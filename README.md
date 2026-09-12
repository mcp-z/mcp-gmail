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

## How to use

```bash
# Start the configured server and list its tools
npx -y @mcp-z/cli inspect --servers gmail --tools

# Call a tool after authorizing Gmail
npx -y @mcp-z/cli call-tool gmail message-search '{"query":"from:alice@example.com"}'
```

## Tools

1. categories-list
2. label-add
3. label-delete
4. labels-list
5. message-get
6. message-mark-read
7. message-move-to-trash
8. message-respond
9. message-search
10. message-send
11. messages-export-csv

## Resources

1. email

## Prompts

1. draft-email
2. query-syntax

## Configuration reference

See [`server.json`](https://github.com/mcp-z/mcp-gmail/blob/master/server.json) for all supported environment variables, CLI arguments, and defaults.

## Storage backends

OAuth tokens (`TOKEN_STORE_URI`) and DCR registrations (`DCR_STORE_URI`) are stored through [keyv-registry](https://www.npmjs.com/package/keyv-registry), which picks an adapter from the URI protocol.

`file://` (the default, under `~/.mcp-z/`) and `memory://` work with no extra setup.

Any other backend needs its adapter installed alongside this server. Adapters are resolved with `require()`, so a globally installed server finds a globally installed adapter:

```bash
npm install -g @mcp-z/mcp-gmail @keyv/redis

TOKEN_STORE_URI=redis://localhost:6379 mcp-gmail
```

A protocol whose adapter is missing fails at startup naming the package to install.

## Documentation

[API Docs](https://mcp-z.github.io/mcp-gmail)
