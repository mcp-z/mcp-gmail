import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ProtocolError, ProtocolErrorCode } from '@mcp-z/server';
import { google } from 'googleapis';
import { z } from 'zod';

// Schema for individual label items
const LabelSchema = z.object({
  id: z.string().describe('Gmail label ID'),
  name: z.string().describe('Label name for use in queries (case-sensitive)'),
  type: z.enum(['user', 'system']).describe('Whether this is a user-created or system label'),
  visibility: z.enum(['labelShow', 'labelHide', 'labelShowIfUnread']).describe('Label visibility in Gmail UI'),
});

/**
 * Input schema for the labels-list tool (currently empty as this tool takes no parameters).
 */
export const inputSchema = z.object({});

const successBranchSchema = z.object({
  type: z.literal('success'),
  items: z.array(LabelSchema),
});

const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'List Gmail labels for label: query syntax. Case-sensitive.',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

/**
 * Input parameters for the labels-list tool.
 */
export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

async function handler(_: Input, extra: EnrichedExtra) {
  const logger = extra.logger;
  logger.info('gmail.labels.list called');

  try {
    const gmail = google.gmail({ version: 'v1', auth: extra.authContext.auth });
    const started = Date.now();

    // Fetch all labels from Gmail API
    const response = await gmail.users.labels.list({ userId: 'me' });
    const labels = response.data.labels || [];

    // Filter out CATEGORY_* labels (handled by categories tool) and map to our schema
    const availableLabels = labels
      .filter((label) => {
        // Exclude CATEGORY_* labels as they're handled by the categories tool
        return !label.id?.startsWith('CATEGORY_');
      })
      .map((label) => {
        const id = label.id as string;
        const name = label.name || id;

        // Determine label type
        const type: 'user' | 'system' = label.type === 'user' ? 'user' : 'system';

        // Map label visibility
        let visibility: 'labelShow' | 'labelHide' | 'labelShowIfUnread' = 'labelShow';
        if (label.labelListVisibility === 'labelHide') {
          visibility = 'labelHide';
        } else if (label.labelListVisibility === 'labelShowIfUnread') {
          visibility = 'labelShowIfUnread';
        }

        return {
          id,
          name,
          type,
          visibility,
        };
      })
      .sort((a, b) => {
        // Sort user labels first, then system labels, both alphabetically
        if (a.type !== b.type) {
          return a.type === 'user' ? -1 : 1;
        }
        // Use simple ASCII comparison for consistent, case-sensitive sorting
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });

    const durationMs = Date.now() - started;

    logger.info('gmail.labels.list results', {
      labelCount: availableLabels.length,
      userLabels: availableLabels.filter((l) => l.type === 'user').length,
      systemLabels: availableLabels.filter((l) => l.type === 'system').length,
      totalLabels: labels.length,
    });
    logger.info('gmail.labels.list metrics', { durationMs });

    const result: Output = {
      type: 'success' as const,
      items: availableLabels,
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
    logger.error('gmail.labels.list error', { error: message });

    throw new ProtocolError(ProtocolErrorCode.InternalError, `Error listing labels: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'labels-list',
    config,
    handler,
  } satisfies ToolModule;
}
