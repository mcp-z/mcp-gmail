import type { PromptModule } from '@mcp-z/server';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export default function createPrompt() {
  const argsSchema = z.object({
    context: z.string().min(1).describe('Email context to draft response for'),
    tone: z.string().optional().describe('Email tone (default: professional)'),
  });

  const config = {
    description: 'Draft an email response',
    argsSchema: argsSchema.shape,
  };

  const handler = async (args: { [x: string]: unknown }, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
    const { context, tone } = argsSchema.parse(args);
    return {
      messages: [
        { role: 'system' as const, content: { type: 'text' as const, text: 'You are an expert email assistant.' } },
        { role: 'user' as const, content: { type: 'text' as const, text: `Draft a ${tone || 'professional'} email:\n\n${context}` } },
      ],
    };
  };

  return {
    name: 'draft-email',
    config,
    handler,
  } satisfies PromptModule;
}
