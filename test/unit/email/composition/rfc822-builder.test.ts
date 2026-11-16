import assert from 'assert';
import PostalMime from 'postal-mime';
import { buildRfc822FromArgs } from '../../../../src/email/composition/rfc822-builder.ts';

// postal-mime is an independent RFC 2047 decoder (the encoder under test uses libmime).
async function parse(raw: string) {
  return PostalMime.parse(raw);
}

function headerLines(raw: string): string[] {
  return raw.split('\r\n\r\n')[0]?.split('\r\n') ?? [];
}

describe('buildRfc822FromArgs', () => {
  it('leaves pure-ASCII headers byte-identical', () => {
    const raw = buildRfc822FromArgs({ from: 'Me <me@example.com>', to: ['a@example.com', 'B <b@example.com>'], cc: 'c@example.com', bcc: 'd@example.com', subject: 'Hello world', body: 'hi' });
    assert.strictEqual(raw, ['From: Me <me@example.com>', 'To: a@example.com, B <b@example.com>', 'Cc: c@example.com', 'Bcc: d@example.com', 'Subject: Hello world', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'hi'].join('\r\n'));
  });

  it('encodes an em dash subject as an RFC 2047 encoded-word', async () => {
    const subject = 'Plan — draft';
    const raw = buildRfc822FromArgs({ to: 'a@example.com', subject, body: 'x' });
    assert.ok(!/[\u0080-\uFFFF]/.test(headerLines(raw).join('\r\n')), 'headers must be 7-bit ASCII');
    assert.ok(/^Subject: .*=\?UTF-8\?Q\?/.test(headerLines(raw).find((l) => l.startsWith('Subject:')) ?? ''));
    assert.strictEqual((await parse(raw)).subject, subject);
  });

  it('keeps every encoded-word within 75 characters and every line within 78 for a long subject', async () => {
    const subject = `Überprüfung — ${'日本語の件名とemoji 🎉 '.repeat(8).trim()}`;
    const raw = buildRfc822FromArgs({ to: 'a@example.com', subject, body: 'x' });
    const lines = headerLines(raw);
    for (const line of lines) assert.ok(line.length <= 78, `line too long (${line.length}): ${line}`);
    const words = lines.join('\r\n').match(/=\?UTF-8\?[QB]\?[^?]*\?=/g) ?? [];
    assert.ok(words.length > 1, 'long subject should need several encoded-words');
    for (const w of words) assert.ok(w.length <= 75, `encoded-word too long (${w.length}): ${w}`);
    assert.strictEqual((await parse(raw)).subject, subject);
  });

  it('encodes non-ASCII display names in From/To/Cc and never the address', async () => {
    const raw = buildRfc822FromArgs({ from: 'Zoë Müller <zoe@example.com>', to: ['José Peña <jose@example.com>', 'plain@example.com'], cc: '"Łukasz, Jr." <l@example.com>', subject: 's', body: 'x' });
    assert.ok(!/[\u0080-\uFFFF]/.test(headerLines(raw).join('\r\n')), 'headers must be 7-bit ASCII');
    const mail = await parse(raw);
    assert.deepStrictEqual([mail.from?.name, mail.from?.address], ['Zoë Müller', 'zoe@example.com']);
    assert.deepStrictEqual(
      mail.to?.map((a) => [a.name, a.address]),
      [
        ['José Peña', 'jose@example.com'],
        ['', 'plain@example.com'],
      ]
    );
    assert.deepStrictEqual([mail.cc?.[0]?.name, mail.cc?.[0]?.address], ['Łukasz, Jr.', 'l@example.com']);
    assert.ok(raw.includes('<jose@example.com>'));
  });

  it('folds an address list only between mailboxes, keeping a quoted ASCII name on one line', async () => {
    const raw = buildRfc822FromArgs({ to: ['"Doe, John" <j@example.com>', 'Jürgen <g@example.com>'], subject: 's', body: 'x' });
    const lines = headerLines(raw);
    assert.ok(lines.includes('To: "Doe, John" <j@example.com>,'), `quoted name was split: ${JSON.stringify(lines)}`);
    const mail = await parse(raw);
    assert.deepStrictEqual(
      mail.to?.map((a) => [a.name, a.address]),
      [
        ['Doe, John', 'j@example.com'],
        ['Jürgen', 'g@example.com'],
      ]
    );
  });

  describe('display names with ASCII specials', () => {
    const encodedWords = (raw: string) =>
      headerLines(raw)
        .join('\r\n')
        .match(/=\?UTF-8\?[QB]\?[^?]*\?=/g) ?? [];

    const cases: Array<[string, string, Array<[string, string]>]> = [
      ['comma and non-ASCII', '"Smith, Zoë" <z@x.com>', [['Smith, Zoë', 'z@x.com']]],
      ['angle brackets inside the name', '"Ünï <x>" <a@b.c>', [['Ünï <x>', 'a@b.c']]],
      ['comma, period and non-ASCII', '"Smith, Jr. Zoë" <z@x.com>', [['Smith, Jr. Zoë', 'z@x.com']]],
      ['escaped quote', '"Zoë \\" Q" <z@x.com>', [['Zoë " Q', 'z@x.com']]],
    ];
    for (const [label, input, expected] of cases) {
      it(`decodes to exactly the intended recipient: ${label}`, async () => {
        const raw = buildRfc822FromArgs({ to: input, subject: 's', body: 'x' });
        const mail = await parse(raw);
        assert.deepStrictEqual(
          mail.to?.map((a) => [a.name, a.address]),
          expected
        );
        const words = encodedWords(raw);
        assert.ok(words.length > 0);
        for (const w of words) {
          const text = w.split('?')[3] as string;
          assert.ok(/^[A-Za-z0-9!*+\-/=_]+$/.test(text), `encoded-text outside RFC 2047 §5(3) set: ${w}`);
          assert.ok(w.length <= 75, `encoded-word too long: ${w}`);
        }
      });
    }

    it('keeps a group and its members', async () => {
      const raw = buildRfc822FromArgs({ to: 'Équipe: a@b.c, "Ü, x" <c@d.e>;, f@g.h', subject: 's', body: 'x' });
      const mail = await parse(raw);
      assert.strictEqual(mail.to?.length, 2);
      const group = mail.to?.[0] as { name: string; group?: Array<{ name: string; address: string }> };
      assert.strictEqual(group.name, 'Équipe');
      assert.deepStrictEqual(
        group.group?.map((a) => [a.name, a.address]),
        [
          ['', 'a@b.c'],
          ['Ü, x', 'c@d.e'],
        ]
      );
      assert.strictEqual(mail.to?.[1]?.address, 'f@g.h');
    });

    it('writes an ASCII-only list exactly as given', () => {
      const raw = buildRfc822FromArgs({ to: ['"Doe, John" <j@example.com>', 'x@y.z'], subject: 's', body: 'x' });
      assert.ok(raw.includes('To: "Doe, John" <j@example.com>, x@y.z\r\n'));
    });
  });

  describe('header injection guard', () => {
    const attack = 'x\r\nBcc: evil@example.com';
    const cases: Array<[string, Parameters<typeof buildRfc822FromArgs>[0]]> = [
      ['subject', { to: 'a@example.com', subject: attack }],
      ['non-ASCII subject', { to: 'a@example.com', subject: `é${attack}` }],
      ['bare LF subject', { to: 'a@example.com', subject: 'x\nBcc: evil@example.com' }],
      ['DEL subject', { to: 'a@example.com', subject: 'x\u007f' }],
      ['to', { to: `a@example.com${attack}` }],
      ['to array item', { to: ['a@example.com', `b@example.com${attack}`] }],
      ['cc', { to: 'a@example.com', cc: attack }],
      ['bcc', { to: 'a@example.com', bcc: attack }],
      ['display name', { to: `"Bob\r\nBcc: evil@example.com" <b@example.com>` }],
      ['non-ASCII display name', { to: `"Zoë\r\nBcc: evil@example.com" <b@example.com>` }],
      ['from', { from: attack, to: 'a@example.com' }],
    ];
    for (const [label, args] of cases) {
      it(`throws for ${label}`, () => {
        assert.throws(() => buildRfc822FromArgs({ ...args, body: 'x' }), /line break or control character/);
      });
    }

    it('allows a tab in the subject', () => {
      assert.ok(buildRfc822FromArgs({ to: 'a@example.com', subject: 'a\tb', body: 'x' }).includes('Subject: a\tb\r\n'));
    });
  });
});
