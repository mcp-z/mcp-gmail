import assert from 'assert';
import { validateStorageConfig } from '../../../src/setup/runtime.ts';
import type { ServerConfig } from '../../../src/types.ts';

describe('validateStorageConfig (gmail)', () => {
  // TODO: Add exhaustive DCR matrix tests for tool filtering and /files gating.
  it('warns and skips validation in DCR when resourceStoreUri is set', () => {
    const warnings: string[] = [];
    const logger = {
      info: () => {},
      error: () => {},
      warn: (message: string) => warnings.push(message),
      debug: () => {},
    };
    const config: ServerConfig = {
      name: 'test-server',
      version: '0.0.0-test',
      transport: { type: 'http', port: 3000 },
      baseDir: '/tmp',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      headless: true,
      logLevel: 'error',
      auth: 'dcr',
      resourceStoreUri: 'file:///tmp/files',
      repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
    };

    validateStorageConfig(config, logger);

    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0]?.includes('resourceStoreUri'));
  });

  it('skips validation in DCR when resourceStoreUri is empty', () => {
    const warnings: string[] = [];
    const logger = {
      info: () => {},
      error: () => {},
      warn: (message: string) => warnings.push(message),
      debug: () => {},
    };
    const config: ServerConfig = {
      name: 'test-server',
      version: '0.0.0-test',
      transport: { type: 'http', port: 3000 },
      baseDir: '/tmp',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      headless: true,
      logLevel: 'error',
      auth: 'dcr',
      resourceStoreUri: '',
      repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
    };

    validateStorageConfig(config, logger);

    assert.strictEqual(warnings.length, 0);
  });

  it('throws when resourceStoreUri is missing outside DCR', () => {
    const logger = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
    };
    const config: ServerConfig = {
      name: 'test-server',
      version: '0.0.0-test',
      transport: { type: 'http', port: 3000 },
      baseDir: '/tmp',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      headless: true,
      logLevel: 'error',
      auth: 'loopback-oauth',
      resourceStoreUri: '',
      repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
    };

    assert.throws(() => validateStorageConfig(config, logger), {
      message: 'gmail-messages-export-csv: Server configuration missing resourceStoreUri.',
    });
  });

  it('throws when baseUrl and port are missing for HTTP outside DCR', () => {
    const logger = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
    };
    const config: ServerConfig = {
      name: 'test-server',
      version: '0.0.0-test',
      transport: { type: 'http' },
      baseDir: '/tmp',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      headless: true,
      logLevel: 'error',
      auth: 'loopback-oauth',
      resourceStoreUri: 'file:///tmp/files',
      repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
    };

    assert.throws(() => validateStorageConfig(config, logger), {
      message: 'gmail-messages-export-csv: HTTP transport requires either baseUrl in server config or port in transport config. This is a server configuration error - please provide --base-url or --port.',
    });
  });
});
