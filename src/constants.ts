/**
 * Gmail MCP Server Constants
 *
 * These scopes are required for Gmail functionality and are hardcoded
 * rather than externally configured since this server knows its own requirements.
 */

import { EMAIL_CHUNK_SIZE, EMAIL_MAX_BATCH_SIZE } from '@mcp-z/email';

// Google OAuth scopes required for Gmail operations
export const GOOGLE_SCOPE = 'openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://mail.google.com/';

// Batch processing configuration (from shared email constants)
export const CHUNK_SIZE = EMAIL_CHUNK_SIZE;
export const MAX_BATCH_SIZE = EMAIL_MAX_BATCH_SIZE;

// Pagination configuration
export const DEFAULT_PAGE_SIZE = 50; // Default number of items per page
export const MAX_PAGE_SIZE = 1000; // Maximum number of items per page
