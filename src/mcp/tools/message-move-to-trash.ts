import { type gmail_v1, gmail as gmailApi } from '@googleapis/gmail';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ProtocolError, ProtocolErrorCode } from '@mcp-z/server';
import { z } from 'zod';
import { CHUNK_SIZE, MAX_BATCH_SIZE } from '../../constants.ts';
import { googleAuth } from '../../lib/google-auth.ts';
import { type PerIdOutcome, runPerId } from '../../lib/run-per-id.ts';

const inputSchema = z.object({
  ids: z.array(z.coerce.string().trim().min(1)).min(1).describe('Gmail message IDs to move to trash'),
});

const successBranchSchema = z.object({
  type: z.literal('success'),
  totalRequested: z.number().describe('Total number of messages requested to trash'),
  successCount: z.number().describe('Number of messages successfully moved to trash'),
  failureCount: z.number().describe('Number of messages that failed to move'),
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
  description: 'Move Gmail messages to trash (recoverable).',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

export async function trashMessages(gmail: gmail_v1.Gmail, validatedIds: string[], logger: EnrichedExtra['logger']): Promise<PerIdOutcome> {
  return runPerId(validatedIds, (id) => gmail.users.messages.trash({ userId: 'me', id }), logger);
}

async function handler({ ids }: Input, extra: EnrichedExtra) {
  const logger = extra.logger;
  logger.info('gmail-message-move-to-trash called', { count: ids.length });

  if (!ids || ids.length === 0) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Missing ids');
  }

  // Validate batch size to prevent memory exhaustion
  if (ids.length > MAX_BATCH_SIZE) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Batch size ${ids.length} exceeds maximum allowed size of ${MAX_BATCH_SIZE}`);
  }

  // Validate and sanitize IDs
  const validatedIds: string[] = [];
  const invalidIds: string[] = [];

  for (const id of ids) {
    const trimmedId = id.trim();
    if (!trimmedId) {
      invalidIds.push(id);
      continue;
    }
    // Basic Gmail message ID validation - should not contain certain characters
    if (trimmedId.includes('/') || trimmedId.includes('\\') || trimmedId.includes('<') || trimmedId.includes('>')) {
      invalidIds.push(id);
      continue;
    }
    validatedIds.push(trimmedId);
  }

  if (invalidIds.length > 0) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Found ${invalidIds.length} invalid IDs: ${invalidIds.join(', ')}`);
  }

  if (validatedIds.length === 0) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'No valid IDs found after validation');
  }

  try {
    const gmail = gmailApi({ version: 'v1', auth: googleAuth(extra.authContext.auth) });
    const { results: allResults, successCount, failureCount } = await trashMessages(gmail, validatedIds, logger);

    logger.info('gmail-message-move-to-trash completed', {
      totalRequested: validatedIds.length,
      successCount,
      failureCount,
      chunksProcessed: Math.ceil(validatedIds.length / CHUNK_SIZE),
    });

    const result: Output = {
      type: 'success' as const,
      totalRequested: validatedIds.length,
      successCount,
      failureCount,
      results: allResults,
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
    logger.error('gmail-message-move-to-trash error', { error: message });

    throw new ProtocolError(ProtocolErrorCode.InternalError, `Error moving messages to trash: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'message-move-to-trash',
    config,
    handler,
  } satisfies ToolModule;
}
