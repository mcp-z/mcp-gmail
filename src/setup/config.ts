import { parseDcrConfig, parseConfig as parseOAuthConfig } from '@mcp-z/oauth-google';
import { parseConfig as parseTransportConfig } from '@mcp-z/server';
import * as fs from 'fs';
import moduleRoot from 'module-root-sync';
import { homedir } from 'os';
import * as path from 'path';
import * as url from 'url';
import { parseArgs } from 'util';
import { GOOGLE_SCOPE } from '../constants.ts';
import type { ServerConfig } from '../types.js';

const pkg = JSON.parse(fs.readFileSync(path.join(moduleRoot(url.fileURLToPath(import.meta.url)), 'package.json'), 'utf-8'));

const HELP_TEXT = `
Usage: mcp-gmail [options]

MCP server for Gmail email management with OAuth authentication.

Options:
  --version              Show version number
  --help                 Show this help message
  --auth=<mode>          Authentication mode (default: loopback-oauth)
                         Modes: loopback-oauth, service-account, dcr
  --headless             Disable browser auto-open, return auth URL instead
  --redirect-uri=<uri>   OAuth redirect URI (default: ephemeral loopback)
  --dcr-mode=<mode>      DCR mode (self-hosted or external, default: self-hosted)
  --dcr-verify-url=<url> External verification endpoint (required for external mode)
  --dcr-store-uri=<uri>  DCR client storage URI (required for self-hosted mode)
  --port=<port>          Enable HTTP transport on specified port
  --stdio                Enable stdio transport (default if no port)
  --log-level=<level>    Logging level (default: info)
  --storage-dir=<path>   Directory for CSV file storage (default: .mcp-z/files)
  --base-url=<url>       Base URL for HTTP file serving (optional)

Environment Variables:
  GOOGLE_CLIENT_ID       OAuth client ID (REQUIRED)
  GOOGLE_CLIENT_SECRET   OAuth client secret (optional)
  AUTH_MODE              Default authentication mode (optional)
  HEADLESS               Disable browser auto-open (optional)
  DCR_MODE               DCR mode (optional, same format as --dcr-mode)
  DCR_VERIFY_URL         External verification URL (optional, same as --dcr-verify-url)
  DCR_STORE_URI          DCR storage URI (optional, same as --dcr-store-uri)
  PORT                   Default HTTP port (optional)
  LOG_LEVEL              Default logging level (optional)
  STORAGE_DIR            Default storage directory (optional)
  BASE_URL               Default base URL for file serving (optional)

OAuth Scopes:
  openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://mail.google.com/

Examples:
  mcp-gmail                           # Use default settings
  mcp-gmail --auth=service-account    # Use service account auth
  mcp-gmail --port=3000               # HTTP transport on port 3000
  mcp-gmail --storage-dir=./emails    # Custom storage directory
  GOOGLE_CLIENT_ID=xxx mcp-gmail      # Set client ID via env var
`.trim();

/**
 * Handle --version and --help flags before config parsing.
 * These should work without requiring any configuration.
 */
