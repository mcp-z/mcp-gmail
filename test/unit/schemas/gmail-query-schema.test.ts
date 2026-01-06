import assert from 'assert';
import { GmailQueryParameterSchema } from '../../../src/schemas/gmail-query-schema.ts';

describe('GmailQueryParameterSchema', () => {
  it('accepts structured query objects', () => {
    const result = GmailQueryParameterSchema.safeParse({ from: 'alice@example.com', date: { $gte: '2025-01-01' } });
    assert.ok(result.success, 'expected structured query to parse successfully');
    if (result.success) {
      assert.strictEqual(result.data.from, 'alice@example.com');
      assert.deepStrictEqual(result.data.date, { $gte: '2025-01-01' });
    }
  });

  it('parses JSON string inputs', () => {
    const jsonString = JSON.stringify({ date: { $lt: '2025-12-31' } });
    const result = GmailQueryParameterSchema.safeParse(jsonString);
    assert.ok(result.success, 'expected JSON string to parse and validate');
    if (result.success) {
      assert.deepStrictEqual(result.data.date, { $lt: '2025-12-31' });
    }
  });

  it('rejects invalid JSON strings with friendly message', () => {
    const result = GmailQueryParameterSchema.safeParse('{not json}');
    assert.ok(!result.success, 'expected invalid JSON string to fail validation');
    if (!result.success) {
      const [issue] = result.error.issues;
      assert.ok(issue.message.includes('Query must be valid JSON'), 'expected helpful message');
    }
  });

  it('supports rawGmailQuery inside JSON string', () => {
    const rawString = JSON.stringify({ rawGmailQuery: 'after:2025/01/01 from:me@example.com' });
    const result = GmailQueryParameterSchema.safeParse(rawString);
    assert.ok(result.success, 'expected rawGmailQuery string to parse');
    if (result.success) {
      assert.strictEqual(result.data.rawGmailQuery, 'after:2025/01/01 from:me@example.com');
    }
  });
});
