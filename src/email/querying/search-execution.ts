import type { gmail_v1 } from 'googleapis';
import type { GmailQuery as QueryNode } from '../../schemas/gmail-query-schema.ts';
import type { Logger } from '../../types.ts';
import { type FetchMessagesPageParams, fetchMessagesPage } from './pagination.ts';
import { toGmailQuery } from './query-builder.ts';

export interface GmailSearchOptions {
  readonly query?: QueryNode;
  readonly pageSize?: number;
  readonly includeBody?: boolean;
  readonly pageToken: string | undefined; // For pagination support - explicit undefined allowed
  readonly logger: Logger;
}

export interface GmailEmailSummary {
  readonly id: string;
  readonly provider: 'gmail';
  readonly threadId?: string;
  readonly date?: string;
  readonly from?: string;
  readonly fromName?: string;
  readonly to?: string;
  readonly cc?: string;
  readonly bcc?: string;
  readonly subject?: string;
  readonly snippet?: string;
  readonly body?: string;
}

function buildGmailQ(query: QueryNode | undefined): string {
  if (!query) return '';
  const emitted = toGmailQuery(query);
  return emitted?.q ?? '';
}

export interface GmailSearchResult {
  readonly messages: gmail_v1.Schema$Message[]; // Raw Gmail API messages for transformation by caller
  readonly nextPageToken: string | undefined;
}

export async function searchMessages(gmail: gmail_v1.Gmail, opts: GmailSearchOptions): Promise<GmailSearchResult> {
  const { query, pageSize = 50, includeBody = false, pageToken, logger } = opts;
  const gmailQ = buildGmailQ(query);
  const metadataHeaders = ['Date', 'Subject', 'From', 'To', 'Cc', 'Bcc'];
  // Always fetch metadata headers - body is additional content, not a replacement for headers
  const pageParams: FetchMessagesPageParams = {
    gmailQ,
    pageSize,
    body: includeBody,
    metadataHeaders,
    pageToken,
    logger,
  };
  const result = await fetchMessagesPage(gmail, pageParams);

  // Return raw Gmail messages - transformation happens in caller
  return {
    messages: result.messages,
    nextPageToken: result.nextPageToken,
  };
}
