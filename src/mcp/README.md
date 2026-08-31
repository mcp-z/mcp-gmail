# MCP Components: Unified Authentication Pattern

Docs: https://mcp-z.github.io/mcp-gmail This directory contains MCP component implementations (tools, resources, prompts) for Gmail.

## Unified Middleware Pattern

All MCP components (tools, resources, and prompts) receive the `RequestHandlerExtra` parameter from the MCP SDK, allowing consistent middleware-based authentication across all component types.

### Tools

**Handler Signature:**
```typescript
type ToolHandler<A extends AnyArgs = AnyArgs> = (
  argsOrExtra: A | RequestHandlerExtra,
  maybeExtra?: RequestHandlerExtra
) => Promise<CallToolResult>;
```

**Authentication Implementation:**
```typescript
export default function createTool() {
  const handler = async (args: In, extra: EnrichedExtra): Promise<CallToolResult> => {
    // Middleware enriches extra with authContext and logger
    const { auth } = extra.authContext;
    const { logger } = extra;

    const gmail = google.gmail({ version: 'v1', auth });
    // ...
  };

  return {
    name: 'message-search',
    config,
    handler,
  } satisfies ToolModule;
}
```

### Resources

**Handler Signature:**
```typescript
type ReadResourceTemplateCallback = (
  uri: URL,
  variables: Variables,
  extra: RequestHandlerExtra  // ✅ Third parameter
) => ReadResourceResult | Promise<ReadResourceResult>;
```

**Authentication Implementation:**
```typescript
export default function createResource(): ResourceModule {
  const handler = async (uri: URL, variables: { id: string }, extra: EnrichedExtra): Promise<ReadResourceResult> => {
    try {
      // Middleware enriches extra with authContext and logger
      const { auth } = extra.authContext;
      const { logger } = extra;

      const gmail = google.gmail({ version: 'v1', auth });
      const message = await gmail.users.messages.get({ userId: 'me', id: variables.id });

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(message.data)
        }]
      };
    } catch (e) {
      logger.error(e as Record<string, unknown>, 'resource fetch failed');
      const error = asError(e);
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ error: error.message })
        }]
      };
    }
  };

  return {
    name: 'email',
    template,
    config,
    handler,
  };
}
```

### Prompts

**Handler Signature:**
```typescript
type PromptHandler = (
  args: { [x: string]: unknown },
  extra: RequestHandlerExtra  // ✅ Second parameter
) => Promise<GetPromptResult>;
```

**Implementation:**
```typescript
export default function createPrompt(): PromptModule {
  const handler = async (args: { [x: string]: unknown }, extra: RequestHandlerExtra) => {
    const { data, goal } = argsSchema.parse(args);
    return {
      messages: [
        { role: 'system', content: { type: 'text', text: '...' } },
        { role: 'user', content: { type: 'text', text: `...` } },
      ],
    };
  };

  return { name: 'data-analyze-data', config, handler };
}
```

## Unified Registration Pattern

All components follow the same pattern:

```typescript
const { middleware: authMiddleware } = oauthAdapters;

// All components wrapped with auth middleware using same pattern
const tools = Object.values(toolFactories)
  .map((f) => f())
  .map(authMiddleware.withToolAuth);

const resources = Object.values(resourceFactories)
  .map((x) => x())
  .map(authMiddleware.withResourceAuth);

const prompts = Object.values(promptFactories)
  .map((x) => x())
  .map(authMiddleware.withPromptAuth);

registerTools(mcpServer, tools);
registerResources(mcpServer, resources);
registerPrompts(mcpServer, prompts);
```

## Key Principles

1. **Unified Pattern**: All components use middleware for cross-cutting concerns
2. **Type Safety**: Middleware enriches `extra` with `authContext` and `logger`
3. **Lazy Authentication**: Auth only happens when requests come in
4. **Server Startup**: Servers can start without accounts configured
5. **Account Management**: `{service}-account-switch` tools work correctly at runtime

## See Also

- @mcp-z/oauth-google
