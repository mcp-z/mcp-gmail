import assert from 'assert';
import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import createTool, { type Input } from '../../../../src/mcp/tools/message-respond.ts';
import type { Logger } from '../../../../src/types.ts';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.ts';
import createMiddlewareContext from '../../../lib/create-middleware-context.ts';
import { createTestMessage, deleteTestMessage } from '../../../lib/message-helpers.ts';
import waitForMessage from '../../../lib/wait-for-message.ts';

describe('message-respond tool', () => {
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
    const tool = createTool();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;
    sharedGmailClient = google.gmail({ version: 'v1', auth: auth });
  });

  it('respond replies to a message', async () => {
    const gmail = sharedGmailClient;
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const emailAddress = profile.data.emailAddress;
    if (!emailAddress) throw new Error('Unable to determine test email address');

    // Track created resource ids locally to ensure per-test close
    const createdIds: string[] = [];

    try {
      const sentId = await createTestMessage(gmail);
      createdIds.push(sentId);
      await waitForMessage(gmail, sentId, { interval: 200, timeout: 8000 });

      const respResult = (await handler({ id: sentId, body: 'reply from test', contentType: 'text' }, createExtra())) as { content?: unknown[] };
      assert.ok(respResult && respResult.content, 'respond did not return content');
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
