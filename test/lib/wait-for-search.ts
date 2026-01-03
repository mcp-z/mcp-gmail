import { setTimeout as delay } from 'timers/promises';
import { toGmailQuery } from '../../src/email/querying/query-builder.ts';
import type { GmailQuery } from '../../src/schemas/gmail-query-schema.ts';

type GmailClient = {
  users: {
    messages: {
      list: (args: Record<string, unknown>) => Promise<{ data?: { messages?: unknown[] } }>;
    };
  };
};

interface WaitForSearchOptions {
  timeout?: number; // Timeout in ms (default: 10000)
  limit?: number; // Max results (default: 5)
  expectedId?: string; // Wait for specific message ID in results
}

/**
 * Wait for Gmail search results using GmailQuery compilation with exponential backoff.
 * Uses the same query compilation path (GmailQuery → toGmailQuery) that message-search tool uses, ensuring consistency.
 * Only retries on 404 errors (message not indexed yet).
 * Throws immediately on auth errors, rate limits, or other failures.
 */
export default async function waitForSearch(gmail: GmailClient, query: GmailQuery | string, opts: WaitForSearchOptions = {}): Promise<unknown[]> {
  const timeoutMs = opts.timeout ?? 10000;
  const limit = opts.limit ?? 5;
  const start = Date.now();
  let interval = 100;
  const maxInterval = 1000;

  // Compile GmailQuery to Gmail query string - same path as message-search tool
  // If query is already a string (raw Gmail query), use it directly
  const q = typeof query === 'string' ? query : toGmailQuery(query).q;

  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: limit,
      });

      const messages = resp?.data?.messages;
      if (Array.isArray(messages) && messages.length > 0) {
        // If expectedId specified, check if it's in results
        if (opts.expectedId) {
          const found = messages.some((m: unknown) => {
            const msg = m as { id?: unknown };
            return msg.id === opts.expectedId;
          });
          if (found) {
            return messages;
          }
          // expectedId not found yet, continue polling
        } else {
          // No expectedId, just return first results
          return messages;
        }
      }
    } catch (error: unknown) {
      // Only retry on 404 (message not indexed yet)
      // Fail fast on auth errors, rate limits, or other issues
      const err = error as { status?: unknown; statusCode?: unknown; code?: unknown };
      const status = err.status || err.statusCode || err.code;
      if (status !== 404 && status !== 'ENOTFOUND') {
        throw error; // Real error - don't hide it
      }
      // 404 is expected during indexing - continue retry loop
    }

    await delay(interval);
    // Exponential backoff with cap
    interval = Math.min(interval * 1.5, maxInterval);
  }

  throw new Error(`waitForSearch: timeout after ${timeoutMs}ms waiting for search results. Query: ${JSON.stringify(query)}${opts.expectedId ? `, Expected ID: ${opts.expectedId}` : ''}`);
}
