import type { GmailQuery as QueryNode } from '../../schemas/gmail-query-schema.ts';

/**
 * Field operator interface for query filters
 */
export interface FieldOperator {
  $any?: string[];
  $all?: string[];
  $none?: string[];
}

/**
 * Field query interface with support for all email fields including categories and labels
 */
export interface FieldQuery {
  from?: FieldOperator | string;
  to?: FieldOperator | string;
  cc?: FieldOperator | string;
  bcc?: FieldOperator | string;
  subject?: FieldOperator | string;
  text?: FieldOperator | string;
  body?: FieldOperator | string;
  categories?: FieldOperator | string;
  label?: FieldOperator | string;
}

/**
 * Filter extraction result with all collected values from a query
 */
export interface Filters {
  subjectIncludes?: string[];
  bodyIncludes?: string[];
  textIncludes?: string[];
  fromIncludes?: string[];
  toIncludes?: string[];
  ccIncludes?: string[];
  bccIncludes?: string[];
  categoriesIncludes?: string[];
  labelIncludes?: string[];
  hasAttachment?: boolean;
  since?: string;
  before?: string;
}

/**
 * Gmail category mappings - case insensitive input to exact system labels
 */
const GMAIL_CATEGORIES = {
  primary: 'CATEGORY_PERSONAL',
  social: 'CATEGORY_SOCIAL',
  promotions: 'CATEGORY_PROMOTIONS',
  updates: 'CATEGORY_UPDATES',
  forums: 'CATEGORY_FORUMS',
} as const;

/**
 * Validate and map category name to Gmail system label
 * Throws error for invalid categories (fail fast principle)
 */
function mapCategoryToLabel(category: string): string {
  // Input validation - fail fast on invalid input
  if (!category || typeof category !== 'string') {
    throw new Error(`Invalid category: expected non-empty string, got ${typeof category}`);
  }

  const trimmed = category.trim();
  if (trimmed === '') {
    throw new Error('Invalid category: empty string after trimming');
  }

  // Fail fast on unknown categories
  const normalizedCategory = trimmed.toLowerCase();
  const systemLabel = GMAIL_CATEGORIES[normalizedCategory as keyof typeof GMAIL_CATEGORIES];

  if (!systemLabel) {
    throw new Error(`Invalid Gmail category: "${category}". Valid categories: ${Object.keys(GMAIL_CATEGORIES).join(', ')}`);
  }

  return systemLabel;
}

