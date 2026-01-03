import assert from 'assert';
import { filterClientSide, type GmailMessage, toRowFromGmail } from '../../../src/lib/messages-to-row.ts';

// --- Date normalization + address formatting ---------------------------------
it('toRowFromGmail: normalizes Date header to ISO8601 UTC', () => {
  const rawDate = 'Sat, 30 Aug 2025 15:44:48 -0700';
  const msg = {
    id: 'mid',
    threadId: 'tid',
    labelIds: [],
    snippet: '',
    payload: {
      headers: [
        { name: 'Date', value: rawDate },
        { name: 'From', value: 'Alice <alice@example.com>' },
        { name: 'To', value: 'Bob <bob@example.com>' },
        { name: 'Subject', value: 'Hello' },
      ],
    },
  };
  const row = toRowFromGmail(msg, { body: false });
  const date = row[7]; // [id, provider, threadId, to, from, cc, bcc, date, ...]
  assert.equal(date, '2025-08-30T22:44:48.000Z');
});

it('toRowFromGmail: address formatting modes (default=email)', () => {
  const msg = {
    id: 'mid',
    threadId: 'tid',
    labelIds: [],
    snippet: '',
    payload: {
      headers: [
        { name: 'Date', value: 'Sat, 30 Aug 2025 15:44:48 -0700' },
        { name: 'From', value: 'Alice Smith <alice@example.com>' },
        { name: 'To', value: 'Bob <bob@example.com>, carol@example.com' },
        { name: 'Subject', value: 'Hello' },
      ],
    },
  };

  // default (email)
  let row = toRowFromGmail(msg, { body: false });
  assert.equal(row[3], 'bob@example.com, carol@example.com');
  assert.equal(row[4], 'alice@example.com');

  // raw
  row = toRowFromGmail(msg, { body: false, addressFormat: 'raw' });
  assert.equal(row[3], 'Bob <bob@example.com>, carol@example.com');
  assert.equal(row[4], 'Alice Smith <alice@example.com>');

  // name (falls back to email when name missing)
  row = toRowFromGmail(msg, { body: false, addressFormat: 'name' });
  assert.equal(row[3], 'Bob, carol@example.com');
  assert.equal(row[4], 'Alice Smith');
});

// --- Client-side filter behavior ---------------------------------------------
it('filterClientSide: OR within subject values, AND across fields', () => {
  const filters = {
    subjectIncludes: ['invoice', 'receipt'],
  };
  assert.equal(filterClientSide(filters, { subject: 'Monthly invoice' }), true);
  assert.equal(filterClientSide(filters, { subject: 'Payment receipt' }), true);
  assert.equal(filterClientSide(filters, { subject: 'Hello there' }), false);

  const filters2 = { subjectIncludes: ['invoice', 'receipt'], bodyIncludes: ['overdue'] };
  assert.equal(filterClientSide(filters2, { subject: 'Invoice', fullBody: 'This is overdue' }), true);
  assert.equal(filterClientSide(filters2, { subject: 'Invoice', fullBody: 'All paid' }), false);
});

it('filterClientSide: textIncludes matches subject OR body', () => {
  const filters = { textIncludes: ['overdue', 'past due'] };
  assert.equal(filterClientSide(filters, { subject: 'Overdue invoice' }), true);
  assert.equal(filterClientSide(filters, { fullBody: 'Payment is past due' }), true);
  assert.equal(filterClientSide(filters, { subject: 'Hello', fullBody: 'All paid' }), false);
});

it('toRowFromGmail: trims quoted history in text and html', () => {
  const textBody = 'Hi Bob,\nLatest update.\n\n> On Sat, 30 Aug 2025 12:00 -0700, Alice wrote:\n> Older lines';
  const htmlBody = '<div>Hi Bob,<br>Latest update.</div><blockquote class="gmail_quote">On Sat...<div>Older message</div></blockquote>';

  // text/plain via payload.body
  const msg = {
    id: 'mid',
    threadId: 'tid',
    labelIds: [],
    snippet: '',
    payload: { headers: [], body: { data: Buffer.from(textBody, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } },
  };
  let row = toRowFromGmail(msg, { body: true });
  let body = row[11] ?? '';
  assert.ok(body.includes('Latest update'));
  assert.ok(!/On Sat/i.test(body));

  // html path via parts
  const htmlMsg = {
    id: 'mid',
    threadId: 'tid',
    labelIds: [],
    snippet: '',
    payload: { headers: [], parts: [{ mimeType: 'text/html', body: { data: Buffer.from(htmlBody, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } }] },
  } satisfies GmailMessage;
  row = toRowFromGmail(htmlMsg, { body: true });
  body = row[11] ?? '';
  assert.ok(body.includes('Latest update'));
  assert.ok(!/Older message/i.test(body));
});

it('toRowFromGmail: trims when quoted block has only > prefixes (no explicit marker)', () => {
  const textBody = 'Top line\nSecond line\n\n> quoted 1\n> quoted 2\n> quoted 3';
  const msg = {
    id: 'mid',
    threadId: 'tid',
    labelIds: [],
    snippet: '',
    payload: { headers: [], body: { data: Buffer.from(textBody, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } },
  };
  const row = toRowFromGmail(msg, { body: true });
  const body = row[11] ?? '';
  assert.ok(body.includes('Second line'));
  assert.ok(!/quoted 2/.test(body));
});
