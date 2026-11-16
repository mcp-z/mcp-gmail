import type { gmail_v1 } from '@googleapis/gmail';
import assert from 'assert';
import { ensureLabelId, resolveLabel } from '../../../src/labels/gmail-labels.ts';

const labels = [
  { id: 'INBOX', name: 'INBOX', type: 'system' },
  { id: 'STARRED', name: 'STARRED', type: 'system' },
  { id: 'Label_42', name: 'Receipts', type: 'user' },
  { id: 'Label_7', name: 'Label_42', type: 'user' },
  { id: 'Label_9', name: 'inbox', type: 'user' },
];

describe('resolveLabel', () => {
  it('resolves a system label by ID and by name, case-insensitively', () => {
    assert.deepStrictEqual(resolveLabel(labels, 'INBOX'), { id: 'INBOX', name: 'INBOX' });
    assert.deepStrictEqual(resolveLabel(labels, 'starred'), { id: 'STARRED', name: 'STARRED' });
  });

  it('prefers the system label over a user label whose name differs only by case', () => {
    assert.deepStrictEqual(resolveLabel(labels, 'inbox'), { id: 'INBOX', name: 'INBOX' });
  });

  it('resolves a user label by exact name', () => {
    assert.deepStrictEqual(resolveLabel(labels, 'Receipts'), { id: 'Label_42', name: 'Receipts' });
  });

  it('compares user label names case-sensitively', () => {
    assert.strictEqual(resolveLabel(labels, 'receipts'), undefined);
  });

  it('resolves a user label by ID', () => {
    assert.deepStrictEqual(resolveLabel(labels, 'Label_42'), { id: 'Label_42', name: 'Receipts' });
  });

  it('matches an ID before a name when a name equals another label ID', () => {
    // Label_7 is named "Label_42", but "Label_42" is also Receipts' ID.
    assert.strictEqual(resolveLabel(labels, 'Label_42')?.id, 'Label_42');
    assert.strictEqual(resolveLabel(labels, 'Label_7')?.id, 'Label_7');
  });

  it('returns undefined for an unknown label and for an empty list', () => {
    assert.strictEqual(resolveLabel(labels, 'Nope'), undefined);
    assert.strictEqual(resolveLabel([], 'INBOX'), undefined);
  });
});

describe('ensureLabelId', () => {
  function fakeGmail(created: unknown[]): gmail_v1.Gmail {
    return {
      users: {
        labels: {
          list: async () => ({ data: { labels } }),
          create: async (arg: unknown) => {
            created.push(arg);
            return { data: { id: 'Label_new' } };
          },
        },
      },
    } as unknown as gmail_v1.Gmail;
  }

  it('returns the existing label for a user label ID without creating one', async () => {
    const created: unknown[] = [];
    assert.strictEqual(await ensureLabelId(fakeGmail(created), 'me', 'Label_42'), 'Label_42');
    assert.strictEqual(created.length, 0);
  });

  it('returns the existing label for a user label name without creating one', async () => {
    const created: unknown[] = [];
    assert.strictEqual(await ensureLabelId(fakeGmail(created), 'me', 'Receipts'), 'Label_42');
    assert.strictEqual(created.length, 0);
  });

  it('passes system names through without listing', async () => {
    assert.strictEqual(await ensureLabelId({} as gmail_v1.Gmail, 'me', 'inbox'), 'INBOX');
  });

  it('creates a label only when nothing matches', async () => {
    const created: unknown[] = [];
    assert.strictEqual(await ensureLabelId(fakeGmail(created), 'me', 'Brand New'), 'Label_new');
    assert.strictEqual(created.length, 1);
    assert.strictEqual((created[0] as { requestBody: { name: string } }).requestBody.name, 'Brand New');
  });
});
