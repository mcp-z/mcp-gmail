import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';

const inputSchema = z.object({
  to: z.coerce.string().trim().min(1).describe('Recipient email address(es). For multiple recipients, use comma-separated.'),
  subject: z.coerce.string().default('').describe('Email subject line'),
  body: z.coerce.string().trim().min(1).describe('Email body content (plain text or HTML)'),
  cc: z.coerce.string().optional().describe('CC recipients (comma-separated)'),
  bcc: z.coerce.string().optional().describe('BCC recipients (comma-separated)'),
  contentType: z.enum(['text', 'html']).default('text').describe('Format of the body content'),
  replyToMessageId: z.coerce.string().optional().describe('Message ID to create draft as reply to'),
});

// Success branch schema
const successBranchSchema = z.object({
  type: z.literal('success'),
  item: z.object({
    id: z.string().describe('Draft ID'),
    messageId: z.string().describe('Message ID of the draft'),
    webLink: z.string().describe('Link to view draft in Gmail'),
  }),
});

// Output schema with auth_required support
const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'Create a draft email in Gmail (does not send)',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

function createRawEmail(
  to: string,
  subject: string,
  body: string,
  contentType: 'text' | 'html',
  cc?: string,
  bcc?: string,
  replyToMessageId?: string,
  threadId?: string
): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const mimeType = contentType === 'html' ? 'text/html' : 'text/plain';

  let headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${mimeType}; charset=utf-8`,
  ];

  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  if (replyToMessageId) {
    headers.push(`In-Reply-To: ${replyToMessageId}`);
    headers.push(`References: ${replyToMessageId}`);
  }

  const rawEmail = headers.join('\r\n') + '\r\n\r\n' + body;

  // Base64url encode
  return Buffer.from(rawEmail)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function handler(input: Input, extra: EnrichedExtra) {
  const logger = extra.logger;
  const { to, subject, body, cc, bcc, contentType, replyToMessageId } = input;

  logger.info('gmail.draft.create called', { to, subject });

  if (!to || !body) {
    throw new McpError(ErrorCode.InvalidParams, 'Missing required fields: to, body');
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: extra.authContext.auth });

    // If replying, get the thread ID
    let threadId: string | undefined;
    if (replyToMessageId) {
      const originalMessage = await gmail.users.messages.get({
        userId: 'me',
        id: replyToMessageId,
        format: 'minimal',
      });
      threadId = originalMessage.data.threadId || undefined;
    }

    const raw = createRawEmail(to, subject, body, contentType, cc, bcc, replyToMessageId, threadId);

    const draft = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw,
          threadId,
        },
      },
    });

    if (!draft.data.id || !draft.data.message?.id) {
      throw new Error('Failed to create draft');
    }

    logger.info('gmail.draft.create success', { draftId: draft.data.id });

    const result: Output = {
      type: 'success' as const,
      item: {
        id: draft.data.id,
        messageId: draft.data.message.id,
        webLink: `https://mail.google.com/mail/u/0/#drafts/${draft.data.message.id}`,
      },
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
    logger.error('gmail.draft.create error', { error: message });

    throw new McpError(ErrorCode.InternalError, `Error creating draft: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'draft-create',
    config,
    handler,
  } satisfies ToolModule;
}
