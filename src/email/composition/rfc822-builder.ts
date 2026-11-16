import { formatAddressHeader, formatHeader } from './header-encoding.ts';

export interface Rfc822Args {
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  body?: string;
  from?: string;
  /** Content type for the email body */
  contentType?: 'text' | 'html';
}

export function buildRfc822FromArgs(args: Rfc822Args): string {
  const { to = [], cc = [], bcc = [], subject = '', body = '', from = '', contentType = 'text' } = args;

  const headers: string[] = [];

  if (from) headers.push(formatAddressHeader('From', from));
  if (to && to.length) headers.push(formatAddressHeader('To', to));
  if (cc && cc.length) headers.push(formatAddressHeader('Cc', cc));
  if (bcc && bcc.length) headers.push(formatAddressHeader('Bcc', bcc));
  if (subject) headers.push(formatHeader('Subject', subject));

  headers.push('MIME-Version: 1.0');
  const mimeType = contentType === 'html' ? 'text/html' : 'text/plain';
  headers.push(`Content-Type: ${mimeType}; charset=utf-8`);

  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}
