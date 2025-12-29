/**
 * Gmail Server Spawn Integration Test
 *
 * Pattern:
 * 1. Use createServerRegistry() to spawn Gmail server
 * 2. Use unique server name for test isolation
 * 3. Use registry.connect() for connection
 * 4. Verify MCP communication
 * 5. Use registry.close() for graceful close
 */

import { createServerRegistry, type ManagedClient, type ServerRegistry } from '@mcp-z/client';
import assert from 'assert';

describe('Gmail Server Spawn Integration', () => {
  let client: ManagedClient;
  let _registry: ServerRegistry;

  before(async () => {
    // Spawn Gmail server using createServerRegistry
    _registry = createServerRegistry(
      {
        gmail: {
          command: 'node',
          args: ['bin/server.js', '--headless'],
          env: {
            NODE_ENV: 'test',
            GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
            GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
            HEADLESS: 'true',
            LOG_LEVEL: 'error',
          },
        },
      },
      { cwd: process.cwd() }
    );

    // Connect MCP client
    client = await _registry.connect('gmail');
  });

  after(async () => {
    if (client) {
      await client.close();
    }

    if (_registry) {
      await _registry.close();
    }
  });

  it('should connect to Gmail server', async () => {
    // Client is already connected via connect() in before hook
    assert.ok(client, 'Should have connected Gmail client');
  });

  it('should list tools via MCP protocol', async () => {
    // List tools using connected client
    const result = await client.listTools();

    assert.ok(result.tools, 'Should return tools');
    assert.ok(result.tools.length > 0, 'Should have at least one tool');

    // Verify specific tools exist
    const includes = (name: string) => result.tools.some((t) => t.name.includes(name));
    assert.ok(includes('message-search'), 'Should have message-search tool');
    assert.ok(includes('message-get'), 'Should have message-get tool');
    assert.ok(includes('message-send'), 'Should have message-send tool');
    assert.ok(includes('labels-list'), 'Should have labels-list tool');
  });
});
