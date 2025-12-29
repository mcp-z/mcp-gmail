import { EMAIL_COMMON_PATTERNS, EMAIL_FIELD_DESCRIPTIONS, EMAIL_FIELDS, EmailContentTypeSchema, type EmailDetail, EmailDetailSchema, ExcludeThreadHistorySchema } from '@mcp-z/email';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import { createFieldsSchema, filterFields, parseFields, type ToolModule } from '@mcp-z/server';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { type gmail_v1, google } from 'googleapis';
import { z } from 'zod';
import { extractBodyFromPayload, extractEmails, extractFrom } from '../../email/parsing/message-extraction.js';
import { toIsoUtc } from '../../lib/date-conversion.js';

const inputSchema = z.object({
  id: z.coerce.string().trim().min(1).describe('Gmail message ID to retrieve'),
  fields: createFieldsSchema({
    availableFields: EMAIL_FIELDS,
    fieldDescriptions: EMAIL_FIELD_DESCRIPTIONS,
    commonPatterns: EMAIL_COMMON_PATTERNS,
    resourceName: 'email message',
  }),
  contentType: EmailContentTypeSchema,
  excludeThreadHistory: ExcludeThreadHistorySchema,
});

// Success branch schema
const successBranchSchema = z.object({
  type: z.literal('success'),
  item: EmailDetailSchema,
});

// Output schema with auth_required support
const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'Get a Gmail message by ID with flexible field selection',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

async function handler({ id, fields, contentType, excludeThreadHistory }: Input, extra: EnrichedExtra) {
  const logger = extra.logger;

  const requestedFields = parseFields(fields, EMAIL_FIELDS);

  logger.info('gmail.message.get called', { id: Boolean(id), fields: fields || 'all' });

  try {
    if (!id) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing id');
    }

    const gmail = google.gmail({ version: 'v1', auth: extra.authContext.auth });
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: id,
      format: 'full',
      metadataHeaders: ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Date'],
    });
    const fullData = response.data;
    if (!fullData) {
      throw new McpError(ErrorCode.InvalidRequest, 'Message not found');
    }

    // Build full message data with type guards
    const headers = fullData?.payload?.headers;
    const headersArray = Array.isArray(headers) ? headers : [];
    const headersMap: Record<string, string> = Object.fromEntries(
      headersArray.map((h: unknown) => {
        const header = h as gmail_v1.Schema$MessagePartHeader;
        return [String(header.name ?? ''), String(header.value ?? '')];
      })
    );
    const fromInfo = extractFrom(headersMap.From);
    const toStr = extractEmails(headersMap.To).join(', ');
    const ccStr = extractEmails(headersMap.Cc).join(', ');
    const bccStr = extractEmails(headersMap.Bcc).join(', ');
    const messagePayload = fullData?.payload;
    const bodyContent = messagePayload ? extractBodyFromPayload(messagePayload, { contentType, excludeThreadHistory }) : '';
    const payload: Partial<EmailDetail> = {
      id: fullData.id ?? undefined,
      threadId: fullData.threadId ?? undefined,
      date: toIsoUtc(headersMap.Date) || headersMap.Date,
      from: fromInfo?.address || headersMap.From,
      fromName: fromInfo?.name,
      to: toStr,
      cc: ccStr,
      bcc: bccStr,
      subject: headersMap.Subject ?? '',
      snippet: fullData.snippet ?? undefined,
      body: bodyContent,
      bodyContentType: contentType,
    };

    // Filter based on requested fields
    const filteredPayload = filterFields(payload, requestedFields);

    logger.info('gmail.message.get result', { id: fullData.id, subject: payload.subject, from: payload.from, fields: fields || 'all' });

    const result: Output = {
      type: 'success' as const,
      item: filteredPayload,
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
    logger.error('gmail.message.get error', { error: message });

    throw new McpError(ErrorCode.InternalError, `Error getting message: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'message-get',
    config,
    handler,
  } satisfies ToolModule;
}
