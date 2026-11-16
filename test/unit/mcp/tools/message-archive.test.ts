import type { gmail_v1 } from '@googleapis/gmail';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { ProtocolError, ProtocolErrorCode } from '@mcp-z/server';
import assert from 'assert';
import createTool, { archiveMessages } from '../../../../src/mcp/tools/message-archive.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as EnrichedExtra['logger'];
type ModifyCall = { userId: string; id: string; requestBody: unknown };

function fakeGmail(failures: Record<string, unknown>, calls: ModifyCall[]): gmail_v1.Gmail {
  return {
    users: {
      messages: {
        modify: async (call: ModifyCall) => {
          calls.push(call);
          if (call.id in failures) throw failures[call.id];
          return {};
        },
        trash: async () => assert.fail('must not trash'),
        delete: async () => assert.fail('must not delete'),
      },
    },
  } as unknown as gmail_v1.Gmail;
}

describe('message-archive', () => {
  it('is registered as message-archive with an idempotent hint', () => {
    const tool = createTool();
    assert.strictEqual(tool.name, 'message-archive');
    assert.strictEqual(tool.config.annotations.idempotentHint, true);
  });

  it('removes only INBOX, with no addLabelIds, one call per message', async () => {
    const calls: ModifyCall[] = [];
    const out = await archiveMessages(fakeGmail({}, calls), ['a', 'b'], logger);
    assert.strictEqual(calls.length, 2);
    for (const call of calls) {
      assert.strictEqual(call.userId, 'me');
      assert.deepStrictEqual(call.requestBody, { removeLabelIds: ['INBOX'] });
    }
    assert.deepStrictEqual(out, {
      results: [
        { id: 'a', success: true },
        { id: 'b', success: true },
      ],
      successCount: 2,
      failureCount: 0,
    });
  });

  it('reports a per-item failure without failing the call', async () => {
    const out = await archiveMessages(fakeGmail({ bad: new Error('Requested entity was not found.') }, []), ['ok', 'bad'], logger);
    assert.deepStrictEqual(out.results, [
      { id: 'ok', success: true },
      { id: 'bad', success: false, error: 'Requested entity was not found.' },
    ]);
    assert.strictEqual(out.successCount, 1);
    assert.strictEqual(out.failureCount, 1);
  });

  it('rejects empty, oversized and malformed ids as InvalidParams before any network call', async () => {
    const { handler } = createTool();
    const extra = { logger } as unknown as EnrichedExtra;
    for (const ids of [[], Array.from({ length: 501 }, (_, i) => `m${i}`), ['a/b'], ['x', '<y>']]) {
      await assert.rejects(
        () => handler({ ids }, extra),
        (e) => e instanceof ProtocolError && e.code === ProtocolErrorCode.InvalidParams
      );
    }
  });
});
