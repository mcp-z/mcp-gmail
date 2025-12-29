import type { TypedToolResult } from '@mcp-z/server';
import assert from 'assert';
import createTool, { type Input, type Output } from '../../../../src/mcp/tools/categories-list.js';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.js';
import createMiddlewareContext from '../../../lib/create-middleware-context.js';

describe('Gmail categories list tool', () => {
  // Shared instances for all tests
  let handler: TypedHandler<Input>;

  before(async () => {
    const middlewareContext = await createMiddlewareContext();
    const middleware = middlewareContext.middleware;
    const _middleware = middlewareContext.middleware;
    const tool = createTool();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;
  });

  it('returns all supported Gmail categories (service-backed)', async () => {
    const result = await handler({}, createExtra());

    // Canonical machine-readable payload must be present in structuredContent.result
    const payload = (result as unknown as TypedToolResult<Output>)?.structuredContent?.result as Output | undefined;
    assert.ok(payload, 'structuredContent missing');

    if (payload.type === 'success') {
      assert.ok('items' in payload);
      assert.ok(Array.isArray(payload.items));
      assert.strictEqual(payload.items.length, 5);

      // Verify specific categories
      const categories = payload.items;
      const categoryIds = categories.map((cat: unknown) => {
        const c = cat as { id: string };
        return c.id;
      });

      assert.ok(categoryIds.includes('CATEGORY_PERSONAL'));
      assert.ok(categoryIds.includes('CATEGORY_SOCIAL'));
      assert.ok(categoryIds.includes('CATEGORY_PROMOTIONS'));
      assert.ok(categoryIds.includes('CATEGORY_UPDATES'));
      assert.ok(categoryIds.includes('CATEGORY_FORUMS'));

      // Verify structure of first category
      const firstCategory = categories[0] as { id: string; name: string; description: string };
      assert.ok(typeof firstCategory.id === 'string');
      assert.ok(typeof firstCategory.name === 'string');
      assert.ok(typeof firstCategory.description === 'string');
      assert.ok(firstCategory.id.length > 0);
      assert.ok(firstCategory.name.length > 0);
      assert.ok(firstCategory.description.length > 0);

      // Verify Primary category specifically
      const primaryCategory = categories.find((cat: unknown) => {
        const c = cat as { id: string };
        return c.id === 'CATEGORY_PERSONAL';
      }) as { id: string; name: string; description: string } | undefined;
      assert.ok(primaryCategory);
      assert.strictEqual(primaryCategory.name, 'Primary');
      assert.strictEqual(primaryCategory.description, 'Important emails from people you know');
    } else if (payload.type === 'auth_required') {
      // Auth required is acceptable in test environment without tokens
      assert.ok(typeof payload.message === 'string');
      assert.ok(payload.message.length > 0);
    } else {
      assert.fail(`expected success or auth_required branch but received: ${JSON.stringify(payload)}`);
    }
  });
});
