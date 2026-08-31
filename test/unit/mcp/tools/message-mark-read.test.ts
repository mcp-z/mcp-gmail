import type { Logger } from '@mcp-z/mcp-gmail';
import { mcp } from '@mcp-z/mcp-gmail';
import assert from 'assert';
import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import type { Input, Output } from '../../../../src/mcp/tools/message-mark-read.ts';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.ts';
import createMiddlewareContext from '../../../lib/create-middleware-context.ts';
import { createTestMessage, deleteTestMessage } from '../../../lib/message-helpers.ts';
import waitForMessage from '../../../lib/wait-for-message.ts';

describe('message-mark-read tool', () => {
  // Shared instances for all tests
  let logger: Logger;
  let auth: Awaited<ReturnType<typeof createMiddlewareContext>>['auth'];
  let handler: TypedHandler<Input>;
  let sharedGmailClient: gmail_v1.Gmail;

  before(async () => {
    const middlewareContext = await createMiddlewareContext();
    logger = middlewareContext.logger;
    auth = middlewareContext.auth;
    const middleware = middlewareContext.middleware;
    const tool = mcp.toolFactories.messageMarkRead();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;
    sharedGmailClient = google.gmail({ version: 'v1', auth: auth });
  });

  it('mark-read marks message as read', async () => {
    const gmail = sharedGmailClient;

    // Track created resource ids locally to ensure per-test close
    const createdIds: string[] = [];

    try {
      const sentId = await createTestMessage(gmail);
      createdIds.push(sentId);
      await waitForMessage(gmail, sentId, { interval: 200, timeout: 8000 });

      const mrResp = await handler({ id: sentId }, createExtra());

      // Canonical machine-readable payload must be present in structuredContent.result
      const structured = mrResp.structuredContent?.result as Output | undefined;
      assert.ok(structured, 'structuredContent missing');
      if (structured.type === 'success') {
        // success branch has id property at root level
        assert.ok(typeof structured.id === 'string', 'structured.id should be a string');
        assert.ok(structured.id.length > 0, 'structured.id should not be empty');
      } else {
        // If an error branch is returned, fail the test with the error details
        assert.fail(`expected success branch but received error: ${JSON.stringify(structured)}`);
      }
    } finally {
      // Per-test close: delete created messages; fail loudly on persistent failure
      if (createdIds.length > 0) {
        for (const id of createdIds) {
          await deleteTestMessage(gmail, id, logger);
        }
      }
    }
  });
});
