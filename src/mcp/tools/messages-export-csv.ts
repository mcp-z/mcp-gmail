import { EmailContentTypeSchema, ExcludeThreadHistorySchema } from '@mcp-z/email';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import { getFileUri, reserveFile, type ToolModule } from '@mcp-z/server';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { stringify } from 'csv-stringify/sync';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { type gmail_v1, google } from 'googleapis';
import { z } from 'zod';
import { DEFAULT_PAGE_SIZE } from '../../constants.ts';
import { extractBodyFromPayload } from '../../email/parsing/html-processing.ts';
import { executeQuery as executeGmailQuery } from '../../email/querying/execute-query.ts';
import { GmailQuerySchema } from '../../schemas/gmail-query-schema.ts';
import type { StorageExtra } from '../../types.ts';

const DEFAULT_MAX_ITEMS = 10000;
const MAX_EXPORT_ITEMS = 50000;

/**
 * CSV row format based on EmailDetail
 * All fields are strings (empty string instead of undefined)
 * Includes additional CSV-specific fields: provider and labels
 */
interface CsvRow {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  provider: string;
  labels: string;
}

const inputSchema = z.object({
  query: GmailQuerySchema.optional().describe('Structured query object for filtering messages. Use query-syntax prompt for reference.'),
  maxItems: z.number().int().positive().max(MAX_EXPORT_ITEMS).default(DEFAULT_MAX_ITEMS).describe(`Maximum messages to export (default: ${DEFAULT_MAX_ITEMS}, max: ${MAX_EXPORT_ITEMS})`),
  filename: z.string().trim().min(1).default('gmail-messages.csv').describe('Output filename (default: gmail-messages.csv)'),
  contentType: EmailContentTypeSchema,
  excludeThreadHistory: ExcludeThreadHistorySchema,
});

const successBranchSchema = z.object({
  type: z.literal('success'),
  uri: z.string().describe('File URI (file:// or http://)'),
  filename: z.string().describe('Stored filename'),
  rowCount: z.number().describe('Number of messages exported'),
  truncated: z.boolean().describe('Whether export was truncated at maxItems'),
});

const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'Export Gmail messages to CSV with streaming pagination. Returns file URI. Use query-syntax prompt for query reference.',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

/**
 * Handler for gmail-messages-export-csv tool
 *
 * CRITICAL: Streaming implementation per user requirements
 * - Generate UUID upfront
 * - Write CSV header immediately
 * - Append rows as batches arrive
 * - Delete partial file on error
 * - NO RETRIES (fail fast on error)
 */
