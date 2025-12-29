import { extractCurrentMessageFromHtmlToText, extractCurrentMessageFromText, formatAddresses, normalizeDateToISO } from '@mcp-z/email';

export interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: {
      data?: string;
    };
    parts?: Array<{
      mimeType: string;
      body?: {
        data?: string;
      };
    }>;
  };
}

interface GmailEmailSummary {
  id: string;
  provider: 'gmail';
  threadId?: string | undefined;
  date?: string | undefined;
  from?: string | undefined;
  fromName?: string | undefined;
  to?: string | undefined;
  cc?: string | undefined;
  bcc?: string | undefined;
  subject?: string | undefined;
  snippet?: string | undefined;
  body?: string | undefined;
}

interface FormatOptions {
  body?: boolean;
  addressFormat?: 'raw' | 'name' | 'email';
}

function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  if (!headers || !Array.isArray(headers)) return '';
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

interface AddressToken {
  name?: string | undefined;
  email: string;
}

function parseEmailHeader(headerValue: string): AddressToken[] {
  if (!headerValue) return [];

  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < headerValue.length; i++) {
    const char = headerValue[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ',' && !inQuotes) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current) parts.push(current.trim());

  return parts
    .map((part): AddressToken => {
      const match = part.match(/^(?:"?([^"]*)"? <([^>]+)>|([^,]+))$/);
      if (match) {
        if (match[2]) {
          return { name: match[1] || undefined, email: match[2] };
        }
        return { email: match[3] || '' };
      }
      return { email: part.trim() };
    })
    .filter((token) => !!token.email); // Type guard to ensure email is always present
}

function formatRecipientHeader(headerValue: string, mode: 'raw' | 'name' | 'email' = 'email'): string {
  const addresses = parseEmailHeader(headerValue);
  return formatAddresses(addresses, mode);
}

/**
 * Sanitizes email body text for Google Sheets export by enforcing cell character limits.
 * Google Sheets API limits cells to 50,000 characters - this prevents API errors during export.
 */
function sanitizeForSheetsExport(text: string): string {
  // Google Sheets has a 50,000 character limit per cell
  // Leave some buffer for safety
  const GOOGLE_SHEETS_CELL_LIMIT = 49000;

  if (text.length <= GOOGLE_SHEETS_CELL_LIMIT) return text;

  // Truncate and add indication that it was truncated
  const truncated = text.substring(0, GOOGLE_SHEETS_CELL_LIMIT - 100);
  return `${truncated}\n\n[...content truncated to fit Google Sheets cell limit...]`;
}

export function toRowFromGmail(msg: GmailMessage = {}, opts: FormatOptions = { body: false, addressFormat: 'email' }) {
  const id = msg.id ?? '';
  const provider = 'gmail';
  const threadId = msg.threadId ?? '';
  const fmt = opts.addressFormat || 'email';

  const headers = msg.payload?.headers || [];
  const toHeader = getHeader(headers, 'To');
  const fromHeader = getHeader(headers, 'From');
  const ccHeader = getHeader(headers, 'Cc');
  const bccHeader = getHeader(headers, 'Bcc');
  const dateHeader = getHeader(headers, 'Date');
  const subjectHeader = getHeader(headers, 'Subject');

  const to = formatRecipientHeader(toHeader, fmt);
  const from = formatRecipientHeader(fromHeader, fmt);
  const cc = formatRecipientHeader(ccHeader, fmt);
  const bcc = formatRecipientHeader(bccHeader, fmt);
  const date = normalizeDateToISO(dateHeader) ?? '';
  const subject = subjectHeader ?? '';

  const labels = (msg.labelIds || []).join(', ');
  const snippet = msg.snippet ?? '';

  let bodyFull = '';
  if (opts.body) {
    if (msg.payload) {
      if (msg.payload.body?.data) {
        const rawBody = Buffer.from(msg.payload.body.data, 'base64').toString('utf-8');
        bodyFull = extractCurrentMessageFromText(rawBody);
      } else if (msg.payload.parts && Array.isArray(msg.payload.parts)) {
        for (const part of msg.payload.parts) {
          if (part.body?.data) {
            const rawBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
            if (part.mimeType === 'text/plain') {
              bodyFull = extractCurrentMessageFromText(rawBody);
              break;
            }
            if (part.mimeType === 'text/html') {
              bodyFull = extractCurrentMessageFromHtmlToText(rawBody);
              break;
            }
          }
        }
      }
    }
  }

  return [id, provider, threadId, to, from, cc, bcc, date, subject, labels, snippet, sanitizeForSheetsExport(bodyFull)];
}

