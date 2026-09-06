import type { gmail_v1 } from '@googleapis/gmail';
import type { Logger } from '../../src/types.ts';
// Helpers operate on a provided Gmail client instance

export interface CreateTestMessageOptions {
  subject?: string;
  body?: string;
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  labels?: string[];
}

export async function createTestMessage(gmail: gmail_v1.Gmail, opts: CreateTestMessageOptions = {}): Promise<string> {
  const profileResp = await gmail.users.getProfile({ userId: 'me' });
  const userEmail = profileResp.data.emailAddress ?? 'me';

  const subject = opts.subject || `ci-test-${Date.now()}`;
  const body = opts.body || 'Automated integration test message body';
  const from = opts.from || userEmail;
  const to = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to || userEmail;

  // Build RFC 2822 message headers
  const headers: string[] = [`From: ${from}`, `To: ${to}`];

  if (opts.cc) {
    const cc = Array.isArray(opts.cc) ? opts.cc.join(', ') : opts.cc;
    headers.push(`Cc: ${cc}`);
  }

  if (opts.bcc) {
    const bcc = Array.isArray(opts.bcc) ? opts.bcc.join(', ') : opts.bcc;
    headers.push(`Bcc: ${bcc}`);
  }

  headers.push(`Subject: ${subject}`);
  headers.push(''); // Empty line between headers and body

  const raw = [...headers, body].join('\r\n');
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sentResp = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
  const sent = sentResp.data;
  if (!sent?.id) throw new Error('createTestMessage: expected sent message id');

  const messageId = sent.id;

  // Apply labels if specified (labels are applied after message creation)
  if (opts.labels && opts.labels.length > 0) {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: opts.labels,
      },
    });
  }

  return messageId;
}

/**
 * Delete a test message created with createTestMessage.
 * Throws on any error - close failures indicate test problems that need to be visible.
 */
export async function deleteTestMessage(gmail: gmail_v1.Gmail, id: string, logger: Logger): Promise<void> {
  try {
    await gmail.users.messages.delete({ userId: 'me', id });
    logger.debug('Test message close successful', { messageId: id });
  } catch (e: unknown) {
    const error = e as { status?: unknown; statusCode?: unknown; code?: unknown };
    logger.error('Test message close failed', {
      messageId: id,
      error: e instanceof Error ? e.message : String(e),
      status: error.status || error.statusCode,
      code: error.code,
    });
    throw e; // Always throw - if we're deleting it, it should exist
  }
}
