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

  if (from) headers.push(`From: ${from}`);
  if (to && to.length) headers.push(`To: ${Array.isArray(to) ? to.join(', ') : to}`);
  if (cc && cc.length) headers.push(`Cc: ${Array.isArray(cc) ? cc.join(', ') : cc}`);
  if (bcc && bcc.length) headers.push(`Bcc: ${Array.isArray(bcc) ? bcc.join(', ') : bcc}`);
  if (subject) headers.push(`Subject: ${subject}`);

  headers.push('MIME-Version: 1.0');
  const mimeType = contentType === 'html' ? 'text/html' : 'text/plain';
  headers.push(`Content-Type: ${mimeType}; charset=utf-8`);

  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}
