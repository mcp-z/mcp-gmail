import { ProtocolError, ProtocolErrorCode } from '@mcp-z/server';
import { MAX_BATCH_SIZE } from '../constants.ts';

/** Trim and validate a batch of Gmail IDs; every failure is InvalidParams, thrown before any network call. */
export function validateIds(ids: string[], kind: string): string[] {
  if (!ids || ids.length === 0) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Missing ids');
  }
  if (ids.length > MAX_BATCH_SIZE) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Batch size ${ids.length} exceeds maximum allowed size of ${MAX_BATCH_SIZE}`);
  }

  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('<') || trimmed.includes('>')) {
      invalid.push(id);
      continue;
    }
    valid.push(trimmed);
  }
  if (invalid.length > 0) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Found ${invalid.length} invalid ${kind} IDs: ${invalid.join(', ')}`);
  }
  return valid;
}
