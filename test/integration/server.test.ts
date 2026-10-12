import '../lib/env-loader.ts';
import { createServerRegistry, type ManagedClient, type ServerRegistry } from '@mcp-z/client';
import assert from 'assert';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { throwFailures } from '../lib/throw-failures.ts';

describe('Gmail MCP Server Component Tests', () => {
  let client: ManagedClient;
  let registry: ServerRegistry | undefined;
  let projectDir: string | undefined;
  let spawnAttempted = false;

  before(async () => {
    const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const serverPath = path.join(serverRoot, 'bin/server.js');

    // The server places .mcp-z/ (logs, stores) beside the .mcp.json it discovers from its cwd.
    projectDir = path.join(serverRoot, '.tmp', `server-test-${randomUUID()}`);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.mcp.json'), '{ "mcpServers": {} }\n');
    const stateDir = path.join(projectDir, '.mcp-z');

    spawnAttempted = true;
    registry = createServerRegistry(
      {
        server: {
          command: process.execPath,
          args: [serverPath],
          env: {
            NODE_ENV: 'test',
            TOKEN_STORE_URI: pathToFileURL(path.join(stateDir, 'tokens.json')).href,
            DCR_STORE_URI: pathToFileURL(path.join(stateDir, 'dcr.json')).href,
            RESOURCE_STORE_URI: pathToFileURL(path.join(stateDir, 'files')).href,
          },
        },
      },
      { cwd: projectDir }
    );
    client = await registry.connect('server');
  });

  after(async () => {
    const failures: unknown[] = [];
    // registry.close() owns the client and the child; only a resolved close proves the child has exited.
    let childClosed = !spawnAttempted;
    if (registry) {
      try {
        const result = await registry.close();
        childClosed = true;
        assert.deepStrictEqual({ timedOut: result.timedOut, killedCount: result.killedCount }, { timedOut: false, killedCount: 0 }, 'Server should shut down cooperatively');
      } catch (error) {
        failures.push(error);
      }
    }
    if (projectDir && childClosed) {
      try {
        safeRmSync(projectDir, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    } else if (projectDir) {
      failures.push(new Error(`Server closure unconfirmed; retained scratch ${projectDir}`));
    }
    throwFailures('Server test teardown failed', failures);
  });

  describe('MCP Protocol Component Testing', () => {
    it('should respond to MCP tools/list request', async () => {
      const result = await client.listTools();

      assert(Array.isArray(result.tools), 'Should return tools array');
      assert(result.tools.length > 0, 'Should have at least one tool');
    });

    it('should respond to MCP prompts/list request', async () => {
      // Note: MCP SDK only exposes prompts/list if at least one prompt is registered.
      // Gmail currently has all prompts disabled, so this method won't be available.
      try {
        const result = await client.listPrompts();
        assert(Array.isArray(result.prompts) || result.prompts === undefined, 'Should return prompts array or undefined');
      } catch (error: unknown) {
        // When no prompts are registered, MCP SDK returns -32601 (Method not found)
        // This is expected behavior and indicates the server correctly doesn't expose
        // prompts capability when no prompts are available.
        if (error && typeof error === 'object' && 'code' in error) {
          assert.strictEqual(error.code, -32601, 'Should return Method not found when no prompts registered');
        } else {
          throw error;
        }
      }
    });

    it('should respond to MCP resources/list request', async () => {
      const result = await client.listResources();

      assert(Array.isArray(result.resources), 'Should return resources array');
    });

    it('should have expected Gmail tools available', async () => {
      const result = await client.listTools();

      const toolNames = result.tools.map((tool) => tool.name);

      // Expected Gmail tools based on servers/mcp-gmail/src/mcp/tools/index.ts
      const expectedTools = ['label-add', 'label-delete', 'message-get', 'message-mark-read', 'message-move-to-trash', 'message-respond', 'message-search', 'message-send'];

      // Verify each expected tool is registered
      for (const expectedTool of expectedTools) {
        assert(toolNames.includes(expectedTool), `Should have ${expectedTool} tool registered`);
      }
    });

    it('should have properly configured tool schemas', async () => {
      const result = await client.listTools();

      // Verify each tool has required MCP schema fields
      for (const tool of result.tools) {
        assert(typeof tool.name === 'string', `Tool ${tool.name} should have string name`);
        assert(typeof tool.description === 'string', `Tool ${tool.name} should have string description`);
        assert(typeof tool.inputSchema === 'object', `Tool ${tool.name} should have inputSchema object`);

        // Verify inputSchema is properly structured
        const inputSchema = tool.inputSchema;
        assert.strictEqual(inputSchema.type, 'object', `Tool ${tool.name} inputSchema should be object type`);
        assert(typeof inputSchema.properties === 'object', `Tool ${tool.name} should have properties in inputSchema`);
      }
    });
  });

  describe('Component Health and Status', () => {
    it('should be accessible as a single component', async () => {
      // Simple health check - any successful MCP response indicates the server is running
      const result = await client.listTools();

      // Any valid MCP response means the server is accessible
      assert(result.tools, 'Should return tools from MCP server');
    });
  });
});
