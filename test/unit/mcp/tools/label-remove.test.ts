import type { gmail_v1 } from '@googleapis/gmail';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { ProtocolError, ProtocolErrorCode } from '@mcp-z/server';
import assert from 'assert';
import createTool, { removeLabel } from '../../../../src/mcp/tools/label-remove.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as EnrichedExtra['logger'];
type ModifyCall = { userId: string; id: string; requestBody: unknown };

const labels = [
  { id: 'INBOX', name: 'INBOX', type: 'system' },
  { id: 'Label_42', name: 'Receipts', type: 'user' },
];

function fakeGmail(failures: Record<string, unknown>, calls: ModifyCall[], created: unknown[] = []): gmail_v1.Gmail {
  return {
    users: {
      labels: {
        list: async () => ({ data: { labels } }),
        create: async (arg: unknown) => {
          created.push(arg);
          return { data: { id: 'new' } };
        },
        delete: async () => assert.fail('must not delete a label'),
      },
      messages: {
        modify: async (call: ModifyCall) => {
          calls.push(call);
          if (call.id in failures) throw failures[call.id];
          return {};
        },
      },
    },
  } as unknown as gmail_v1.Gmail;
}

describe('label-remove', () => {
  it('is registered as label-remove, idempotent, requiring ids and label', () => {
    const tool = createTool();
    assert.strictEqual(tool.name, 'label-remove');
    assert.strictEqual(tool.config.annotations.idempotentHint, true);
    assert.strictEqual(tool.config.inputSchema.safeParse({ ids: ['a'] }).success, false);
    assert.strictEqual(tool.config.inputSchema.safeParse({ label: 'x' }).success, false);
    assert.strictEqual(tool.config.inputSchema.safeParse({ ids: [], label: 'x' }).success, false);
    assert.strictEqual(tool.config.inputSchema.safeParse({ ids: ['a'], label: 'x' }).success, true);
  });

  for (const [how, ref] of [
    ['name', 'Receipts'],
    ['ID', 'Label_42'],
  ] as const) {
    it(`removes a user label resolved by ${how}, and only that label`, async () => {
      const calls: ModifyCall[] = [];
      const out = await removeLabel(fakeGmail({}, calls), ['a', 'b'], ref, logger);
      assert.deepStrictEqual(out.label, { id: 'Label_42', name: 'Receipts' });
      assert.deepStrictEqual(
        calls.map((c) => c.requestBody),
        [{ removeLabelIds: ['Label_42'] }, { removeLabelIds: ['Label_42'] }]
      );
      assert.strictEqual(out.successCount, 2);
    });
  }

  it('resolves a system label by case-insensitive name (INBOX-only removal)', async () => {
    const calls: ModifyCall[] = [];
    const out = await removeLabel(fakeGmail({}, calls), ['a'], 'inbox', logger);
    assert.deepStrictEqual(out.label, { id: 'INBOX', name: 'INBOX' });
    assert.deepStrictEqual(calls[0]?.requestBody, { removeLabelIds: ['INBOX'] });
  });

  it('reports per-item failures', async () => {
    const out = await removeLabel(fakeGmail({ bad: { message: 'nope' } }, []), ['ok', 'bad'], 'Receipts', logger);
    assert.deepStrictEqual(out.results, [
      { id: 'ok', success: true },
      { id: 'bad', success: false, error: 'nope' },
    ]);
    assert.strictEqual(out.failureCount, 1);
  });

  it('throws InvalidParams for an unknown label, without modifying messages or creating a label', async () => {
    const calls: ModifyCall[] = [];
    const created: unknown[] = [];
    await assert.rejects(
      () => removeLabel(fakeGmail({}, calls, created), ['a'], 'Missing', logger),
      (e) => e instanceof ProtocolError && e.code === ProtocolErrorCode.InvalidParams && /Label not found: "Missing"/.test(e.message)
    );
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(created.length, 0);
  });

  it('rejects malformed ids as InvalidParams before any network call', async () => {
    const { handler } = createTool();
    await assert.rejects(
      () => handler({ ids: ['a/b'], label: 'Receipts' }, { logger } as unknown as EnrichedExtra),
      (e) => e instanceof ProtocolError && e.code === ProtocolErrorCode.InvalidParams
    );
  });
});