export function toRowFromGmailSummary(msg: GmailEmailSummary, opts: FormatOptions = { body: false, addressFormat: 'email' }) {
  const id = msg.id ?? '';
  const provider = msg.provider || 'gmail';
  const threadId = msg.threadId ?? '';
  const fmt = opts.addressFormat || 'email';

  const to = formatRecipientHeader(msg.to ?? '', fmt);
  const from = formatRecipientHeader(msg.from ?? '', fmt);
  const cc = formatRecipientHeader(msg.cc ?? '', fmt);
  const bcc = formatRecipientHeader(msg.bcc ?? '', fmt);
  const date = normalizeDateToISO(msg.date) ?? '';
  const subject = msg.subject ?? '';
  const labels = '';
  const snippet = msg.snippet ?? '';

  let bodyFull = '';
  if (opts.body && msg.body) {
    bodyFull = extractCurrentMessageFromText(msg.body);
  }

  return [id, provider, threadId, to, from, cc, bcc, date, subject, labels, snippet, sanitizeForSheetsExport(bodyFull)];
}

interface ClientSideFilters {
  subjectIncludes?: string[];
  bodyIncludes?: string[];
  textIncludes?: string[];
  fromIncludes?: string[];
  toIncludes?: string[];
  ccIncludes?: string[];
  bccIncludes?: string[];
}

interface FilterContent {
  subject?: string;
  snippetOrPreview?: string;
  fullBody?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
}

export function filterClientSide(filters: ClientSideFilters, { subject = '', snippetOrPreview = '', fullBody = '', from = '', to = '', cc = '', bcc = '' }: FilterContent = {}) {
  const lower = (a: string[]) => a.map((t) => String(t).toLowerCase());
  const subjectTokens = lower(filters.subjectIncludes || []);
  const bodyTokens = lower(filters.bodyIncludes || []);
  const textTokens = lower(filters.textIncludes || []);
  const fromTokens = lower(filters.fromIncludes || []);
  const toCredentials = lower(filters.toIncludes || []);
  const ccTokens = lower(filters.ccIncludes || []);
  const bccTokens = lower(filters.bccIncludes || []);

  const s = String(subject ?? '').toLowerCase();
  const b = String((fullBody || snippetOrPreview) ?? '').toLowerCase();
  const f = String(from ?? '').toLowerCase();
  const t = String(to ?? '').toLowerCase();
  const c = String(cc ?? '').toLowerCase();
  const bc = String(bcc ?? '').toLowerCase();

  const anyIncludes = (val: string, tokens: string[]) => (tokens.length === 1 ? val.includes(tokens[0] ?? '') : tokens.some((token) => val.includes(token)));
  const subjectOk = subjectTokens.length ? anyIncludes(s, subjectTokens) : true;
  const bodyOk = bodyTokens.length ? anyIncludes(b, bodyTokens) : true;
  const textOk = textTokens.length ? textTokens.some((token) => s.includes(token) || b.includes(token)) : true;
  const fromOk = fromTokens.length ? anyIncludes(f, fromTokens) : true;
  const toOk = toCredentials.length ? anyIncludes(t, toCredentials) : true;
  const ccOk = ccTokens.length ? anyIncludes(c, ccTokens) : true;
  const bccOk = bccTokens.length ? anyIncludes(bc, bccTokens) : true;

  return subjectOk && bodyOk && textOk && fromOk && toOk && ccOk && bccOk;
}
