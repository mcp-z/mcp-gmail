import '../../lib/env-loader.ts';
import { setup } from '@mcp-z/mcp-gmail';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

describe('setup.parseConfig', () => {
  const baseEnv = {
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
  };

  describe('Basic OAuth configuration', () => {
    it('parses config with all OAuth environment variables', () => {
      const config = setup.parseConfig([], baseEnv);

      assert.strictEqual(config.clientId, 'test-client-id');
      assert.strictEqual(config.clientSecret, 'test-client-secret');
      assert.strictEqual(config.auth, 'loopback-oauth');
    });

    it('parses config with optional client secret omitted', () => {
      const env = {
        GOOGLE_CLIENT_ID: 'test-client-id',
      };

      const config = setup.parseConfig([], env);

      assert.strictEqual(config.clientId, 'test-client-id');
      assert.strictEqual(config.clientSecret, undefined);
    });
  });

  describe('Authentication modes', () => {
    it('parses --auth=loopback-oauth', () => {
      const config = setup.parseConfig(['--auth=loopback-oauth'], baseEnv);

      assert.strictEqual(config.auth, 'loopback-oauth');
      assert.strictEqual(config.dcrConfig, undefined);
    });

    it('parses --auth=service-account', () => {
      const env = {
        ...baseEnv,
        GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/path/to/key.json',
      };

      const config = setup.parseConfig(['--auth=service-account'], env);

      assert.strictEqual(config.auth, 'service-account');
      assert.strictEqual(config.dcrConfig, undefined);
    });
  });

  describe('DCR mode configuration', () => {
    describe('Self-hosted DCR mode', () => {
      it('parses DCR mode with self-hosted configuration', () => {
        const env = {
          ...baseEnv,
          DCR_MODE: 'self-hosted',
          DCR_STORE_URI: 'file://.dcr.json',
        };

        const config = setup.parseConfig(['--auth=dcr'], env);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.mode, 'self-hosted');
        assert.strictEqual(config.dcrConfig.storeUri, 'file://.dcr.json');
        assert.strictEqual(config.dcrConfig.verifyUrl, undefined);
        assert.strictEqual(config.dcrConfig.clientId, 'test-client-id');
      });

      it('parses DCR mode with CLI --dcr-store-uri', () => {
        const config = setup.parseConfig(['--auth=dcr', '--dcr-store-uri=file://custom-path/store.json'], baseEnv);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.mode, 'self-hosted');
        assert.strictEqual(config.dcrConfig.storeUri, 'file://custom-path/store.json');
      });
    });

    describe('External DCR mode is refused with --auth=dcr', () => {
      const notSupported = { name: 'Error', message: /^external DCR mode is not supported/ };
      const verifyUrlNotSupported = { name: 'Error', message: /DCR_VERIFY_URL is not supported/ };

      it('refuses DCR_MODE=external', () => {
        assert.throws(() => setup.parseConfig(['--auth=dcr'], { ...baseEnv, DCR_MODE: 'external', DCR_VERIFY_URL: 'https://auth.example.com/oauth/verify' }), notSupported);
      });

      it('refuses --dcr-mode=external', () => {
        assert.throws(() => setup.parseConfig(['--auth=dcr', '--dcr-mode=external'], { ...baseEnv, DCR_VERIFY_URL: 'https://auth.example.com/oauth/verify' }), notSupported);
      });

      it('refuses external mode without a verify URL with the same error', () => {
        assert.throws(() => setup.parseConfig(['--auth=dcr'], { ...baseEnv, DCR_MODE: 'external' }), notSupported);
      });

      it('refuses --dcr-mode=external over DCR_MODE=self-hosted', () => {
        assert.throws(() => setup.parseConfig(['--auth=dcr', '--dcr-mode=external'], { ...baseEnv, DCR_MODE: 'self-hosted', DCR_STORE_URI: 'file://.dcr.json' }), notSupported);
      });

      it('refuses --dcr-verify-url', () => {
        assert.throws(() => setup.parseConfig(['--auth=dcr', '--dcr-verify-url=https://new.example.com/verify'], baseEnv), verifyUrlNotSupported);
      });

      it('refuses DCR_VERIFY_URL', () => {
        assert.throws(() => setup.parseConfig(['--auth=dcr'], { ...baseEnv, DCR_VERIFY_URL: 'https://old.example.com/verify' }), verifyUrlNotSupported);
      });

      it('does not refuse stale external settings outside --auth=dcr', () => {
        const config = setup.parseConfig(['--auth=loopback-oauth'], { ...baseEnv, DCR_MODE: 'external', DCR_VERIFY_URL: 'https://auth.example.com/oauth/verify' });
        assert.strictEqual(config.auth, 'loopback-oauth');
        assert.strictEqual(config.dcrConfig, undefined);
      });
    });

    describe('DCR mode defaults', () => {
      it('defaults to self-hosted mode when DCR_MODE not specified', () => {
        const config = setup.parseConfig(['--auth=dcr'], { ...baseEnv, DCR_STORE_URI: 'file://.dcr.json' });

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.mode, 'self-hosted');
        assert.strictEqual(config.dcrConfig.storeUri, 'file://.dcr.json');
      });

      it('accepts --dcr-mode=self-hosted given explicitly', () => {
        const config = setup.parseConfig(['--auth=dcr', '--dcr-mode=self-hosted'], baseEnv);
        assert.strictEqual(config.dcrConfig?.mode, 'self-hosted');
      });
    });

    describe('DCR CLI overrides', () => {
      it('CLI --dcr-store-uri overrides DCR_STORE_URI env var', () => {
        const env = {
          ...baseEnv,
          DCR_MODE: 'self-hosted',
          DCR_STORE_URI: 'file://old-path/store.json',
        };

        const config = setup.parseConfig(['--auth=dcr', '--dcr-store-uri=file://new-path/store.json'], env);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.storeUri, 'file://new-path/store.json');
      });
    });

    describe('Invalid DCR mode', () => {
      const invalid = { name: 'Error', message: 'Invalid DCR mode "invalid": only self-hosted is supported' };

      it('throws error for invalid --dcr-mode value', () => {
        assert.throws(() => setup.parseConfig(['--auth=dcr', '--dcr-mode=invalid'], baseEnv), invalid);
      });

      it('throws error for invalid DCR_MODE env var', () => {
        assert.throws(() => setup.parseConfig(['--auth=dcr'], { ...baseEnv, DCR_MODE: 'invalid' }), invalid);
      });
    });
  });

  it('defaults to stdio transport with no args or env', () => {
    const config = setup.parseConfig([], baseEnv);

    assert.strictEqual(config.transport.type, 'stdio');
  });

  describe('Server configuration', () => {
    it('includes server metadata', () => {
      const config = setup.parseConfig([], baseEnv);

      assert.ok(config.name);
      assert.ok(config.version);
      assert.ok(config.repositoryUrl);
      assert.ok(config.baseDir);
      assert.ok(config.resourceStoreUri);
    });

    it('parses transport configuration', () => {
      const config = setup.parseConfig([], baseEnv);

      assert.ok(config.transport);
      assert.strictEqual(config.transport.type, 'stdio');
    });

    it('parses --port for HTTP transport', () => {
      const config = setup.parseConfig(['--port=3456'], baseEnv);

      assert.strictEqual(config.transport.type, 'http');
      assert.strictEqual(config.transport.port, 3456);
    });
  });

  it('defaults headless to true for tests', () => {
    const env = {
      ...baseEnv,
      HEADLESS: 'true',
    };

    const config = setup.parseConfig([], env);

    assert.strictEqual(config.headless, true);
  });

  it('uses --headless CLI arg to override env var', () => {
    const env = {
      ...baseEnv,
      HEADLESS: 'false',
    };

    const config = setup.parseConfig(['--headless'], env);

    assert.strictEqual(config.headless, true);
  });

  it('parses config from env object parameter', () => {
    const config = setup.parseConfig([], baseEnv);

    assert.strictEqual(config.clientId, 'test-client-id');
    assert.strictEqual(config.clientSecret, 'test-client-secret');
  });

  it('uses empty array for args when no CLI arguments provided', () => {
    const config = setup.parseConfig([], baseEnv);

    assert.strictEqual(config.transport.type, 'stdio');
  });

  it('parses HTTP port from CLI --port flag', () => {
    const config = setup.parseConfig(['--port=4000'], baseEnv);

    assert.strictEqual(config.transport.type, 'http');
    assert.strictEqual(config.transport.port, 4000);
    assert.strictEqual(config.auth, 'loopback-oauth');
    assert.strictEqual(config.redirectUri, undefined);
  });

  it('parses HTTP port from PORT env var', () => {
    const env = {
      ...baseEnv,
      PORT: '4000',
    };

    const config = setup.parseConfig([], env);

    assert.strictEqual(config.transport.type, 'http');
    assert.strictEqual(config.transport.port, 4000);
    assert.strictEqual(config.auth, 'loopback-oauth');
    assert.strictEqual(config.redirectUri, undefined);
  });

  it('CLI --port flag overrides PORT env var', () => {
    const env = {
      ...baseEnv,
      PORT: '4000',
    };

    const config = setup.parseConfig(['--port=5000'], env);

    assert.strictEqual(config.transport.type, 'http');
    assert.strictEqual(config.transport.port, 5000);
    assert.strictEqual(config.redirectUri, undefined);
  });

  it('parses --redirect-uri when explicitly provided', () => {
    const config = setup.parseConfig(['--redirect-uri=https://example.com/callback'], baseEnv);

    assert.strictEqual(config.redirectUri, 'https://example.com/callback');
  });

  it('parses --stdio explicitly', () => {
    const config = setup.parseConfig(['--stdio'], baseEnv);

    assert.strictEqual(config.transport.type, 'stdio');
  });

  it('defaults to loopback-oauth auth mode', () => {
    const config = setup.parseConfig([], baseEnv);

    assert.strictEqual(config.auth, 'loopback-oauth');
  });

  it('defaults to loopback-oauth auth mode', () => {
    const config = setup.parseConfig([], baseEnv);

    assert.strictEqual(config.auth, 'loopback-oauth');
  });

  it('defaults logLevel to info', () => {
    const config = setup.parseConfig([], baseEnv);

    assert.strictEqual(config.logLevel, 'info');
  });

  it('parses LOG_LEVEL from env', () => {
    const env = {
      ...baseEnv,
      LOG_LEVEL: 'debug',
    };

    const config = setup.parseConfig([], env);

    assert.strictEqual(config.logLevel, 'debug');
  });

  it('parses --log-level from CLI', () => {
    const config = setup.parseConfig(['--log-level=error'], baseEnv);

    assert.strictEqual(config.logLevel, 'error');
  });

  it('CLI --log-level overrides LOG_LEVEL env var', () => {
    const env = {
      ...baseEnv,
      LOG_LEVEL: 'debug',
    };

    const config = setup.parseConfig(['--log-level=warn'], env);

    assert.strictEqual(config.logLevel, 'warn');
  });

  describe('server.json resource store entries', () => {
    type Entry = { name?: string; value?: string; default?: string; placeholder?: string };
    const manifest = JSON.parse(fs.readFileSync(path.resolve('server.json'), 'utf8')) as { packages: { transport: { type: string }; environmentVariables: Entry[]; packageArguments: Entry[] }[] };
    const storeEntries = manifest.packages.flatMap((p) => [...p.environmentVariables, ...p.packageArguments].filter((e) => e.name === 'RESOURCE_STORE_URI' || e.name === '--resource-store-uri').map((e) => ({ transport: p.transport.type, ...e })));

    it('lists the entry in both transports', () => {
      assert.strictEqual(storeEntries.filter((e) => e.name === 'RESOURCE_STORE_URI').length, 2);
      assert.strictEqual(storeEntries.filter((e) => e.name === '--resource-store-uri').length, 2);
    });

    it('carries no fixed value or default, so a generated configuration keeps the server default', () => {
      for (const entry of storeEntries) {
        assert.strictEqual(entry.value, undefined, `${entry.transport} ${entry.name} has a value`);
        assert.strictEqual(entry.default, undefined, `${entry.transport} ${entry.name} has a default`);
      }
    });

    it('shows the home form of the server default as the placeholder, and the code builds that default from the data directory', () => {
      const config = setup.parseConfig([], baseEnv);
      for (const entry of storeEntries.filter((e) => e.name === 'RESOURCE_STORE_URI')) assert.strictEqual(entry.placeholder, `file://~/.mcp-z/${config.name}/files`);
      assert.strictEqual(config.resourceStoreUri, pathToFileURL(path.join(config.baseDir, config.name, 'files')).href);
    });
  });
});