export function toGmailQuery(query: QueryNode, options: { dateSlash?: boolean } = {}) {
  const slashDates = options.dateSlash !== false;
  const subjectIncludes: string[] = [];
  const bodyIncludes: string[] = [];
  const textIncludes: string[] = [];
  const fromIncludes: string[] = [];
  const toIncludes: string[] = [];
  const ccIncludes: string[] = [];
  const bccIncludes: string[] = [];
  const categoriesIncludes: string[] = [];
  const labelIncludes: string[] = [];
  let hasAttachment: boolean | undefined;

  function p(s: unknown) {
    return `(${String(s ?? '')})`;
  }
  function fmt(d: unknown) {
    const str = String(d ?? '');
    return slashDates ? str.replace(/-/g, '/') : str;
  }

  function fv(field: string, raw?: unknown) {
    const rawVal = String(raw ?? '');
    if (rawVal.trim() === '') {
      throw new Error(`Invalid ${field} value: empty string`);
    }
    const v = quote(rawVal);
    if (field === 'subject') subjectIncludes.push(rawVal);
    if (field === 'body') bodyIncludes.push(rawVal);
    if (field === 'text') {
      textIncludes.push(rawVal);
      bodyIncludes.push(rawVal);
    }
    if (field === 'from') fromIncludes.push(rawVal);
    if (field === 'to') toIncludes.push(rawVal);
    if (field === 'cc') ccIncludes.push(rawVal);
    if (field === 'bcc') bccIncludes.push(rawVal);
    if (field === 'categories') {
      const systemLabel = mapCategoryToLabel(rawVal);
      categoriesIncludes.push(rawVal);
      return `label:${systemLabel}`;
    }
    if (field === 'label') {
      // Direct passthrough to Gmail's label syntax (case-sensitive)
      labelIncludes.push(rawVal);
      return `label:${quote(rawVal)}`;
    }
    if (field === 'text' || field === 'body') return p(`subject:${v} OR ${v}`);
    return `${field}:${v}`;
  }

  function chain(op: 'AND' | 'OR', arr: string[]) {
    if (arr.length === 0) throw new Error(`chain: empty array for ${op} operation`);
    if (arr.length === 1) {
      const first = arr[0] ?? '';
      return first;
    }
    return p(arr.join(` ${op} `));
  }

  function fieldExpr(field: string, op: FieldOperator) {
    if (op.$any) {
      const results = op.$any.map((v: string) => fv(field, String(v ?? '')));
      return chain('OR', results);
    }
    if (op.$all) {
      const results = op.$all.map((v: string) => fv(field, String(v ?? '')));
      return chain('AND', results);
    }
    if (op.$none) {
      const results = op.$none.map((v: string) => fv(field, String(v ?? '')));
      return `NOT ${p(chain('OR', results))}`;
    }
    throw new Error(`Unknown field operator ${JSON.stringify(op)}`);
  }

  function dateExpr(d: unknown) {
    const parts: string[] = [];
    if (d && typeof d === 'object' && '$gte' in d) {
      parts.push(`after:${fmt(d.$gte)}`);
    }
    if (d && typeof d === 'object' && '$lt' in d) {
      parts.push(`before:${fmt(d.$lt)}`);
    }
    return parts.length > 1 ? p(parts.join(' AND ')) : (parts[0] ?? '');
  }

  function fieldKeys() {
    return ['from', 'to', 'cc', 'bcc', 'subject', 'text', 'body', 'categories', 'label'];
  }

  function quote(s?: unknown) {
    const str = String(s ?? '');
    return /[\s"()]/.test(str) ? `"${str.replace(/["\\]/g, (m) => `\\${m}`)}"` : str;
  }

  function emit(n: unknown): string {
    if (!n || typeof n !== 'object') return '';

    if ('$and' in n && Array.isArray(n.$and)) {
      return p(n.$and.map(emit).join(' AND '));
    }
    if ('$or' in n && Array.isArray(n.$or)) {
      return p(n.$or.map(emit).join(' OR '));
    }
    if ('$not' in n) {
      return `NOT ${emit(n.$not)}`;
    }
    if ('hasAttachment' in n) {
      hasAttachment = true;
      return 'has:attachment';
    }
    if ('fuzzyPhrase' in n) {
      // Gmail fuzzy phrase matching using quoted strings
      // Example: { fuzzyPhrase: "quarterly report" } -> "quarterly report"
      return quote(n.fuzzyPhrase);
    }
    if ('date' in n) {
      return dateExpr(n.date);
    }

    // Handle empty objects
    const keys = Object.keys(n);
    if (keys.length === 0) return '';

    if (keys.length === 1) {
      const k = String(keys[0] ?? '');
      if (fieldKeys().includes(k)) {
        const op = (n as Record<string, unknown>)[k];
        // Handle string-only category queries properly (C2 fix)
        const normalizedOp: FieldOperator = typeof op === 'string' ? { $any: [op] } : (op ?? {});
        return fieldExpr(k, normalizedOp);
      }
    }
    throw new Error(`Unknown node: ${JSON.stringify(n)}`);
  }

  function emitTop(n: unknown): string {
    if (!n || typeof n !== 'object') return '';

    // Handle empty objects
    if (Object.keys(n).length === 0) return '';

    if ('$and' in n && Array.isArray(n.$and)) {
      return n.$and.map(emit).join(' ');
    }
    if ('$or' in n && Array.isArray(n.$or)) {
      return n.$or.map(emit).join(' OR ');
    }
    if ('$not' in n) {
      return `NOT ${emit(n.$not)}`;
    }
    if ('hasAttachment' in n) {
      hasAttachment = true;
      return 'has:attachment';
    }
    if ('fuzzyPhrase' in n) {
      // Gmail fuzzy phrase matching using quoted strings
      return quote(n.fuzzyPhrase);
    }
    if ('date' in n) {
      return dateExpr(n.date);
    }
    return emit(n);
  }

  const q = emitTop(query);
  const filters: Record<string, unknown> = {};
  if (subjectIncludes.length) filters.subjectIncludes = subjectIncludes;
  if (bodyIncludes.length) filters.bodyIncludes = bodyIncludes;
  if (textIncludes.length) filters.textIncludes = textIncludes;
  if (fromIncludes.length) filters.fromIncludes = fromIncludes;
  if (toIncludes.length) filters.toIncludes = toIncludes;
  if (ccIncludes.length) filters.ccIncludes = ccIncludes;
  if (bccIncludes.length) filters.bccIncludes = bccIncludes;
  if (categoriesIncludes.length) filters.categoriesIncludes = categoriesIncludes;
  if (labelIncludes.length) filters.labelIncludes = labelIncludes;
  if (typeof hasAttachment === 'boolean') filters.hasAttachment = hasAttachment;
  return { q: q ?? '', filters };
}

export function extractFiltersFromParsed(parsed: QueryNode): Filters {
  const filters: Filters = {
    subjectIncludes: [],
    bodyIncludes: [],
    textIncludes: [],
    categoriesIncludes: [],
    labelIncludes: [],
  };

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;

    if ('$and' in node && Array.isArray(node.$and)) {
      node.$and.forEach(walk);
      return;
    }
    if ('$or' in node && Array.isArray(node.$or)) {
      node.$or.forEach(walk);
      return;
    }
    if ('$not' in node) {
      walk(node.$not);
      return;
    }
    if ('hasAttachment' in node) {
      filters.hasAttachment = node.hasAttachment === true;
      return;
    }
    if ('date' in node) {
      const dateObj = node.date;
      if (dateObj && typeof dateObj === 'object') {
        if ('$gte' in dateObj) {
          filters.since = String(dateObj.$gte);
        }
        if ('$lt' in dateObj) {
          filters.before = String(dateObj.$lt);
        }
      }
      return;
    }

    const keys = Object.keys(node || {});
    for (const k of keys) {
      const v = (node as Record<string, unknown>)[k];
      if (!v || typeof v !== 'object') continue;

      if (k === 'subject') {
        if ('$any' in v && Array.isArray(v.$any)) filters.subjectIncludes?.push(...v.$any);
        if ('$all' in v && Array.isArray(v.$all)) filters.subjectIncludes?.push(...v.$all);
        if ('$none' in v && Array.isArray(v.$none)) filters.subjectIncludes?.push(...v.$none);
      } else if (k === 'body') {
        if ('$any' in v && Array.isArray(v.$any)) filters.bodyIncludes?.push(...v.$any);
        if ('$all' in v && Array.isArray(v.$all)) filters.bodyIncludes?.push(...v.$all);
        if ('$none' in v && Array.isArray(v.$none)) filters.bodyIncludes?.push(...v.$none);
      } else if (k === 'text') {
        if ('$any' in v && Array.isArray(v.$any)) filters.textIncludes?.push(...v.$any);
        if ('$all' in v && Array.isArray(v.$all)) filters.textIncludes?.push(...v.$all);
        if ('$none' in v && Array.isArray(v.$none)) filters.textIncludes?.push(...v.$none);
      } else if (k === 'categories') {
        // Validate all categories (will throw on invalid)
        if ('$any' in v && Array.isArray(v.$any)) {
          v.$any.forEach((cat: unknown) => {
            mapCategoryToLabel(String(cat));
          });
          filters.categoriesIncludes?.push(...v.$any.map(String));
        }
        if ('$all' in v && Array.isArray(v.$all)) {
          v.$all.forEach((cat: unknown) => {
            mapCategoryToLabel(String(cat));
          });
          filters.categoriesIncludes?.push(...v.$all.map(String));
        }
        if ('$none' in v && Array.isArray(v.$none)) {
          v.$none.forEach((cat: unknown) => {
            mapCategoryToLabel(String(cat));
          });
          filters.categoriesIncludes?.push(...v.$none.map(String));
        }
      } else if (k === 'label') {
        // Direct passthrough for labels (case-sensitive)
        if ('$any' in v && Array.isArray(v.$any)) filters.labelIncludes?.push(...v.$any.map(String));
        if ('$all' in v && Array.isArray(v.$all)) filters.labelIncludes?.push(...v.$all.map(String));
        if ('$none' in v && Array.isArray(v.$none)) filters.labelIncludes?.push(...v.$none.map(String));
      }
    }
  }
  walk(parsed);
  return filters;
}
