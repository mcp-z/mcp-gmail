# Changelog

## [2.5.0]

### Changed

- On first start, sign-ins saved by earlier versions (`TOKEN_STORE_URI` and `DCR_STORE_URI`, default namespace only) are moved to the keyv 6 storage format, and the server logs "Moved N saved sign-in entries to the keyv 6 format" when it moves any. Nothing is moved on later starts.
- Upgrade servers that share one token file together: once one has moved the entries, an earlier version no longer finds them and asks you to sign in again.
- With a `sqlite://` token store opened by several servers at once on the first start after upgrading, one of them may fail once with "database is locked". Start it again.
- Old `duckdb://` data in `~/.keyv-duckdb/store.duckdb` is not moved (keyv 5 wrote it there whatever the URI said), so those sign-ins are lost and you sign in again. That file holds tokens; delete it.
- Storage adapters you install yourself for `TOKEN_STORE_URI` / `DCR_STORE_URI` (for example `@keyv/redis`) should be keyv 6 releases.

## [2.4.1] - 2026-11-16

### Fixed

- A subject, recipient or display name containing a line break or other control character (tab is allowed) is rejected with an error naming the field. Previously it could add header lines to the message, such as a hidden `Bcc`.
- `message-respond` cleans the original message's Subject, Message-ID and References before building the reply: each run of line breaks or control characters becomes one space, so a crafted message cannot add headers to your reply and can still be answered. Requires `@mcp-z/email` 1.1.5.

## [2.4.0] - 2026-11-15

### Added

- `message-archive` removes messages from the Inbox (only `INBOX` is removed; other labels and read state are kept) and `label-remove` removes one existing label from messages without creating or deleting any label. Both take `ids` and report a result per message, like `message-move-to-trash`.
- Private settings such as the OAuth client ID and secret can live in a file instead of the shell: the first file found of `<baseDir>/mcp-gmail/.env` (the `.mcp-z` folder beside the nearest `.mcp.json`, else in the home folder) and `~/.config/mcp-z/mcp-gmail/.env`. Non-empty environment values win over the file. On macOS and Linux a file readable by other accounts is refused. Requires `@mcp-z/server` 2.3.0.

### Fixed

- Non-ASCII subjects and display names are sent as RFC 2047 encoded-words, so they no longer arrive garbled.
- `label-add` uses an existing label found by ID or name before creating one.

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
