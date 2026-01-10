#!/usr/bin/env node

/**
 * Gmail Mail Cleaner
 *
 * Uses loopback OAuth to authenticate and clean (move to trash) all emails.
 * Always requests new tokens, does not store them persistently.
 *
 * Usage:
 *   node scripts/clean.ts           # Preview mode: lists messages that would be deleted
 *   node scripts/clean.ts --force   # Force mode: actually deletes the messages
 *   node scripts/clean.ts --headless # Prints URL for CI/SSH environments
 */

import { AuthRequiredError, listAccountIds } from '@mcp-z/oauth';
import { LoopbackOAuthProvider } from '@mcp-z/oauth-google';
import { google } from 'googleapis';
import type { Keyv } from 'keyv';
import { GOOGLE_SCOPE } from '../src/constants.ts';
import createStore from '../src/lib/create-store.ts';
import { createConfig } from '../src/setup/config.ts';

const CHUNK_SIZE = 20; // Gmail API has stricter rate limits
const MAX_BATCH_SIZE = 10000; // Stop after this many messages to prevent runaway

async function cleanMail(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const isForce = args.includes('--force');

  const config = createConfig();
  console.log('📧 Gmail Mail Cleaner');
  console.log('');

  if (isForce) {
    console.log('⚠️  WARNING: FORCE MODE - This will move ALL your emails to trash!');
    console.log('   Make sure you have a backup or are absolutely sure.');
  } else {
    console.log('👀 PREVIEW MODE: This will list messages that WOULD be deleted.');
    console.log('   Run with --force to actually delete them.');
  }
  console.log('');

  const tokenStore = await createStore<unknown>('file://.//.tokens/store.json');
  const accountId = await resolveTestAccount(tokenStore, config.name);

  const auth = new LoopbackOAuthProvider({
    service: config.name,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: GOOGLE_SCOPE,
    headless: true,
    logger: console,
    tokenStore,
  });

  console.log('Using cached test account:', accountId);
  console.log('');

  try {
    const token = await auth.getAccessToken(accountId);

    console.log('✓ Authentication successful!');
    console.log('');

    // Create Gmail client with OAuth2 client
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    console.log('Searching for all messages...');

    // Collect all messages by paginating through all messages (include subject for preview)
    const allMessages: Array<{ id: string; subject: string }> = [];
    let pageCount = 0;
    let hasNextPage = true;
    let nextPageToken: string | undefined;

    while (hasNextPage && allMessages.length < MAX_BATCH_SIZE) {
      pageCount++;

      const request = {
        userId: 'me',
        maxResults: 500, // Gmail API limit
        format: 'metadata',
        metadataHeaders: ['subject'],
      };

      if (nextPageToken) {
        request.pageToken = nextPageToken;
      }

      console.log(`Fetching page ${pageCount}...`);
      const response = await gmail.users.messages.list(request);

      const messages = response.data.messages || [];

      // Get full message details for subject
      for (const message of messages) {
        if (message.id) {
          try {
            const headers = (message.payload?.headers || []) as Array<{ name: string; value?: string }>;
            const subjectHeader = headers.find((h) => h.name === 'Subject');
            const subject = subjectHeader?.value || '(No subject)';

            allMessages.push({
              id: message.id,
              subject,
            });
          } catch (_error) {
            // If we can't get message details, still include it
            allMessages.push({
              id: message.id,
              subject: '(Unable to retrieve subject)',
            });
          }
        }
      }

      nextPageToken = response.data.nextPageToken || undefined;
      hasNextPage = !!nextPageToken;

      console.log(`  Found ${messages.length} messages in this page (total: ${allMessages.length})`);

      // Safety check
      if (allMessages.length >= MAX_BATCH_SIZE) {
        console.log(`⚠️  Reached maximum batch size limit (${MAX_BATCH_SIZE}). Stopping at ${allMessages.length} messages.`);
        hasNextPage = false;
      }

      // Safety check: if no messages in last few pages but still hasNextPage, might be stuck
      if (pageCount > 20 && messages.length === 0) {
        // Gmail sometimes returns empty pages
        console.log('⚠️  No more messages found. Stopping.');
        hasNextPage = false;
      }
    }

    console.log('');
    console.log(`📧 Found ${allMessages.length} messages total (${pageCount} pages)`);

    if (allMessages.length === 0) {
      console.log('✅ No messages to clean!');
      return;
    }

    if (!isForce) {
      // Preview mode: show first 10 messages and summary
      console.log('');
      console.log('📋 Preview of messages that would be deleted:');
      console.log('');

      const previewCount = Math.min(10, allMessages.length);
      for (let i = 0; i < previewCount; i++) {
        const msg = allMessages[i];
        console.log(`  ${i + 1}. [${msg.id}] ${msg.subject}`);
      }

      if (allMessages.length > 10) {
        console.log(`  ... and ${allMessages.length - 10} more messages`);
      }

      console.log('');
      console.log(`💡 To delete these ${allMessages.length} messages, run with --force flag:`);
      console.log('   node scripts/clean.ts --force');

      return;
    }

    // Force mode: actually delete
    console.log('');
    console.log(`🗑️  Deleting ${allMessages.length} messages...`);

    const messageIds = allMessages.map((m) => m.id);
    let totalSuccess = 0;
    let totalFailure = 0;

    for (let i = 0; i < messageIds.length; i += CHUNK_SIZE) {
      const chunk = messageIds.slice(i, i + CHUNK_SIZE);
      console.log(`Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(messageIds.length / CHUNK_SIZE)}: ${chunk.length} messages`);

      const chunkResults = await Promise.allSettled(
        chunk.map(async (id) => {
          await gmail.users.messages.trash({
            userId: 'me',
            id: id,
          });
          return { id, success: true };
        })
      );

      const successCount = chunkResults.filter((r) => r.status === 'fulfilled').length;
      const failureCount = chunkResults.filter((r) => r.status === 'rejected').length;

      totalSuccess += successCount;
      totalFailure += failureCount;

      console.log(`  ✓ ${successCount} successful, ✗ ${failureCount} failed`);
    }

    console.log('');
    console.log('🧹 Cleanup complete!');
    console.log(`✅ Successfully moved ${totalSuccess} messages to trash`);
    if (totalFailure > 0) {
      console.log(`❌ Failed to move ${totalFailure} messages`);
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      console.error('\n❌ Cleanup failed: no cached tokens available for Gmail.');
      console.error('   Run `npm run test:setup` to generate tokens and try again.');
      process.exit(1);
    }
    console.error('\n❌ Cleanup failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function resolveTestAccount(tokenStore: Keyv, service: string): Promise<string> {
  const accountIds = await listAccountIds(tokenStore, service);
  if (accountIds.length === 0) {
    throw new Error('No test account found. Run `npm run test:setup` to initialize Gmail credentials.');
  }
  if (accountIds.length > 1) {
    throw new Error(`Multiple test accounts found for ${service} (${accountIds.length}). Please clean .tokens and rerun setup:\n  rm -rf .tokens\n  npm run test:setup`);
  }
  return (
    accountIds[0] ??
    (function () {
      throw new Error('No account id available');
    })()
  );
}

// Run if executed directly
if (import.meta.main) {
  cleanMail()
    .then(() => {
      console.log('');
      console.log('Done!');
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}
