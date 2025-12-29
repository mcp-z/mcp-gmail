import { type BaseEmailQueryFields, baseEmailQueryFields, type FieldOperator, FieldOperatorSchema } from '@mcp-z/email';
import { z } from 'zod';

/**
 * Gmail-specific query schema with recursive operators and Gmail features.
 *
 * Includes Gmail-specific features:
 * - fuzzyPhrase: Approximate phrase matching (Gmail's quoted string behavior with relevance ranking)
 * - categories: Gmail system categories (primary, social, promotions, updates, forums)
 * - label: User-created Gmail labels (case-sensitive, discovered via gmail-labels-list)
 * - rawGmailQuery: Escape hatch for advanced Gmail query syntax
 *
 * Plus all base fields from baseEmailQueryFields:
 * - Email addresses: from, to, cc, bcc (support string or field operators)
 * - Content: subject, body, text
 * - Flags: hasAttachment, isRead
 * - Date range: date { $gte, $lt }
 * - Logical operators: $and, $or, $not (recursive)
 *
 * Note: Cast through unknown to work around Zod's lazy schema type inference issue
 * with exactOptionalPropertyTypes. The runtime schema is correct; this cast ensures
 * TypeScript sees the strict GmailQuery type everywhere the schema is used.
 */
export const GmailQuerySchema = z.lazy(() =>
  z
    .object({
      // Logical operators for combining conditions (recursive)
      $and: z.array(GmailQuerySchema).optional().describe('Array of conditions that must ALL match'),
      $or: z.array(GmailQuerySchema).optional().describe('Array of conditions where ANY must match'),
      $not: GmailQuerySchema.optional().describe('Nested condition that must NOT match'),

      // Spread base email query fields (from, to, subject, body, etc.)
      ...baseEmailQueryFields,

      // Gmail-specific features

      // Fuzzy phrase matching - Gmail's approximate search using quoted strings
      fuzzyPhrase: z.string().min(1).optional().describe('Fuzzy phrase matching - words should appear together (approximate matching). Gmail uses relevance-based matching.'),

      // Gmail system categories with field operator support
      categories: z
        .union([
          z.enum(['primary', 'social', 'promotions', 'updates', 'forums']),
          z
            .object({
              $any: z.array(z.enum(['primary', 'social', 'promotions', 'updates', 'forums'])).optional(),
              $all: z.array(z.enum(['primary', 'social', 'promotions', 'updates', 'forums'])).optional(),
              $none: z.array(z.enum(['primary', 'social', 'promotions', 'updates', 'forums'])).optional(),
            })
            .strict(),
        ])
        .optional()
        .describe('Filter by Gmail system categories (primary, social, promotions, updates, forums)'),

      // User-created labels
      label: z
        .union([z.string().min(1), FieldOperatorSchema])
        .optional()
        .describe('Filter by user-created labels (case-sensitive). Use gmail-labels-list to see available labels'),

      // Raw Gmail query string - escape hatch for advanced syntax
      rawGmailQuery: z.string().min(1).optional().describe('Raw Gmail query syntax for advanced use cases. Bypasses schema validation - use sparingly.'),
    })
    .strict()
) as unknown as z.ZodType<GmailQuery>;

export type GmailQuery = BaseEmailQueryFields & {
  $and?: GmailQuery[];
  $or?: GmailQuery[];
  $not?: GmailQuery;
  fuzzyPhrase?: string;
  categories?:
    | 'primary'
    | 'social'
    | 'promotions'
    | 'updates'
    | 'forums'
    | {
        $any?: ('primary' | 'social' | 'promotions' | 'updates' | 'forums')[];
        $all?: ('primary' | 'social' | 'promotions' | 'updates' | 'forums')[];
        $none?: ('primary' | 'social' | 'promotions' | 'updates' | 'forums')[];
      };
  label?: string | FieldOperator;
  rawGmailQuery?: string;
};
