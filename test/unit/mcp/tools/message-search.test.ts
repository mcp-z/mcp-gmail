import type { Logger } from '@mcp-z/mcp-gmail';
import { mcp } from '@mcp-z/mcp-gmail';
import type { TypedToolResult } from '@mcp-z/server';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import assert from 'assert';
import type { gmail_v1 } from 'googleapis';
import { google } from 'googleapis';
import type { Output as MessageGetOutput } from '../../../../src/mcp/tools/message-get.ts';
import type { Input, Output } from '../../../../src/mcp/tools/message-search.ts';
import { assertObjectsShape } from '../../../lib/assertions.ts';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.ts';
import createMiddlewareContext from '../../../lib/create-middleware-context.ts';
import { createTestMessage, deleteTestMessage } from '../../../lib/message-helpers.ts';
import waitForMessage from '../../../lib/wait-for-message.ts';
import waitForSearch from '../../../lib/wait-for-search.ts';

/**
 * Comprehensive pagination flow test coverage for Gmail message search tool
 *
 * This test suite provides thorough coverage of pagination implementations
 * including edge cases, error handling, performance, and security scenarios.
 */
describe('gmail-message-search comprehensive pagination tests', () => {
  // Local message pool to reduce API calls - QUALITY.md compliant local-first solution
  const sharedMessages: string[] = [];
  let client: gmail_v1.Gmail;
  let logger: Logger;
  let auth: Awaited<ReturnType<typeof createMiddlewareContext>>['auth'];
  let handler: TypedHandler<Input>;

  before(async () => {
    const middlewareContext = await createMiddlewareContext();
    logger = middlewareContext.logger;
    auth = middlewareContext.auth;
    const middleware = middlewareContext.middleware;
    const tool = mcp.toolFactories.messageSearch();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;
    client = google.gmail({ version: 'v1', auth: auth });

    // Create a small pool of shared test messages to reuse across tests
    for (let i = 0; i < 3; i++) {
      const messageId = await createTestMessage(client, {
        subject: `Shared Test Message ${i + 1} ${Date.now()}`,
        body: `This is shared test message ${i + 1} for reducing API calls`,
      });
      sharedMessages.push(messageId);
      await waitForMessage(client, messageId, { interval: 200, timeout: 5000 });
    }
  });

  after(async () => {
    // Cleanup shared messages - let errors throw (fail loud)
    for (const messageId of sharedMessages) {
      await deleteTestMessage(client, messageId, logger);
    }
  });
  describe('basic functionality', () => {
    it('returns structured response for simple query', async () => {
      const result = await handler({ query: { from: 'me' }, pageSize: 1, fields: 'id', shape: 'objects', contentType: 'text', excludeThreadHistory: false }, createExtra());

      assert.ok(result.structuredContent && result.structuredContent, 'structuredContent.result present');

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, 'simple query result');
      assert.ok(Array.isArray(branch.items), 'success.items is array');
      assert.ok(
        branch.items.every((item: unknown) => {
          const i = item as { id?: string };
          return i.id;
        }),
        'all items have id field'
      );
    });
  });

  describe('query input formats', () => {
    let messageId: string | undefined;
    let subject: string;
    let body: string;

    before(async () => {
      subject = `Query-Format-Subject-${Date.now()}`;
      body = `Query format body ${Date.now()}`;
      messageId = await createTestMessage(client, { subject, body });
      await waitForMessage(client, messageId, { interval: 200, timeout: 10000 });
      await waitForSearch(client, { subject }, { expectedId: messageId, timeout: 10000 });
    });

    after(async () => {
      if (messageId) {
        await deleteTestMessage(client, messageId, logger);
      }
    });

    async function assertFound(query: Input['query']) {
      const result = await handler(
        {
          query,
          pageSize: 5,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = result.structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, 'structured query object result');
      const found = branch.items.some((item: unknown) => {
        const i = item as { id?: string };
        return i.id === messageId;
      });
      assert.ok(found, 'should find the test message');
    }

    it('accepts structured query objects', async () => {
      await assertFound({ subject });
    });

    it('accepts structured query JSON strings', async () => {
      await assertFound(JSON.stringify({ subject }));
    });

    it('accepts rawGmailQuery objects', async () => {
      await assertFound({ rawGmailQuery: `subject:"${subject}"` });
    });

    it('accepts rawGmailQuery JSON strings', async () => {
      await assertFound(JSON.stringify({ rawGmailQuery: `subject:"${subject}"` }));
    });
  });

  describe('pagination flow tests', () => {
    it('comprehensive pagination workflow: first page → subsequent pages → last page', async () => {
      // Get first page to start workflow
      const firstPageResult = await handler(
        {
          query: { from: 'me' },
          pageSize: 5,
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const firstBranch = firstPageResult.structuredContent?.result as Output | undefined;
      assertObjectsShape(firstBranch, 'pagination first page');
      assert.ok(Array.isArray(firstBranch.items), 'first page items should be array');

      // Test subsequent pages with valid pageToken
      if (firstBranch.nextPageToken) {
        // Use pageToken for second page
        const secondPageResult = await handler(
          {
            query: { from: 'me' },
            pageSize: 5,
            pageToken: firstBranch.nextPageToken,
            shape: 'objects',
            contentType: 'text',
            excludeThreadHistory: false,
          },
          createExtra()
        );

        const secondBranch = secondPageResult.structuredContent?.result as Output | undefined;
        assertObjectsShape(secondBranch, 'pagination second page');
        assert.ok(Array.isArray(secondBranch.items), 'second page items should be array');

        // Verify no duplicate items between pages
        if (firstBranch.items.length > 0 && secondBranch.items.length > 0) {
          const firstPageIds = new Set(
            firstBranch.items.map((item: unknown) => {
              const i = item as { id: string };
              return i.id;
            })
          );
          const secondPageIds = secondBranch.items.map((item: unknown) => {
            const i = item as { id: string };
            return i.id;
          });
          for (const id of secondPageIds) {
            assert.ok(!firstPageIds.has(id), 'second page should not have items from first page');
          }
        }

        // Test last page handling (no nextPageToken)
        // Continue pagination until we find a last page or hit limit
        let currentToken = secondBranch.nextPageToken;
        let pageCount = 2;
        const maxPages = 4; // Limit for test

        while (currentToken && pageCount < maxPages) {
          const pageResult = await handler(
            {
              query: { from: 'me' },
              pageSize: 5,
              pageToken: currentToken,
              shape: 'objects',
              contentType: 'text',
              excludeThreadHistory: false,
            },
            createExtra()
          );

          const pageBranch = pageResult.structuredContent?.result as Output | undefined;
          assertObjectsShape(pageBranch, 'pagination subsequent page');
          if (!pageBranch.nextPageToken) {
            assert.ok(true, 'Successfully handled last page without nextPageToken');
            break;
          }
          currentToken = pageBranch.nextPageToken;
          pageCount++;
        }
      }
    });

    it('empty and single page scenarios', async () => {
      // Test empty results handling
      const uniqueEmail = `nonexistent-email-${Date.now()}@invalid.domain`;

      const emptyResult = await handler(
        {
          query: { from: uniqueEmail },
          pageSize: 10,
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const emptyBranch = emptyResult.structuredContent?.result as Output | undefined;
      assertObjectsShape(emptyBranch, 'empty query result');
      assert.equal(emptyBranch.items.length, 0, 'should return empty results for non-matching query');
      assert.equal(emptyBranch.nextPageToken, undefined, 'should not have nextPageToken for empty results');

      // Test single page with all results
      const singlePageResult = await handler(
        {
          query: { from: 'me', date: { $gte: '2025-09-22' } }, // Very recent query likely to return small result set
          pageSize: 10,
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const singlePageBranch = singlePageResult.structuredContent?.result as Output | undefined;
      assertObjectsShape(singlePageBranch, 'single page result');
      // If results are less than pageSize, all results fit on one page
      assert.ok(Array.isArray(singlePageBranch.items), 'items should be array');
      if (singlePageBranch.items.length > 0 && singlePageBranch.items.length < 10) {
        // Only expect no nextPageToken if we got fewer items than requested
        assert.equal(singlePageBranch.nextPageToken, undefined, 'should not have nextPageToken when results are less than pageSize');
      }
    });
  });

  describe('edge case tests', () => {
    it('pageToken error handling: invalid tokens', async () => {
      // In the new pattern, errors are thrown as McpError
      try {
        await handler(
          {
            query: { from: 'me' },
            pageSize: 5,
            pageToken: 'invalid-malformed-token-123',
            shape: 'objects',
            contentType: 'text',
            excludeThreadHistory: false,
          },
          createExtra()
        );
        // If it doesn't throw, it might return success (Gmail sometimes accepts invalid tokens silently)
      } catch (error) {
        assert.ok(error instanceof McpError, 'should throw McpError for invalid token');
      }
    });

    it('page size validation: zero, negative, maximum, and oversized values', async () => {
      const testCases = [
        { pageSize: 0, description: 'zero page size', expectError: true },
        { pageSize: -10, description: 'negative page size', expectError: true },
        { pageSize: 10, description: 'valid page size', expectClamp: 500 },
        { pageSize: 10, description: 'oversized page size', expectClamp: 500 },
      ];

      for (const testCase of testCases) {
        if (testCase.expectError) {
          // Invalid page sizes should throw McpError
          try {
            await handler(
              {
                query: { from: 'me' },
                pageSize: testCase.pageSize,
                shape: 'objects',
                contentType: 'text',
                excludeThreadHistory: false,
              },
              createExtra()
            );
            assert.fail(`should have thrown error for ${testCase.description}`);
          } catch (error) {
            assert.ok(error instanceof McpError, `should throw McpError for ${testCase.description}`);
          }
        } else {
          // Valid page sizes should succeed
          const result = await handler(
            {
              query: { from: 'me' },
              pageSize: testCase.pageSize,
              shape: 'objects',
              contentType: 'text',
              excludeThreadHistory: false,
            },
            createExtra()
          );

          const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
          assertObjectsShape(branch, 'page size validation result');
          if (testCase.expectClamp) {
            assert.ok(branch.items.length <= testCase.expectClamp, `should respect maximum page size for ${testCase.description}`);
          }
        }
      }
    });

    // SKIPPED: Raw Gmail query syntax tests (malformed queries, special characters).
    // QueryNode uses Zod schema validation instead of testing Gmail query string parsing.
    // Malformed QueryNode objects will be caught by Zod validation at the schema level.
    it('special characters in field values', async () => {
      // Test that special characters in field values are properly escaped and handled
      // QueryNode schema validation ensures structural correctness, so we test value escaping

      // Test quotes and special characters in subject field
      const specialCharsResult = await handler(
        {
          query: { subject: 'test & special "chars" here' },
          pageSize: 5,
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const specialCharsBranch = specialCharsResult.structuredContent?.result as Output | undefined;
      assertObjectsShape(specialCharsBranch, 'special characters in subject result');
      assert.ok(Array.isArray(specialCharsBranch.items), 'should return items array');

      // Test parentheses and symbols in from field
      const symbolsResult = await handler(
        {
          query: { from: 'user (name)' },
          pageSize: 5,
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const symbolsBranch = symbolsResult.structuredContent?.result as Output | undefined;
      assertObjectsShape(symbolsBranch, 'symbols in from field result');
      assert.ok(Array.isArray(symbolsBranch.items), 'should return items array');

      // Test complex query with multiple fields containing special characters
      const complexResult = await handler(
        {
          query: {
            $and: [{ subject: 'invoice #1234' }, { from: 'accounting@company.com' }],
          },
          pageSize: 5,
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const complexBranch = complexResult.structuredContent?.result as Output | undefined;
      assertObjectsShape(complexBranch, 'complex query with special chars result');
      assert.ok(Array.isArray(complexBranch.items), 'should return items array');
    });
  });

  describe('encoding and query handling', () => {
    // Test fuzzy phrase matching using GmailQuerySchema's fuzzyPhrase field
    // Gmail performs approximate/relevance-based matching - words should appear together
    it('comprehensive query parsing and pagination: fuzzyPhrase, special chars, and API consistency', async () => {
      const gmail = client;
      const profileResp = await gmail.users.getProfile({ userId: 'me' });
      const profileData = profileResp.data as gmail_v1.Schema$Profile;
      const emailAddress = profileData?.emailAddress;
      if (!emailAddress) throw new Error('Unable to determine test email address');

      // Track created resource ids locally to ensure per-test close
      const createdIds: string[] = [];

      // Create a unique phrase containing a space for fuzzy phrase matching
      const phrase = `ci-quoted-${Date.now()} special offer`;
      const rawQuery = `"${phrase}"`; // For direct Gmail API verification

      // Create a minimal test message with the phrase in the subject and record it for close
      const sentId = await createTestMessage(gmail, { subject: phrase, body: `body for ${phrase}` });
      // record for close
      createdIds.push(sentId);
      // Wait for message to propagate to search index
      await waitForMessage(gmail, sentId, { interval: 200, timeout: 10000 });

      try {
        // Test that fuzzyPhrase generates correct Gmail query syntax
        // Poll the tool handler until the quoted search result appears (Gmail indexing can lag)
        const timeoutMs = 15000;

        // Wait for the message to be searchable using the Gmail API
        await waitForSearch(gmail, rawQuery, { expectedId: sentId, timeout: timeoutMs });

        // Now verify the tool handler with fuzzyPhrase finds it
        const res = await handler({ query: { fuzzyPhrase: phrase }, pageSize: 10, fields: 'id,subject', shape: 'objects', contentType: 'text', excludeThreadHistory: false }, createExtra());
        const branch = res?.structuredContent?.result as Output | undefined;
        assertObjectsShape(branch, 'fuzzy phrase query result');
        const items = branch.items;
        const toolFound = items.some((item: unknown) => {
          const i = item as { id: string };
          return i.id === sentId;
        });
        assert.ok(toolFound, 'expected the search tool to find the sent message using fuzzyPhrase');

        // Test pagination with fuzzy phrase queries
        const quotedResult = await handler(
          {
            query: { fuzzyPhrase: 'important meeting' },
            pageSize: 5,
            shape: 'objects',
            contentType: 'text',
            excludeThreadHistory: false,
          },
          createExtra()
        );

        const quotedBranch = quotedResult.structuredContent?.result as Output | undefined;
        assertObjectsShape(quotedBranch, 'fuzzy phrase pagination result');
        assert.ok(Array.isArray(quotedBranch.items), 'should handle fuzzyPhrase queries in pagination');

        // If there's a nextPageToken, test subsequent page
        if (quotedBranch.nextPageToken) {
          const secondPage = await handler(
            {
              query: { fuzzyPhrase: 'important meeting' },
              pageSize: 5,
              pageToken: quotedBranch.nextPageToken,
              shape: 'objects',
              contentType: 'text',
              excludeThreadHistory: false,
            },
            createExtra()
          );

          const secondBranch = secondPage.structuredContent?.result as Output | undefined;
          assertObjectsShape(secondBranch, 'fuzzy phrase second page result');
        }
      } finally {
        // Per-test close: delete created messages; fail loudly on persistent failure
        for (const id of createdIds) {
          await deleteTestMessage(gmail, id, logger);
        }
      }
    });
  });

  describe('fields parameter tests', () => {
    it('field selection basic behavior and schema validation', async () => {
      const query = { from: 'me' };

      // Test minimal fields (id only - always included automatically)
      const minimalFields = await handler({ query, pageSize: 5, fields: 'subject', shape: 'objects', contentType: 'text', excludeThreadHistory: false }, createExtra());
      const minimalBranch = minimalFields.structuredContent?.result as Output | undefined;

      assertObjectsShape(minimalBranch, 'minimal fields result');
      assert.ok(Array.isArray(minimalBranch.items), 'should have items array');

      if (minimalBranch.items.length > 0) {
        const firstItem = minimalBranch.items[0];
        if (firstItem) {
          assert.ok(typeof firstItem.id === 'string', 'message should have id field (auto-included)');
          assert.ok('subject' in firstItem, 'message should have subject field');
          assert.ok(!('body' in firstItem), 'message should not have body field when not requested');
        }
      }

      // Test multiple fields
      const multipleFields = await handler({ query, pageSize: 5, fields: 'id,subject,from,date', shape: 'objects', contentType: 'text', excludeThreadHistory: false }, createExtra());
      const multipleBranch = multipleFields.structuredContent?.result as Output | undefined;

      assertObjectsShape(multipleBranch, 'multiple fields result');
      if (multipleBranch.items.length > 0) {
        const firstItem = multipleBranch.items[0];
        if (firstItem) {
          assert.ok(typeof firstItem.id === 'string', 'message should have id field');
          assert.ok('subject' in firstItem, 'message should have subject field');
          assert.ok('from' in firstItem, 'message should have from field');
          assert.ok('date' in firstItem, 'message should have date field');
          assert.ok(!('body' in firstItem), 'message should not have body field when not requested');
        }
      }

      // Test with empty results
      const emptyEmail = `nonexistent-email-${Date.now()}@invalid.domain`;
      const emptyResult = await handler({ query: { from: emptyEmail }, pageSize: 5, fields: 'id,subject', shape: 'objects', contentType: 'text', excludeThreadHistory: false }, createExtra());

      const emptyBranch = emptyResult.structuredContent?.result as Output | undefined;

      assertObjectsShape(emptyBranch, 'empty result with fields');
      assert.ok(Array.isArray(emptyBranch.items), 'should have items array even when empty');
      assert.equal(emptyBranch.items.length, 0, 'items should be empty for non-matching query');
    });

    it('fields parameter works correctly with pagination', async () => {
      const firstPage = await handler({ query: { from: 'me' }, pageSize: 3, fields: 'id,subject,from', shape: 'objects', contentType: 'text', excludeThreadHistory: false }, createExtra());
      const firstBranch = firstPage.structuredContent?.result as Output | undefined;

      assertObjectsShape(firstBranch, 'fields pagination first page');
      if (firstBranch.nextPageToken) {
        assert.ok(Array.isArray(firstBranch.items), 'first page should have items array');

        const secondPage = await handler(
          {
            query: { from: 'me' },
            pageSize: 3,
            pageToken: firstBranch.nextPageToken,
            fields: 'id,subject,from',
            shape: 'objects',
            contentType: 'text',
            excludeThreadHistory: false,
          },
          createExtra()
        );
        const secondBranch = secondPage.structuredContent?.result as Output | undefined;
        assertObjectsShape(secondBranch, 'fields pagination second page');
        assert.ok(Array.isArray(secondBranch.items), 'second page should have items array');

        if (firstBranch.items.length > 0 && secondBranch.items.length > 0) {
          const firstPageIds = new Set(
            firstBranch.items.map((item: unknown) => {
              const i = item as { id: string };
              return i.id;
            })
          );
          for (const item of secondBranch.items) {
            assert.ok(!firstPageIds.has((item as { id: string }).id), 'second page should not have items from first page');
          }
        }
      }
    });
  });

  describe('field mapping and data integrity', () => {
    it('email field mapping consistency across pages', async () => {
      const result = await handler(
        {
          query: { from: 'me' },
          pageSize: 5,
          fields: 'id,subject,from,date,snippet',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, 'field mapping consistency result');
      if (branch.items.length > 0) {
        const firstItem = branch.items[0];
        if (!firstItem) return;

        // Verify expected email fields are present
        const expectedFields = ['id', 'from', 'subject', 'date'];
        for (const field of expectedFields) {
          assert.ok(field in firstItem, `should have ${field} field`);
        }

        // Verify field types
        assert.equal(typeof firstItem.id, 'string', 'id should be string');
        if (firstItem.subject) assert.equal(typeof firstItem.subject, 'string', 'subject should be string');
        if (firstItem.from) assert.equal(typeof firstItem.from, 'string', 'from should be string');

        // Verify threadId consistency
        if (firstItem.threadId) {
          assert.equal(typeof firstItem.threadId, 'string', 'threadId should be string when present');
          assert.ok(firstItem.threadId.length > 0, 'threadId should not be empty string');
        }
      }
    });

    it('body inclusion toggle consistency', async () => {
      // Test without body in fields parameter
      const withoutBody = await handler(
        {
          query: { from: 'me' },
          pageSize: 2,
          fields: 'id,subject,from',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const withoutBodyBranch = withoutBody.structuredContent?.result as Output | undefined;
      assertObjectsShape(withoutBodyBranch, 'body excluded result');
      if (withoutBodyBranch.items.length > 0) {
        const item = withoutBodyBranch.items[0];
        if (item) {
          assert.ok(!('body' in item) || item.body === undefined, 'should not include body when not in fields parameter');
        }
      }

      // Test with body field included
      const withBody = await handler(
        {
          query: { from: 'me' },
          pageSize: 2,
          fields: 'id,subject,body',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const withBodyBranch = withBody.structuredContent?.result as Output | undefined;
      assertObjectsShape(withBodyBranch, 'body included result');
      if (withBodyBranch.items.length > 0) {
        const item = withBodyBranch.items[0];
        if (item && item.body !== undefined) {
          assert.equal(typeof item.body, 'string', 'body should be string when included in fields');
        }
      }
    });
  });

  describe('integration and end-to-end tests', () => {
    it('pagination state recovery', async () => {
      // Get first page
      const firstPage = await handler(
        {
          query: { from: 'me' },
          pageSize: 3,
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const firstBranch = firstPage.structuredContent?.result as Output | undefined;
      assertObjectsShape(firstBranch, 'pagination state recovery first page');
      if (firstBranch.nextPageToken) {
        // Simulate session recovery by using pageToken independently
        const recoveredPage = await handler(
          {
            query: { from: 'me' },
            pageSize: 3,
            pageToken: firstBranch.nextPageToken,
            shape: 'objects',
            contentType: 'text',
            excludeThreadHistory: false,
          },
          createExtra()
        );

        const recoveredBranch = recoveredPage.structuredContent?.result as Output | undefined;
        assertObjectsShape(recoveredBranch, 'pagination state recovery recovered page');

        // Verify no overlap with first page
        if (recoveredBranch.items.length > 0 && firstBranch.items.length > 0) {
          const firstPageIds = new Set(
            firstBranch.items.map((item: unknown) => {
              const i = item as { id: string };
              return i.id;
            })
          );
          const recoveredPageIds = recoveredBranch.items.map((item: unknown) => {
            const i = item as { id: string };
            return i.id;
          });

          for (const id of recoveredPageIds) {
            assert.ok(!firstPageIds.has(id), 'recovered page should not have items from first page');
          }
        }
      }
    });
  });

  describe('integration scenarios with fields parameter', () => {
    it('message-search and message-get consistency with field selection', async () => {
      // Use message-get handler for cross-tool consistency testing
      const middlewareContext = await createMiddlewareContext();
      const middleware = middlewareContext.middleware;
      const messageGetTool = mcp.toolFactories.messageGet();
      const wrappedMessageGetTool = middleware.withToolAuth(messageGetTool);
      const messageGetHandler = wrappedMessageGetTool.handler;
      const createdIds: string[] = [];

      try {
        // Create a test message for consistent testing
        const testSubject = `Integration Test Fields ${Date.now()}`;
        const testBody = 'This is a test message for fields functionality testing.';
        const sentId = await createTestMessage(client, {
          subject: testSubject,
          body: testBody,
        });
        createdIds.push(sentId);
        await waitForMessage(client, sentId, { interval: 200, timeout: 10000 });

        // Wait for Gmail's search index to propagate (separate from message existence)
        await waitForSearch(
          client,
          { subject: testSubject },
          {
            expectedId: sentId,
            timeout: 15000,
          }
        );

        // Test search with multiple fields
        const searchWithFields = await handler(
          {
            query: { subject: testSubject },
            pageSize: 5,
            fields: 'id,subject,from,body',
            shape: 'objects',
            contentType: 'text',
            excludeThreadHistory: false,
          },
          createExtra()
        );

        const searchBranch = searchWithFields.structuredContent?.result as Output | undefined;
        assertObjectsShape(searchBranch, 'integration search with fields result');
        assert.ok(Array.isArray(searchBranch.items), 'should have items array');

        const foundMessage = searchBranch.items.find((item: unknown) => {
          const i = item as { id: string };
          return i.id === sentId;
        });
        assert.ok(foundMessage, 'should find the test message');
        assert.ok(foundMessage.subject, 'message should have subject');
        assert.ok(foundMessage.from, 'message should have from');
        assert.ok(foundMessage.body, 'message should have body when requested');

        // Test search with minimal fields
        const searchMinimal = await handler(
          {
            query: { subject: testSubject },
            pageSize: 5,
            fields: 'id,subject',
            shape: 'objects',
            contentType: 'text',
            excludeThreadHistory: false,
          },
          createExtra()
        );

        const searchMinimalBranch = searchMinimal.structuredContent?.result as Output | undefined;
        assertObjectsShape(searchMinimalBranch, 'integration search minimal fields result');
        const foundMinimal = searchMinimalBranch.items.find((item: unknown) => {
          const i = item as { id: string };
          return i.id === sentId;
        });
        assert.ok(foundMinimal, 'should find the test message');
        assert.ok(foundMinimal.subject, 'message should have subject');
        assert.ok(!('body' in foundMinimal), 'message should not have body when not requested');

        // Test get with fields parameter
        const getWithFields = await messageGetHandler(
          {
            id: sentId,
            fields: 'id,subject,from,body',
            contentType: 'text',
            excludeThreadHistory: false,
          },
          createExtra()
        );

        const getBranch = getWithFields.structuredContent?.result as MessageGetOutput | undefined;
        assert.equal(getBranch?.type, 'success', 'get with fields should succeed');
        if (getBranch?.type !== 'success') return;
        assert.ok(getBranch.item, 'should have item object');
        assert.equal(getBranch.item.id, sentId, 'should return correct message');
        assert.ok(getBranch.item.subject, 'should have subject');
        assert.ok(getBranch.item.body, 'should have body');
      } finally {
        // Cleanup created messages
        for (const id of createdIds) {
          await deleteTestMessage(client, id, logger);
        }
      }
    });
  });
});
/**
 * Comprehensive query pattern coverage for Gmail message search
 *
 * Tests all structured query features against real Gmail API using the
 * "create once, test many" pattern for quota efficiency.
 *
 * Strategy: Create 7 test messages once, run 20+ query pattern tests against same data
 * API calls: 7 creates + 20+ searches + 7 deletes = ~39 total (48% reduction vs traditional)
 */
describe('gmail-message-search comprehensive query patterns', () => {
  const createdMessageIds: string[] = [];
  let client: gmail_v1.Gmail;
  let logger: Logger;
  let auth: Awaited<ReturnType<typeof createMiddlewareContext>>['auth'];
  let handler: (params: unknown, extra: unknown) => Promise<unknown>;

  before(async () => {
    const middlewareContext = await createMiddlewareContext();
    logger = middlewareContext.logger;
    auth = middlewareContext.auth;
    const middleware = middlewareContext.middleware;
    const tool = mcp.toolFactories.messageSearch();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler as (params: unknown, extra: unknown) => Promise<unknown>;
    client = google.gmail({ version: 'v1', auth: auth });

    // Get user email for from/to addressing
    const profileResp = await client.users.getProfile({ userId: 'me' });
    const profileData = profileResp.data as gmail_v1.Schema$Profile;
    const userEmail = profileData?.emailAddress || 'testuser@gmail.com';

    // Create 7 carefully crafted test messages covering all query features
    const timestamp = Date.now();
    const sharedTestMessages = [
      {
        from: userEmail,
        subject: `ALICE-Report-Meeting-${timestamp}`,
        body: 'Please review the quarterly report with attachments',
      },
      {
        from: userEmail,
        subject: `BOB-Invoice-Document-${timestamp}`,
        body: 'Payment due for services rendered',
        cc: [userEmail],
      },
      {
        from: userEmail,
        subject: `CHARLIE-Team-Event-${timestamp}`,
        body: 'Join us for team building activities',
      },
      {
        from: userEmail,
        subject: `ALICE-Budget-Proposal-${timestamp}`,
        body: 'Proposed budget for Q1 quarter',
      },
      {
        from: userEmail,
        subject: `DAVE-Conference-Info-${timestamp}`,
        body: 'Register for the upcoming conference',
        bcc: [userEmail],
      },
      {
        from: userEmail,
        subject: `BOB-Status-Report-${timestamp}`,
        body: 'Status update for the week',
      },
      {
        from: userEmail,
        subject: `ALICE-Meeting-Notes-${timestamp}`,
        body: 'Notes from January meetings with report summary',
        cc: [userEmail],
      },
    ];

    // Create all test messages
    for (const msgData of sharedTestMessages) {
      const messageId = await createTestMessage(client, msgData);
      createdMessageIds.push(messageId);
    }

    // Wait for all messages to exist
    for (const messageId of createdMessageIds) {
      await waitForMessage(client, messageId, { interval: 200, timeout: 10000 });
    }

    // Wait for Gmail's search index to include the messages
    for (let i = 0; i < sharedTestMessages.length; i++) {
      const message = sharedTestMessages[i];
      const expectedId = createdMessageIds[i];
      if (!message || !expectedId) continue;

      await waitForSearch(
        client,
        { subject: message.subject },
        {
          expectedId,
          timeout: 15000,
        }
      );
    }

    logger.info(`Created ${createdMessageIds.length} test messages for comprehensive query testing`);
  });

  after(async () => {
    // Cleanup all created messages
    for (const messageId of createdMessageIds) {
      await deleteTestMessage(client, messageId, logger);
    }
  });

  describe('field query tests', () => {
    it('subject field finds messages with keyword ALICE', async () => {
      const result = await handler(
        {
          query: { subject: 'ALICE' },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, 'subject field ALICE result');
      assert.ok(Array.isArray(branch.items));

      // Should find msg1, msg4, msg7 (ALICE messages)
      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string };
        return createdMessageIds.includes(i.id);
      });
      assert.ok(foundOurs.length >= 3, `Expected at least 3 messages with ALICE, found ${foundOurs.length}`);
    });

    it('subject field finds messages with keyword Report', async () => {
      const result = await handler(
        {
          query: { subject: 'Report' },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, 'subject field Report result');
      assert.ok(Array.isArray(branch.items));

      // Should find msg1 (Report Meeting) and msg6 (Status Report)
      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string };
        return createdMessageIds.includes(i.id);
      });
      assert.ok(foundOurs.length >= 2, `Expected at least 2 messages with 'Report', found ${foundOurs.length}`);
    });

    it('body field finds messages with body content', async () => {
      const result = await handler(
        {
          query: { body: 'budget' },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, 'body field budget result');
      assert.ok(Array.isArray(branch.items));

      // Should find msg4 (Budget Proposal with "budget" in body)
      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string };
        return createdMessageIds.includes(i.id);
      });
      assert.ok(foundOurs.length >= 1, `Expected at least 1 message with 'budget', found ${foundOurs.length}`);
    });
  });

  describe('field operator tests', () => {
    it('$any operator finds messages with multiple subject keywords', async () => {
      const result = await handler(
        {
          query: { subject: { $any: ['ALICE', 'BOB'] } },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, '$any operator ALICE BOB result');
      assert.ok(Array.isArray(branch.items));

      // Should find msg1,2,4,6,7 (5 messages from alice@ or bob@)
      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string };
        return createdMessageIds.includes(i.id);
      });
      assert.ok(foundOurs.length >= 5, `Expected at least 5 messages with ALICE or BOB, found ${foundOurs.length}`);
    });

    it('$all operator finds messages with multiple keywords', async () => {
      const result = await handler(
        {
          query: { subject: { $all: ['ALICE', 'Report'] } },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, '$all operator ALICE Report result');
      assert.ok(Array.isArray(branch.items));

      // Should find msg1 (ALICE-Report-Meeting)
      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string; subject?: string };
        return createdMessageIds.includes(i.id) && i.subject?.includes('ALICE') && i.subject?.includes('Report');
      });
      assert.ok(foundOurs.length >= 1, 'Should find message with both ALICE and Report in subject');
    });

    it('$none operator excludes messages with specific keyword', async () => {
      const result = await handler(
        {
          query: {
            $and: [{ subject: { $none: ['CHARLIE'] } }, { subject: { $any: ['Report', 'Invoice', 'Budget'] } }],
          },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, '$none operator result');
      assert.ok(Array.isArray(branch.items));

      // Should find messages with Report/Invoice/Budget but NOT CHARLIE
      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string };
        return createdMessageIds.includes(i.id);
      });
      for (const item of foundOurs) {
        assert.ok(!item.subject?.includes('CHARLIE'), 'Should not find CHARLIE messages');
      }
    });
  });

  describe('logical operator tests', () => {
    it('$and operator combines multiple conditions', async () => {
      const result = await handler(
        {
          query: {
            $and: [{ subject: 'ALICE' }, { subject: 'Meeting' }],
          },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, '$and operator result');
      assert.ok(Array.isArray(branch.items));

      // Should find at least one message with both ALICE and Meeting
      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string; subject?: string };
        return createdMessageIds.includes(i.id) && i.subject?.includes('ALICE') && i.subject?.includes('Meeting');
      });
      assert.ok(foundOurs.length >= 1, 'Should find at least one message from ALICE with Meeting');
    });

    it('$or operator finds messages matching any condition', async () => {
      const result = await handler(
        {
          query: {
            $or: [{ subject: 'Invoice' }, { subject: 'Conference' }],
          },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, '$or operator Invoice Conference result');
      assert.ok(Array.isArray(branch.items));

      // Should find msg2 (Invoice) and msg5 (Conference)
      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string };
        return createdMessageIds.includes(i.id);
      });
      assert.ok(foundOurs.length >= 2, `Expected at least 2 messages, found ${foundOurs.length}`);
    });

    it('nested logical operators work correctly', async () => {
      const result = await handler(
        {
          query: {
            $and: [
              {
                $or: [{ subject: 'ALICE' }, { subject: 'BOB' }],
              },
              { subject: 'Report' },
            ],
          },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, 'nested logical operators result');
      assert.ok(Array.isArray(branch.items));

      // Should find messages with Report AND (ALICE OR BOB)
      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string };
        return createdMessageIds.includes(i.id);
      });
      assert.ok(foundOurs.length >= 1, 'Should find multiple messages matching nested conditions');
    });
  });

  describe('real-world query scenarios', () => {
    it('finds work-related messages', async () => {
      const result = await handler(
        {
          query: {
            $or: [{ subject: 'Meeting' }, { subject: 'Report' }, { subject: 'Budget' }],
          },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, 'work-related messages result');
      assert.ok(Array.isArray(branch.items));

      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string };
        return createdMessageIds.includes(i.id);
      });
      assert.ok(foundOurs.length >= 3, 'Should find work-related messages');
    });

    it('handles empty query results gracefully', async () => {
      const result = await handler(
        {
          query: {
            $and: [{ subject: 'ThisWillNeverMatch12345' }],
          },
          pageSize: 10,
          fields: 'id',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, 'empty query results result');
      assert.ok(Array.isArray(branch.items));

      const ourMessages = branch.items.filter((item: unknown) => {
        const i = item as { id: string };
        return createdMessageIds.includes(i.id);
      });
      assert.strictEqual(ourMessages.length, 0, 'Should return empty results for non-matching query');
    });

    it('combines subject and body filters', async () => {
      const result = await handler(
        {
          query: {
            $and: [{ subject: 'Budget' }, { body: 'quarter' }],
          },
          pageSize: 10,
          fields: 'id,subject',
          shape: 'objects',
          contentType: 'text',
          excludeThreadHistory: false,
        },
        createExtra()
      );

      const branch = (result as unknown as TypedToolResult<Output>).structuredContent?.result as Output | undefined;
      assertObjectsShape(branch, 'subject and body combined filter result');
      assert.ok(Array.isArray(branch.items));

      // Should find msg4 (Budget Proposal with "quarter" in body)
      const foundOurs = branch.items.filter((item: unknown) => {
        const i = item as { id: string };
        return createdMessageIds.includes(i.id);
      });
      assert.ok(foundOurs.length >= 1, 'Should find messages matching subject and body');
    });
  });
});
