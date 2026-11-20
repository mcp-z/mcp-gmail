# @mcp-z/mcp-gmail

MCP server for Gmail integration with OAuth authentication, message search, batch operations, and Google Sheets export

Requires Node.js >=20. The examples use `npx`, included with npm, to run this server and [@mcp-z/cli](https://github.com/mcp-z/cli).

## Common uses

- Search and read messages
- Send and reply to emails
- Manage labels and export messages to CSV

## Transports

MCP supports stdio and HTTP.

Both the 2025 and 2026-07-28 protocol revisions are served, over either transport, from the same
server. Your client negotiates whichever it speaks. A 2025 client keeps working with no change,
and support for it is not being dropped. The 2026-07-28 revision is stateless, so a client speaking
it sends no `initialize` handshake and carries no session id.

**Stdio**
```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@mcp-z/mcp-gmail"]
    }
  }
}
```

**HTTP**
```json
{
  "mcpServers": {
    "gmail": {
      "type": "http",
      "url": "http://localhost:9002/mcp",
      "start": {
        "command": "npx",
        "args": ["-y", "@mcp-z/mcp-gmail", "--port=9002"]
      }
    }
  }
}
```

`start` is an extension used by `npx @mcp-z/cli up` to launch HTTP servers for you.

## Create a Google Cloud app

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable the Gmail API.
4. Create OAuth 2.0 credentials (Desktop app).
5. Copy the Client ID and Client Secret.
6. Select your MCP transport (stdio for local and http for remote) and platform
- For stdio, choose "APIs & Services", + Create client, "Desktop app" type
- For http, choose "APIs & Services", + Create client, "Web application" type, add your URL (default is http://localhost:3000/oauth/callback based on the --port or PORT)
- For local hosting, add "http://127.0.0.1" for [Ephemeral redirect URL](https://en.wikipedia.org/wiki/Ephemeral_port)
7. Enable OAuth2 [scopes](https://console.cloud.google.com/auth/scopes): openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://mail.google.com/
8. Add [test emails](https://console.cloud.google.com/auth/audience)

## OAuth modes

Configure via environment variables or the `env` block in `.mcp.json`. The configuration reference below lists every option.

### Configuration file

Keep the client secret out of your shell and out of `.mcp.json` by putting it in a private file the server reads at startup, `~/.config/mcp-z/mcp-gmail/.env`:

```bash
mkdir -p ~/.config/mcp-z/mcp-gmail && chmod 700 ~/.config/mcp-z/mcp-gmail
printf 'GOOGLE_CLIENT_ID=your-client-id\nGOOGLE_CLIENT_SECRET=your-client-secret\n' > ~/.config/mcp-z/mcp-gmail/.env
chmod 600 ~/.config/mcp-z/mcp-gmail/.env
```

The server uses the first of `.mcp-z/mcp-gmail/.env` beside the nearest `.mcp.json` (else `~/.mcp-z/mcp-gmail/.env`) and `~/.config/mcp-z/mcp-gmail/.env` that exists. Anything set in the environment or in the `.mcp.json` `env` block overrides the file. On macOS and Linux the server refuses a file that other users can read.

### Loopback OAuth (default)

Environment variables:

```bash
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

Example (stdio) - Create .mcp.json:
```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@mcp-z/mcp-gmail"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id"
      }
    }
  }
}
```

Example (http) - Create .mcp.json:
```json
{
  "mcpServers": {
    "gmail": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "start": {
        "command": "npx",
        "args": ["-y", "@mcp-z/mcp-gmail", "--port=3000"],
        "env": {
          "GOOGLE_CLIENT_ID": "your-client-id"
        }
      }
    }
  }
}
```

Local (default): omit REDIRECT_URI → ephemeral loopback. Cloud: set REDIRECT_URI to your public /oauth/callback and expose the service publicly.

Note: the `start` block is a helper in `npx @mcp-z/cli up` for starting an HTTP server from your `.mcp.json`. See [@mcp-z/cli](https://github.com/mcp-z/cli) for details.


### Service account

Environment variables:

```bash
AUTH_MODE=service-account
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/path/to/service-account.json
```

Example:
```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@mcp-z/mcp-gmail", "--auth=service-account"],
      "env": {
        "GOOGLE_SERVICE_ACCOUNT_KEY_FILE": "/path/to/service-account.json"
      }
    }
  }
}
```

### DCR (self-hosted)

HTTP only. Requires a public base URL. CSV export and `/files` are disabled in DCR mode; `resourceStoreUri` is ignored.

```json
{
  "mcpServers": {
    "gmail-dcr": {
      "command": "npx",
      "args": [
        "-y",
        "@mcp-z/mcp-gmail",
        "--auth=dcr",
        "--port=3456",
        "--base-url=https://oauth.example.com"
      ],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

In `--auth=dcr` mode, every request to `/mcp` needs a bearer token issued by the server's own `/oauth/register` and `/oauth/authorize` flow; a request without a valid one gets 401 with a `WWW-Authenticate` challenge that points clients to it.

In `--auth=dcr` mode, `/oauth/register` accepts anonymous registrations with no limit, and stored registrations do not expire. If you expose the server to the internet, limit that endpoint in your reverse proxy.

## How to use

```bash
# Start the configured server and list its tools
npx -y @mcp-z/cli inspect --servers gmail --tools

# Call a tool after authorizing Gmail
npx -y @mcp-z/cli call-tool gmail message-search '{"query":"from:alice@example.com"}'

# Archive messages (remove from Inbox, nothing else changes)
npx -y @mcp-z/cli call-tool gmail message-archive '{"ids":["MESSAGE_ID"]}'
```

## Tools

1. categories-list
2. label-add
3. label-delete
4. label-remove
5. labels-list
6. message-archive
7. message-get
8. message-mark-read
9. message-move-to-trash
10. message-respond
11. message-search
12. message-send
13. messages-export-csv

## Resources

1. email

## Prompts

1. draft-email
2. query-syntax

## Configuration reference

See [`server.json`](https://github.com/mcp-z/mcp-gmail/blob/master/server.json) for all supported environment variables, CLI arguments, and defaults.

## Storage backends

OAuth tokens (`TOKEN_STORE_URI`) and DCR registrations (`DCR_STORE_URI`) are stored through [keyv-registry](https://www.npmjs.com/package/keyv-registry), which picks an adapter from the URI protocol.

The default is a JSON file under `~/.mcp-z/` (`file+shared://`), written under a lock so several mcp-z servers and the cli can share `.mcp-z/tokens.json` without undoing each other's sign-ins; upgrade them together, because an older one still rewrites the whole file. `file://` (keyv-file) and `memory://` also work with no extra setup.

Any other backend needs its adapter installed alongside this server. Adapters are resolved with `require()`, so a globally installed server finds a globally installed adapter:

```bash
npm install -g @mcp-z/mcp-gmail @keyv/redis

TOKEN_STORE_URI=redis://localhost:6379 mcp-gmail
```

A protocol whose adapter is missing fails at startup naming the package to install. This release uses keyv 6, so adapters you install should be keyv 6 releases (`@keyv/redis` 6). Sign-ins saved by earlier versions are moved to the new format on first start.

## Documentation

[API Docs](https://mcp-z.github.io/mcp-gmail)
