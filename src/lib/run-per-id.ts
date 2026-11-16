import type { EnrichedExtra } from '@mcp-z/oauth-google';
import { CHUNK_SIZE } from '../constants.ts';

export interface PerIdResult {
  id: string;
  success: boolean;
  error?: string;
}

export interface PerIdOutcome {
  results: PerIdResult[];
  successCount: number;
  failureCount: number;
}

function errorMessageOf(reason: unknown): string {
  if (!reason) return 'Unknown error';
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'object' && 'message' in reason) return String((reason as { message: unknown }).message);
  if (typeof reason === 'object' && 'error' in reason) return String((reason as { error: unknown }).error);
  return String(reason);
}

/**
 * Run `fn` once per ID, CHUNK_SIZE at a time, and report each ID's outcome in input order.
 * A rejection becomes `success: false` with the extracted message; it never aborts the other IDs.
 */
export async function runPerId(ids: string[], fn: (id: string) => Promise<unknown>, logger: EnrichedExtra['logger']): Promise<PerIdOutcome> {
  const results: PerIdResult[] = [];

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    logger.info('Processing chunk', { chunkIndex: i / CHUNK_SIZE + 1, chunkSize: chunk.length, totalChunks: Math.ceil(ids.length / CHUNK_SIZE) });

    const settled = await Promise.allSettled(chunk.map(async (id) => fn(id)));
    settled.forEach((outcome, index) => {
      const id = chunk[index] as string;
      results.push(outcome.status === 'fulfilled' ? { id, success: true } : { id, success: false, error: errorMessageOf(outcome.reason) });
    });
  }

  const successCount = results.filter((r) => r.success).length;
  return { results, successCount, failureCount: results.length - successCount };
}