export function handleVersionHelp(args: string[]): { handled: boolean; output?: string } {
  const { values } = parseArgs({
    args,
    options: {
      version: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    strict: false,
  });

  if (values.version) return { handled: true, output: pkg.version };
  if (values.help) return { handled: true, output: HELP_TEXT };
  return { handled: false };
}

/**
 * Parse Gmail server configuration from CLI arguments and environment.
 *
 * CLI Arguments (all optional):
 * - --auth=<mode>          Authentication mode (default: loopback-oauth)
 *                          Modes: loopback-oauth, service-account, dcr
 * - --headless             Disable browser auto-open, return auth URL instead
 * - --redirect-uri=<uri>   OAuth redirect URI (default: ephemeral loopback)
 * - --dcr-mode=<mode>      DCR mode (self-hosted or external, default: self-hosted)
 * - --dcr-verify-url=<url> External verification endpoint (required for external mode)
 * - --dcr-store-uri=<uri>  DCR client storage URI (required for self-hosted mode)
 * - --port=<port>          Enable HTTP transport on specified port
 * - --stdio                Enable stdio transport (default if no port)
 * - --log-level=<level>    Logging level (default: info)
 * - --storage-dir=<path>   Directory for CSV file storage (default: .mcp-z/files)
 * - --base-url=<url>       Base URL for HTTP file serving (optional)
 *
 * Environment Variables:
 * - GOOGLE_CLIENT_ID       OAuth client ID (REQUIRED)
 * - GOOGLE_CLIENT_SECRET   OAuth client secret (optional)
 * - AUTH_MODE              Default authentication mode (optional)
 * - HEADLESS               Disable browser auto-open (optional)
 * - DCR_MODE               DCR mode (optional, same format as --dcr-mode)
 * - DCR_VERIFY_URL         External verification URL (optional, same as --dcr-verify-url)
 * - DCR_STORE_URI          DCR storage URI (optional, same as --dcr-store-uri)
 * - PORT                   Default HTTP port (optional)
 * - LOG_LEVEL              Default logging level (optional)
 * - STORAGE_DIR            Default storage directory (optional)
 * - BASE_URL               Default base URL for file serving (optional)
 *
 * OAuth Scopes (from constants.ts):
 * openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://mail.google.com/
 */
export function parseConfig(args: string[], env: Record<string, string | undefined>): ServerConfig {
  const transportConfig = parseTransportConfig(args, env);
  const oauthConfig = parseOAuthConfig(args, env);

  // Parse DCR configuration if DCR mode is enabled
  const dcrConfig = oauthConfig.auth === 'dcr' ? parseDcrConfig(args, env, GOOGLE_SCOPE) : undefined;

  // Parse application-level config (LOG_LEVEL, STORAGE_DIR, BASE_URL)
  const { values } = parseArgs({
    args,
    options: {
      'log-level': { type: 'string' },
      'storage-dir': { type: 'string' },
      'base-url': { type: 'string' },
    },
    strict: false, // Allow other arguments
    allowPositionals: true,
  });

  const name = pkg.name.replace(/^@[^/]+\//, '');
  // Parse repository URL from package.json, stripping git+ prefix and .git suffix
  const rawRepoUrl = typeof pkg.repository === 'object' ? pkg.repository.url : pkg.repository;
  const repositoryUrl = rawRepoUrl?.replace(/^git\+/, '').replace(/\.git$/, '') ?? `https://github.com/mcp-z/${name}`;
  const rootDir = process.cwd() === '/' ? homedir() : process.cwd();
  const baseDir = path.join(rootDir, '.mcp-z');
  const cliLogLevel = typeof values['log-level'] === 'string' ? values['log-level'] : undefined;
  const envLogLevel = env.LOG_LEVEL;
  const logLevel = cliLogLevel ?? envLogLevel ?? 'info';

  // Parse storage configuration
  const cliStorageDir = typeof values['storage-dir'] === 'string' ? values['storage-dir'] : undefined;
  const envStorageDir = env.STORAGE_DIR;
  let storageDir = cliStorageDir ?? envStorageDir ?? path.join(baseDir, name, 'files');
  if (storageDir.startsWith('~')) storageDir = storageDir.replace(/^~/, homedir());

  const cliBaseUrl = typeof values['base-url'] === 'string' ? values['base-url'] : undefined;
  const envBaseUrl = env.BASE_URL;
  const baseUrl = cliBaseUrl ?? envBaseUrl;

  // Combine configs
  const result: ServerConfig = {
    ...oauthConfig, // Includes clientId, auth, headless, redirectUri, serviceAccountKeyFile
    transport: transportConfig.transport,
    logLevel,
    baseDir,
    name,
    version: pkg.version,
    repositoryUrl,
    storageDir: path.resolve(storageDir),
  };
  if (baseUrl) result.baseUrl = baseUrl;
  if (dcrConfig !== undefined) result.dcrConfig = dcrConfig;
  return result;
}

/**
 * Build production configuration from process globals.
 * Entry point for production server.
 */
export function createConfig(): ServerConfig {
  return parseConfig(process.argv, process.env);
}
