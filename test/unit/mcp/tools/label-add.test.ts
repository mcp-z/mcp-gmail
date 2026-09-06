import { type gmail_v1, gmail as gmailApi } from '@googleapis/gmail';
import type { Logger } from '@mcp-z/mcp-gmail';
import { mcp } from '@mcp-z/mcp-gmail';
import type { CallToolResult } from '@mcp-z/server';
import assert from 'assert';
import type { Input, Output } from '../../../../src/mcp/tools/label-add.ts';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.ts';
import createMiddlewareContext from '../../../lib/create-middleware-context.ts';
import { deleteTestLabel } from '../../../lib/label-helpers.ts';
import { createTestMessage, deleteTestMessage } from '../../../lib/message-helpers.ts';
import waitForLabel from '../../../lib/wait-for-label.ts';
import waitForMessage from '../../../lib/wait-for-message.ts';

describe('label-add tool', () => {
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
    const tool = mcp.toolFactories.labelAdd();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;
    sharedGmailClient = gmailApi({ version: 'v1', auth: auth });
  });

  it('add_label adds a label to message', async () => {
    const gmail = sharedGmailClient;
    const createdIds: string[] = [];
    const createdLabelIds: string[] = [];

    try {
      const sentId = await createTestMessage(gmail);
      createdIds.push(sentId);

      // Wait until Gmail reports the message exists (indexed)
      await waitForMessage(gmail, sentId, { interval: 200, timeout: 8000 });

      // Pre-create the label and wait for it to be indexed
      const labelName = `ci-label-${Date.now()}`;
      const labelResp = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });
      const createdLabelId = labelResp.data.id;
      assert.ok(createdLabelId, 'Label should be created');
      createdLabelIds.push(createdLabelId);

      // Wait for Gmail to index the new label
      await waitForLabel(gmail, createdLabelId);

      const addResp = await handler({ id: sentId, label: labelName }, createExtra());

      // Canonical machine-readable payload must be present in structuredContent.result
      const structured = ((addResp as CallToolResult)?.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
      assert.ok(structured, 'structuredContent missing');
      if (structured.type === 'success') {
        const s = structured as {
          ok?: boolean;
          id?: string;
          item?: { id?: string; label?: string };
          label?: string;
        };
        const itemId = s?.id || s?.item?.id;
        const itemLabel = s?.label || s?.item?.label;
        const hasOk = s.ok === true;
        assert.ok(hasOk || typeof itemId === 'string' || typeof itemLabel === 'string', 'structuredContent.result missing expected keys (ok/id/label)');

        // Verify the label name matches what we requested
        assert.strictEqual(itemLabel, labelName, 'Returned label name should match requested name');
      } else {
        // Fail loudly on any error - don't paper over issues
        assert.fail(`expected success branch but received error: ${JSON.stringify(structured)}`);
      }
    } finally {
      // Per-test close: delete created messages using helper (logs failures but doesn't throw)
      if (createdIds.length > 0) {
        for (const id of createdIds) {
          await deleteTestMessage(gmail, id, logger);
        }
      }

      // Per-test close: delete created labels using helper (logs failures but doesn't throw)
      if (createdLabelIds.length > 0) {
        for (const labelId of createdLabelIds) {
          await deleteTestLabel(gmail, labelId, logger);
        }
      }
    }
  });
});
