import type { gmail_v1 } from 'googleapis';
import type { Logger } from '../../src/types.ts';

/**
 * Create a test label in Gmail
 */
export async function createTestLabel(gmail: gmail_v1.Gmail, opts: { name?: string; visibility?: string } = {}): Promise<string> {
  const name = opts.name || `ci-test-label-${Date.now()}`;
  const visibility = opts.visibility || 'labelShow';

  const response = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name,
      labelListVisibility: visibility as 'labelShow' | 'labelShowIfUnread' | 'labelHide',
    },
  });

  const labelId = response.data.id;
  if (!labelId) throw new Error('createTestLabel: expected created label id');
  return labelId;
}

/**
 * Delete a test label created with createTestLabel.
 * Throws on any error - close failures indicate test problems that need to be visible.
 */
export async function deleteTestLabel(gmail: gmail_v1.Gmail, id: string, logger: Logger): Promise<void> {
  try {
    await gmail.users.labels.delete({ userId: 'me', id });
    logger.debug('Test label close successful', { labelId: id });
  } catch (e: unknown) {
    const error = e as { status?: unknown; statusCode?: unknown; code?: unknown };
    logger.error('Test label close failed', {
      labelId: id,
      error: e instanceof Error ? e.message : String(e),
      status: error.status || error.statusCode,
      code: error.code,
    });
    throw e; // Always throw - if we're deleting it, it should exist
  }
}

/**
 * Check if a label exists
 */
export async function labelExists(gmail: gmail_v1.Gmail, id: string): Promise<boolean> {
  try {
    await gmail.users.labels.get({ userId: 'me', id });
    return true;
  } catch (e: unknown) {
    const error = e as { status?: unknown; code?: unknown };
    if (error.status === 404 || error.code === 404) {
      return false;
    }
    throw e;
  }
}

/**
 * Batch delete multiple test labels with enhanced error reporting.
 * Returns close summary for test diagnostics.
 */
export async function batchDeleteTestLabels(gmail: gmail_v1.Gmail, ids: string[], logger: Logger): Promise<{ successful: number; failed: number; errors: Array<{ id: string; error: string }> }> {
  const startTime = Date.now();
  const results = { successful: 0, failed: 0, errors: [] as Array<{ id: string; error: string }> };

  logger.debug('Starting batch label close', { count: ids.length });

  // Use sequential deletion for consistency with Outlook implementation.
  // Gmail API tolerates parallel deletion, but sequential ensures consistent
  // error reporting and avoids potential hidden race conditions.
  for (const id of ids) {
    try {
      await deleteTestLabel(gmail, id, logger);
      results.successful++;
    } catch (e: unknown) {
      results.failed++;
      results.errors.push({
        id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const duration = Date.now() - startTime;
  logger.info('Batch label close completed', {
    total: ids.length,
    successful: results.successful,
    failed: results.failed,
    duration,
  });

  return results;
}
