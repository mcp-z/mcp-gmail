import type { EnrichedExtra } from '@mcp-z/oauth-google';
import type { ReadResourceResult, ResourceConfig, ResourceModule, ServerContext } from '@mcp-z/server';
import { ResourceTemplate } from '@mcp-z/server';
import { type gmail_v1, google } from 'googleapis';
import { extractEmails, extractFrom } from '../../email/parsing/message-extraction.ts';
import { toIsoUtc } from '../../lib/date-conversion.ts';
import { googleAuth } from '../../lib/google-auth.ts';

export default function createResource() {
  const template = new ResourceTemplate('gmail://messages/{id}', {
    list: undefined,
  });
  const config: ResourceConfig = {
    description: 'Gmail message metadata (lightweight: id, subject, from, to, date)',
    mimeType: 'application/json',
  };

  const handler = async (uri: URL, variables: { id: string }, extra: ServerContext): Promise<ReadResourceResult> => {
    try {
      const { logger, authContext } = extra as unknown as EnrichedExtra;

      logger.info(variables, 'gmail-email resource fetch');

      const gmail = google.gmail({ version: 'v1', auth: googleAuth(authContext.auth) });
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: variables.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });

      const fullData = response.data;
      if (!fullData) {
        throw new Error('Message not found');
      }

      // Extract headers
      const headers = fullData?.payload?.headers;
      const headersArray = Array.isArray(headers) ? headers : [];
      const headersMap: Record<string, string> = Object.fromEntries(
        headersArray.map((h: unknown) => {
          const header = h as gmail_v1.Schema$MessagePartHeader;
          return [String(header.name ?? ''), String(header.value ?? '')];
        })
      );

      const fromInfo = extractFrom(headersMap.From);
      const toStr = extractEmails(headersMap.To).join(', ');

      // Return lightweight metadata only (no body/snippet)
      const metadata = {
        id: fullData.id ?? variables.id,
        subject: headersMap.Subject ?? '',
        from: fromInfo?.address || headersMap.From,
        to: toStr,
        date: toIsoUtc(headersMap.Date) || headersMap.Date,
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(metadata),
          },
        ],
      };
    } catch (e) {
      const { logger } = extra as unknown as EnrichedExtra;
      logger.error(e as Record<string, unknown>, 'gmail-email resource fetch failed');
      const error = e as { message?: unknown };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ error: String(error?.message ?? e) }),
          },
        ],
      };
    }
  };

  return {
    name: 'email',
    template,
    config,
    handler,
  } satisfies ResourceModule;
}
