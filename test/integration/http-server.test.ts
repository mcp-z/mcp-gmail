import '../lib/env-loader.ts';
import { pathToFileURL } from 'node:url';
import type { ServerConfig } from '@mcp-z/mcp-gmail';
import { setup } from '@mcp-z/mcp-gmail';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'assert';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import getPort from 'get-port';
import * as path from 'path';
import { throwFailures } from '../lib/throw-failures.ts';

describe('setup.createHTTPServer - transport initialization', () => {
  const servers: Awaited<ReturnType<typeof setup.createHTTPServer>>[] = [];
  let testContextPath: string;

  const clients: { client: Client; transport: StreamableHTTPClientTransport }[] = [];
  const isolatedEnv = ['TOKEN_STORE_URI', 'DCR_STORE_URI'] as const;
  const inheritedEnv = new Map<string, string | undefined>();

  before(async () => {
    const testId = randomUUID();
    testContextPath = path.join(process.cwd(), '.tmp', `.mcp-z-test-${testId}`);
    fs.mkdirSync(testContextPath, { recursive: true });

    // Runtime stores read these before baseDir; an inherited value would point the suite at real stores.
    for (const key of isolatedEnv) {
      inheritedEnv.set(key, process.env[key]);
      process.env[key] = pathToFileURL(path.join(testContextPath, key === 'TOKEN_STORE_URI' ? 'tokens.json' : 'dcr.json')).href;
    }
  });

  after(async () => {
    // Clients before servers before scratch; every close is attempted and every failure reported.
    const failures: unknown[] = [];
    for (const { client, transport } of clients) {
      // Client.close() owns its transport; close the transport directly only if that fails.
      try {
        await client.close();
      } catch (error) {
        failures.push(error);
        try {
          await transport.close();
        } catch (fallbackError) {
          failures.push(fallbackError);
        }
      }
    }
    for (const result of servers) {
      try {
        await result.close();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const [key, value] of inheritedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      if (testContextPath && fs.existsSync(testContextPath)) safeRmSync(testContextPath, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    throwFailures('HTTP server suite teardown failed', failures);
  });

  /** An owned export under its own resource root, named as the export tool stores files. */
  function writeExport(): { resourceStoreUri: string; storedName: string; bytes: Buffer } {
    const filesDir = path.join(testContextPath, `files-${randomUUID()}`);
    fs.mkdirSync(filesDir, { recursive: true });
    const storedName = `${randomUUID()}~export.csv`;
    const bytes = Buffer.from('id,subject\n1,hello\n');
    fs.writeFileSync(path.join(filesDir, storedName), bytes);
    return { resourceStoreUri: pathToFileURL(filesDir).href, storedName, bytes };
  }

  // Anonymous discovery: no authProvider, so an authorization challenge fails instead of starting consent.
  async function listToolNames(port: number): Promise<string[]> {
    const client = new Client({ name: 'http-server-test', version: '0.0.0-test' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));
    clients.push({ client, transport });
    await client.connect(transport);
    return (await client.listTools()).tools.map((tool) => tool.name);
  }

  it('initializes single HTTP transport with OAuth', async () => {
    const port = await getPort({ host: '127.0.0.1' });
    const config: ServerConfig = {
      name: 'test-server',
      version: '0.0.0-test',
      transport: {
        type: 'http',
        port,
      },
      baseDir: testContextPath,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      headless: true,
      logLevel: 'error',
      auth: 'loopback-oauth',
      resourceStoreUri: pathToFileURL(path.join(testContextPath, 'files')).href,
      repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
    };

    const result = await setup.createHTTPServer(config);
    servers.push(result);

    assert.ok(result.logger, 'Logger should be initialized');
    assert.ok('httpServer' in result && result.httpServer, 'HTTP server should be initialized');
  });

  it('includes logger in server result', async () => {
    const port = await getPort({ host: '127.0.0.1' });
    const config: ServerConfig = {
      name: 'test-server',
      version: '0.0.0-test',
      transport: { type: 'http', port },
      baseDir: testContextPath,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      headless: true,
      logLevel: 'error',
      auth: 'loopback-oauth',
      resourceStoreUri: pathToFileURL(path.join(testContextPath, 'files')).href,
      repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
    };

    const result = await setup.createHTTPServer(config);
    servers.push(result);

    assert.ok(result.logger, 'Result should have logger');
    assert.strictEqual(typeof result.logger.info, 'function', 'Logger should have info method');
    assert.strictEqual(typeof result.logger.error, 'function', 'Logger should have error method');
  });

  it('creates server with MCP server instance', async () => {
    const port = await getPort({ host: '127.0.0.1' });
    const config: ServerConfig = {
      name: 'test-server',
      version: '0.0.0-test',
      transport: { type: 'http', port },
      baseDir: testContextPath,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      headless: true,
      logLevel: 'error',
      auth: 'loopback-oauth',
      resourceStoreUri: pathToFileURL(path.join(testContextPath, 'files')).href,
      repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
    };

    const result = await setup.createHTTPServer(config);
    servers.push(result);

    assert.strictEqual(typeof result.close, 'function', 'Result should have close function');
  });

  it('rejects service account mode without key file', async () => {
    const port = await getPort();
    const config: ServerConfig = {
      name: 'test-server',
      version: '0.0.0-test',
      transport: { type: 'http', port },
      baseDir: testContextPath,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      headless: true,
      logLevel: 'error',
      auth: 'service-account',
      resourceStoreUri: pathToFileURL(path.join(testContextPath, 'files')).href,
      repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
      // Intentionally missing serviceAccountKeyFile
    };

    await assert.rejects(
      async () => await setup.createHTTPServer(config),
      (error: Error) => {
        assert.ok(error.message.includes('Service account key file is required'), `Expected key file error, got: ${error.message}`);
        return true;
      },
      'Should reject service account mode without key file'
    );
  });

  it('serves exported files and advertises export in loopback mode', async () => {
    const { resourceStoreUri, storedName, bytes } = writeExport();
    const port = await getPort({ host: '127.0.0.1' });
    const config: ServerConfig = {
      name: 'test-server',
      version: '0.0.0-test',
      transport: { type: 'http', port },
      baseDir: testContextPath,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      headless: true,
      logLevel: 'error',
      auth: 'loopback-oauth',
      resourceStoreUri,
      repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
    };
    servers.push(await setup.createHTTPServer(config));

    const response = await fetch(`http://localhost:${port}/files/${storedName}`);
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.ok(response.headers.get('content-type')?.startsWith('text/csv'), `content-type: ${response.headers.get('content-type')}`);
    assert.strictEqual(response.headers.get('content-disposition'), 'attachment; filename="export.csv"');

    const tools = await listToolNames(port);
    assert.ok(tools.includes('messages-export-csv'), `tools: ${tools.join(', ')}`);
    assert.ok(tools.includes('message-search'), `tools: ${tools.join(', ')}`);
  });

  it('omits export and does not mount /files in DCR mode', async () => {
    const { resourceStoreUri, storedName } = writeExport();
    const port = await getPort({ host: '127.0.0.1' });
    const config: ServerConfig = {
      name: 'test-server',
      version: '0.0.0-test',
      transport: { type: 'http', port },
      baseDir: testContextPath,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      headless: true,
      logLevel: 'error',
      auth: 'dcr',
      resourceStoreUri,
      repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
    };
    servers.push(await setup.createHTTPServer(config));

    // The same stored file exists on disk, so a mounted router would have served it.
    const response = await fetch(`http://localhost:${port}/files/${storedName}`);
    assert.strictEqual(response.status, 404);

    const tools = await listToolNames(port);
    assert.ok(!tools.includes('messages-export-csv'), `tools: ${tools.join(', ')}`);
    assert.ok(tools.includes('message-search'), `tools: ${tools.join(', ')}`);
  });
});
