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
});
