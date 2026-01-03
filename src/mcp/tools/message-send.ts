import { ComposeContentTypeSchema, createEmailRecipientsSchema, createMessageResultSchema } from '@mcp-z/email';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { buildRfc822FromArgs } from '../../email/composition/rfc822-builder.ts';
import { b64url } from '../../lib/base64-encoding.ts';

const inputSchema = z.object({
  to: createEmailRecipientsSchema('to', true),
  cc: createEmailRecipientsSchema('cc', false),
  bcc: createEmailRecipientsSchema('bcc', false),
  subject: z.string().describe('Message subject').default(''),
  body: z.string().trim().min(1).describe('Email body content (plain text or HTML)'),
  contentType: ComposeContentTypeSchema,
});

// Success branch schema
const successBranchSchema = z.object({
  type: z.literal('success'),
  item: createMessageResultSchema('gmail'),
});

// Output schema with auth_required support
const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'Send an email message through Gmail',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

async function handler(params: Input, extra: EnrichedExtra) {
  const { to, cc, bcc, subject, body, contentType } = params;
  const logger = extra.logger;
  logger.info('gmail.message.send called', { to, subject, contentType });

  if (!to) {
    throw new McpError(ErrorCode.InvalidParams, 'Missing required field: to');
  }

  try {
    // Build RFC822 message - only include optional headers when defined to satisfy
    // exactOptionalPropertyTypes (avoid passing `undefined` into optional props)
    const msgArgs: { to: string; cc?: string; bcc?: string; subject?: string; body: string; contentType: 'text' | 'html' } = { to, body, contentType };
    if (cc !== undefined) msgArgs.cc = cc;
    if (bcc !== undefined) msgArgs.bcc = bcc;
    if (subject !== undefined) msgArgs.subject = subject;

    const raw = buildRfc822FromArgs(msgArgs);
    const encodedMessage = b64url(raw);

    const gmail = google.gmail({ version: 'v1', auth: extra.authContext.auth });

    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });
    const sendData = sendRes.data;
    const messageId = sendData.id || 'unknown';
    logger.info('Gmail: sent message successfully', { id: messageId });
    logger.info('gmail.message.send result (typed)', { to, subject, messageId });

    const totalRecipients = (Array.isArray(to) ? to.length : 1) + (cc ? (Array.isArray(cc) ? cc.length : 1) : 0) + (bcc ? (Array.isArray(bcc) ? bcc.length : 1) : 0);
    const result: Output = {
      type: 'success' as const,
      item: {
        id: messageId,
        sentAt: new Date().toISOString(),
        recipientCount: totalRecipients,
        webLink: `https://mail.google.com/mail/u/0/#sent/${messageId}`,
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
    logger.error('gmail.message.send error', { error: message });

    throw new McpError(ErrorCode.InternalError, `Error sending message: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'message-send',
    config,
    handler,
  } satisfies ToolModule;
}
