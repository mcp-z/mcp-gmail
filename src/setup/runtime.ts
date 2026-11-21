import { pathToFileURL } from 'node:url';
import { sanitizeForLoggingFormatter } from '@mcp-z/oauth';
import type { CachedToken } from '@mcp-z/oauth-google';
import type { Logger, MiddlewareLayer } from '@mcp-z/server';
import { createLoggingMiddleware } from '@mcp-z/server';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import { SHARED_FILE_PROTOCOL } from '../constants.ts';
import createStore from '../lib/create-store.ts';
import * as mcp from '../mcp/index.ts';
import type { CommonRuntime, RuntimeDeps, RuntimeOverrides, ServerConfig, StorageContext } from '../types.ts';
import { createOAuthAdapters, type OAuthAdapters } from './oauth-google.ts';

export function createLogger(config: ServerConfig): Logger {
  const hasStdio = config.transport.type === 'stdio';
  const logsPath = path.join(config.baseDir, 'logs', `${config.name}.log`);
  if (hasStdio) fs.mkdirSync(path.dirname(logsPath), { recursive: true });
  return pino({ level: config.logLevel ?? 'info', formatters: sanitizeForLoggingFormatter() }, hasStdio ? pino.destination({ dest: logsPath, sync: true }) : pino.destination(1));
}

// Several mcp-z processes share these files, so the default store merges each write under a lock.
function sharedFileUri(file: string): string {
  return pathToFileURL(file).href.replace(/^file:/, SHARED_FILE_PROTOCOL);
}

export async function createTokenStore(baseDir: string, logger?: Logger) {
  const tokenStoreUri = process.env.TOKEN_STORE_URI || sharedFileUri(path.join(baseDir, 'tokens.json'));
  return createStore<CachedToken>(tokenStoreUri, logger);
}

export async function createDcrStore(baseDir: string, required: boolean, logger?: Logger, storeUri?: string) {
  if (!required) return undefined;
  const dcrStoreUri = storeUri || process.env.DCR_STORE_URI || sharedFileUri(path.join(baseDir, 'dcr.json'));
  return createStore<unknown>(dcrStoreUri, logger);
}

export function createAuthLayer(authMiddleware: OAuthAdapters['middleware']): MiddlewareLayer {
  return {
    withTool: authMiddleware.withToolAuth,
    withResource: authMiddleware.withResourceAuth,
    withPrompt: authMiddleware.withPromptAuth,
  };
}

export function createLoggingLayer(logger: Logger): MiddlewareLayer {
  const logging = createLoggingMiddleware({ logger });
  return {
    withTool: logging.withToolLogging,
    withResource: logging.withResourceLogging,
    withPrompt: logging.withPromptLogging,
  };
}

export function createStorageLayer(storageContext: StorageContext): MiddlewareLayer {
  const wrapAtPosition = <T extends { name: string; handler: unknown; [key: string]: unknown }>(module: T, extraPosition: number): T => {
    const originalHandler = module.handler as (...args: unknown[]) => Promise<unknown>;

    const wrappedHandler = async (...allArgs: unknown[]) => {
      const extra = allArgs[extraPosition];
      (extra as { storageContext?: StorageContext }).storageContext = storageContext;
      return await originalHandler(...allArgs);
    };

    return {
      ...module,
      handler: wrappedHandler,
    } as T;
  };

  return {
    withTool: <T extends { name: string; config: unknown; handler: unknown }>(module: T): T => wrapAtPosition(module, 1) as T,
  };
}

export function validateStorageConfig(config: ServerConfig, logger: Logger) {
  if (config.auth === 'dcr') {
    if (config.resourceStoreUri) {
      logger.warn('DCR mode does not support file storage; resourceStoreUri will be ignored.');
    }
    return;
  }
  if (!config.resourceStoreUri) {
    throw new Error('gmail-messages-export-csv: Server configuration missing resourceStoreUri.');
  }
  if (config.transport.type === 'http' && !config.baseUrl && !config.transport.port) {
    throw new Error('gmail-messages-export-csv: HTTP transport requires either baseUrl in server config or port in transport config. This is a server configuration error - please provide --base-url or --port.');
  }
}

export async function createDefaultRuntime(config: ServerConfig, overrides?: RuntimeOverrides): Promise<CommonRuntime> {
  if (config.auth === 'dcr' && config.transport.type !== 'http') throw new Error('DCR mode requires an HTTP transport');

  const logger = createLogger(config);
  validateStorageConfig(config, logger);
  const tokenStore = await createTokenStore(config.baseDir, logger);
  const baseUrl = config.baseUrl ?? (config.transport.type === 'http' && config.transport.port ? `http://localhost:${config.transport.port}` : undefined);
  const dcrStore = await createDcrStore(config.baseDir, config.auth === 'dcr', logger, config.dcrConfig?.storeUri);
  const oauthAdapters = await createOAuthAdapters(config, { logger, tokenStore, dcrStore }, baseUrl);
  const deps: RuntimeDeps = { config, logger, tokenStore, oauthAdapters, baseUrl };
  const createDomainModules =
    overrides?.createDomainModules ??
    (() => ({
      tools: Object.values(mcp.toolFactories).map((factory) => factory()),
      resources: Object.values(mcp.resourceFactories).map((factory) => factory()),
      prompts: Object.values(mcp.promptFactories).map((factory) => factory()),
    }));
  const middlewareFactories = overrides?.middlewareFactories ?? [() => createAuthLayer(oauthAdapters.middleware), () => createLoggingLayer(logger), ...(config.auth === 'dcr' ? [] : [() => createStorageLayer({ resourceStoreUri: config.resourceStoreUri, baseUrl: config.baseUrl, transport: config.transport })])];

  return {
    deps,
    middlewareFactories,
    createDomainModules,
    close: async () => {},
  };
}
