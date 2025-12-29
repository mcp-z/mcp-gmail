import { extractCurrentMessageFromHtml } from '@mcp-z/email';
import type { gmail_v1 } from 'googleapis';
import { parse } from 'node-html-parser';

export interface BodyExtractionOptions {
  /** Format to return: 'text' extracts plain text, 'html' preserves HTML structure */
  contentType?: 'text' | 'html';
  /** When true, removes quoted thread history from HTML content */
  excludeThreadHistory?: boolean;
}

export function extractBodyFromPayload(payload: gmail_v1.Schema$MessagePart, options: BodyExtractionOptions = {}): string {
  const { contentType = 'text', excludeThreadHistory = false } = options;
  if (!payload) return '';

  // If there's a direct body with data
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // If there are parts, look for text/plain or text/html
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.mimeType === 'text/html' && part.body?.data) {
        let html = Buffer.from(part.body.data, 'base64').toString('utf-8');

        // Remove thread history if requested
        if (excludeThreadHistory) {
          html = extractCurrentMessageFromHtml(html);
        }

        // Return HTML directly if requested
        if (contentType === 'html') {
          return html;
        }

        // Otherwise extract plain text from HTML
        const doc = parse(html);
        const docUnknown = doc as unknown;
        if (docUnknown && typeof docUnknown === 'object' && 'text' in docUnknown) {
          return docUnknown.text as string;
        }
        return '';
      }
    }
  }

  return '';
}
