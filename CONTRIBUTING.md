# Contributing to @mcp-z/mcp-gmail

MCP server for Gmail integration with OAuth authentication, message search, batch operations, and Google Sheets export

## Before Starting

A few conventions here differ from what you might expect:

- **Breaking changes over compatibility.** This project has no compatibility burden yet. Do not add back-compat layers, migration utilities, or wrappers for deprecated APIs - change the API cleanly and bump the major.
- **Keep it approachable.** This is a small community project, not an enterprise codebase. Prefer the simplest solution that fits in the existing files over new abstractions, frameworks, or shared infrastructure.
- **Tests run against real services, not mocks.** Suites call live provider APIs with real credentials, so you need your own test account configured through the shell, CI, or an optional `.env.test` file copied from `.env.test.example`. File values override matching inherited values. A test that fails on credentials is reported, not skipped or loosened.
- **Never write to stdout in server code.** MCP speaks JSON-RPC over stdio; a stray `console.log` corrupts the protocol stream. Use the injected logger, which writes to stderr.
- **Test scratch goes in the package's gitignored `.tmp/`**, never `os.tmpdir()`.

## Branches

`master` is the only maintained release line. The 1.x line is retired and receives no fixes. All changes target `master`.

## Pre-Commit Commands

Install ts-dev-stack globally if not already installed:

```bash
npm install -g ts-dev-stack
```

Run before committing - this builds, type-checks, lints, and tests:

```bash
tsds validate
```

`tsds validate` also runs automatically on `npm publish` via the `prepublishOnly` hook; a failure blocks the publish.

## Testing

```bash
npm run test:setup    # Generate OAuth tokens (interactive, run once)
npm test              # Run the test suite
npm run test:engines  # Run the suite across every supported Node version
```

Specs live in `test/unit/`, mirroring `src/`. Cross-service specs live in `test/integration/`. Both run under `npm test`.

## Package Development

See `README.md` for package overview and usage.

## GitHub Actions

Trusted master CI uses Node 26, `npm ci`, `prepublishOnly`, the full current-runtime suite and the supported-engine sweep. Ubuntu completes before Windows starts. The calling workflow uses the same commit's `.github/workflows/live.yml`; manual dispatch uses that existing workflow too. macOS coverage runs locally.

Pull requests receive no provider credentials. They run the existing exports, unit tests, local HTTP suite and both stdio discovery suites through the canonical commands on Linux and Windows:

```bash
npm test -- "test/exports/*.test.*" "test/unit/**/*.test.ts" "test/integration/http-server.test.ts" "test/integration/server.test.ts" "test/integration/gmail-server-spawn.test.ts"
npm run test:engines -- "test/exports/*.test.*" "test/unit/**/*.test.ts" "test/integration/http-server.test.ts" "test/integration/server.test.ts" "test/integration/gmail-server-spawn.test.ts"
```

The PR job supplies the nonsecret `GOOGLE_CLIENT_ID=test-client-id` and `HEADLESS=true` required for local server startup. The stdio suites issue discovery requests without invoking provider tools and own private project/store paths. The HTTP suite uses explicit local configuration. A green PR check establishes local coverage only.

`npm test`, `npm run test:engines` and both `test:ci` aliases retain full discovery without exclusions or script-level environment preloads. Each configured TypeScript test entrypoint imports its environment loader first. The optional `.env.test` overrides matching inherited values; CI can supply values without that file. JavaScript export smokes need no environment setup.

### Trusted tests

The trusted workflow runs `npm test -- --bail` and `npm run test:engines -- --bail`. Every unattended provider suite runs against the existing Gmail test account. Current Node plus each supported major-even engine runs serially per platform. The engine tool continues later engines after a failed runtime; `--bail` stops that runtime's suite. Failed Ubuntu prevents Windows from starting. No automatic retry is configured.

Interactive consent remains the local `npm run test:setup` command. Gmail has no authored browser-consent test gate; `TEST_INCLUDE_MANUAL=false` is retained in CI's existing token setup.

Live tests use a process-wide strict pace of one token-provider call every 1.2 seconds. The summary counts token-provider calls, not exact API requests or Gmail quota units. At 50 calls per minute, 100-unit methods would use 5,000 units per minute against Gmail's documented default of 6,000 units per user per minute. Existing projects may have different limits; see [Gmail API quotas](https://developers.google.com/workspace/gmail/api/reference/quota).

This repository owns its `live-test` GitHub environment, restricted to master. The credential-consuming job uses the shared `live-provider-tests` concurrency group with `queue: max` and `cancel-in-progress: false`. Automatic and manual jobs hold this lock through seed, tests, persistence and cleanup. Queued jobs read environment secrets when they start, after preceding jobs persist replacement credentials. PR cancellation uses a separate group. There is no cross-repository coordinator; coordinate any shared account, refresh grant or quota before starting another repository's provider job.

Configure these individual environment secrets from the existing test configuration and token stores:

- `CI_SECRETS_TOKEN`
- `TEST_ACCOUNT_ID`
- `TEST_REFRESH_TOKEN`
- `TEST_SCOPE`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

`CI_SECRETS_TOKEN` is a fine-grained GitHub PAT with this repository selected and **Environments: Read and write**. GitHub's default workflow token cannot update environment secrets; see the [environment-secret API permissions](https://docs.github.com/en/rest/actions/secrets#create-or-update-an-environment-secret). Keep the PAT's expiry visible to the maintainer; do not use the local broad GitHub login as a CI secret. Provider refresh tokens and GitHub authorization have separate lifetimes.

The seeder validates configuration, renews provider credentials, saves private runner files, and writes replacement refresh tokens back to environment secrets before tests run. An always-run finalizer saves subsequent replacements even when tests fail, then removes runner credential files. Credentials are not cached or uploaded as artifacts. Missing configuration, failed renewal and failed persistence fail the job; CI never opens a consent screen. After provider revocation or expiry, reauthorize locally with the existing setup command and reseed that repository's refresh-token secrets.

Google external apps in Testing can issue seven-day refresh tokens for these scopes; successful access-token renewal does not remove that policy. Confirm the existing project's consent publishing configuration before relying on long-term unattended runs. See [Google's token lifecycle documentation](https://developers.google.com/identity/protocols/oauth2).
