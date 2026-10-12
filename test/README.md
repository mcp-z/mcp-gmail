Run test commands from the package root. The package supports Node >=20; use a current Node release for the interactive setup script.

```bash
npm test                 # Full suite, including live Gmail APIs
npm run test:engines     # Full suite across supported Node versions
npm run test:ci          # Credential-free selection, excludes test/integration/**
npm run test:ci:engines  # Same selection across supported Node versions
```

The runner loads `test/lib/env-loader.ts` before tests. It optionally loads `.env.test` through `portable-env`; file values override matching inherited values. The shell or CI can supply values without a file.

Live tests require `GOOGLE_CLIENT_ID`, a configured test account, valid stored OAuth tokens, and access to Google APIs. `GOOGLE_CLIENT_SECRET` is optional for public loopback clients. To authorize a local test account interactively, run:

```bash
npm run test:setup
npm test
```

`test/lib/create-middleware-context.ts` exports the default `createMiddlewareContext` helper and validates exactly one account in the package-local `.tokens/store.json`. `test/lib/create-extra.ts` exports `createExtra`. Tests share the package token store and keep test-only helpers in `test/lib/`.

For an unattended live run, dispatch the **Live provider tests** workflow from `master`. It runs the full non-interactive suite on the selected Linux or Windows runner using the repository's `live-test` environment. See [CONTRIBUTING.md](../CONTRIBUTING.md#live-provider-tests) for required secrets and token setup.

Keep credentials and token files out of Git. Live tests can create or change mail; use a dedicated test account and clean up test resources.
