# @mcp-z/mcp-gmail

Docs: https://mcp-z.github.io/mcp-gmail
Gmail MCP server for searching, reading, and sending mail over MCP.

## Common uses

- Search and read messages
- Send and reply to emails
- Manage labels and export messages to CSV

## Transports

MCP supports stdio and HTTP.

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

## OAuth modes

Configure via environment variables or the `env` block in `.mcp.json`. See `server.json` for the full list of options.

### Loopback OAuth (default)

Environment variables:

```bash
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

Example:
```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@mcp-z/mcp-gmail"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

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

HTTP only. Requires a public base URL.

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
# List tools
mcp-z inspect --servers gmail --tools

# Call a tool
mcp-z call gmail message-search '{"query":"from:alice@example.com"}'
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

See `server.json` for all supported environment variables, CLI arguments, and defaults.
