This folder contains the Gmail package's tests.

Run tests for this package from the package directory:

```bash
npm test
```

Notes:
- Tests run in the package context so Node will resolve `package.json` and dependencies correctly.
- Live integration tests load credentials via Node's `--env-file`. Place them in `.env/test/gmail`.
- Helpers used only for tests should live under `test/lib/` so they are executed within the package context.
# Service‑backed unit tests: servers/mcp-gmail

These examples exercise real Google APIs via the normal unit test runner using injected dependencies. Tests run unconditionally with credentials loaded from the repository `.env.test` by the package test script.

Prerequisites
- Node >= 18
- Google OAuth credentials for a test account (set as environment variables below)
- Network access to Google APIs

Environment variables (from `.env.test`)
- GOOGLE_CLIENT_ID: OAuth client ID
- GOOGLE_CLIENT_SECRET: OAuth client secret

Note: Token storage location is automatically determined using zero-config pattern. Use the package helper `test/lib/create-middleware-context.ts` to obtain shared package-level tokens stored under the package-local `.tokens/{environment}/{provider}/` structure. Tests should share the package token store; per-test token isolation (creating distinct token files per test) is not permitted. If strict isolation is required for a specific workflow, open an RFC so we can design a supported pattern that includes automatic teardown and CI safeguards.

How to run (single test) Ensure you have a `.env.test` file at the repository root with the required credentials, then run:

tsds test:node test/unit/tools/<tool>.test.js

How to run (all service‑backed tests in this package) Ensure `.env.test` contains valid credentials, then run:

tsds test:node test/unit

Recommended local pattern
1. Use the package `test/lib/create-middleware-context.ts` helper to obtain dependencies.
   The helper will place tokens under the package-local `.tokens/{environment}/{provider}/` structure and tests
   should share that token store. Example:

```ts
import { createMiddlewareContext, createExtra } from './test/lib/create-middleware-context.ts';

const middleware = await createMiddlewareContext();
const extra = createExtra();
```

2. Start the test with live calls enabled and ensure `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` are provided via `.env.test` or CI environment.

3. Keep tests simple: create a small resource, exercise the tool, verify results
   via the API when possible, and clean up external resources (delete messages,
   files, etc.) in teardown. Do not create per-test token files unless an
   approved RFC introduces a controlled pattern for that behavior.

Notes & security
- Never commit real credentials or token files to the repo. Prefer using a short-lived test account and restrict scope.
- If CI needs to run service‑backed tests, provision secrets in the CI environment (locked) and run these tests in a separate job with limited lifetime and access.
- Document any manual steps required (for example granting test account access to specific mailboxes).

Example: run a single test file with live calls Ensure `.env.test` contains valid credentials and run: tsds test:node test/unit/gmail.test.js

Add package-specific notes below as needed.

Docs: https://mcp-z.github.io/mcp-gmail
