import type { gmail_v1 } from 'googleapis';
import { toIsoUtc } from '../../lib/date-conversion.js';
import { extractEmails, extractFrom } from '../parsing/headers-utils.js';

export type FetchMode = 'metadata' | 'full';

export interface NormalizedAddress {
  address?: string | undefined;
  name?: string | undefined;
}
export interface NormalizedMessage {
  id: string;
  threadId?: string | undefined;
  date?: string | undefined;
  subject?: string | undefined;
  from?: NormalizedAddress | undefined;
  to?: string[] | undefined;
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  snippet?: string | undefined;
  labels?: string[] | undefined;
  body?: string | undefined;
}

export interface GmailDeps {
  /** googleapis Gmail client created via createGmailClient(provider). */
  gmail: gmail_v1.Gmail;
}

function extractHeader(headers: Array<{ name?: string; value?: string }> | undefined, key: string): string | undefined {
  const h = headers?.find((x) => (x.name ?? '').toLowerCase() === key.toLowerCase());
  return h?.value ?? undefined;
}

function base64UrlDecode(input: string): string {
  let s = String(input).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractBody(payload: unknown): string | undefined {
  const find = (parts: unknown[] | undefined, mime: string): string | undefined => {
    for (const p of parts ?? []) {
      if (p && typeof p === 'object' && 'mimeType' in p && 'body' in p) {
        if (p.mimeType === mime && p.body && typeof p.body === 'object' && 'data' in p.body) {
          return base64UrlDecode(p.body.data as string);
        }
      }
      if (p && typeof p === 'object' && 'parts' in p) {
        const nested = find(p.parts as unknown[], mime);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  if (payload && typeof payload === 'object' && 'parts' in payload) {
    return find(payload.parts as unknown[], 'text/plain') ?? find(payload.parts as unknown[], 'text/html')?.replace(/\r\n?/g, '\n');
  }
  return undefined;
}

export async function fetchMessage(deps: GmailDeps, id: string, mode: FetchMode): Promise<NormalizedMessage> {
  const { gmail } = deps;
  // When only metadata is requested, ask Gmail for a reduced payload with just the headers we care about.
  const metadataHeaders = ['Date', 'Subject', 'From', 'To', 'Cc', 'Bcc'];
  const format = mode === 'full' ? 'full' : 'metadata';
  const baseParams = { userId: 'me' as const, id, format };
  const resp = format === 'metadata' ? await gmail.users.messages.get({ ...baseParams, metadataHeaders }) : await gmail.users.messages.get(baseParams);
  const data = resp?.data as unknown;
  const headers = data && typeof data === 'object' && 'payload' in data && data.payload && typeof data.payload === 'object' && 'headers' in data.payload ? (data.payload.headers as Array<{ name?: string; value?: string }> | undefined) : undefined;
  const dateRaw = extractHeader(headers, 'Date');
  const fromRaw = extractHeader(headers, 'From');
  const toRaw = extractHeader(headers, 'To');
  const ccRaw = extractHeader(headers, 'Cc');
  const bccRaw = extractHeader(headers, 'Bcc');

  const fromObj = (fromRaw ? (extractFrom(fromRaw) as NormalizedAddress) : undefined) ?? undefined;
  const toArr = toRaw ? extractEmails(toRaw) : [];
  const ccArr = ccRaw ? extractEmails(ccRaw) : [];
  const bccArr = bccRaw ? extractEmails(bccRaw) : [];

  const getId = (): string => {
    if (data && typeof data === 'object' && 'id' in data) {
      return String(data.id ?? id);
    }
    return id;
  };

  const getThreadId = (): string | undefined => {
    if (data && typeof data === 'object' && 'threadId' in data && data.threadId) {
      return String(data.threadId);
    }
    return undefined;
  };

  const getSnippet = (): string | undefined => {
    if (data && typeof data === 'object' && 'snippet' in data && data.snippet) {
      return String(data.snippet);
    }
    return undefined;
  };

  const getLabelIds = (): string[] | undefined => {
    if (data && typeof data === 'object' && 'labelIds' in data && Array.isArray(data.labelIds)) {
      return data.labelIds.map(String);
    }
    return undefined;
  };

  const getPayload = (): unknown => {
    if (data && typeof data === 'object' && 'payload' in data) {
      return data.payload;
    }
    return undefined;
  };

  const msg: NormalizedMessage = {
    id: getId(),
    threadId: getThreadId(),
    date: dateRaw ? (toIsoUtc(dateRaw) ?? dateRaw) : undefined,
    subject: extractHeader(headers, 'Subject'),
    from: fromObj,
    to: toArr.length ? toArr : undefined,
    cc: ccArr.length ? ccArr : undefined,
    bcc: bccArr.length ? bccArr : undefined,
    snippet: getSnippet(),
    labels: getLabelIds(),
  };
  if (mode === 'full') {
    const body = extractBody(getPayload());
    if (body) msg.body = body;
  }
  return msg;
}
