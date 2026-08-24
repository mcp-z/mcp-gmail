import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';

const inputSchema = z.object({
  ids: z
    .array(z.coerce.string().trim().min(1))
    .min(1)
    .describe('Gmail message IDs to archive'),
});

// Success branch schema
const successBranchSchema = z.object({
  type: z.literal('success'),
  totalRequested: z.number().describe('Total number of messages requested to archive'),
  successCount: z.number().describe('Number of messages successfully archived'),
  failureCount: z.number().describe('Number of messages that failed to archive'),
  results: z.array(
    z.object({
      id: z.string().describe('Message ID'),
      success: z.boolean().describe('Whether the archive operation succeeded'),
      error: z.string().optional().describe('Error message if failed'),
    })
  ),
});

// Output schema with auth_required support
const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'Archive Gmail messages (remove from inbox). Supports batch operations.',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

async function handler({ ids }: Input, extra: EnrichedExtra) {
  const logger = extra.logger;
  logger.info('gmail.message.archive called', { ids, count: ids.length });

  if (!ids || ids.length === 0) {
    logger.info('gmail.message.archive missing ids');
    throw new McpError(ErrorCode.InvalidParams, 'Missing message ids');
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: extra.authContext.auth });

    const results: { id: string; success: boolean; error?: string }[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Process each message
    for (const id of ids) {
      try {
        await gmail.users.messages.modify({
          userId: 'me',
          id: id,
          requestBody: {
            removeLabelIds: ['INBOX'],
          },
        });
        results.push({ id, success: true });
        successCount++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({ id, success: false, error: errorMessage });
        failureCount++;
        logger.warn('gmail.message.archive failed for message', { id, error: errorMessage });
      }
    }

    logger.info('gmail.message.archive complete', { successCount, failureCount });

    const result: Output = {
      type: 'success' as const,
      totalRequested: ids.length,
      successCount,
      failureCount,
      results,
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
    logger.error('gmail.message.archive error', { error: message });

    throw new McpError(ErrorCode.InternalError, `Error archiving messages: ${message}`, {
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
