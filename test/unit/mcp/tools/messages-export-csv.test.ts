import type { Logger, StorageExtra } from '@mcp-z/mcp-gmail';
import { mcp } from '@mcp-z/mcp-gmail';
import type { EnrichedExtra } from '@mcp-z/oauth-google';
import type { TypedToolResult } from '@mcp-z/server';
import assert from 'assert';
import { existsSync } from 'fs';
import { mkdir, readFile, rm } from 'fs/promises';
import * as path from 'path';
import type { Input, Output } from '../../../../src/mcp/tools/messages-export-csv.ts';
import { createExtra, type TypedHandler } from '../../../lib/create-extra.ts';
import createMiddlewareContext from '../../../lib/create-middleware-context.ts';

describe('Gmail messages export CSV tool (directory creation)', () => {
  let logger: Logger;
  let handler: TypedHandler<Input, EnrichedExtra & StorageExtra>;
  const tmpDir = path.join(process.cwd(), '.tmp');
  const testStorageDir = path.join(tmpDir, 'test-export-storage');
  const _storageContext = {
    resourceStoreUri: `file://${testStorageDir}`,
    baseUrl: 'http://localhost:3000',
    transport: { type: 'http', port: 3000 },
  } as const;
  const stdioStorageContext = {
    resourceStoreUri: `file://${testStorageDir}`,
    transport: { type: 'stdio' },
  } as const;

  before(async () => {
    const middlewareContext = await createMiddlewareContext();
    logger = middlewareContext.logger;
    const middleware = middlewareContext.middleware;

    const tool = mcp.toolFactories.messagesExportCsv();
    const wrappedTool = middleware.withToolAuth(tool);
    handler = wrappedTool.handler;

    // Ensure .tmp directory exists (parent for all test storage)
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    // Clean up entire .tmp directory after all tests
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err }, 'Failed to clean up .tmp directory');
    }
  });

  afterEach(async () => {
    // Clean up test resource store directory after each test
    try {
      await rm(testStorageDir, { recursive: true, force: true });
    } catch (_err) {
      // Ignore errors if directory doesn't exist
    }
  });

  it('creates resource store directory if it does not exist', async () => {
    // Ensure directory doesn't exist before test
    assert.strictEqual(existsSync(testStorageDir), false, 'Resource store directory should not exist initially');

    // Export with minimal query (limit to 1 message for speed)
    const result = await handler(
      {
        query: {},
        maxItems: 1,
        filename: 'test-dir-creation.csv',
        contentType: 'text',
        excludeThreadHistory: false,
      },
      createExtra(stdioStorageContext)
    );

    // Validate success
    const structured = ((result as unknown as TypedToolResult<Output>)?.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
    assert.strictEqual(structured?.type, 'success', 'Expected success result');
    if (structured?.type !== 'success') return;

    // Verify directory was created
    assert.strictEqual(existsSync(testStorageDir), true, 'Resource store directory should have been created');

    // Verify CSV file exists
    const csvPath = path.join(testStorageDir, structured.filename);
    assert.strictEqual(existsSync(csvPath), true, 'CSV file should exist');

    // Verify CSV has content (at least headers)
    const csvContent = await readFile(csvPath, 'utf-8');
    assert.ok(csvContent.includes('id'), 'CSV should contain header with id column');
  });

  it('works when resource store directory already exists', async () => {
    // Pre-create resource store directory
    await mkdir(testStorageDir, { recursive: true });
    assert.strictEqual(existsSync(testStorageDir), true, 'Resource store directory should exist before test');

    // Export with minimal query
    const result = await handler(
      {
        query: {},
        maxItems: 1,
        filename: 'test-existing-dir.csv',
        contentType: 'text',
        excludeThreadHistory: false,
      },
      createExtra(stdioStorageContext)
    );

    // Validate success
    const structured = ((result as unknown as TypedToolResult<Output>)?.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
    assert.strictEqual(structured?.type, 'success', 'Expected success result');
    if (structured?.type !== 'success') return;

    // Verify CSV file exists
    const csvPath = path.join(testStorageDir, structured.filename);
    assert.strictEqual(existsSync(csvPath), true, 'CSV file should exist');
  });

  it('creates parent directories recursively if needed', async () => {
    // Use nested directory path
    const nestedStorageDir = path.join(tmpDir, 'deeply', 'nested', 'storage', 'dir');

    // Ensure nested path doesn't exist
    assert.strictEqual(existsSync(nestedStorageDir), false, 'Nested resource store directory should not exist initially');

    const nestedStorageContext = {
      resourceStoreUri: `file://${nestedStorageDir}`,
      baseUrl: 'http://localhost:3000',
      transport: { type: 'http', port: 3000 },
    } as const;

    const middlewareContext = await createMiddlewareContext();
    logger = middlewareContext.logger;
    const middleware = middlewareContext.middleware;
    logger = middlewareContext.logger;
    const _middleware = middlewareContext.middleware;
    const tool = mcp.toolFactories.messagesExportCsv();
    const wrappedTool = middleware.withToolAuth(tool);
    const nestedHandler = wrappedTool.handler;

    // Export with minimal query
    const result = await nestedHandler(
      {
        query: {},
        maxItems: 1,
        filename: 'test-nested-dirs.csv',
        contentType: 'text',
        excludeThreadHistory: false,
      },
      createExtra(nestedStorageContext)
    );

    try {
      // Validate success
      const structured = ((result as unknown as TypedToolResult<Output>)?.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
      assert.strictEqual(structured?.type, 'success', 'Expected success result');
      if (structured?.type !== 'success') return;

      // Verify all parent directories were created
      assert.strictEqual(existsSync(nestedStorageDir), true, 'Nested resource store directory should have been created');
      assert.strictEqual(existsSync(path.join(tmpDir, 'deeply')), true, 'Parent directory should exist');
      assert.strictEqual(existsSync(path.join(tmpDir, 'deeply', 'nested')), true, 'Grandparent directory should exist');

      // Verify CSV file exists
      const csvPath = path.join(nestedStorageDir, structured.filename);
      assert.strictEqual(existsSync(csvPath), true, 'CSV file should exist in nested directory');
    } finally {
      // Clean up nested directory structure
      await rm(path.join(tmpDir, 'deeply'), { recursive: true, force: true });
    }
  });

  it('exports valid CSV with headers and data', async () => {
    // Pre-create resource store directory
    await mkdir(testStorageDir, { recursive: true });

    // Export with minimal query
    const result = await handler(
      {
        query: { from: 'noreply' }, // Common sender for testing
        maxItems: 5,
        filename: 'test-csv-content.csv',
        contentType: 'text',
        excludeThreadHistory: false,
      },
      createExtra(stdioStorageContext)
    );

    // Validate success
    const structured = ((result as unknown as TypedToolResult<Output>)?.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
    assert.strictEqual(structured?.type, 'success', 'Expected success result');
    if (structured?.type !== 'success') return;
    assert.ok(structured.rowCount >= 0, 'Should have row count');

    // Verify CSV file structure
    const csvPath = path.join(testStorageDir, structured.filename);
    const csvContent = await readFile(csvPath, 'utf-8');
    const lines = csvContent.split('\n').filter((line) => line.trim());

    // Verify header row
    assert.ok(lines.length > 0, 'CSV should have at least header row');
    const headerLine = lines[0];
    assert.ok(headerLine, 'Header line should exist');
    assert.ok(headerLine.includes('id'), 'Header should include id');
    assert.ok(headerLine.includes('subject'), 'Header should include subject');
    assert.ok(headerLine.includes('from'), 'Header should include from');

    // If messages were found, verify data rows
    if (structured.rowCount > 0) {
      assert.ok(lines.length > 1, 'CSV should have data rows when messages found');
    }
  });

  it('returns absolute file:// URI for stdio transport', async () => {
    // Pre-create resource store directory
    await mkdir(testStorageDir, { recursive: true });

    // Export with minimal query
    const result = await handler(
      {
        query: {},
        maxItems: 1,
        filename: 'test-uri-format.csv',
        contentType: 'text',
        excludeThreadHistory: false,
      },
      createExtra(stdioStorageContext)
    );

    // Validate success
    const structured = ((result as unknown as TypedToolResult<Output>)?.structuredContent as { result?: unknown } | undefined)?.result as Output | undefined;
    assert.strictEqual(structured?.type, 'success', 'Expected success result');
    assert.ok(structured, 'structured should be defined');

    if (structured.type !== 'success') {
      assert.fail('Expected success type');
    }

    // Verify URI format
    const uri = structured.uri;
    assert.ok(uri.startsWith('file://'), 'URI should start with file://');
    assert.ok(path.isAbsolute(uri.replace('file://', '')), 'URI should contain absolute path');
    assert.ok(uri.includes(testStorageDir), 'URI should include resource store path');
    assert.ok(uri.includes(structured.filename), 'URI should include filename');

    // Verify file exists at the URI path
    const filePath = uri.replace('file://', '');
    assert.strictEqual(existsSync(filePath), true, 'File should exist at URI path');
  });
});
