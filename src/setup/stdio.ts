import { composeMiddleware, connectStdio, McpServer, registerPrompts, registerResources, registerTools } from '@mcp-z/server';
import type { RuntimeOverrides, ServerConfig } from '../types.ts';
import { createDefaultRuntime } from './runtime.ts';

export async function createStdioServer(config: ServerConfig, overrides?: RuntimeOverrides) {
  const runtime = await createDefaultRuntime(config, overrides);
  const modules = runtime.createDomainModules();
  const layers = runtime.middlewareFactories.map((factory) => factory(runtime.deps));
  const composed = composeMiddleware(modules, layers);
  const logger = runtime.deps.logger;

  const tools = [...composed.tools, ...runtime.deps.oauthAdapters.accountTools];
  const filteredTools =
    config.auth === 'dcr'
      ? tools.filter((tool) => tool.name !== 'messages-export-csv') // No file storage in DCR (public cloud responsibility)
      : tools;
  const prompts = [...composed.prompts, ...runtime.deps.oauthAdapters.accountPrompts];

  // Built per request (HTTP) and per connection (stdio), not shared. The SDK caches the
  // negotiated protocol revision on the McpServer instance - its own docs say a negotiated
  // session never re-routes a method onto the other era - so one shared instance pins itself
  // to whichever revision reaches it first and answers the other with -32601.
  const buildServer = () => {
    const mcpServer = new McpServer({ name: config.name, version: config.version });
    registerTools(mcpServer, filteredTools);
    registerResources(mcpServer, composed.resources);
    registerPrompts(mcpServer, prompts);
    return mcpServer;
  };

  logger.info(`Starting ${config.name} MCP server (stdio)`);
  const { close } = await connectStdio(buildServer, { logger });
  logger.info('stdio transport ready');

  return {
    logger,
    close: async () => {
      await close();
      await runtime.close();
    },
  };
}
