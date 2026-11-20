import '../lib/env-loader.ts';
import { pathToFileURL } from 'node:url';
import type { ServerConfig } from '@mcp-z/mcp-gmail';
import { setup } from '@mcp-z/mcp-gmail';
import { dcrUtils } from '@mcp-z/oauth';
import { Client as ModernClient, StreamableHTTPClientTransport as ModernTransport, type OAuthClientProvider, UnauthorizedError } from '@modelcontextprotocol/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'assert';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import getPort from 'get-port';
import * as path from 'path';
import createStore from '../../src/lib/create-store.ts';
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

  // A DCR store holding one access token whose provider tokens never reach Google.
  const TOKEN = 'seeded-dcr-token';
  async function seedDcrStore(): Promise<string> {
    const dcrFile = pathToFileURL(path.join(testContextPath, `dcr-${randomUUID()}.json`)).href;
    const seed = await createStore<unknown>(dcrFile);
    await dcrUtils.setAccessToken(seed as never, TOKEN, {
      access_token: TOKEN,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid',
      client_id: 'seeded-client',
      providerTokens: { accessToken: 'never-sent-to-google', expiresAt: Date.now() + 3600_000 },
      created_at: Date.now(),
    } as never);
    await seed.disconnect();
    return dcrFile;
  }

  // No authProvider, so an authorization challenge fails instead of starting consent; DCR servers need a bearer token.
  async function listToolNames(port: number, bearerToken?: string): Promise<string[]> {
    const client = new Client({ name: 'http-server-test', version: '0.0.0-test' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`), bearerToken ? { requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } } } : undefined);
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
    const dcrFile = await seedDcrStore();
    const savedDcrStore = process.env.DCR_STORE_URI;
    process.env.DCR_STORE_URI = dcrFile;
    try {
      servers.push(await setup.createHTTPServer(config));
    } finally {
      if (savedDcrStore === undefined) delete process.env.DCR_STORE_URI;
      else process.env.DCR_STORE_URI = savedDcrStore;
    }

    // The same stored file exists on disk, so a mounted router would have served it.
    const response = await fetch(`http://localhost:${port}/files/${storedName}`);
    assert.strictEqual(response.status, 404);

    const tools = await listToolNames(port, TOKEN);
    assert.ok(!tools.includes('messages-export-csv'), `tools: ${tools.join(', ')}`);
    assert.ok(tools.includes('message-search'), `tools: ${tools.join(', ')}`);
  });

  describe('DCR bearer gate', () => {
    const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' };
    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-server-test', version: '0.0.0-test' } } };

    // A DCR server on loopback with its own stores holding one access token that never reaches Google.
    async function startDcrServer(): Promise<{ base: string }> {
      const port = await getPort({ host: '127.0.0.1' });
      const base = `http://127.0.0.1:${port}`;
      const dcrFile = await seedDcrStore();

      const saved = process.env.DCR_STORE_URI;
      process.env.DCR_STORE_URI = dcrFile;
      try {
        const config: ServerConfig = {
          name: 'test-server',
          version: '0.0.0-test',
          transport: { type: 'http', port },
          baseDir: testContextPath,
          baseUrl: base,
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          headless: true,
          logLevel: 'error',
          auth: 'dcr',
          resourceStoreUri: pathToFileURL(path.join(testContextPath, 'files')).href,
          repositoryUrl: 'https://github.com/mcp-z/mcp-gmail',
        };
        servers.push(await setup.createHTTPServer(config));
      } finally {
        if (saved === undefined) delete process.env.DCR_STORE_URI;
        else process.env.DCR_STORE_URI = saved;
      }
      return { base };
    }

    const post = (base: string, body: unknown, authorization?: string) => fetch(`${base}/mcp`, { method: 'POST', headers: { ...MCP_HEADERS, ...(authorization && { authorization }) }, body: JSON.stringify(body) });

    it('answers 401 with a resource_metadata challenge when there is no token', async () => {
      const { base } = await startDcrServer();
      const response = await post(base, initialize);
      assert.strictEqual(response.status, 401);
      const challenge = response.headers.get('www-authenticate') ?? '';
      assert.ok(challenge.includes(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`), challenge);
    });

    it('answers 401 invalid_token for an unknown token', async () => {
      const { base } = await startDcrServer();
      const response = await post(base, initialize, 'Bearer not-a-real-token');
      assert.strictEqual(response.status, 401);
      assert.ok((response.headers.get('www-authenticate') ?? '').includes('error="invalid_token"'));
    });

    for (const [label, mode] of [
      ['a legacy client', 'legacy'],
      ['a 2026-07-28 client', { pin: '2026-07-28' }],
    ] as const) {
      it(`lists tools for ${label} holding a seeded token`, async () => {
        const { base } = await startDcrServer();
        const client = new ModernClient({ name: 'http-server-test', version: '0.0.0-test' }, { versionNegotiation: { mode } });
        const transport = new ModernTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });
        try {
          await client.connect(transport);
          const { tools } = await client.listTools();
          assert.ok(tools.some((tool) => tool.name === 'message-search'));
        } finally {
          await client.close();
        }
      });
    }

    it('sends an SDK client without a token to the authorization endpoint without opening it', async () => {
      const { base } = await startDcrServer();
      let authorizationUrl: URL | undefined;
      let registered: { client_id: string } | undefined;
      let verifier: string | undefined;
      const redirectUrl = 'http://127.0.0.1:53682/callback';
      const provider: OAuthClientProvider = {
        redirectUrl,
        clientMetadata: { client_name: 'http-server-test', redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
        clientInformation: () => registered,
        saveClientInformation: (info) => {
          registered = info as { client_id: string };
        },
        tokens: () => undefined,
        saveTokens: () => {},
        redirectToAuthorization: (url) => {
          authorizationUrl = url;
        },
        saveCodeVerifier: (value) => {
          verifier = value;
        },
        codeVerifier: () => verifier as string,
      };
      const client = new ModernClient({ name: 'http-server-test', version: '0.0.0-test' });
      try {
        await assert.rejects(client.connect(new ModernTransport(new URL(`${base}/mcp`), { authProvider: provider })), UnauthorizedError);
      } finally {
        await client.close();
      }
      assert.ok(authorizationUrl, 'redirectToAuthorization was reached');
      assert.strictEqual(`${authorizationUrl.origin}${authorizationUrl.pathname}`, `${base}/oauth/authorize`);
    });
  });
});
