import assert from 'assert';
import { toGmailQuery } from '../../../../src/email/querying/query-builder.ts';

describe('toGmailQuery - basic field queries', () => {
  it('handles from field (single value)', () => {
    const result = toGmailQuery({ from: 'alice@example.com' });
    assert.strictEqual(result.q, 'from:alice@example.com');
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
  });

  it('handles to field (single value)', () => {
    const result = toGmailQuery({ to: 'bob@example.com' });
    assert.strictEqual(result.q, 'to:bob@example.com');
    assert.deepStrictEqual(result.filters.toIncludes, ['bob@example.com']);
  });

  it('handles cc field (single value)', () => {
    const result = toGmailQuery({ cc: 'charlie@example.com' });
    assert.strictEqual(result.q, 'cc:charlie@example.com');
    assert.deepStrictEqual(result.filters.ccIncludes, ['charlie@example.com']);
  });

  it('handles bcc field (single value)', () => {
    const result = toGmailQuery({ bcc: 'dave@example.com' });
    assert.strictEqual(result.q, 'bcc:dave@example.com');
    assert.deepStrictEqual(result.filters.bccIncludes, ['dave@example.com']);
  });

  it('handles subject field (single value)', () => {
    const result = toGmailQuery({ subject: 'meeting' });
    assert.strictEqual(result.q, 'subject:meeting');
    assert.deepStrictEqual(result.filters.subjectIncludes, ['meeting']);
  });

  it('handles body field (single value)', () => {
    const result = toGmailQuery({ body: 'report' });
    assert.ok(result.q.includes('subject:report'));
    assert.ok(result.q.includes('OR'));
    assert.ok(result.q.includes('report'));
    assert.deepStrictEqual(result.filters.bodyIncludes, ['report']);
  });

  it('handles text field (single value)', () => {
    const result = toGmailQuery({ text: 'budget' });
    assert.ok(result.q.includes('subject:budget'));
    assert.ok(result.q.includes('OR'));
    assert.ok(result.q.includes('budget'));
    assert.deepStrictEqual(result.filters.textIncludes, ['budget']);
    assert.deepStrictEqual(result.filters.bodyIncludes, ['budget']);
  });
});

