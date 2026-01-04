import assert from 'assert';
import { parseConfig } from '../../../src/setup/config.ts';

describe('parseConfig', () => {
  const baseEnv = {
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
  };

  describe('Basic OAuth configuration', () => {
    it('parses config with all OAuth environment variables', () => {
      const config = parseConfig([], baseEnv);

      assert.strictEqual(config.clientId, 'test-client-id');
      assert.strictEqual(config.clientSecret, 'test-client-secret');
      assert.strictEqual(config.auth, 'loopback-oauth');
    });

    it('parses config with optional client secret omitted', () => {
      const env = {
        GOOGLE_CLIENT_ID: 'test-client-id',
      };

      const config = parseConfig([], env);

      assert.strictEqual(config.clientId, 'test-client-id');
      assert.strictEqual(config.clientSecret, undefined);
    });
  });

  describe('Authentication modes', () => {
    it('parses --auth=loopback-oauth', () => {
      const config = parseConfig(['--auth=loopback-oauth'], baseEnv);

      assert.strictEqual(config.auth, 'loopback-oauth');
      assert.strictEqual(config.dcrConfig, undefined);
    });

    it('parses --auth=service-account', () => {
      const env = {
        ...baseEnv,
        GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '/path/to/key.json',
      };

      const config = parseConfig(['--auth=service-account'], env);

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

        const config = parseConfig(['--auth=dcr'], env);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.mode, 'self-hosted');
        assert.strictEqual(config.dcrConfig.storeUri, 'file://.dcr.json');
        assert.strictEqual(config.dcrConfig.verifyUrl, undefined);
        assert.strictEqual(config.dcrConfig.clientId, 'test-client-id');
      });

      it('parses DCR mode with CLI --dcr-store-uri', () => {
        const config = parseConfig(['--auth=dcr', '--dcr-store-uri=file://custom-path/store.json'], baseEnv);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.mode, 'self-hosted');
        assert.strictEqual(config.dcrConfig.storeUri, 'file://custom-path/store.json');
      });
    });

    describe('External DCR mode', () => {
      it('parses DCR mode with external configuration', () => {
        const env = {
          ...baseEnv,
          DCR_MODE: 'external',
          DCR_VERIFY_URL: 'https://auth.example.com/oauth/verify',
        };

        const config = parseConfig(['--auth=dcr'], env);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.mode, 'external');
        assert.strictEqual(config.dcrConfig.verifyUrl, 'https://auth.example.com/oauth/verify');
        assert.strictEqual(config.dcrConfig.storeUri, undefined);
        assert.strictEqual(config.dcrConfig.clientId, 'test-client-id');
      });

      it('parses DCR mode with CLI --dcr-mode=external', () => {
        const env = {
          ...baseEnv,
          DCR_VERIFY_URL: 'https://auth.example.com/oauth/verify',
        };

        const config = parseConfig(['--auth=dcr', '--dcr-mode=external'], env);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.mode, 'external');
        assert.strictEqual(config.dcrConfig.verifyUrl, 'https://auth.example.com/oauth/verify');
      });

      it('parses DCR mode with CLI --dcr-verify-url', () => {
        const env = {
          ...baseEnv,
          DCR_MODE: 'external',
        };

        const config = parseConfig(['--auth=dcr', '--dcr-verify-url=https://new.example.com/verify'], env);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.mode, 'external');
        assert.strictEqual(config.dcrConfig.verifyUrl, 'https://new.example.com/verify');
      });

      it('throws error when DCR_VERIFY_URL missing in external mode', () => {
        const env = {
          ...baseEnv,
          DCR_MODE: 'external',
        };

        assert.throws(() => parseConfig(['--auth=dcr'], env), {
          name: 'Error',
          message: 'DCR external mode requires --dcr-verify-url or DCR_VERIFY_URL environment variable',
        });
      });
    });

    describe('DCR mode defaults', () => {
      it('defaults to self-hosted mode when DCR_MODE not specified', () => {
        const env = {
          ...baseEnv,
          DCR_STORE_URI: 'file://.dcr.json',
        };

        const config = parseConfig(['--auth=dcr'], env);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.mode, 'self-hosted');
        assert.strictEqual(config.dcrConfig.storeUri, 'file://.dcr.json');
      });
    });

    describe('DCR CLI overrides', () => {
      it('CLI --dcr-mode overrides DCR_MODE env var', () => {
        const env = {
          ...baseEnv,
          DCR_MODE: 'self-hosted',
          DCR_STORE_URI: 'file://.dcr.json',
          DCR_VERIFY_URL: 'https://auth.example.com/oauth/verify',
        };

        const config = parseConfig(['--auth=dcr', '--dcr-mode=external'], env);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.mode, 'external');
        assert.strictEqual(config.dcrConfig.verifyUrl, 'https://auth.example.com/oauth/verify');
      });

      it('CLI --dcr-verify-url overrides DCR_VERIFY_URL env var', () => {
        const env = {
          ...baseEnv,
          DCR_MODE: 'external',
          DCR_VERIFY_URL: 'https://old.example.com/verify',
        };

        const config = parseConfig(['--auth=dcr', '--dcr-verify-url=https://new.example.com/verify'], env);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.verifyUrl, 'https://new.example.com/verify');
      });

      it('CLI --dcr-store-uri overrides DCR_STORE_URI env var', () => {
        const env = {
          ...baseEnv,
          DCR_MODE: 'self-hosted',
          DCR_STORE_URI: 'file://old-path/store.json',
        };

        const config = parseConfig(['--auth=dcr', '--dcr-store-uri=file://new-path/store.json'], env);

        assert.strictEqual(config.auth, 'dcr');
        assert.ok(config.dcrConfig);
        assert.strictEqual(config.dcrConfig.storeUri, 'file://new-path/store.json');
      });
    });

    describe('Invalid DCR mode', () => {
      it('throws error for invalid --dcr-mode value', () => {
        assert.throws(() => parseConfig(['--auth=dcr', '--dcr-mode=invalid'], baseEnv), {
          name: 'Error',
          message: 'Invalid --dcr-mode value: "invalid". Valid values: self-hosted, external',
        });
      });

      it('throws error for invalid DCR_MODE env var', () => {
        const env = {
          ...baseEnv,
          DCR_MODE: 'invalid',
        };

        assert.throws(() => parseConfig(['--auth=dcr'], env), {
          name: 'Error',
          message: 'Invalid --dcr-mode value: "invalid". Valid values: self-hosted, external',
        });
      });
    });
  });

  it('defaults to stdio transport with no args or env', () => {
    const config = parseConfig([], baseEnv);

    assert.strictEqual(config.transport.type, 'stdio');
  });

  describe('Server configuration', () => {
    it('includes server metadata', () => {
      const config = parseConfig([], baseEnv);

      assert.ok(config.name);
      assert.ok(config.version);
      assert.ok(config.repositoryUrl);
      assert.ok(config.baseDir);
      assert.ok(config.resourceStoreUri);
    });

    it('parses transport configuration', () => {
      const config = parseConfig([], baseEnv);

      assert.ok(config.transport);
      assert.strictEqual(config.transport.type, 'stdio');
    });

    it('parses --port for HTTP transport', () => {
      const config = parseConfig(['--port=3456'], baseEnv);

      assert.strictEqual(config.transport.type, 'http');
      assert.strictEqual(config.transport.port, 3456);
    });
  });

  it('defaults headless to true for tests', () => {
    const env = {
      ...baseEnv,
      HEADLESS: 'true',
    };

    const config = parseConfig([], env);

    assert.strictEqual(config.headless, true);
  });

  it('uses --headless CLI arg to override env var', () => {
    const env = {
      ...baseEnv,
      HEADLESS: 'false',
    };

    const config = parseConfig(['--headless'], env);

    assert.strictEqual(config.headless, true);
  });

  it('parses config from env object parameter', () => {
    const config = parseConfig([], baseEnv);

    assert.strictEqual(config.clientId, 'test-client-id');
    assert.strictEqual(config.clientSecret, 'test-client-secret');
  });

  it('uses empty array for args when no CLI arguments provided', () => {
    const config = parseConfig([], baseEnv);

    assert.strictEqual(config.transport.type, 'stdio');
  });

  it('parses HTTP port from CLI --port flag', () => {
    const config = parseConfig(['--port=4000'], baseEnv);

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

    const config = parseConfig([], env);

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

    const config = parseConfig(['--port=5000'], env);

    assert.strictEqual(config.transport.type, 'http');
    assert.strictEqual(config.transport.port, 5000);
    assert.strictEqual(config.redirectUri, undefined);
  });

  it('parses --redirect-uri when explicitly provided', () => {
    const config = parseConfig(['--redirect-uri=https://example.com/callback'], baseEnv);

    assert.strictEqual(config.redirectUri, 'https://example.com/callback');
  });

  it('parses --stdio explicitly', () => {
    const config = parseConfig(['--stdio'], baseEnv);

    assert.strictEqual(config.transport.type, 'stdio');
  });

  it('defaults to loopback-oauth auth mode', () => {
    const config = parseConfig([], baseEnv);

    assert.strictEqual(config.auth, 'loopback-oauth');
  });

  it('defaults to loopback-oauth auth mode', () => {
    const config = parseConfig([], baseEnv);

    assert.strictEqual(config.auth, 'loopback-oauth');
  });

  it('defaults logLevel to info', () => {
    const config = parseConfig([], baseEnv);

    assert.strictEqual(config.logLevel, 'info');
  });

  it('parses LOG_LEVEL from env', () => {
    const env = {
      ...baseEnv,
      LOG_LEVEL: 'debug',
    };

    const config = parseConfig([], env);

    assert.strictEqual(config.logLevel, 'debug');
  });

  it('parses --log-level from CLI', () => {
    const config = parseConfig(['--log-level=error'], baseEnv);

    assert.strictEqual(config.logLevel, 'error');
  });

  it('CLI --log-level overrides LOG_LEVEL env var', () => {
    const env = {
      ...baseEnv,
      LOG_LEVEL: 'debug',
    };

    const config = parseConfig(['--log-level=warn'], env);

    assert.strictEqual(config.logLevel, 'warn');
  });
});
