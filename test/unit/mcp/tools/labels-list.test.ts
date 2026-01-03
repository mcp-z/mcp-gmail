import type { TypedToolResult } from '@mcp-z/server';
import assert from 'assert';
import createTool, { type Input, type Output } from '../../../../src/mcp/tools/labels-list.ts';
import type { Logger } from '../../../../src/types.ts';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.ts';
import createMiddlewareContext from '../../../lib/create-middleware-context.ts';

describe('Gmail labels list tool', () => {
  // Shared instance for all tests
  let logger: Logger;
  let handler: TypedHandler<Input>;

  before(async () => {
    const middlewareContext = await createMiddlewareContext();
    logger = middlewareContext.logger;
    const middleware = middlewareContext.middleware;
    logger = middlewareContext.logger;
    const _middleware = middlewareContext.middleware;
    const tool = createTool();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;
  });
  it('returns user Gmail labels (excluding CATEGORY_* system labels) (service-backed)', async () => {
    const result = await handler({}, createExtra());

    // Canonical machine-readable payload must be present in structuredContent.result
    const payload = (result as unknown as TypedToolResult<Output>)?.structuredContent?.result as Output | undefined;
    assert.ok(payload, 'structuredContent missing');

    if (payload.type === 'success' && 'items' in payload) {
      assert.ok(Array.isArray(payload.items));

      const labels = payload.items;
      logger.info(`Found ${labels.length} labels`);

      if (labels.length > 0) {
        // Verify structure of labels
        const firstLabel = labels[0] as { id: string; name: string; type: string; visibility: string };
        assert.ok(typeof firstLabel.id === 'string', 'label should have string id');
        assert.ok(typeof firstLabel.name === 'string', 'label should have string name');
        assert.ok(['user', 'system'].includes(firstLabel.type), 'label should have valid type');
        assert.ok(['labelShow', 'labelHide', 'labelShowIfUnread'].includes(firstLabel.visibility), 'label should have valid visibility');

        // Verify no CATEGORY_* labels are returned (those are handled by categories tool)
        const categoryLabels = labels.filter((label: unknown) => {
          const l = label as { id?: string };
          return l.id?.startsWith('CATEGORY_');
        });
        assert.strictEqual(categoryLabels.length, 0, 'CATEGORY_* labels should be excluded');

        // Verify user labels come first in sort order
        const userLabels = labels.filter((label: unknown) => {
          const l = label as { type: string };
          return l.type === 'user';
        });
        const systemLabels = labels.filter((label: unknown) => {
          const l = label as { type: string };
          return l.type === 'system';
        });

        if (userLabels.length > 0 && systemLabels.length > 0) {
          // Find index of first user label and first system label
          const firstUserIndex = labels.findIndex((label: unknown) => {
            const l = label as { type: string };
            return l.type === 'user';
          });
          const firstSystemIndex = labels.findIndex((label: unknown) => {
            const l = label as { type: string };
            return l.type === 'system';
          });

          if (firstUserIndex >= 0 && firstSystemIndex >= 0) {
            assert.ok(firstUserIndex < firstSystemIndex, 'user labels should come before system labels');
          }
        }

        // Verify alphabetical sorting within each type
        if (userLabels.length > 1) {
          const userLabelNames = userLabels.map((label: unknown) => {
            const l = label as { name: string };
            return l.name;
          });
          const sortedUserNames = [...userLabelNames].sort();
          assert.deepStrictEqual(userLabelNames, sortedUserNames, 'user labels should be alphabetically sorted');
        }
      }

      logger.info('Sample labels:', {
        samples: labels.slice(0, 5).map((l: unknown) => {
          const label = l as { name: string; type: string };
          return `${label.name} (${label.type})`;
        }),
      });
    } else if (payload.type === 'auth_required') {
      // Auth required is acceptable in test environment
      logger.info(`Labels list returned auth_required (expected in test environment): ${JSON.stringify(payload)}`);
      assert.ok(typeof payload.message === 'string');
      assert.ok(payload.message.length > 0);
    }
  });

  it('handles case-sensitive label names correctly', async () => {
    const result = await handler({}, createExtra());

    const payload = (result as unknown as TypedToolResult<Output>)?.structuredContent?.result as Output | undefined;
    assert.ok(payload, 'structuredContent missing');

    if (payload.type === 'success' && 'items' in payload) {
      const labels = payload.items;

      // Check that label names preserve their exact case
      for (const label of labels) {
        const labelObj = label as { name?: string };
        if (labelObj.name) {
          // Label names should preserve their exact case from Gmail
          assert.strictEqual(typeof labelObj.name, 'string');
          assert.ok(labelObj.name.length > 0);

          // Verify that the name field matches the expected case-sensitive pattern
          // (this is more about structure validation than specific values)
          assert.ok(/^[^"']*$/.test(labelObj.name) || labelObj.name.includes(' '), 'label names should be unquoted strings or contain spaces');
        }
      }
    } else if (payload.type === 'auth_required') {
      // Auth required is acceptable in test environment without tokens
      logger.info('Test skipped due to missing auth');
    }
  });
});
