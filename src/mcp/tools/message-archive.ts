import { type gmail_v1, gmail as gmailApi } from '@googleapis/gmail';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ProtocolError, ProtocolErrorCode } from '@mcp-z/server';
import { z } from 'zod';
import { googleAuth } from '../../lib/google-auth.ts';
import { type PerIdOutcome, runPerId } from '../../lib/run-per-id.ts';
import { validateIds } from '../../lib/validate-ids.ts';

const inputSchema = z.object({
  ids: z.array(z.coerce.string().trim().min(1)).min(1).describe('Gmail message IDs to archive (remove from Inbox)'),
});

const successBranchSchema = z.object({
  type: z.literal('success'),
  totalRequested: z.number().describe('Total number of messages requested to archive'),
  successCount: z.number().describe('Number of messages archived (including messages already archived)'),
  failureCount: z.number().describe('Number of messages that failed to archive'),
  results: z
    .array(
      z.object({
        id: z.string().describe('Message ID'),
        success: z.boolean().describe('Whether the operation succeeded'),
        error: z.string().optional().describe('Error message if operation failed'),
      })
    )
    .describe('Individual results for each message'),
});

const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'Archive Gmail messages: remove them from the Inbox while keeping the message, its other labels and its read/unread state. Repeating is safe. Never trashes or deletes. Acts on the given messages only; other messages in the same thread stay in the Inbox.',
  annotations: { idempotentHint: true },
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

/** One `messages.modify` per ID that removes only INBOX. */
export async function archiveMessages(gmail: gmail_v1.Gmail, validatedIds: string[], logger: EnrichedExtra['logger']): Promise<PerIdOutcome> {
  return runPerId(validatedIds, (id) => gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['INBOX'] } }), logger);
}

async function handler({ ids }: Input, extra: EnrichedExtra) {
  const logger = extra.logger;
  logger.info('gmail-message-archive called', { count: ids?.length });

  const validatedIds = validateIds(ids, 'message');

  try {
    const gmail = gmailApi({ version: 'v1', auth: googleAuth(extra.authContext.auth) });
    const { results, successCount, failureCount } = await archiveMessages(gmail, validatedIds, logger);

    logger.info('gmail-message-archive completed', { totalRequested: validatedIds.length, successCount, failureCount });

    const result: Output = {
      type: 'success' as const,
      totalRequested: validatedIds.length,
      successCount,
      failureCount,
      results,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: { result },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('gmail-message-archive error', { error: message });

    throw new ProtocolError(ProtocolErrorCode.InternalError, `Error archiving messages: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'message-archive',
    config,
    handler,
  } satisfies ToolModule;
}
