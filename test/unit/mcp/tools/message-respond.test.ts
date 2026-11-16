import assert from 'assert';
import PostalMime from 'postal-mime';
import { buildReplyRfc822 } from '../../../../src/mcp/tools/message-respond.ts';

describe('buildReplyRfc822', () => {
  it('leaves an ASCII reply byte-identical', () => {
    const raw = buildReplyRfc822({ toAddr: 'a@example.com', subject: 'Hello', messageIdHeader: 'abc@x', references: '<r@x>', body: 'hi' });
    assert.strictEqual(raw, ['To: a@example.com', 'Subject: Re: Hello', 'In-Reply-To: <abc@x>', 'References: <r@x> <abc@x>', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', 'hi'].join('\r\n'));
  });

  it('encodes a non-ASCII original subject and decodes back to Re: + original', async () => {
    const raw = buildReplyRfc822({ toAddr: 'a@example.com', subject: 'Plan — draft', messageIdHeader: '<abc@x>', body: 'hi' });
    assert.ok(!/[\u0080-\uFFFF]/.test(raw.split('\r\n\r\n')[0] as string), 'headers must be 7-bit ASCII');
    assert.strictEqual((await PostalMime.parse(raw)).subject, 'Re: Plan — draft');
  });

  it('does not double the Re: prefix', async () => {
    const raw = buildReplyRfc822({ toAddr: 'a@example.com', subject: 'RE: Café', body: 'hi' });
    assert.strictEqual((await PostalMime.parse(raw)).subject, 'RE: Café');
  });

  it('cleans a crafted Subject, Message-ID and References into exactly one header each', () => {
    const raw = buildReplyRfc822({
      toAddr: 'a@example.com',
      subject: 'Hi\r\nBcc: evil@example.com',
      messageIdHeader: '<m@x>\r\nBcc: e2@example.com',
      references: '<r@x>\r\n Bcc: e3@example.com',
      body: 'hi',
    });
    const lines = (raw.split('\r\n\r\n')[0] as string).split('\r\n');
    assert.deepStrictEqual(lines, ['To: a@example.com', 'Subject: Re: Hi Bcc: evil@example.com', 'In-Reply-To: <m@x> Bcc: e2@example.com', 'References: <r@x>  Bcc: e3@example.com <m@x> Bcc: e2@example.com', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8']);
    for (const name of ['Subject', 'In-Reply-To', 'References']) assert.strictEqual(lines.filter((l) => l.startsWith(`${name}:`)).length, 1);
    assert.ok(!lines.some((l) => /^Bcc:/i.test(l)));
  });

  it('turns a run of control characters into one space', () => {
    const raw = buildReplyRfc822({ toAddr: 'a@example.com', subject: 'a\r\n\r\n\u0000b', body: 'hi' });
    assert.ok(raw.includes('\r\nSubject: Re: a b\r\n'));
  });

  it('cleans a non-ASCII subject with a line break', async () => {
    const raw = buildReplyRfc822({ toAddr: 'a@example.com', subject: 'Café\r\nBcc: evil@example.com', body: 'hi' });
    assert.ok(!/^Bcc:/im.test(raw.split('\r\n\r\n')[0] as string));
    assert.strictEqual((await PostalMime.parse(raw)).subject, 'Re: Café Bcc: evil@example.com');
  });
});