describe('toGmailQuery - field operators', () => {
  it('handles $any operator (OR logic) for from', () => {
    const result = toGmailQuery({ from: { $any: ['alice@example.com', 'bob@example.com'] } });
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.ok(result.q.includes('from:bob@example.com'));
    assert.ok(result.q.includes('OR'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com', 'bob@example.com']);
  });

  it('handles $all operator (AND logic) for to', () => {
    const result = toGmailQuery({ to: { $all: ['alice@example.com', 'bob@example.com'] } });
    assert.ok(result.q.includes('to:alice@example.com'));
    assert.ok(result.q.includes('to:bob@example.com'));
    assert.ok(result.q.includes('AND'));
    assert.deepStrictEqual(result.filters.toIncludes, ['alice@example.com', 'bob@example.com']);
  });

  it('handles $none operator (NOT logic) for subject', () => {
    const result = toGmailQuery({ subject: { $none: ['spam', 'ads'] } });
    assert.ok(result.q.includes('NOT'));
    assert.ok(result.q.includes('subject:spam'));
    assert.ok(result.q.includes('subject:ads'));
    assert.deepStrictEqual(result.filters.subjectIncludes, ['spam', 'ads']);
  });

  it('handles multiple field operators in same query', () => {
    const result = toGmailQuery({
      $and: [{ from: { $any: ['alice@example.com', 'bob@example.com'] } }, { subject: { $all: ['meeting', 'notes'] } }],
    });
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.ok(result.q.includes('from:bob@example.com'));
    assert.ok(result.q.includes('subject:meeting'));
    assert.ok(result.q.includes('subject:notes'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com', 'bob@example.com']);
    assert.deepStrictEqual(result.filters.subjectIncludes, ['meeting', 'notes']);
  });
});

describe('toGmailQuery - category queries', () => {
  it('handles single category (primary)', () => {
    const result = toGmailQuery({ categories: 'primary' });
    assert.strictEqual(result.q, 'label:CATEGORY_PERSONAL');
    assert.deepStrictEqual(result.filters.categoriesIncludes, ['primary']);
  });

  it('handles multiple categories with $any', () => {
    const result = toGmailQuery({ categories: { $any: ['primary', 'social', 'promotions'] } });
    assert.ok(result.q.includes('label:CATEGORY_PERSONAL'));
    assert.ok(result.q.includes('label:CATEGORY_SOCIAL'));
    assert.ok(result.q.includes('label:CATEGORY_PROMOTIONS'));
    assert.ok(result.q.includes('OR'));
    assert.deepStrictEqual(result.filters.categoriesIncludes, ['primary', 'social', 'promotions']);
  });

  it('throws error on invalid category names', () => {
    assert.throws(
      () =>
        toGmailQuery({
          categories: { $any: ['invalid', 'primary', 'bad'] as ('primary' | 'social' | 'promotions' | 'updates' | 'forums')[] },
        }),
      /Invalid Gmail category: "invalid"/
    );
  });

  it('maps all valid categories correctly', () => {
    const categories: ('primary' | 'social' | 'promotions' | 'updates' | 'forums')[] = ['primary', 'social', 'promotions', 'updates', 'forums'];
    const expectedLabels = ['CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'];

    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      if (category) {
        const result = toGmailQuery({ categories: category });
        assert.ok(result.q.includes(expectedLabels[i] ?? ''), `Category ${category} should map to ${expectedLabels[i]}`);
        assert.deepStrictEqual(result.filters.categoriesIncludes, [category]);
      }
    }
  });

  it('combines categories with other fields', () => {
    const result = toGmailQuery({
      $and: [{ categories: 'primary' }, { from: 'alice@example.com' }],
    });
    assert.ok(result.q.includes('label:CATEGORY_PERSONAL'));
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.deepStrictEqual(result.filters.categoriesIncludes, ['primary']);
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
  });
});

describe('toGmailQuery - fuzzy phrase matching', () => {
  it('handles simple fuzzy phrase', () => {
    const result = toGmailQuery({ fuzzyPhrase: 'quarterly report' });
    assert.ok(result.q.includes('quarterly report'));
    assert.ok(result.q.includes('"'));
  });

  it('quotes phrases with special characters', () => {
    const result = toGmailQuery({ fuzzyPhrase: 'meeting (urgent)' });
    assert.ok(result.q.includes('meeting (urgent)'));
    assert.ok(result.q.includes('"'));
  });

  it('combines fuzzy phrase with other filters', () => {
    const result = toGmailQuery({
      $and: [{ fuzzyPhrase: 'quarterly report' }, { from: 'alice@example.com' }],
    });
    assert.ok(result.q.includes('quarterly report'));
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
  });
});

describe('toGmailQuery - attachment flag', () => {
  it('handles hasAttachment = true', () => {
    const result = toGmailQuery({ hasAttachment: true });
    assert.strictEqual(result.q, 'has:attachment');
    assert.strictEqual(result.filters.hasAttachment, true);
  });

  it('combines hasAttachment with other queries', () => {
    const result = toGmailQuery({
      $and: [{ hasAttachment: true }, { from: 'alice@example.com' }],
    });
    assert.ok(result.q.includes('has:attachment'));
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.strictEqual(result.filters.hasAttachment, true);
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
  });
});

describe('toGmailQuery - date ranges', () => {
  it('handles date with $gte only', () => {
    const result = toGmailQuery({ date: { $gte: '2025-01-15' } });
    assert.strictEqual(result.q, 'after:2025/01/15');
  });

  it('handles date with $lt only', () => {
    const result = toGmailQuery({ date: { $lt: '2025-01-20' } });
    assert.strictEqual(result.q, 'before:2025/01/20');
  });

  it('handles date with both $gte and $lt (range)', () => {
    const result = toGmailQuery({ date: { $gte: '2025-01-15', $lt: '2025-01-20' } });
    assert.ok(result.q.includes('after:2025/01/15'));
    assert.ok(result.q.includes('before:2025/01/20'));
    assert.ok(result.q.includes('AND'));
  });

  it('handles date slash format option', () => {
    const resultSlash = toGmailQuery({ date: { $gte: '2025-01-15' } }, { dateSlash: true });
    assert.strictEqual(resultSlash.q, 'after:2025/01/15');

    const resultDash = toGmailQuery({ date: { $gte: '2025-01-15' } }, { dateSlash: false });
    assert.strictEqual(resultDash.q, 'after:2025-01-15');
  });
});

describe('toGmailQuery - logical operators', () => {
  it('handles $and operator with multiple conditions', () => {
    const result = toGmailQuery({
      $and: [{ from: 'alice@example.com' }, { subject: 'meeting' }, { hasAttachment: true }],
    });
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.ok(result.q.includes('subject:meeting'));
    assert.ok(result.q.includes('has:attachment'));
    // Top-level $and in Gmail is implicit (space-separated)
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
    assert.deepStrictEqual(result.filters.subjectIncludes, ['meeting']);
    assert.strictEqual(result.filters.hasAttachment, true);
  });

  it('handles $or operator with multiple conditions', () => {
    const result = toGmailQuery({
      $or: [{ from: 'alice@example.com' }, { from: 'bob@example.com' }],
    });
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.ok(result.q.includes('from:bob@example.com'));
    assert.ok(result.q.includes('OR'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com', 'bob@example.com']);
  });

  it('handles $not operator', () => {
    const result = toGmailQuery({
      $not: { subject: 'spam' },
    });
    assert.ok(result.q.includes('NOT'));
    assert.ok(result.q.includes('subject:spam'));
    assert.deepStrictEqual(result.filters.subjectIncludes, ['spam']);
  });

  it('handles nested logical operators', () => {
    const result = toGmailQuery({
      $and: [
        { from: 'alice@example.com' },
        {
          $or: [{ subject: 'meeting' }, { subject: 'conference' }],
        },
      ],
    });
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.ok(result.q.includes('subject:meeting'));
    assert.ok(result.q.includes('subject:conference'));
    assert.ok(result.q.includes('OR'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
    assert.deepStrictEqual(result.filters.subjectIncludes, ['meeting', 'conference']);
  });

  it('handles complex nested query combinations', () => {
    const result = toGmailQuery({
      $and: [
        { from: 'alice@example.com' },
        {
          $or: [{ subject: 'meeting' }, { subject: 'conference' }],
        },
        {
          $not: { categories: 'promotions' },
        },
      ],
    });
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.ok(result.q.includes('subject:meeting'));
    assert.ok(result.q.includes('subject:conference'));
    assert.ok(result.q.includes('NOT'));
    assert.ok(result.q.includes('label:CATEGORY_PROMOTIONS'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
    assert.deepStrictEqual(result.filters.subjectIncludes, ['meeting', 'conference']);
    assert.deepStrictEqual(result.filters.categoriesIncludes, ['promotions']);
  });
});

describe('toGmailQuery - query string escaping', () => {
  it('escapes quotes in values', () => {
    const result = toGmailQuery({ subject: 'Project "Alpha" Report' });
    assert.ok(result.q.includes('subject:"Project \\"Alpha\\" Report"'));
    assert.deepStrictEqual(result.filters.subjectIncludes, ['Project "Alpha" Report']);
  });

  it('handles email addresses (no spaces, no quotes)', () => {
    const result = toGmailQuery({ from: 'alice.bob@example.com' });
    assert.strictEqual(result.q, 'from:alice.bob@example.com');
    assert.ok(!result.q.includes('"'));
  });

  it('handles phrases with spaces (quoted)', () => {
    const result = toGmailQuery({ subject: 'Quarterly Report 2025' });
    assert.ok(result.q.includes('"Quarterly Report 2025"'));
    assert.deepStrictEqual(result.filters.subjectIncludes, ['Quarterly Report 2025']);
  });

  it('handles special Gmail characters', () => {
    const result = toGmailQuery({ subject: 'Meeting (urgent)' });
    assert.ok(result.q.includes('"Meeting (urgent)"'));
    assert.deepStrictEqual(result.filters.subjectIncludes, ['Meeting (urgent)']);
  });

  it('handles multiple special characters', () => {
    const result = toGmailQuery({ subject: 'Test "quotes" and (parens)' });
    assert.ok(result.q.includes('"'));
    assert.ok(result.q.includes('\\'));
    assert.deepStrictEqual(result.filters.subjectIncludes, ['Test "quotes" and (parens)']);
  });
});

describe('toGmailQuery - edge cases', () => {
  it('handles empty query object', () => {
    const result = toGmailQuery({});
    assert.strictEqual(result.q, '');
    assert.deepStrictEqual(result.filters, {});
  });

  it('throws error on empty strings in field operators', () => {
    assert.throws(() => toGmailQuery({ from: { $any: ['', '  ', 'alice@example.com'] } }), /Invalid from value: empty string/);
  });

  it('handles single-element field operator arrays', () => {
    const result = toGmailQuery({ from: { $any: ['alice@example.com'] } });
    assert.strictEqual(result.q, 'from:alice@example.com');
    assert.ok(!result.q.includes('OR'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
  });

  it('combines all query types in one complex query', () => {
    const result = toGmailQuery({
      $and: [{ from: { $any: ['alice@example.com', 'bob@example.com'] } }, { subject: 'meeting' }, { categories: 'primary' }, { hasAttachment: true }, { date: { $gte: '2025-01-15' } }],
    });
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.ok(result.q.includes('from:bob@example.com'));
    assert.ok(result.q.includes('subject:meeting'));
    assert.ok(result.q.includes('label:CATEGORY_PERSONAL'));
    assert.ok(result.q.includes('has:attachment'));
    assert.ok(result.q.includes('after:2025/01/15'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com', 'bob@example.com']);
    assert.deepStrictEqual(result.filters.subjectIncludes, ['meeting']);
    assert.deepStrictEqual(result.filters.categoriesIncludes, ['primary']);
    assert.strictEqual(result.filters.hasAttachment, true);
  });
});

describe('toGmailQuery - query string normalization', () => {
  it('removes trailing logical operators', () => {
    const result = toGmailQuery({ from: 'alice@example.com' });
    assert.ok(!result.q.endsWith('AND'));
    assert.ok(!result.q.endsWith('OR'));
    assert.ok(!result.q.startsWith('AND'));
    assert.ok(!result.q.startsWith('OR'));
  });

  it('handles whitespace normalization', () => {
    const result = toGmailQuery({
      $and: [{ from: 'alice@example.com' }, { subject: 'meeting' }],
    });
    assert.ok(!result.q.includes('  ')); // No double spaces
    assert.ok(result.q.trim() === result.q); // No leading/trailing whitespace
  });
});

describe('toGmailQuery - filters extraction', () => {
  it('extracts all field filters correctly', () => {
    const result = toGmailQuery({
      $and: [{ from: 'alice@example.com' }, { to: 'bob@example.com' }, { cc: 'charlie@example.com' }, { bcc: 'dave@example.com' }, { subject: 'meeting' }, { body: 'notes' }, { text: 'budget' }],
    });
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
    assert.deepStrictEqual(result.filters.toIncludes, ['bob@example.com']);
    assert.deepStrictEqual(result.filters.ccIncludes, ['charlie@example.com']);
    assert.deepStrictEqual(result.filters.bccIncludes, ['dave@example.com']);
    assert.deepStrictEqual(result.filters.subjectIncludes, ['meeting']);
    assert.deepStrictEqual(result.filters.bodyIncludes, ['notes', 'budget']);
    assert.deepStrictEqual(result.filters.textIncludes, ['budget']);
  });

  it('tracks nested filter values', () => {
    const result = toGmailQuery({
      $and: [{ from: { $any: ['alice@example.com', 'bob@example.com'] } }, { subject: { $all: ['meeting', 'notes'] } }],
    });
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com', 'bob@example.com']);
    assert.deepStrictEqual(result.filters.subjectIncludes, ['meeting', 'notes']);
  });

  it('filters are empty when no relevant fields present', () => {
    const result = toGmailQuery({ hasAttachment: true });
    assert.strictEqual(result.filters.fromIncludes, undefined);
    assert.strictEqual(result.filters.subjectIncludes, undefined);
    assert.strictEqual(result.filters.hasAttachment, true);
  });

  it('hasAttachment flag extraction', () => {
    const result = toGmailQuery({ hasAttachment: true });
    assert.strictEqual(result.filters.hasAttachment, true);
  });
});

describe('toGmailQuery - label queries', () => {
  it('toGmailQuery handles label queries with direct passthrough (case-sensitive)', () => {
    // Test single label
    const singleParsed = { label: 'work' };
    const singleResult = toGmailQuery(singleParsed);

    assert.ok(singleResult.q.includes('label:work'), 'expected direct label passthrough');
    assert.deepStrictEqual(singleResult.filters.labelIncludes, ['work']);

    // Test quoted label with spaces
    const quotedParsed = { label: 'Project Alpha' };
    const quotedResult = toGmailQuery(quotedParsed);

    assert.ok(quotedResult.q.includes('label:"Project Alpha"'), 'expected quoted label for spaces');
    assert.deepStrictEqual(quotedResult.filters.labelIncludes, ['Project Alpha']);

    // Test case-sensitive handling (no normalization)
    const caseParsed = { label: { $any: ['Work', 'work', 'WORK'] } };
    const caseResult = toGmailQuery(caseParsed);

    assert.ok(caseResult.q.includes('label:Work'), 'expected case-sensitive Work');
    assert.ok(caseResult.q.includes('label:work'), 'expected case-sensitive work');
    assert.ok(caseResult.q.includes('label:WORK'), 'expected case-sensitive WORK');
    assert.ok(caseResult.q.includes(' OR '), 'expected OR for multiple labels');
    assert.deepStrictEqual(caseResult.filters.labelIncludes, ['Work', 'work', 'WORK']);
  });

  it('toGmailQuery handles multiple label queries with OR logic', () => {
    const parsed = { label: { $any: ['important', 'urgent', 'work'] } };
    const result = toGmailQuery(parsed);

    assert.ok(result.q.includes('label:important'), 'expected important label');
    assert.ok(result.q.includes('label:urgent'), 'expected urgent label');
    assert.ok(result.q.includes('label:work'), 'expected work label');
    assert.ok(result.q.includes(' OR '), 'expected OR operator for multiple labels');
    assert.deepStrictEqual(result.filters.labelIncludes, ['important', 'urgent', 'work']);
  });

  it('toGmailQuery handles label queries with AND logic', () => {
    const parsed = { label: { $all: ['important', 'work'] } };
    const result = toGmailQuery(parsed);

    assert.ok(result.q.includes('label:important'), 'expected important label');
    assert.ok(result.q.includes('label:work'), 'expected work label');
    assert.ok(result.q.includes(' AND '), 'expected AND operator for $all labels');
    assert.deepStrictEqual(result.filters.labelIncludes, ['important', 'work']);
  });

  it('toGmailQuery handles label queries with NOT logic', () => {
    const parsed = { label: { $none: ['spam', 'trash'] } };
    const result = toGmailQuery(parsed);

    assert.ok(result.q.includes('NOT'), 'expected NOT operator');
    assert.ok(result.q.includes('label:spam'), 'expected spam label in NOT clause');
    assert.ok(result.q.includes('label:trash'), 'expected trash label in NOT clause');
    assert.deepStrictEqual(result.filters.labelIncludes, ['spam', 'trash']);
  });

  it('toGmailQuery combines label queries with other fields', () => {
    const parsed = {
      $and: [{ label: 'work' }, { from: 'alice@example.com' }, { subject: 'meeting' }],
    };
    const result = toGmailQuery(parsed);

    assert.ok(result.q.includes('label:work'), 'expected label query');
    assert.ok(result.q.includes('from:alice@example.com'), 'expected from query');
    assert.ok(result.q.includes('subject:meeting'), 'expected subject query');
    assert.deepStrictEqual(result.filters.labelIncludes, ['work']);
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
    assert.deepStrictEqual(result.filters.subjectIncludes, ['meeting']);
  });

  it('toGmailQuery handles label queries with special characters', () => {
    // Test labels with hyphens, numbers, and other characters
    const parsed = { label: { $any: ['project-2024', 'team@work', 'label_with_underscores'] } };
    const result = toGmailQuery(parsed);

    assert.ok(result.q.includes('label:project-2024'), 'expected hyphenated label');
    assert.ok(result.q.includes('label:team@work'), 'expected label with @ (not quoted by current implementation)');
    assert.ok(result.q.includes('label:label_with_underscores'), 'expected underscored label');
    assert.deepStrictEqual(result.filters.labelIncludes, ['project-2024', 'team@work', 'label_with_underscores']);
  });

  it('toGmailQuery throws error on empty label values', () => {
    assert.throws(() => toGmailQuery({ label: { $any: ['', '  ', 'valid'] } }), /Invalid label value: empty string/);
  });
});

describe('toGmailQuery - real-world query examples', () => {
  it('finds emails from specific sender with attachment', () => {
    const result = toGmailQuery({
      $and: [{ from: 'alice@example.com' }, { hasAttachment: true }],
    });
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.ok(result.q.includes('has:attachment'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com']);
    assert.strictEqual(result.filters.hasAttachment, true);
  });

  it('finds emails in primary category with subject keyword', () => {
    const result = toGmailQuery({
      $and: [{ categories: 'primary' }, { subject: 'invoice' }],
    });
    assert.ok(result.q.includes('label:CATEGORY_PERSONAL'));
    assert.ok(result.q.includes('subject:invoice'));
    assert.deepStrictEqual(result.filters.categoriesIncludes, ['primary']);
    assert.deepStrictEqual(result.filters.subjectIncludes, ['invoice']);
  });

  it('finds emails in date range from multiple senders', () => {
    const result = toGmailQuery({
      $and: [{ from: { $any: ['alice@example.com', 'bob@example.com'] } }, { date: { $gte: '2025-01-15', $lt: '2025-01-20' } }],
    });
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.ok(result.q.includes('from:bob@example.com'));
    assert.ok(result.q.includes('after:2025/01/15'));
    assert.ok(result.q.includes('before:2025/01/20'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['alice@example.com', 'bob@example.com']);
  });

  it('complex query with all features combined', () => {
    const result = toGmailQuery({
      $and: [
        { from: { $any: ['alice@example.com', 'bob@example.com'] } },
        { subject: { $all: ['meeting', 'notes'] } },
        { categories: 'primary' },
        { hasAttachment: true },
        { date: { $gte: '2025-01-15' } },
        {
          $not: { label: 'archived' },
        },
      ],
    });
    assert.ok(result.q.includes('from:alice@example.com'));
    assert.ok(result.q.includes('subject:meeting'));
    assert.ok(result.q.includes('label:CATEGORY_PERSONAL'));
    assert.ok(result.q.includes('has:attachment'));
    assert.ok(result.q.includes('after:2025/01/15'));
    assert.ok(result.q.includes('NOT'));
    assert.ok(result.q.includes('label:archived'));
  });

  it('searches by fuzzy phrase with filters', () => {
    const result = toGmailQuery({
      $and: [{ fuzzyPhrase: 'quarterly report' }, { from: 'finance@example.com' }, { hasAttachment: true }],
    });
    assert.ok(result.q.includes('"quarterly report"'));
    assert.ok(result.q.includes('from:finance@example.com'));
    assert.ok(result.q.includes('has:attachment'));
    assert.deepStrictEqual(result.filters.fromIncludes, ['finance@example.com']);
    assert.strictEqual(result.filters.hasAttachment, true);
  });
});
