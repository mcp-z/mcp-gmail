import { type gmail_v1, gmail as gmailApi } from '@googleapis/gmail';
import { ProtocolError, ProtocolErrorCode } from '@mcp-z/server';
/** Gmail message search using middleware-based auth pattern */

import { EMAIL_COMMON_PATTERNS, EMAIL_FIELD_DESCRIPTIONS, EMAIL_FIELDS, EmailContentTypeSchema, type EmailDetail, EmailDetailSchema, ExcludeThreadHistorySchema } from '@mcp-z/email';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import { createFieldsSchema, createPaginationSchema, createShapeSchema, filterFields, parseFields, type ToolModule, toColumnarFormat } from '@mcp-z/server';
import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../constants.ts';
import { extractBodyFromPayload } from '../../email/parsing/html-processing.ts';
import { executeQuery as executeGmailQuery } from '../../email/querying/execute-query.ts';
import { googleAuth } from '../../lib/google-auth.ts';
import { GmailQueryParameterSchema, parseGmailQueryParameter } from '../../schemas/gmail-query-schema.ts';

const inputSchema = z.object({
  query: GmailQueryParameterSchema.optional().describe('Structured query object or JSON string for filtering messages. Use query-syntax prompt for reference and rawGmailQuery for Gmail syntax.'),
  fields: createFieldsSchema({
    availableFields: EMAIL_FIELDS,
    fieldDescriptions: EMAIL_FIELD_DESCRIPTIONS,
    commonPatterns: EMAIL_COMMON_PATTERNS,
    resourceName: 'email message',
  }),
  ...createPaginationSchema({ defaultPageSize: DEFAULT_PAGE_SIZE, maxPageSize: MAX_PAGE_SIZE, provider: 'gmail' }).shape,
  shape: createShapeSchema(),
  contentType: EmailContentTypeSchema,
  excludeThreadHistory: ExcludeThreadHistorySchema,
});

// Success branch schemas for different shapes
const successObjectsBranchSchema = z.object({
  type: z.literal('success'),
  shape: z.literal('objects'),
  items: z.array(EmailDetailSchema).describe('Matching email messages'),
  nextPageToken: z.string().optional().describe('Token for fetching next page of results'),
});

const successArraysBranchSchema = z.object({
  type: z.literal('success'),
  shape: z.literal('arrays'),
  columns: z.array(z.string()).describe('Column names in canonical order'),
  rows: z.array(z.array(z.unknown())).describe('Row data matching column order'),
  nextPageToken: z.string().optional().describe('Token for fetching next page of results'),
});

// Output schema with auth_required support
// Using z.union instead of discriminatedUnion since we have two success branches with different shapes
const outputSchema = z.union([successObjectsBranchSchema, successArraysBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'Search Gmail messages using structured query objects with flexible field selection.',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

async function handler({ query, pageSize = DEFAULT_PAGE_SIZE, pageToken, fields, shape = 'arrays', contentType = 'text', excludeThreadHistory = false }: Input, extra: EnrichedExtra) {
  const logger = extra.logger;

  try {
    const parsedQuery = parseGmailQueryParameter(query);
    const requestedFields = parseFields(fields, EMAIL_FIELDS);
    const includeBody = requestedFields === 'all' || requestedFields.has('body');

    logger.info('gmail.message.search called', {
      query: parsedQuery,
      pageSize,
      pageToken: pageToken ? '[provided]' : undefined,
      fields,
      includeBody,
      accountId: extra.authContext.accountId, // Available from middleware
    });

    const gmail = gmailApi({ version: 'v1', auth: googleAuth(extra.authContext.auth) });

    const started = Date.now();

    const exec = await executeGmailQuery(
      parsedQuery,
      {
        client: gmail,
        logger,
        pageSize,
        ...(pageToken !== undefined && { pageToken }),
        includeBody,
      },
      (full: unknown) => {
        // Type-safe property access with guards
        const fullData = full as gmail_v1.Schema$Message;

        const headersArray = Array.isArray(fullData?.payload?.headers) ? fullData.payload.headers : [];
        const headers = Object.fromEntries(
          headersArray.map((h: unknown) => {
            const header = h as gmail_v1.Schema$MessagePartHeader;
            return [String(header.name ?? ''), String(header.value ?? '')];
          })
        );

        const mapped: Partial<EmailDetail> = {
          id: String(fullData?.id ?? ''),
          threadId: fullData?.threadId ? String(fullData.threadId) : undefined,
          from: headers?.From,
          to: headers?.To,
          subject: headers?.Subject,
          date: headers?.Date,
          snippet: fullData?.snippet ? String(fullData.snippet) : undefined,
        };

        if (includeBody) {
          const payload = fullData?.payload;
          // Cast to Schema$MessagePart for extractBodyFromPayload
          const body = payload ? extractBodyFromPayload(payload as gmail_v1.Schema$MessagePart, { contentType, excludeThreadHistory }) : '';
          if (body) {
            mapped.body = body;
            mapped.bodyContentType = contentType;
          }
        }
        return mapped;
      }
    );

    const items = exec.items;
    const metadata = exec.metadata;
    const durationMs = Date.now() - started;

    // Type-safe field filtering
    const filteredItems = items.map((item) => filterFields(item, requestedFields));

    logger.info('gmail.message.search results', { query, pageSize, resultCount: filteredItems.length, fields: fields || 'all' });
    logger.info('gmail.message.search metrics', { durationMs, metadata });

    // Type-safe metadata access
    const metadataObj = metadata as { nextPageToken?: string } | undefined;

    // Build result based on shape
    const result: Output =
      shape === 'arrays'
        ? {
            type: 'success' as const,
            shape: 'arrays' as const,
            ...toColumnarFormat(filteredItems, requestedFields, EMAIL_FIELDS),
            ...(metadataObj?.nextPageToken && { nextPageToken: metadataObj.nextPageToken }),
          }
        : {
            type: 'success' as const,
            shape: 'objects' as const,
            items: filteredItems,
            ...(metadataObj?.nextPageToken && { nextPageToken: metadataObj.nextPageToken }),
          };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result),
        },
      ],
      structuredContent: { result },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('gmail.message.search error', { error: message });

    throw new ProtocolError(ProtocolErrorCode.InternalError, `Error searching messages: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'message-search',
    config,
    handler,
  } satisfies ToolModule;
}
