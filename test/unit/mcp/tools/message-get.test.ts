import { type CallToolResult, McpError } from '@modelcontextprotocol/sdk/types.js';
import assert from 'assert';
import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import createTool, { type Input, type Output } from '../../../../src/mcp/tools/message-get.js';
import type { Logger } from '../../../../src/types.js';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.js';
import createMiddlewareContext from '../../../lib/create-middleware-context.js';
import { createTestMessage, deleteTestMessage } from '../../../lib/message-helpers.js';
import waitForMessage from '../../../lib/wait-for-message.js';

describe('gmail-message-get tests', () => {
  // Local message pool to reduce API calls - QUALITY.md compliant local-first solution
  const sharedMessages: string[] = [];
  let client: gmail_v1.Gmail;
  let logger: Logger;
  let auth: Awaited<ReturnType<typeof createMiddlewareContext>>['auth'];
  let handler: TypedHandler<Input>;

  before(async () => {
    const middlewareContext = await createMiddlewareContext();
    logger = middlewareContext.logger;
    auth = middlewareContext.auth;
    const middleware = middlewareContext.middleware;
    const tool = createTool();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;
    client = google.gmail({ version: 'v1', auth: auth });

    // Create a small pool of shared test messages to reuse across tests
    for (let i = 0; i < 2; i++) {
      const messageId = await createTestMessage(client, {
        subject: `Shared Get Test Message ${i + 1} ${Date.now()}`,
        body: `This is shared test message ${i + 1} for get operations`,
      });
      sharedMessages.push(messageId);
      await waitForMessage(client, messageId, { interval: 200, timeout: 8000 });
    }
  });

  after(async () => {
    // Cleanup shared messages - let errors throw (fail loud)
    for (const messageId of sharedMessages) {
      await deleteTestMessage(client, messageId, logger);
    }
  });
  it('get returns message details', async () => {
    // Use shared message pool instead of creating new messages
    const sentId = sharedMessages[0];
    assert.ok(sentId, 'shared message pool should have messages');

    const res = await handler({ id: sentId, fields: 'id,subject,body,from', contentType: 'text', excludeThreadHistory: false }, createExtra());

    // Canonical machine-readable payload must be present in structuredContent.result
    const payload = (res as CallToolResult)?.structuredContent?.result as Output | undefined;
    assert.ok(payload, 'structuredContent missing');
    if (payload.type === 'success') {
      const p = payload as { ok?: boolean; item?: { id?: string; subject?: string; body?: string; ok?: boolean; [key: string]: unknown } };
      const item = (p.item || p) as { id?: string; subject?: string; body?: string; ok?: boolean; [key: string]: unknown };
      const hasId = typeof item.id === 'string' && item.id.length > 0;
      const hasSubject = typeof item.subject === 'string' && item.subject.length > 0;
      const hasBody = typeof item.body === 'string' && item.body.length > 0;
      const hasOk = item.ok === true;
      assert.ok(hasId || hasSubject || hasBody || hasOk, 'payload missing expected keys (id/subject/body/ok)');
    } else {
      assert.fail(`expected success branch but received error: ${JSON.stringify(payload)}`);
    }
  });

  describe('fields parameter tests', () => {
    it('all fields returns full message item', async () => {
      // Use shared message pool instead of creating new messages
      const sentId = sharedMessages[0];
      assert.ok(sentId, 'shared message pool should have messages');

      const res = await handler({ id: sentId, contentType: 'text', excludeThreadHistory: false }, createExtra());

      const payload = (res as CallToolResult)?.structuredContent?.result as Output | undefined;
      assert.ok(payload, 'structuredContent missing');

      if (payload.type === 'success') {
        const p = payload as { ok?: boolean; item?: { id?: string; subject?: string; body?: string; ok?: boolean; [key: string]: unknown } };
        assert.ok(p.item, 'should have item field');

        // Verify full message data is present
        assert.equal(typeof p.item.id, 'string', 'item should have id field');
        assert.ok('subject' in p.item, 'item should have subject field');
        assert.ok('body' in p.item, 'item should have body field');
        assert.ok('from' in p.item, 'item should have from field');
      } else {
        assert.fail(`expected success branch but received error: ${JSON.stringify(payload)}`);
      }
    });

    it('specific fields returns filtered message item', async () => {
      const gmail = client;
      const createdIds: string[] = [];

      try {
        const sentId = await createTestMessage(gmail, { subject: 'Test Subject', body: 'Test body content' });
        createdIds.push(sentId);
        await waitForMessage(gmail, sentId, { interval: 200, timeout: 8000 });

        const res = await handler({ id: sentId, fields: 'id,subject,from', contentType: 'text', excludeThreadHistory: false }, createExtra());

        const payload = (res as CallToolResult)?.structuredContent?.result as Output | undefined;
        assert.ok(payload, 'structuredContent missing');

        if (payload.type === 'success') {
          const p = payload as { ok?: boolean; item?: { id?: string; subject?: string; body?: string; ok?: boolean; [key: string]: unknown } };
          // Should have item field
          assert.ok(p.item, 'should have item field');

          // Verify only requested fields are present
          assert.equal(typeof p.item.id, 'string', 'item should have id field');
          assert.ok('subject' in p.item, 'item should have subject field');
          assert.ok('from' in p.item, 'item should have from field');

          // Verify unrequested fields are NOT present
          assert.ok(!('body' in p.item), 'item should not have body field when not requested');
        } else {
          assert.fail(`expected success branch but received error: ${JSON.stringify(payload)}`);
        }
      } finally {
        for (const id of createdIds) {
          await deleteTestMessage(gmail, id, logger);
        }
      }
    });

    it('minimal fields returns only requested field', async () => {
      const gmail = client;
      const createdIds: string[] = [];

      try {
        const sentId = await createTestMessage(gmail);
        createdIds.push(sentId);
        await waitForMessage(gmail, sentId, { interval: 200, timeout: 8000 });

        const res = await handler({ id: sentId, fields: 'id', contentType: 'text', excludeThreadHistory: false }, createExtra());

        const payload = (res as CallToolResult)?.structuredContent?.result as Output | undefined;
        assert.ok(payload, 'structuredContent missing');

        if (payload.type === 'success') {
          const p = payload as { ok?: boolean; item?: { id?: string; subject?: string; body?: string; ok?: boolean; [key: string]: unknown } };
          // Should have item with only id field
          assert.ok(p.item, 'should have item field');
          assert.equal(typeof p.item.id, 'string', 'item.id should be string');
          assert.equal(p.item.id, sentId, 'item.id should match requested message ID');

          // Verify unrequested fields are NOT present
          assert.ok(!('body' in p.item), 'item should not have body when not requested');
          assert.ok(!('subject' in p.item), 'item should not have subject when not requested');
        } else {
          assert.fail(`expected success branch but received error: ${JSON.stringify(payload)}`);
        }
      } finally {
        for (const id of createdIds) {
          await deleteTestMessage(gmail, id, logger);
        }
      }
    });

    it('minimal fields with nonexistent message', async () => {
      const nonexistentId = 'nonexistent-message-id-123';

      // In the new pattern, errors are thrown as McpError
      await assert.rejects(
        async () => await handler({ id: nonexistentId, fields: 'id', contentType: 'text', excludeThreadHistory: false }, createExtra()),
        (error: unknown) => {
          assert.ok(error instanceof McpError, 'should throw McpError');
          return true;
        }
      );
    });

    it('fields parameter behavior with missing id parameter', async () => {
      // In the new pattern, errors are thrown as McpError
      await assert.rejects(
        async () => await handler({ fields: 'id,subject,from,body', contentType: 'text', excludeThreadHistory: false } as Input, createExtra()),
        (error: unknown) => {
          assert.ok(error instanceof McpError, 'should throw McpError');
          return true;
        }
      );

      // Test with minimal fields - also should throw McpError
      await assert.rejects(
        async () => await handler({ fields: 'id', contentType: 'text', excludeThreadHistory: false } as Input, createExtra()),
        (error: unknown) => {
          assert.ok(error instanceof McpError, 'should throw McpError');
          return true;
        }
      );
    });
  });
});
