import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { CHUNK_SIZE, MAX_BATCH_SIZE } from '../../constants.ts';

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

async function handler({ ids }: Input, extra: EnrichedExtra) {
  const logger = extra.logger;
  logger.info('gmail-message-move-to-trash called', { count: ids.length });

  if (!ids || ids.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, 'Missing ids');
  }

  // Validate batch size to prevent memory exhaustion
  if (ids.length > MAX_BATCH_SIZE) {
    throw new McpError(ErrorCode.InvalidParams, `Batch size ${ids.length} exceeds maximum allowed size of ${MAX_BATCH_SIZE}`);
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
    throw new McpError(ErrorCode.InvalidParams, `Found ${invalidIds.length} invalid IDs: ${invalidIds.join(', ')}`);
  }

  if (validatedIds.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, 'No valid IDs found after validation');
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: extra.authContext.auth });
    // Process operations in chunks to prevent memory exhaustion
    const allResults: Array<{ id: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < validatedIds.length; i += CHUNK_SIZE) {
      const chunk = validatedIds.slice(i, i + CHUNK_SIZE);
      logger.info('Processing chunk', { chunkIndex: i / CHUNK_SIZE + 1, chunkSize: chunk.length, totalChunks: Math.ceil(validatedIds.length / CHUNK_SIZE) });

      const chunkResults = await Promise.allSettled(
        chunk.map(async (id) => {
          await gmail.users.messages.trash({
            userId: 'me',
            id: id,
          });
          return { id, success: true };
        })
      );

      // Process chunk results
      const processedChunkResults = chunkResults.map((result, chunkIndex) => {
        const id = chunk[chunkIndex];
        if (!id) {
          throw new Error(`Chunk index ${chunkIndex} is out of bounds for chunk of size ${chunk.length}`);
        }
        if (result.status === 'fulfilled') {
          return { id, success: true };
        }

        // Extract error message more robustly
        let errorMessage = 'Unknown error';
        if (result.reason) {
          if (typeof result.reason === 'string') {
            errorMessage = result.reason;
          } else if (result.reason instanceof Error) {
            errorMessage = result.reason.message;
          } else if (result.reason && typeof result.reason === 'object' && 'message' in result.reason) {
            errorMessage = String(result.reason.message);
          } else if (result.reason && typeof result.reason === 'object' && 'error' in result.reason) {
            errorMessage = String(result.reason.error);
          } else {
            errorMessage = String(result.reason);
          }
        }

        return { id, success: false, error: errorMessage };
      });

      allResults.push(...processedChunkResults);
    }

    const successCount = allResults.filter((r) => r.success).length;
    const failureCount = allResults.filter((r) => !r.success).length;

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

    throw new McpError(ErrorCode.InternalError, `Error moving messages to trash: ${message}`, {
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
