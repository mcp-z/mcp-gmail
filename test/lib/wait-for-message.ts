import type { gmail_v1 } from '@googleapis/gmail';
import { setTimeout as delay } from 'timers/promises';

export type GoogleApisLike = gmail_v1.Gmail;
export type HttpClientLike = { getMessage?: (id: string, format?: string) => Promise<{ id?: string }> };

export default async function waitForMessage(gmail: GoogleApisLike | HttpClientLike, id: string, opts: { interval?: number; timeout?: number } = {}): Promise<unknown> {
  const initialInterval = typeof opts.interval === 'number' ? opts.interval : 100;
  const timeout = typeof opts.timeout === 'number' ? opts.timeout : 10000;
  const maxInterval = 1000;
  const start = Date.now();
  let currentInterval = initialInterval;

  while (true) {
    if (Date.now() - start > timeout) throw new Error('waitForMessage: timeout waiting for message');
    try {
      // Support either googleapis-like client or our HttpClient wrapper
      const gmailClient = gmail as { users?: { messages?: { get?: (params: unknown) => Promise<{ data?: { id?: string } }> } } };
      const maybeUsers = gmailClient.users;
      if (maybeUsers?.messages?.get) {
        const resp = await maybeUsers.messages.get({ userId: 'me', id });
        if (resp?.data?.id) return resp.data;
      } else {
        const httpClient = gmail as { getMessage?: (id: string, format?: string) => Promise<{ id?: string }> };
        if (typeof httpClient.getMessage === 'function') {
          const msg = await httpClient.getMessage(id, 'minimal');
          if (msg?.id) return msg;
        }
      }
    } catch (e: unknown) {
      // Only retry on 404 (message not indexed yet)
      // Fail fast on auth errors, rate limits, or other issues
      const error = e as { status?: unknown; statusCode?: unknown; code?: unknown };
      const status = error.status || error.statusCode || error.code;
      if (status !== 404 && status !== 'ENOTFOUND') {
        throw e; // Real error - don't hide it
      }
      // 404 is expected during indexing - continue retry loop
    }
    await delay(currentInterval);
    // Exponential backoff with cap
    currentInterval = Math.min(currentInterval * 1.5, maxInterval);
  }
}
