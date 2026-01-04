import { composeMiddleware, connectHttp, createFileServingRouter, registerPrompts, registerResources, registerTools } from '@mcp-z/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import cors from 'cors';
import express from 'express';
import type { RuntimeOverrides, ServerConfig } from '../types.ts';
import { createDefaultRuntime } from './runtime.ts';

export async function createHTTPServer(config: ServerConfig, overrides?: RuntimeOverrides) {
  const runtime = await createDefaultRuntime(config, overrides);
  const modules = runtime.createDomainModules();
  const layers = runtime.middlewareFactories.map((factory) => factory(runtime.deps));
  const composed = composeMiddleware(modules, layers);
  const logger = runtime.deps.logger;
  const port = config.transport.port;
  if (!port) throw new Error('Port is required for HTTP transport');

  const tools = [...composed.tools, ...runtime.deps.oauthAdapters.accountTools];
  const filteredTools =
    config.auth === 'dcr'
      ? tools.filter((tool) => tool.name !== 'messages-export-csv') // No file storage in DCR (public cloud responsibility)
      : tools;
  const prompts = [...composed.prompts, ...runtime.deps.oauthAdapters.accountPrompts];

  const mcpServer = new McpServer({ name: config.name, version: config.version });
  registerTools(mcpServer, filteredTools);
  registerResources(mcpServer, composed.resources);
  registerPrompts(mcpServer, prompts);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  if (runtime.deps.oauthAdapters.loopbackRouter) {
    app.use('/', runtime.deps.oauthAdapters.loopbackRouter);
    logger.info('Mounted loopback OAuth callback router');
  }

  if (config.auth !== 'dcr') {
    const fileRouter = createFileServingRouter({ resourceStoreUri: config.resourceStoreUri }, { contentType: 'text/csv', contentDisposition: 'attachment' });
    app.use('/files', fileRouter);
  }

  if (runtime.deps.oauthAdapters.dcrRouter) {
    app.use('/', runtime.deps.oauthAdapters.dcrRouter);
    logger.info('Mounted DCR router with OAuth endpoints');
  }

  logger.info(`Starting ${config.name} MCP server (http)`);
  const { close, httpServer } = await connectHttp(mcpServer, { logger, app, port });
  logger.info('http transport ready');

  return {
    httpServer,
    mcpServer,
    logger,
    close: async () => {
      await close();
      await runtime.close();
    },
  };
}
