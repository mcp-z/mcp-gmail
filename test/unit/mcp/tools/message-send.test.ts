import type { Logger } from '@mcp-z/mcp-gmail';
import { mcp } from '@mcp-z/mcp-gmail';
import type { TypedToolResult } from '@mcp-z/server';
import assert from 'assert';
import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import type { Input, Output } from '../../../../src/mcp/tools/message-send.ts';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.ts';
import createMiddlewareContext from '../../../lib/create-middleware-context.ts';
import { deleteTestMessage } from '../../../lib/message-helpers.ts';

describe('Gmail message send tool (integration)', () => {
  let logger: Logger;
  let auth: Awaited<ReturnType<typeof createMiddlewareContext>>['auth'];
  let handler: TypedHandler<Input>;
  let sharedGmailClient: gmail_v1.Gmail;

  before(async () => {
    const middlewareContext = await createMiddlewareContext();
    logger = middlewareContext.logger;
    auth = middlewareContext.auth;
    const middleware = middlewareContext.middleware;
    const tool = mcp.toolFactories.messageSend();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;
    sharedGmailClient = google.gmail({ version: 'v1', auth: auth });
  });

  it('sends an email and returns success with message id', async () => {
    const sentMessageIds: string[] = [];

    try {
      const gmail = sharedGmailClient;
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const toAddr = (profile.data as gmail_v1.Schema$Profile)?.emailAddress ?? undefined;

      const result = await handler({ to: toAddr, cc: undefined, bcc: undefined, subject: 'Integration Test', body: 'Integration test body', contentType: 'text' }, createExtra());

      // Validate complete response structure according to outputSchema
      assert.ok(result, 'Handler returned no result');

      // Validate structuredContent.result matches outputSchema
      const structured = (result as unknown as TypedToolResult<Output>)?.structuredContent?.result as Output | undefined;
      assert.ok(structured, 'Response missing structuredContent.result');
      assert.strictEqual(structured.type, 'success', 'Expected success result');
      assert.ok(structured.item, 'Success result missing item');
      assert.ok(typeof structured.item.id === 'string' && structured.item.id.length > 0, 'Item missing valid id');

      // Track for close immediately after successful creation
      sentMessageIds.push(structured.item.id);

      // Validate content array matches outputSchema requirements
      const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
      assert.ok(Array.isArray(content), 'Response missing content array');
      assert.ok(content.length > 0, 'Content array is empty');
      assert.strictEqual(content[0]?.type, 'text', 'Content item missing text type');
      assert.ok(typeof content[0]?.text === 'string', 'Content item missing text field');

      // Validate that content contains the item data
      const parsedContent = JSON.parse(content[0]?.text ?? '{}');
      assert.ok(parsedContent.item.id, 'Content text does not contain id');
    } finally {
      // Clean up this test's resources
      const gmail = sharedGmailClient;
      for (const id of sentMessageIds) {
        await deleteTestMessage(gmail, id, logger);
      }
    }
  });

  it('formats RFC822 message with multiple recipients and headers', async () => {
    const sentMessageIds: string[] = [];

    try {
      const gmail = sharedGmailClient;
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const userEmail = (profile.data as gmail_v1.Schema$Profile)?.emailAddress ?? undefined;

      const to = `${userEmail}, ${userEmail}`; // Send to ourselves twice to test multiple recipients
      const cc = userEmail ?? undefined; // CC ourselves
      const bcc = userEmail ?? undefined; // BCC ourselves

      const result = await handler({ to, cc, bcc, subject: 'Format Test', body: 'Line 1\nLine 2', contentType: 'text' }, createExtra());

      // Validate complete response structure according to outputSchema
      assert.ok(result, 'Handler returned no result');

      // Validate structuredContent.result matches outputSchema
      const structured = (result as unknown as TypedToolResult<Output>)?.structuredContent?.result as Output | undefined;
      assert.ok(structured, 'Response missing structuredContent.result');
      assert.strictEqual(structured.type, 'success', 'Expected success result');
      assert.ok(structured.item, 'Success result missing item');
      assert.ok(typeof structured.item.id === 'string' && structured.item.id.length > 0, 'Item missing valid id');

      // Track for close immediately after successful creation
      sentMessageIds.push(structured.item.id);

      // Validate content array matches outputSchema requirements
      const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
      assert.ok(Array.isArray(content), 'Response missing content array');
      assert.ok(content.length > 0, 'Content array is empty');
      assert.strictEqual(content[0]?.type, 'text', 'Content item missing text type');
      assert.ok(typeof content[0]?.text === 'string', 'Content item missing text field');

      const getMsg = await gmail.users.messages.get({ userId: 'me', id: structured.item.id, format: 'raw' });
      const raw = String(((getMsg.data as gmail_v1.Schema$Message) || {}).raw ?? '');
      const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();

      assert.ok(decoded.includes('Subject: Format Test'));
      assert.ok(decoded.includes('To:'));
      assert.ok(decoded.includes('Cc:'));
    } finally {
      // Clean up this test's resources
      const gmail = sharedGmailClient;
      for (const id of sentMessageIds) {
        await deleteTestMessage(gmail, id, logger);
      }
    }
  });
});
