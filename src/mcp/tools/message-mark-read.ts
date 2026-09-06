import { gmail as gmailApi } from '@googleapis/gmail';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ProtocolError, ProtocolErrorCode } from '@mcp-z/server';
import { z } from 'zod';
import { googleAuth } from '../../lib/google-auth.ts';

const inputSchema = z.object({
  id: z.coerce.string().trim().min(1).describe('Gmail message ID to mark as read'),
});

const successBranchSchema = z.object({
  type: z.literal('success'),
  id: z.string().describe('Message ID that was marked as read'),
});

const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'Mark a Gmail message as read',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

async function handler({ id }: Input, extra: EnrichedExtra) {
  const logger = extra.logger;
  logger.info('gmail-message-mark-read called', { id: Boolean(id) });

  if (!id) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Missing id');
  }

  try {
    const gmail = gmailApi({ version: 'v1', auth: googleAuth(extra.authContext.auth) });
    await gmail.users.messages.modify({
      userId: 'me',
      id: id,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    });

    logger.info('gmail-message-mark-read success', { id });

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
    logger.error('gmail-message-mark-read error', { error: message });

    throw new ProtocolError(ProtocolErrorCode.InternalError, `Error marking message as read: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'message-mark-read',
    config,
    handler,
  } satisfies ToolModule;
}
