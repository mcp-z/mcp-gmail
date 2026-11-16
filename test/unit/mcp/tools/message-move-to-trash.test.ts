import type { gmail_v1 } from '@googleapis/gmail';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import assert from 'assert';
import { trashMessages } from '../../../../src/mcp/tools/message-move-to-trash.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as EnrichedExtra['logger'];

// A plain object satisfying the one method trashMessages calls; failures are keyed by message ID.
function fakeGmail(failures: Record<string, unknown>, calls: string[] = []): gmail_v1.Gmail {
  return {
    users: {
      messages: {
        trash: async ({ id }: { id: string }) => {
          calls.push(id);
          if (id in failures) throw failures[id];
          return {};
        },
      },
    },
  } as unknown as gmail_v1.Gmail;
}

describe('trashMessages output', () => {
  it('reports every success in input order', async () => {
    const calls: string[] = [];
    const out = await trashMessages(fakeGmail({}, calls), ['a', 'b', 'c'], logger);
    assert.deepStrictEqual(out, {
      results: [
        { id: 'a', success: true },
        { id: 'b', success: true },
        { id: 'c', success: true },
      ],
      successCount: 3,
      failureCount: 0,
    });
    assert.deepStrictEqual(calls.sort(), ['a', 'b', 'c']);
  });

  it('extracts the message from each rejection shape and keeps input order across chunks', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `m${i}`);
    const failures = {
      m1: 'plain string',
      m11: new Error('error object'),
      m12: { message: 'message field' },
      m13: { error: 'error field' },
      m24: 42,
      m5: undefined, // falsy reason
    };
    const out = await trashMessages(fakeGmail(failures), ids, logger);
    assert.deepStrictEqual(
      out.results.map((r) => r.id),
      ids
    );
    assert.strictEqual(out.successCount, 19);
    assert.strictEqual(out.failureCount, 6);
    const byId = Object.fromEntries(out.results.map((r) => [r.id, r]));
    assert.deepStrictEqual(byId.m0, { id: 'm0', success: true });
    assert.deepStrictEqual(byId.m1, { id: 'm1', success: false, error: 'plain string' });
    assert.deepStrictEqual(byId.m11, { id: 'm11', success: false, error: 'error object' });
    assert.deepStrictEqual(byId.m12, { id: 'm12', success: false, error: 'message field' });
    assert.deepStrictEqual(byId.m13, { id: 'm13', success: false, error: 'error field' });
    assert.deepStrictEqual(byId.m24, { id: 'm24', success: false, error: '42' });
    assert.deepStrictEqual(byId.m5, { id: 'm5', success: false, error: 'Unknown error' });
  });
});
