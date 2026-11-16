import type { gmail_v1 } from '@googleapis/gmail';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import assert from 'assert';
import { deleteLabels } from '../../../../src/mcp/tools/label-delete.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as EnrichedExtra['logger'];

// A plain object satisfying the two methods deleteLabels calls.
function fakeGmail(labels: Array<{ id: string; name: string; type: 'system' | 'user' }>, deleteFailures: Record<string, unknown> = {}, deleted: string[] = []): gmail_v1.Gmail {
  return {
    users: {
      labels: {
        list: async () => ({ data: { labels } }),
        delete: async ({ id }: { id: string }) => {
          if (id in deleteFailures) throw deleteFailures[id];
          deleted.push(id);
          return {};
        },
      },
    },
  } as unknown as gmail_v1.Gmail;
}

describe('deleteLabels output', () => {
  it('deletes user labels and reports unknown ids, system labels and API failures per item in input order', async () => {
    const deleted: string[] = [];
    const labels = [
      { id: 'INBOX', name: 'INBOX', type: 'system' as const },
      { id: 'Label_1', name: 'One', type: 'user' as const },
      { id: 'Label_2', name: 'Two', type: 'user' as const },
    ];
    const out = await deleteLabels(fakeGmail(labels, { Label_2: { message: 'boom' } }, deleted), ['Label_1', 'nope', 'INBOX', 'Label_2'], logger);
    assert.deepStrictEqual(out, {
      results: [
        { id: 'Label_1', success: true },
        { id: 'nope', success: false, error: 'Label not found: nope' },
        { id: 'INBOX', success: false, error: 'Cannot delete system label: INBOX (INBOX)' },
        { id: 'Label_2', success: false, error: 'boom' },
      ],
      successCount: 1,
      failureCount: 3,
    });
    assert.deepStrictEqual(deleted, ['Label_1']);
  });

  it('keeps input order across chunk boundaries', async () => {
    const labels = Array.from({ length: 12 }, (_, i) => ({ id: `L${i}`, name: `n${i}`, type: 'user' as const }));
    const out = await deleteLabels(
      fakeGmail(labels),
      labels.map((l) => l.id),
      logger
    );
    assert.deepStrictEqual(
      out.results.map((r) => r.id),
      labels.map((l) => l.id)
    );
    assert.strictEqual(out.successCount, 12);
    assert.strictEqual(out.failureCount, 0);
  });
});
