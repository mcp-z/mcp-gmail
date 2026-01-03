import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';

// Schema for individual category items
const CategorySchema = z.object({
  id: z.string().describe('Gmail category ID (e.g., CATEGORY_PERSONAL)'),
  name: z.string().describe('Human-readable category name'),
  description: z.string().describe('Description of what emails belong in this category'),
});

/**
 * Input schema for the categories-list tool (currently empty as this tool takes no parameters).
 */
export const inputSchema = z.object({});

// Success branch schema
const successBranchSchema = z.object({
  type: z.literal('success'),
  items: z.array(CategorySchema),
});

// Output schema with auth_required support
const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'List Gmail category labels (CATEGORY_*) with IDs and descriptions.',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

/**
 * Input parameters for the categories-list tool.
 */
export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

async function handler(_: Input, extra: EnrichedExtra) {
  const logger = extra.logger;
  logger.info('gmail.categories.list called');

  try {
    const gmail = google.gmail({ version: 'v1', auth: extra.authContext.auth });
    const started = Date.now();

    // Fetch all labels from Gmail API
    const response = await gmail.users.labels.list({ userId: 'me' });
    const labels = response.data.labels || [];

    // Filter for CATEGORY_* system labels and map to our schema
    const categories = labels
      .filter((label) => label.id?.startsWith('CATEGORY_'))
      .map((label) => {
        const id = label.id as string;
        let name = label.name || id;
        let description = '';

        // Map known category types to user-friendly names and descriptions
        switch (id) {
          case 'CATEGORY_PERSONAL':
            name = 'Primary';
            description = 'Important emails from people you know';
            break;
          case 'CATEGORY_SOCIAL':
            name = 'Social';
            description = 'Social networks and social websites';
            break;
          case 'CATEGORY_PROMOTIONS':
            name = 'Promotions';
            description = 'Deals, offers, and marketing emails';
            break;
          case 'CATEGORY_UPDATES':
            name = 'Updates';
            description = 'Confirmations, receipts, bills, and statements';
            break;
          case 'CATEGORY_FORUMS':
            name = 'Forums';
            description = 'Online groups, discussion boards, mailing lists';
            break;
          default:
            // For any unknown CATEGORY_* labels, use the label name as-is
            name = label.name || id.replace('CATEGORY_', '');
            description = `Gmail category: ${name}`;
        }

        return {
          id,
          name,
          description,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically by name

    const durationMs = Date.now() - started;

    logger.info('gmail.categories.list results', { categoryCount: categories.length, totalLabels: labels.length });
    logger.info('gmail.categories.list metrics', { durationMs });

    const result: Output = {
      type: 'success' as const,
      items: categories,
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
    logger.error('gmail.categories.list error', { error: message });

    throw new McpError(ErrorCode.InternalError, `Error listing categories: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'categories-list',
    config,
    handler,
  } satisfies ToolModule;
}
