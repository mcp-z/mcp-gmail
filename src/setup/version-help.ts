import * as fs from 'fs';
import moduleRoot from 'module-root-sync';
import * as path from 'path';
import * as url from 'url';
import { parseArgs } from 'util';

// Kept dependency-free (fs/path/url/module-root-sync only) so `--version`/`--help`
// resolve nothing beyond Node startup: config.ts's parseConfig pulls in @mcp-z/oauth-google and
// @mcp-z/server, which this path must not touch.
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
  --dcr-store-uri=<uri>  DCR client storage URI (default: .mcp-z/dcr.json)
  --port=<port>          Enable HTTP transport on specified port
  --stdio                Enable stdio transport (default if no port)
  --log-level=<level>    Logging level (default: info)
  --resource-store-uri=<uri>    Resource store URI for CSV file storage (default: .mcp-z/mcp-gmail/files beside the nearest .mcp.json, else ~/.mcp-z/mcp-gmail/files)
  --base-url=<url>       Base URL for HTTP file serving (optional)

Environment Variables:
  GOOGLE_CLIENT_ID       OAuth client ID (REQUIRED)
  GOOGLE_CLIENT_SECRET   OAuth client secret (optional)
  AUTH_MODE              Default authentication mode (optional)
  HEADLESS               Disable browser auto-open (optional)
  DCR_STORE_URI          DCR storage URI (optional, same as --dcr-store-uri)
  TOKEN_STORE_URI        Token storage URI (optional)
  PORT                   Default HTTP port (optional)
  LOG_LEVEL              Default logging level (optional)
  RESOURCE_STORE_URI            Resource store URI (optional, file://)
  BASE_URL               Default base URL for file serving (optional)

Configuration Files:
  Variables may also be set in the first of these files that exists:
    1. .mcp-z/mcp-gmail/.env beside the nearest .mcp.json (else ~/.mcp-z/mcp-gmail/.env)
    2. ~/.config/mcp-z/mcp-gmail/.env   (~ is your home directory, on every OS)
  Values already in the environment, including .mcp.json "env", take precedence.
  On macOS and Linux the file must be private (chmod 600), or the server will not start.

Storage Backends:
  TOKEN_STORE_URI and DCR_STORE_URI accept any keyv-registry protocol.
  file+shared:// (the default), file:// and memory:// work out of the box. Any other backend
  needs its adapter installed alongside this server:
    npm install -g @keyv/redis
    TOKEN_STORE_URI=redis://localhost:6379 mcp-gmail

OAuth Scopes:
  openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://mail.google.com/

Examples:
  mcp-gmail                           # Use default settings
  mcp-gmail --auth=service-account    # Use service account auth
  mcp-gmail --port=3000               # HTTP transport on port 3000
  mcp-gmail --resource-store-uri=file:///tmp/emails    # Custom resource store URI
  GOOGLE_CLIENT_ID=xxx mcp-gmail      # Set client ID via env var
`.trim();

/** Package metadata read from package.json, resolved relative to this file. */
export function readPkg(): { name: string; version: string; repository?: string | { url?: string } } {
  return pkg;
}

/**
 * Handle --version/--help flags before config parsing.
 * These must work without requiring any configuration or heavy dependency.
 */
export function handleVersionHelp(args: string[]): { handled: boolean; output?: string } {
  const { values } = parseArgs({
    args,
    options: {
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values.version) return { handled: true, output: pkg.version };
  if (values.help) return { handled: true, output: HELP_TEXT };
  return { handled: false };
}