async function handler({ query, maxItems, filename, contentType, excludeThreadHistory }: Input, extra: EnrichedExtra & StorageExtra) {
  const logger = extra.logger;
  const { storageContext } = extra;
  const { transport, storageDir, baseUrl } = storageContext;

  logger.info('gmail.messages.export-csv called', {
    query,
    maxItems,
    filename,
    accountId: extra.authContext.accountId,
  });

  // Reserve file location for streaming write (creates directory, generates ID, formats filename)
  const reservation = await reserveFile(filename, {
    storageDir,
  });
  const { storedName, fullPath } = reservation;

  logger.info('gmail.messages.export-csv starting streaming export', { path: fullPath, maxItems });

  try {
    const gmail = google.gmail({ version: 'v1', auth: extra.authContext.auth });

    // Create CSV headers (all email fields)
    const csvHeaders = ['id', 'threadId', 'from', 'to', 'cc', 'bcc', 'subject', 'date', 'snippet', 'body', 'provider', 'labels'];

    // Create write stream and write headers immediately
    const writeStream = createWriteStream(fullPath, { encoding: 'utf-8' });
    const headerLine = stringify([csvHeaders], { header: false, quoted: true, quote: '"', escape: '"' });
    writeStream.write(headerLine);

    // Internal pagination loop - append to CSV with each batch
    // NO RETRIES: If any error occurs, fail the whole operation and clean up
    let totalRows = 0;
    let nextPageToken: string | undefined;
    const started = Date.now();

    while (totalRows < maxItems) {
      const remainingItems = maxItems - totalRows;
      const pageSize = Math.min(remainingItems, DEFAULT_PAGE_SIZE);

      const exec: {
        items: CsvRow[];
        metadata?: { nextPageToken?: string };
      } = await executeGmailQuery(
        query,
        {
          client: gmail,
          logger,
          pageSize,
          ...(nextPageToken !== undefined && { pageToken: nextPageToken }),
          includeBody: true, // Always include body for CSV export
        },
        (full: unknown): CsvRow => {
          // Type-safe property access with guards
          const fullData = full as {
            id?: unknown;
            threadId?: unknown;
            snippet?: unknown;
            labelIds?: unknown[];
            payload?: { headers?: unknown[] };
          };

          const headersArray = Array.isArray(fullData?.payload?.headers) ? fullData.payload.headers : [];
          const headers = Object.fromEntries(
            headersArray.map((h: unknown) => {
              const header = h as { name?: unknown; value?: unknown };
              return [String(header.name ?? ''), String(header.value ?? '')];
            })
          );

          const payload = fullData?.payload;
          // Cast to Schema$MessagePart for extractBodyFromPayload
          const body = payload ? extractBodyFromPayload(payload as gmail_v1.Schema$MessagePart, { contentType, excludeThreadHistory }) : '';

          const labelIds = Array.isArray(fullData?.labelIds) ? fullData.labelIds.map((id) => String(id ?? '')) : [];

          return {
            id: String(fullData?.id ?? ''),
            threadId: fullData?.threadId ? String(fullData.threadId) : '',
            from: headers?.From || '',
            to: headers?.To || '',
            cc: headers?.Cc || '',
            bcc: headers?.Bcc || '',
            subject: headers?.Subject || '',
            date: headers?.Date || '',
            snippet: fullData?.snippet ? String(fullData.snippet) : '',
            body,
            provider: 'gmail',
            labels: labelIds.join(';'),
          };
        }
      );

      // Type-safe CSV row mapping
      const csvRows = exec.items.map((row) => {
        return [row.id, row.threadId, row.from, row.to, row.cc, row.bcc, row.subject, row.date, row.snippet, row.body, row.provider, row.labels];
      });

      // Append rows to CSV file immediately
      if (csvRows.length > 0) {
        const rowsContent = stringify(csvRows, { header: false, quoted: true, quote: '"', escape: '"' });
        writeStream.write(rowsContent);
      }

      totalRows += exec.items.length;
      nextPageToken = exec.metadata?.nextPageToken;

      logger.info('gmail.messages.export-csv batch written', {
        batchSize: exec.items.length,
        totalRows,
        hasMore: Boolean(nextPageToken),
      });

      // Exit if no more results or reached maxItems
      if (!nextPageToken || exec.items.length === 0) {
        break;
      }
    }

    // Close write stream
    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });

    const durationMs = Date.now() - started;
    const truncated = totalRows >= maxItems && Boolean(nextPageToken);

    logger.info('gmail.messages.export-csv completed', {
      rowCount: totalRows,
      truncated,
      durationMs,
      filename: storedName,
    });

    // Generate URI based on transport type (stdio: file://, HTTP: http://)
    const uri = getFileUri(storedName, transport, {
      storageDir,
      ...(baseUrl && { baseUrl }),
      endpoint: '/files',
    });

    const result: Output = {
      type: 'success' as const,
      uri,
      filename: storedName,
      rowCount: totalRows,
      truncated,
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
    // CRITICAL: Clean up partial CSV file on error
    try {
      await unlink(fullPath);
      logger.debug('Cleaned up partial CSV file after error', { path: fullPath });
    } catch (_cleanupError) {
      logger.debug('Could not clean up CSV file (may not exist)', { path: fullPath });
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error('gmail.messages.export-csv error', { error: message });

    throw new McpError(ErrorCode.InternalError, `Error exporting messages to CSV: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'messages-export-csv',
    config,
    handler,
  } satisfies ToolModule;
}
