import type { EnrichedExtra } from '@mcp-z/oauth-google';
import assert from 'assert';
import { CHUNK_SIZE } from '../../../src/constants.ts';
import { runPerId } from '../../../src/lib/run-per-id.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as EnrichedExtra['logger'];

describe('runPerId', () => {
  it('returns an empty outcome for no ids', async () => {
    assert.deepStrictEqual(await runPerId([], async () => {}, logger), { results: [], successCount: 0, failureCount: 0 });
  });

  it('keeps input order across chunk boundaries (CHUNK_SIZE + 1 ids)', async () => {
    const ids = Array.from({ length: CHUNK_SIZE + 1 }, (_, i) => `id${i}`);
    // Earlier ids finish later, so completion order differs from input order.
    const out = await runPerId(ids, (id) => new Promise((resolve) => setTimeout(resolve, 20 - Number(id.slice(2)))), logger);
    assert.deepStrictEqual(
      out.results.map((r) => r.id),
      ids
    );
    assert.strictEqual(out.successCount, CHUNK_SIZE + 1);
    assert.strictEqual(out.failureCount, 0);
  });

  it('never runs more than CHUNK_SIZE calls at once', async () => {
    let active = 0;
    let peak = 0;
    const ids = Array.from({ length: CHUNK_SIZE * 2 + 3 }, (_, i) => `id${i}`);
    await runPerId(
      ids,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
      },
      logger
    );
    assert.strictEqual(peak, CHUNK_SIZE);
  });

  it('turns each rejection shape into success:false with the extracted message, and keeps going', async () => {
    const reasons: Record<string, unknown> = {
      a: 'a string',
      b: new Error('an Error'),
      c: { message: 'a message field' },
      d: { error: 'an error field' },
      e: 7,
      f: undefined,
    };
    const out = await runPerId(
      ['a', 'b', 'c', 'd', 'e', 'f', 'ok'],
      async (id) => {
        if (id in reasons) throw reasons[id];
      },
      logger
    );
    assert.deepStrictEqual(out.results, [
      { id: 'a', success: false, error: 'a string' },
      { id: 'b', success: false, error: 'an Error' },
      { id: 'c', success: false, error: 'a message field' },
      { id: 'd', success: false, error: 'an error field' },
      { id: 'e', success: false, error: '7' },
      { id: 'f', success: false, error: 'Unknown error' },
      { id: 'ok', success: true },
    ]);
    assert.strictEqual(out.successCount, 1);
    assert.strictEqual(out.failureCount, 6);
  });

  it('turns a synchronous throw from the callback into one failed item and keeps going', async () => {
    const fn = (id: string): Promise<unknown> => {
      if (id === 'b') throw new Error('sync boom');
      return Promise.resolve();
    };
    const out = await runPerId(['a', 'b', 'c'], fn, logger);
    assert.deepStrictEqual(out.results, [
      { id: 'a', success: true },
      { id: 'b', success: false, error: 'sync boom' },
      { id: 'c', success: true },
    ]);
    assert.strictEqual(out.failureCount, 1);
  });
});
