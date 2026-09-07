# Changelog

## [2.3.0] - 2026-09-07

### Changed

- Clients speaking the 2026-07-28 protocol revision now receive cache hints on list results: `tools/list`, `prompts/list`, `resources/templates/list` and `server/discover` carry a five-minute TTL and `cacheScope: 'public'`, while `resources/list` and `resources/read` stay `private` with no TTL because they vary by account. Previously every cacheable result used the SDK's conservative `ttlMs: 0` / `private` default, which caches nothing. 2025-era clients are unaffected — the fields do not exist on that revision.
- Tools, resources and prompts are now registered in name order, so `tools/list` returns the same order from every connection and a client can keep a cached catalog valid across a reconnect. The listed order differs from previous releases; no tool is added, removed or renamed.

## [2.2.0] - 2026-09-06

### Added

- Serves both the 2025 and 2026-07-28 MCP protocol revisions from the same HTTP endpoint and the same stdio connection. A client speaking either revision reaches the same tools; 2025 clients are unaffected.

### Removed

- `setup.createHTTPServer` and `setup.createStdioServer` no longer return `mcpServer` in their result, since each HTTP request and stdio connection now builds its own server instance instead of sharing one.

## [2.1.1] - 2026-09-06

### Changed

- Depends on `@googleapis/gmail` instead of the `googleapis` meta-package. Same generated client and the same `*_v*` types, from the same source; `googleapis` ships every Google API, and this package uses one or two of them. The installed SDK drops from 206 MB to 2 MB.

## [2.1.0] - 2026-09-06

### Fixed

- Works with `@mcp-z/oauth-google` 2.0.1, which replaced `toAuth()` with a token provider. Version 2.0.0 of this package resolves that release through its `^2.0.0` range and fails at runtime on any Google API call. Upgrade.

## [2.0.0] - 2026-09-06

### Changed

- Migrated to the v2 MCP SDK. `McpError`/`ErrorCode` are `ProtocolError`/`ProtocolErrorCode`, reached through `@mcp-z/server`; wire codes are unchanged.
- The 1.x line is maintained on `support/1.x` and published under the `support-1` dist-tag.

## [1.1.3] - 2026-09-05

### Fixed

- Origin validation and loopback bind for the HTTP transport (DNS rebinding).

## [1.1.0] - 2026-08-29

### Changed

- Dependency refresh; exports smoke tests added.

## [1.0.0] - 2025-12-29

Initial release.
