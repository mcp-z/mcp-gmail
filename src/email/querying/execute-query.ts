import type { ExecutionResult } from '@mcp-z/email';
import type { gmail_v1 } from 'googleapis';
import { MAX_PAGE_SIZE } from '../../constants.ts';
import type { GmailQuery as QueryNode } from '../../schemas/gmail-query-schema.ts';
import type { Logger } from '../../types.ts';
import { searchMessages } from './search-execution.ts';

export interface ExecuteQueryOptions {
  client: gmail_v1.Gmail;
  logger: Logger;
  pageSize?: number;
  pageToken?: string;
  includeBody?: boolean;
}

/**
 * Execute a Gmail query with direct, single-attempt execution.
 * No planning, no fallbacks, no retries.
 * Provider errors are returned directly to the caller for actionable feedback.
 */
export async function executeQuery<T>(query: QueryNode | undefined, options: ExecuteQueryOptions, transform: (item: unknown) => T): Promise<ExecutionResult<T>> {
  const { client, logger, pageSize, pageToken, includeBody } = options;

  // Validate pagination parameters
  if (pageSize !== undefined && (pageSize < 1 || pageSize > MAX_PAGE_SIZE)) {
    throw new Error(`pageSize must be between 1 and ${MAX_PAGE_SIZE}`);
  }

  if (pageToken !== undefined && typeof pageToken === 'string' && pageToken.trim().length === 0) {
    logger.info('Empty pageToken provided, ignoring');
  }

  // Single execution - direct query to Gmail API
  logger.info('executeQuery: executing direct Gmail query');

  try {
    const result = await searchMessages(client, {
      ...(query !== undefined && { query }),
      pageSize: pageSize ?? 50,
      pageToken: pageToken && pageToken.trim().length > 0 ? pageToken : undefined,
      includeBody: includeBody ?? false,
      logger,
    });

    // Transform results
    const transformedResults = result.messages.map(transform);

    logger.info(`executeQuery: succeeded with ${transformedResults.length} results`);

    return {
      success: true,
      items: transformedResults,
      metadata: {
        nextPageToken: result.nextPageToken,
      },
    };
  } catch (error) {
    // Re-throw errors directly - no fallback logic
    logger.error('executeQuery: failed', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
