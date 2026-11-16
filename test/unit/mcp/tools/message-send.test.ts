import assert from 'assert';
import createTool from '../../../../src/mcp/tools/message-send.ts';

const schema = createTool().config.inputSchema;
const valid = { to: 'a@example.com', subject: 'Hi', body: 'x', contentType: 'text' as const };

function rejectedField(overrides: Record<string, unknown>): string | undefined {
  const result = schema.safeParse({ ...valid, ...overrides });
  assert.ok(!result.success, 'expected the input to be rejected');
  const issue = result.error.issues[0];
  assert.ok(issue?.message.includes('line breaks or control characters'), `unexpected message: ${issue?.message}`);
  return String(issue?.path[0]);
}

describe('message-send input schema', () => {
  for (const field of ['subject', 'to', 'cc', 'bcc']) {
    it(`rejects CRLF in ${field} and names the field`, () => {
      assert.strictEqual(rejectedField({ [field]: 'x@example.com\r\nBcc: evil@example.com' }), field);
    });

    it(`rejects a bare LF in ${field}`, () => {
      assert.strictEqual(rejectedField({ [field]: 'x@example.com\nBcc: evil@example.com' }), field);
    });
  }

  it('rejects DEL in the subject', () => {
    assert.strictEqual(rejectedField({ subject: 'Hi\u007f' }), 'subject');
  });

  it('rejects a display name with CRLF', () => {
    assert.strictEqual(rejectedField({ to: '"Bob\r\nBcc: evil@example.com" <b@example.com>' }), 'to');
  });

  it('accepts a tab and non-ASCII text', () => {
    const result = schema.safeParse({ ...valid, subject: 'Plan\t— draft é', to: 'José <j@example.com>' });
    assert.ok(result.success);
  });

  it('still defaults a missing subject to an empty string', () => {
    const result = schema.safeParse({ to: 'a@example.com', body: 'x', contentType: 'text' });
    assert.ok(result.success);
    assert.strictEqual(result.data.subject, '');
  });
});
