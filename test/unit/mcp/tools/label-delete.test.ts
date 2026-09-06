import { type gmail_v1, gmail as gmailApi } from '@googleapis/gmail';
import type { Logger } from '@mcp-z/mcp-gmail';
import { mcp } from '@mcp-z/mcp-gmail';
import assert from 'assert';
import type { Input, Output } from '../../../../src/mcp/tools/label-delete.ts';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.ts';
import createMiddlewareContext from '../../../lib/create-middleware-context.ts';
import { createTestLabel, deleteTestLabel, labelExists } from '../../../lib/label-helpers.ts';
import waitForLabel from '../../../lib/wait-for-label.ts';

describe('gmail-label-delete', () => {
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
    const tool = mcp.toolFactories.labelDelete();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;
    sharedGmail = gmailApi({ version: 'v1', auth: auth });
  });
  it('deletes single label successfully', async () => {
    const gmail = sharedGmail;

    // Track created resource ids locally to ensure per-test close
    const createdIds: string[] = [];

    try {
      // Create a test label
      const labelId = await createTestLabel(gmail);
      createdIds.push(labelId);

      // Verify label exists
      assert.ok(await labelExists(gmail, labelId), 'Test label should exist before deletion');

      // Delete the label using single ID in array format
      const response = await handler({ ids: [labelId] }, createExtra());

      // Check structured response
      const structured = (response.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
      assert.ok(structured, 'structuredContent missing');

      if (structured.type === 'success') {
        // Access properties directly on structured (no item wrapper)
        assert.strictEqual(structured.totalRequested, 1, 'totalRequested should be 1');
        assert.strictEqual(structured.successCount, 1, 'successCount should be 1');
        assert.strictEqual(structured.failureCount, 0, 'failureCount should be 0');
        assert.strictEqual(structured.results.length, 1, 'results length should be 1');
        assert.strictEqual(structured.results[0]?.id, labelId, 'result id should match');
        assert.strictEqual(structured.results[0]?.success, true, 'result success should be true');
        assert.strictEqual(structured.results[0]?.error, undefined, 'result error should be undefined');

        // Verify label no longer exists
        assert.ok(!(await labelExists(gmail, labelId)), 'Label should not exist after deletion');
        // Remove from close list since it has been deleted
        const idx = createdIds.indexOf(labelId);
        if (idx !== -1) createdIds.splice(idx, 1);
      } else {
        assert.fail(`expected success branch but received error: ${JSON.stringify(structured)}`);
      }
    } finally {
      // Cleanup any remaining labels
      for (const id of createdIds) {
        await deleteTestLabel(gmail, id, logger);
      }
    }
  });

  it('deletes multiple labels in batch', async () => {
    const gmail = sharedGmail;

    // Track created resource ids locally to ensure per-test close
    const createdIds: string[] = [];

    try {
      // Create multiple test labels
      const labelId1 = await createTestLabel(gmail, { name: `ci-test-batch-1-${Date.now()}` });
      const labelId2 = await createTestLabel(gmail, { name: `ci-test-batch-2-${Date.now()}` });
      createdIds.push(labelId1, labelId2);

      // Wait for Gmail API to index the new labels
      await waitForLabel(gmail, labelId1);
      await waitForLabel(gmail, labelId2);

      // Verify labels exist
      assert.ok(await labelExists(gmail, labelId1), 'Test label 1 should exist before deletion');
      assert.ok(await labelExists(gmail, labelId2), 'Test label 2 should exist before deletion');

      // Delete the labels using array of IDs
      const response = await handler({ ids: [labelId1, labelId2] }, createExtra());

      // Check structured response
      const structured = (response.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
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
          return result.id === labelId1;
        });
        const result2 = structured.results.find((r: unknown) => {
          const result = r as { id: string };
          return result.id === labelId2;
        });

        assert.ok(result1, 'result for labelId1 should exist');
        assert.strictEqual(result1.success, true, 'result1 success should be true');
        assert.strictEqual(result1.error, undefined, 'result1 error should be undefined');

        assert.ok(result2, 'result for labelId2 should exist');
        assert.strictEqual(result2.success, true, 'result2 success should be true');
        assert.strictEqual(result2.error, undefined, 'result2 error should be undefined');

        // Verify labels no longer exist
        assert.ok(!(await labelExists(gmail, labelId1)), 'Label 1 should not exist after deletion');
        assert.ok(!(await labelExists(gmail, labelId2)), 'Label 2 should not exist after deletion');
        // Remove deleted ids from close list
        createdIds.splice(0, createdIds.length);
      } else {
        assert.fail(`expected success branch but received error: ${JSON.stringify(structured)}`);
      }
    } finally {
      // Cleanup any remaining labels
      for (const id of createdIds) {
        await deleteTestLabel(gmail, id, logger);
      }
    }
  });

  it('handles system label deletion attempt gracefully', async () => {
    // Try to delete INBOX (a system label)
    const response = await handler({ ids: ['INBOX'] }, createExtra());

    // Check structured response
    const structured = (response.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
    assert.ok(structured, 'structuredContent missing');

    if (structured.type === 'success') {
      assert.strictEqual(structured.totalRequested, 1, 'totalRequested should be 1');
      assert.strictEqual(structured.successCount, 0, 'successCount should be 0');
      assert.strictEqual(structured.failureCount, 1, 'failureCount should be 1');
      assert.strictEqual(structured.results.length, 1, 'results length should be 1');
      assert.strictEqual(structured.results[0]?.id, 'INBOX', 'result id should match');
      assert.strictEqual(structured.results[0]?.success, false, 'result success should be false');
      assert.ok(structured.results[0]?.error?.includes('system label'), 'error should mention system label');
    } else {
      assert.fail(`expected success branch but received error: ${JSON.stringify(structured)}`);
    }
  });

  it('handles non-existent label deletion gracefully', async () => {
    const nonExistentId = `Label_NonExistent${Date.now()}`;

    // Try to delete a non-existent label
    const response = await handler({ ids: [nonExistentId] }, createExtra());

    // Check structured response
    const structured = (response.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
    assert.ok(structured, 'structuredContent missing');

    if (structured.type === 'success') {
      // Access properties directly on structured (no item wrapper)
      assert.strictEqual(structured.totalRequested, 1, 'totalRequested should be 1');
      assert.strictEqual(structured.successCount, 0, 'successCount should be 0');
      assert.strictEqual(structured.failureCount, 1, 'failureCount should be 1');
      assert.strictEqual(structured.results.length, 1, 'results length should be 1');
      assert.strictEqual(structured.results[0]?.id, nonExistentId, 'result id should match');
      assert.strictEqual(structured.results[0]?.success, false, 'result success should be false');
      assert.ok(structured.results[0]?.error?.includes('not found'), 'error should mention not found');
    } else {
      assert.fail(`expected success branch but received error: ${JSON.stringify(structured)}`);
    }
  });

  it('handles mixed success/failure batch operation', async () => {
    const gmail = sharedGmail;

    // Track created resource ids locally to ensure per-test close
    const createdIds: string[] = [];

    try {
      // Create one test label
      const validLabelId = await createTestLabel(gmail, { name: `ci-test-mixed-${Date.now()}` });
      createdIds.push(validLabelId);

      // Try to delete valid label + system label + non-existent label
      const nonExistentId = `Label_NonExistent${Date.now()}`;
      const response = await handler(
        {
          ids: [validLabelId, 'INBOX', nonExistentId],
        },
        createExtra()
      );

      // Check structured response
      const structured = (response.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
      assert.ok(structured, 'structuredContent missing');

      if (structured.type === 'success') {
        // Access properties directly on structured (no item wrapper)
        assert.strictEqual(structured.totalRequested, 3, 'totalRequested should be 3');
        assert.strictEqual(structured.successCount, 1, 'successCount should be 1 (valid label)');
        assert.strictEqual(structured.failureCount, 2, 'failureCount should be 2 (system + non-existent)');
        assert.strictEqual(structured.results.length, 3, 'results length should be 3');

        // Check results
        const validResult = structured.results.find((r: unknown) => {
          const result = r as { id: string };
          return result.id === validLabelId;
        });
        const systemResult = structured.results.find((r: unknown) => {
          const result = r as { id: string };
          return result.id === 'INBOX';
        });
        const nonExistentResult = structured.results.find((r: unknown) => {
          const result = r as { id: string };
          return result.id === nonExistentId;
        });

        assert.ok(validResult, 'valid result should exist');
        assert.strictEqual(validResult.success, true, 'valid result should be successful');

        assert.ok(systemResult, 'system result should exist');
        assert.strictEqual(systemResult.success, false, 'system result should fail');

        assert.ok(nonExistentResult, 'non-existent result should exist');
        assert.strictEqual(nonExistentResult.success, false, 'non-existent result should fail');

        // Verify valid label no longer exists
        assert.ok(!(await labelExists(gmail, validLabelId)), 'Valid label should not exist after deletion');
        // Remove valid label id from close list
        const idx = createdIds.indexOf(validLabelId);
        if (idx !== -1) createdIds.splice(idx, 1);
      } else {
        assert.fail(`expected success branch but received error: ${JSON.stringify(structured)}`);
      }
    } finally {
      // Cleanup any remaining labels
      for (const id of createdIds) {
        await deleteTestLabel(gmail, id, logger);
      }
    }
  });
});
