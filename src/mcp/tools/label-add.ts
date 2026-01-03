import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { schemas } from '@mcp-z/oauth-google';

const { AuthRequiredBranchSchema } = schemas;

import type { ToolModule } from '@mcp-z/server';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { ensureLabelId } from '../../labels/gmail-labels.ts';

const inputSchema = z.object({
  id: z.coerce.string().trim().min(1).describe('Gmail message ID to add label to'),
  label: z.coerce.string().trim().min(1).describe('Label name or ID (use gmail-labels-list to discover available labels)'),
});

// Success branch schema
const successBranchSchema = z.object({
  type: z.literal('success'),
  item: z.object({
    id: z.string().describe('Message ID the label was added to'),
    label: z.string().describe('Label that was added'),
  }),
});

// Output schema with auth_required support
const outputSchema = z.discriminatedUnion('type', [successBranchSchema, AuthRequiredBranchSchema]);

const config = {
  description: 'Add a label to a Gmail message',
  inputSchema: inputSchema,
  outputSchema: z.object({
    result: outputSchema,
  }),
} as const;

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;

async function handler({ id, label }: Input, extra: EnrichedExtra) {
  const logger = extra.logger;
  logger.info('gmail.label.add called', { id, label });

  if (!id || !label) {
    logger.info('gmail.label.add missing parameters', { id, label });
    throw new McpError(ErrorCode.InvalidParams, 'Missing id or label');
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: extra.authContext.auth });

    const labelId = await ensureLabelId(gmail, 'me', label);
    await gmail.users.messages.modify({
      userId: 'me',
      id: id,
      requestBody: {
        addLabelIds: [labelId],
      },
    });

    logger.info('gmail.label.add success', { id, label });
    logger.info('gmail.label.add result (typed)', { id, label });

    const result: Output = {
      type: 'success' as const,
      item: { id, label },
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
    logger.error('gmail.label.add error', { error: message });

    throw new McpError(ErrorCode.InternalError, `Error adding label to message: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export default function createTool() {
  return {
    name: 'label-add',
    config,
    handler,
  } satisfies ToolModule;
}
