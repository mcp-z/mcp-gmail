import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'assert';
import * as path from 'path';

describe('Gmail MCP Server Component Tests', () => {
  let client: Client;
  let transport: StdioClientTransport;

  before(async () => {
    // Resolve paths relative to server root
    const serverRoot = path.resolve(import.meta.dirname, '../..');
    const envFile = path.join(serverRoot, '.env.test');
    const serverPath = path.join(serverRoot, 'bin/server.js');

    // StdioClientTransport spawns the server automatically
    transport = new StdioClientTransport({
      command: 'node',
      args: [`--env-file=${envFile}`, serverPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      } as Record<string, string>,
    });

    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
  });

  after(async () => {
    await client.close();
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
