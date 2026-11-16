import { type gmail_v1, gmail as gmailApi } from '@googleapis/gmail';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ProtocolError, ProtocolErrorCode } from '@mcp-z/server';
import { z } from 'zod';
import { resolveLabel } from '../../labels/gmail-labels.ts';
import { googleAuth } from '../../lib/google-auth.ts';
import { type PerIdOutcome, runPerId } from '../../lib/run-per-id.ts';
import { validateIds } from '../../lib/validate-ids.ts';

const inputSchema = z.object({
  ids: z.array(z.coerce.string().trim().min(1)).min(1).describe('Gmail message IDs to remove the label from'),
  label: z.coerce.string().trim().min(1).describe('Existing label name or ID (use labels-list to discover labels). The label definition is kept; use label-delete to delete a label itself.'),
});

const successBranchSchema = z.object({
  type: z.literal('success'),
  label: z
    .object({
      id: z.string().describe('Resolved label ID'),
      name: z.string().describe('Label name'),
    })
    .describe('Label that was removed from the messages'),
  totalRequested: z.number().describe('Total number of messages requested'),
  successCount: z.number().describe('Number of messages the label was removed from (including messages that did not have it)'),
  failureCount: z.number().describe('Number of messages that failed'),
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
  description: 'Remove a label from Gmail messages. The label itself and other messages keep it; to delete the label definition use label-delete. Never creates labels. Removing INBOX archives (prefer message-archive).',
  annotations: { idempotentHint: true },
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

/** Resolve one existing label (never creating it), then one `messages.modify` per ID that removes only that label. */
export async function removeLabel(gmail: gmail_v1.Gmail, validatedIds: string[], ref: string, logger: EnrichedExtra['logger']): Promise<PerIdOutcome & { label: { id: string; name: string } }> {
  const listed = await gmail.users.labels.list({ userId: 'me' });
  const label = resolveLabel(listed.data.labels || [], ref);
  if (!label) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Label not found: "${ref}" (use labels-list)`);
  }
  const outcome = await runPerId(validatedIds, (id) => gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: [label.id] } }), logger);
  return { ...outcome, label };
}

async function handler({ ids, label }: Input, extra: EnrichedExtra) {
  const logger = extra.logger;
  logger.info('gmail-label-remove called', { count: ids?.length, label });

  const validatedIds = validateIds(ids, 'message');

  try {
    const gmail = gmailApi({ version: 'v1', auth: googleAuth(extra.authContext.auth) });
    const { results, successCount, failureCount, label: resolved } = await removeLabel(gmail, validatedIds, label, logger);

    logger.info('gmail-label-remove completed', { totalRequested: validatedIds.length, successCount, failureCount });

    const result: Output = {
      type: 'success' as const,
      label: resolved,
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
    if (error instanceof ProtocolError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    logger.error('gmail-label-remove error', { error: message });

    throw new ProtocolError(ProtocolErrorCode.InternalError, `Error removing label from messages: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'label-remove',
    config,
    handler,
  } satisfies ToolModule;
}
