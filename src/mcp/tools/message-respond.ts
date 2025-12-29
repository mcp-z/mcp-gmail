import { ComposeContentTypeSchema } from '@mcp-z/email';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { extractEmails } from '../../email/parsing/headers-utils.js';
import { b64url } from '../../lib/base64-encoding.js';

const inputSchema = z.object({
  id: z.coerce.string().trim().min(1).describe('Gmail message ID to reply to'),
  body: z.coerce.string().trim().min(1).describe('Reply body content (plain text or HTML)'),
  contentType: ComposeContentTypeSchema,
});

const successBranchSchema = z.object({
  type: z.literal('success'),
  id: z.string().describe('Original message ID that was replied to'),
});

const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'Send a reply to a Gmail message',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

async function handler({ id, body, contentType }: Input, extra: EnrichedExtra) {
  const logger = extra.logger;

  if (!id || !body) {
    throw new McpError(ErrorCode.InvalidParams, 'Missing id or body');
  }

  logger.info('gmail.message.respond called', { id, contentType });

  try {
    const gmail = google.gmail({ version: 'v1', auth: extra.authContext.auth });

    let full: unknown;
    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Reply-To', 'Subject', 'Message-ID', 'References', 'In-Reply-To', 'Date'],
      });
      full = response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('gmail.message.respond fetch error', { error: message });

      throw new McpError(ErrorCode.InternalError, `Error fetching message metadata: ${message}`, {
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    // Type-safe header extraction
    const fullData = full as { payload?: { headers?: unknown[] }; threadId?: unknown };
    const headersArray = Array.isArray(fullData?.payload?.headers) ? fullData.payload.headers : [];
    const headers = Object.fromEntries(
      headersArray.map((h: unknown) => {
        const header = h as { name?: unknown; value?: unknown };
        return [String(header.name ?? ''), String(header.value ?? '')];
      })
    );
    const fromHdr = headers.From || headers.from;
    const replyToHdr = headers['Reply-To'] || headers['reply-to'];
    const toAddr = (replyToHdr ? extractEmails(replyToHdr)[0] : extractEmails(fromHdr)[0]) ?? '';
    const subject = (headers.Subject || headers.subject) ?? '';
    const messageIdHeader = headers['Message-ID'] || headers['Message-Id'] || headers['message-id'];
    const references = (headers.References || headers.references) ?? '';
    const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
    const inReplyTo = messageIdHeader?.startsWith('<') ? messageIdHeader : messageIdHeader ? `<${messageIdHeader}>` : undefined;
    const refs = [references, inReplyTo].filter(Boolean).join(' ').trim();
    const mimeType = contentType === 'html' ? 'text/html' : 'text/plain';
    const lines = [`To: ${toAddr}`, `Subject: ${replySubject}`, `In-Reply-To: ${inReplyTo ?? ''}`, `References: ${refs}`, 'MIME-Version: 1.0', `Content-Type: ${mimeType}; charset=UTF-8`, '', body].join('\r\n');
    const raw = b64url(lines);

    // Prepare request body with conditional threadId for exactOptionalPropertyTypes
    const threadId = fullData?.threadId ? String(fullData.threadId) : undefined;
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: raw,
        ...(threadId && { threadId }),
      },
    });

    logger.info('gmail.message.respond sent reply', { id });

    const result: Output = {
      type: 'success' as const,
      id,
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
    logger.error('gmail.message.respond error', { error: message });

    throw new McpError(ErrorCode.InternalError, `Error responding to message: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'message-respond',
    config,
    handler,
  } satisfies ToolModule;
}
