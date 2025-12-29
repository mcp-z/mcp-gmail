import type { gmail_v1 } from 'googleapis';
import { setTimeout as delay } from 'timers/promises';

export default async function waitForLabel(gmail: gmail_v1.Gmail, id: string, opts: { interval?: number; timeout?: number } = {}): Promise<gmail_v1.Schema$Label> {
  const initialInterval = typeof opts.interval === 'number' ? opts.interval : 100;
  const timeout = typeof opts.timeout === 'number' ? opts.timeout : 10000;
  const maxInterval = 1000;
  const start = Date.now();
  let currentInterval = initialInterval;

  while (true) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitForLabel: timeout after ${timeout}ms waiting for label ${id}`);
    }

    try {
      const resp = await gmail.users.labels.get({ userId: 'me', id });
      if (resp?.data?.id) return resp.data;
    } catch (e: unknown) {
      // Only retry on 404 (label not yet visible)
      // Fail fast on auth errors, rate limits, or other issues
      const error = e as { status?: unknown; statusCode?: unknown; code?: unknown };
      const status = error.status || error.statusCode || error.code;
      if (status !== 404 && status !== 'ENOTFOUND') {
        throw e; // Real error - don't hide it
      }
      // 404 is expected during propagation - continue retry loop
    }

    await delay(currentInterval);
    // Exponential backoff with cap
    currentInterval = Math.min(currentInterval * 1.5, maxInterval);
  }
}
