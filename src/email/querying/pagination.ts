/** Gmail pagination helpers for single-page operations. */

import type { gmail_v1 } from 'googleapis';
import type { Logger } from '../../types.js';

export interface SinglePageResult {
  readonly messages: gmail_v1.Schema$Message[];
  readonly nextPageToken: string | undefined;
}

/**
 * Fetch a single page of messages from Gmail
 */
export interface FetchMessagesPageParams {
  readonly gmailQ: string;
  readonly pageSize?: number;
  readonly pageToken: string | undefined;
  readonly body?: boolean;
  readonly logger: Logger;
  readonly metadataHeaders?: readonly string[];
}

export async function fetchMessagesPage(gmail: gmail_v1.Gmail, params: FetchMessagesPageParams): Promise<SinglePageResult> {
  const { gmailQ, pageSize = 50, pageToken, body = false, logger, metadataHeaders } = params;

  // Secure resource bounds checking - prevent security bypasses
  const maxPageSize = 500; // Gmail API maximum - enforced for security
  const minPageSize = 1; // Minimum valid page size

  // Validate input is a positive number to prevent bypass attempts
  if (!Number.isInteger(pageSize) || pageSize < 0) {
    throw new Error(`Invalid pageSize: must be a positive integer, got ${pageSize}`);
  }

  const safePageSize = Math.min(Math.max(minPageSize, pageSize), maxPageSize);

  if (pageSize !== safePageSize && logger) {
    logger.info('Page size bounded for API safety', { requested: pageSize, applied: safePageSize });
    // No fallback to console - would corrupt MCP stdio communication
  }

  try {
    const listParams = {
      userId: 'me',
      q: gmailQ,
      maxResults: safePageSize,
    };
    const listResponse = pageToken && pageToken.trim().length > 0 ? await gmail.users.messages.list({ ...listParams, pageToken }) : await gmail.users.messages.list(listParams);
    const response = listResponse.data;
    const messages = response.messages || [];

    if (messages.length === 0) {
      if (logger) logger.info('No messages found on page');
      return { messages: [], nextPageToken: undefined };
    }

    const items = messages.map((m: gmail_v1.Schema$Message) => m.id).filter(Boolean) as string[];
    if (items.length === 0) {
      if (logger) logger.info('No valid message ids on page');
      return { messages: [], nextPageToken: response.nextPageToken && response.nextPageToken.trim().length > 0 ? response.nextPageToken : undefined };
    }

    const concurrentArgs: FetchMessagesConcurrentlyParams = {
      items,
      concurrency: 5,
      body,
      ...(logger && { logger }),
      ...(metadataHeaders && { metadataHeaders }),
    };
    const detailedMessages = await fetchMessagesConcurrently(gmail, concurrentArgs);

    if (logger) logger.info(`Fetched page with ${detailedMessages.length} messages`);
    return {
      messages: detailedMessages,
      nextPageToken: response.nextPageToken && response.nextPageToken.trim().length > 0 ? response.nextPageToken : undefined,
    };
  } catch (error) {
    // Standardized error handling for pagination pipeline
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (logger)
      logger.error('Gmail pagination: single page fetch failed', {
        error: errorMessage,
        query: gmailQ,
        pageSize: safePageSize,
        hasPageToken: !!pageToken,
      });

    // Preserve original error type for upstream handling
    if (error instanceof Error) {
      // Enhance error with pagination context
      error.message = `Gmail pagination fetch failed: ${error.message}`;
      throw error;
    }

    // Convert non-Error objects to proper Error instances
    throw new Error(`Gmail pagination fetch failed: ${errorMessage}`);
  }
}

export interface FetchMessagesConcurrentlyParams {
  readonly items: readonly string[];
  readonly concurrency?: number;
  readonly body?: boolean;
  readonly logger: Logger;
  readonly metadataHeaders?: readonly string[];
}

export async function fetchMessagesConcurrently(gmail: gmail_v1.Gmail, params: FetchMessagesConcurrentlyParams): Promise<gmail_v1.Schema$Message[]> {
  const { items, concurrency = 2, body = false, logger, metadataHeaders } = params;

  // Secure resource bounds checking for concurrent operations
  const maxConcurrency = 10; // Conservative limit to prevent rate limiting and resource exhaustion
  const minConcurrency = 1; // Minimum valid concurrency

  // Validate input is a positive number to prevent bypass attempts
  if (!Number.isInteger(concurrency) || concurrency < 0) {
    throw new Error(`Invalid concurrency: must be a positive integer, got ${concurrency}`);
  }

  const safeConcurrency = Math.min(Math.max(minConcurrency, concurrency), maxConcurrency);

  if (concurrency !== safeConcurrency && logger) {
    logger.info('Concurrency bounded for API safety', { requested: concurrency, applied: safeConcurrency });
    // No fallback to console - would corrupt MCP stdio communication
  }

  if (items.length === 0) return [];

  const results: (gmail_v1.Schema$Message | null)[] = new Array(items.length);
  const format = body ? 'full' : 'metadata';
  // Always pass metadataHeaders if provided - body doesn't replace headers, it's additional content
  const metadataHeadersForRequest = metadataHeaders;

  // Pre-build request parameters to avoid repeated object creation
  const requestParams = items.map((id) => {
    const baseParams = {
      userId: 'me' as const,
      id,
      format,
    };
    // Only include metadataHeaders if defined (exactOptionalPropertyTypes compliance)
    return metadataHeadersForRequest ? { ...baseParams, metadataHeaders: [...metadataHeadersForRequest] } : baseParams;
  });

  // Optimize concurrent processing using batching
  const batchSize = safeConcurrency;
  const batches: (typeof requestParams)[] = [];
  for (let i = 0; i < requestParams.length; i += batchSize) {
    batches.push(requestParams.slice(i, i + batchSize));
  }

  let processedCount = 0;
  for (const batch of batches) {
    const batchPromises = batch.map(async (params, batchIndex) => {
      try {
        const messageResponse = await gmail.users.messages.get(params);
        const globalIndex = processedCount + batchIndex;
        results[globalIndex] = messageResponse.data;
        return messageResponse.data;
      } catch (error) {
        // Log individual message fetch failures but continue processing
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (logger)
          logger.info('Gmail pagination: individual message fetch failed, continuing', {
            error: errorMessage,
            messageId: params.id,
            globalIndex: processedCount + batchIndex,
          });
        return null; // Mark as failed but continue
      }
    });

    await Promise.all(batchPromises);
    processedCount += batch.length;

    // Progress logging for large batches
    if (items.length > 20) {
      if (logger) logger.info(`Gmail pagination: processed ${processedCount}/${items.length} messages`);
    }
  }

  // Filter out any null results from failed individual fetches
  return results.filter((result) => result !== null && result !== undefined);
}
