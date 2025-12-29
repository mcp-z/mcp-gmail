import { safeBase64UrlDecode } from '@mcp-z/email';

export function safeBase64Decode(raw?: string): string {
  if (!raw) return '';
  try {
    return safeBase64UrlDecode(raw);
  } catch {
    // Fallback to original input if decoding fails
    return String(raw);
  }
}

export function b64url(input: string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
