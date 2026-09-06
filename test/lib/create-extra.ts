import type { AuthContext, EnrichedExtra } from '@mcp-z/oauth-google';
import type { CallToolResult, StandardSchemaWithJSON } from '@mcp-z/server';
import pino from 'pino';
import type { StorageContext, StorageExtra } from '../../src/types.ts';

/**
 * Typed handler signature for test files
 * Use with tool's Input type: `let handler: TypedHandler<Input>;`
 */
export type TypedHandler<I, E = EnrichedExtra> = (input: I, extra: E) => Promise<CallToolResult>;

/**
 * Create EnrichedExtra for testing
 *
 * In production, the middleware automatically creates and passes this object.
 * In tests, we call handlers directly, so we need to provide it ourselves.
 */
export function createExtra(): EnrichedExtra;
export function createExtra(storageContext: StorageContext): EnrichedExtra & StorageExtra;
export function createExtra(storageContext?: StorageContext): EnrichedExtra {
  const extra = {
    // v2 nests the per-request fields under mcpReq. Only the members handlers actually
    // read are stubbed; the cast avoids restating the SDK's whole context in a fixture.
    mcpReq: {
      id: 'test-request-id',
      method: 'tools/call',
      signal: new AbortController().signal,
      notify: async () => {},
      requestState: () => undefined,
      send: async <U extends StandardSchemaWithJSON>() => ({}) as StandardSchemaWithJSON.InferOutput<U>,
    },
    // Middleware injects these - placeholders for type compatibility
    authContext: {
      auth: {} as AuthContext['auth'], // Placeholder auth client
      accountId: 'test-account',
    },
    logger: pino({ level: 'silent' }),
    ...(storageContext ? { storageContext } : {}),
  };

  return extra as unknown as EnrichedExtra;
}
