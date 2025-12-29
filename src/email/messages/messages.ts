import { buildContentForItems } from '@mcp-z/email';
import type { gmail_v1 } from 'googleapis';
import { safeBase64Decode } from '../../lib/base64-encoding.js';
import { toIsoUtc } from '../../lib/date-conversion.js';
import { extractEmails, extractFrom } from '../parsing/headers-utils.js';

export { buildContentForItems };

// Convert a Gmail messages.get() response into canonical row shape used by sheets writer
// [id, provider, threadId, to, from, cc, bcc, date, subject, labels, snippet, body]
export function toRowFromGmail(msg: gmail_v1.Schema$Message = {}, opts: { body?: boolean; addressFormat?: 'email' | string } = { body: false, addressFormat: 'email' }) {
  const headers = msg?.payload?.headers || [];
  const headerObj: Record<string, string> = Object.fromEntries((headers || []).map((h) => [String(h?.name ?? ''), String(h?.value ?? '')]));
  const id = msg?.id ?? '';
  const provider = 'gmail';
  const threadId = msg?.threadId ?? '';
  const to = extractEmails(headerObj.To ?? '').join(', ');
  const fromInfo = extractFrom(headerObj.From ?? '');
  const from = ((fromInfo && fromInfo.address) || headerObj.From) ?? '';
  const cc = extractEmails(headerObj.Cc ?? '').join(', ');
  const bcc = extractEmails(headerObj.Bcc ?? '').join(', ');
  const date = (toIsoUtc(headerObj.Date) || headerObj.Date) ?? '';
  const subject = headerObj.Subject ?? '';
  const labelIds = Array.isArray(msg?.labelIds) ? (msg.labelIds as string[]) : [];
  const labels = labelIds.join(';');
  const snippet = msg?.snippet ?? '';

  let bodyFull = '';
  if (opts?.body) {
    const parts = msg?.payload?.parts || [];
    const findText = (partsArr: unknown[]): string | null => {
      for (const p of partsArr || []) {
        if (p && typeof p === 'object' && 'mimeType' in p && 'body' in p) {
          if (p.mimeType === 'text/plain' && p.body && typeof p.body === 'object' && 'data' in p.body) {
            return p.body.data as string;
          }
        }
        if (p && typeof p === 'object' && 'parts' in p) {
          const nested = findText(p.parts as unknown[]);
          if (nested) return nested;
        }
      }
      return null;
    };
    const raw = findText(parts as unknown[]) || (msg?.payload?.body && typeof msg.payload.body === 'object' && 'data' in msg.payload.body ? msg.payload.body.data : null) || null;
    if (raw) {
      bodyFull = safeBase64Decode(raw as string);
    } else {
      const findHtml = (partsArr: unknown[]): string | null => {
        for (const p of partsArr || []) {
          if (p && typeof p === 'object' && 'mimeType' in p && 'body' in p) {
            if (p.mimeType === 'text/html' && p.body && typeof p.body === 'object' && 'data' in p.body) {
              return p.body.data as string;
            }
          }
          if (p && typeof p === 'object' && 'parts' in p) {
            const nested = findHtml(p.parts as unknown[]);
            if (nested) return nested;
          }
        }
        return null;
      };
      const htmlPart = findHtml(parts as unknown[]);
      if (htmlPart) {
        bodyFull = safeBase64Decode(htmlPart).replace(/\r\n?/g, '\n');
      }
    }
  }
  return [id, provider, threadId, to, from, cc, bcc, date, subject, labels, snippet, bodyFull];
}
