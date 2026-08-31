import type { Logger } from '@mcp-z/mcp-gmail';
import { mcp } from '@mcp-z/mcp-gmail';
import assert from 'assert';
import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import type { Input, Output } from '../../../../src/mcp/tools/message-move-to-trash.ts';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.ts';
import createMiddlewareContext from '../../../lib/create-middleware-context.ts';
import { createTestMessage, deleteTestMessage } from '../../../lib/message-helpers.ts';
import waitForMessage from '../../../lib/wait-for-message.ts';

describe('gmail-message-move-to-trash', () => {
  // Shared context and Gmail client for all tests
  let logger: Logger;
  let auth: Awaited<ReturnType<typeof createMiddlewareContext>>['auth'];
  let handler: TypedHandler<Input>;
  let sharedGmail: gmail_v1.Gmail;

  before(async () => {
    const middlewareContext = await createMiddlewareContext();
    logger = middlewareContext.logger;
    auth = middlewareContext.auth;
    const middleware = middlewareContext.middleware;
    const tool = mcp.toolFactories.messageMoveToTrash();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;
    sharedGmail = google.gmail({ version: 'v1', auth: auth });
  });
  it('moves single message to trash', async () => {
    const gmail = sharedGmail;
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const emailAddress = profile.data.emailAddress;
    if (!emailAddress) assert.fail('Unable to determine test email address');

    // Track created resource ids locally to ensure per-test close
    const createdIds: string[] = [];

    try {
      const sentId = await createTestMessage(gmail);
      createdIds.push(sentId);
      await waitForMessage(gmail, sentId, { interval: 200, timeout: 8000 });

      // Test single ID in array format
      const trashResp = await handler({ ids: [sentId] }, createExtra());

      // Canonical machine-readable payload must be present in structuredContent.result
      const structured = trashResp.structuredContent?.result as Output | undefined;
      assert.ok(structured, 'structuredContent missing');
      if (structured.type === 'success') {
        // Access properties directly on structured (no item wrapper)
        assert.strictEqual(structured.totalRequested, 1, 'totalRequested should be 1');
        assert.strictEqual(structured.successCount, 1, 'successCount should be 1');
        assert.strictEqual(structured.failureCount, 0, 'failureCount should be 0');
        assert.strictEqual(structured.results.length, 1, 'results length should be 1');
        assert.strictEqual(structured.results[0]?.id, sentId, 'result id should match');
        assert.strictEqual(structured.results[0]?.success, true, 'result success should be true');
      } else {
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

  it('moves multiple messages to trash in batch', async () => {
    const gmail = sharedGmail;

    // Track created resource ids locally to ensure per-test close
    const createdIds: string[] = [];

    try {
      // Create multiple test messages
      const sentId1 = await createTestMessage(gmail, { subject: `ci-batch-1-${Date.now()}` });
      const sentId2 = await createTestMessage(gmail, { subject: `ci-batch-2-${Date.now()}` });
      createdIds.push(sentId1, sentId2);

      // Wait for messages to be available
      await waitForMessage(gmail, sentId1, { interval: 200, timeout: 8000 });
      await waitForMessage(gmail, sentId2, { interval: 200, timeout: 8000 });

      // Test array of IDs
      const trashResp = await handler({ ids: [sentId1, sentId2] }, createExtra());

      // Check structured response
      const structured = trashResp.structuredContent?.result as Output | undefined;
      assert.ok(structured, 'structuredContent missing');

      if (structured.type === 'success') {
        // Access properties directly on structured (no item wrapper)
        assert.strictEqual(structured.totalRequested, 2, 'totalRequested should be 2');
        assert.strictEqual(structured.successCount, 2, 'successCount should be 2');
        assert.strictEqual(structured.failureCount, 0, 'failureCount should be 0');
        assert.strictEqual(structured.results.length, 2, 'results length should be 2');

        // Check each result
        const result1 = structured.results.find((r: unknown) => {
          const result = r as { id: string };
          return result.id === sentId1;
        });
        const result2 = structured.results.find((r: unknown) => {
          const result = r as { id: string };
          return result.id === sentId2;
        });

        assert.ok(result1, 'result for sentId1 should exist');
        assert.strictEqual(result1?.success, true, 'result1 success should be true');

        assert.ok(result2, 'result for sentId2 should exist');
        assert.strictEqual(result2?.success, true, 'result2 success should be true');
      } else {
        assert.fail(`expected success branch but received error: ${JSON.stringify(structured)}`);
      }
    } finally {
      // Per-test close: delete created messages
      if (createdIds.length > 0) {
        for (const id of createdIds) {
          await deleteTestMessage(gmail, id, logger);
        }
      }
    }
  });

  it('handles non-existent message gracefully in batch', async () => {
    const gmail = sharedGmail;

    // Track created resource ids locally to ensure per-test close
    const createdIds: string[] = [];

    try {
      // Create one valid message
      const validId = await createTestMessage(gmail, { subject: `ci-mixed-${Date.now()}` });
      createdIds.push(validId);
      await waitForMessage(gmail, validId, { interval: 200, timeout: 8000 });

      const nonExistentId = `non_existent_${Date.now()}`;

      // Test mixed valid and invalid IDs
      const trashResp = await handler({ ids: [validId, nonExistentId] }, createExtra());

      // Check structured response
      const structured = trashResp.structuredContent?.result as Output | undefined;
      assert.ok(structured, 'structuredContent missing');

      if (structured.type === 'success') {
        // Access properties directly on structured (no item wrapper)
        assert.strictEqual(structured.totalRequested, 2, 'totalRequested should be 2');
        assert.strictEqual(structured.successCount, 1, 'successCount should be 1');
        assert.strictEqual(structured.failureCount, 1, 'failureCount should be 1');
        assert.strictEqual(structured.results.length, 2, 'results length should be 2');

        // Check results
        const validResult = structured.results.find((r: unknown) => {
          const result = r as { id: string };
          return result.id === validId;
        });
        const invalidResult = structured.results.find((r: unknown) => {
          const result = r as { id: string };
          return result.id === nonExistentId;
        });

        assert.ok(validResult, 'valid result should exist');
        assert.strictEqual(validResult?.success, true, 'valid result should be successful');

        assert.ok(invalidResult, 'invalid result should exist');
        assert.strictEqual(invalidResult?.success, false, 'invalid result should fail');
        assert.ok(invalidResult?.error, 'invalid result should have error message');
      } else {
        assert.fail(`expected success branch but received error: ${JSON.stringify(structured)}`);
      }
    } finally {
      // Per-test close: delete created messages
      if (createdIds.length > 0) {
        for (const id of createdIds) {
          await deleteTestMessage(gmail, id, logger);
        }
      }
    }
  });
});
