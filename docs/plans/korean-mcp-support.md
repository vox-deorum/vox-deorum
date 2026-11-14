# Korean game data through MCP

## Goal and success criteria

A player using Korean Civilization V can start or resume a Vox Deorum session without changing MCP language settings. Civilization, leader, technology, building, resource, and event names use the game's language wherever the installed game provides translations. Strategists and briefers receive a complete player identity and can prepare their turns.

The same automatic selection supports Chinese and other installed game languages. English games continue to work. Explicit database language settings retain precedence. Missing translations fall back to English; deliberately empty translations remain empty. Local validation uses Chinese, with controlled Korean regression coverage for the reported issue.

## Current state

- `mcp-server/src/utils/config.ts` defaults `database.language` to `en_US`. Live Lua collection already uses the game's language.
- `DatabaseManager.localize` and `localizeObjects` in `mcp-server/src/database/manager.ts` resolve database text in the configured language. A missing translation currently leaves its text key unresolved.
- `KnowledgeManager.loadEnumMappings` in `mcp-server/src/knowledge/manager.ts` verifies database tables before opening the game's knowledge store. This is the point to select the language before translating database names.
- `mcp-server/lua/get-table-checksums.lua` returns the live table checksums. `civ5-dll/LuaCATS/Locale.d.lua` documents `Locale.GetCurrentLanguage().Type`, and the game's options menu uses the locale API.
- `DatabaseQueryTool.getSummaries` and the city building caches follow the database generation. `DatabaseManager.setLanguage` currently does not change that generation.
- `get-game-settings.ts` joins player information and civilization catalog entries by display name, then omits `YouAre` if the join fails. `refreshGameState` in `vox-agents/src/strategist/strategy-parameters.ts` retains incomplete metadata and does not reject failed settings results.
- City building filtering also joins localized display names. Different database and game languages can silently remove buildings from city reports.
- `vox-agents/src/knowledge/game-speed.ts` recognizes English speed names only. Korean metadata can therefore use the default past-briefing lookback even for a different game speed.

## Approach

Select the game's language automatically at the existing connection verification step and use the shared database localization path for all database tools and mappings. This also aligns database building names with the Korean names collected from cities.

Keep the existing explicit language override for deployments that need it. Add an English fallback for missing translations. Return basic player identity in the existing live settings call, with civilization catalog data adding unique abilities through the civilization's stable type.

This directly supports Korean game data. A broader conversion of every record relationship to stable identifiers is unnecessary for this patch.

## Steps

### 1. Select the language before translating database names

- Change the default `database.language` to `auto` in `mcp-server/src/utils/config.ts`.
- Extend the response from `get-table-checksums.lua` to include the current language and the table checksum dictionary under separate `language` and `tables` fields. Read the language using `Locale.GetCurrentLanguage().Type`. Guard an unavailable locale so checksums can still be returned.
- Update `KnowledgeManager.loadEnumMappings` to validate this response and pass both fields to `DatabaseManager.reloadMappings`. A failed Lua call uses the existing connection-not-ready path. If checksums are available but the language is missing or invalid, automatic mode uses English and logs an error through Winston. Locale acquisition alone must not prevent verification. An explicit language override permits verification without a reported locale.
- Retain the requested language separately from the effective language. Resolve `auto` again on every connection, even after an earlier Korean connection. An explicit environment or file setting keeps its existing precedence. Use English before a live game has supplied a language; `auto` is never an effective database language. Warn when an explicit setting differs from the reported game language.
- Build candidate enum mappings using the pending language without changing the publicly visible effective language. Pass that language through the localization helpers used by `buildEnumMapping`. After verification succeeds, publish the language and mappings together and advance the database generation in the same synchronous block. A failed rebuild must not publish the candidate language.
- Refresh language selection on each DLL reconnect through the existing verification lifecycle.
- Keep generation advancement at the verified mapping publication step. Tool summaries and city building caches refresh through their existing generation checks. Keep `setLanguage` as an internal startup/test selector: an explicit language sets both requested and effective values, while `auto` sets the request and uses English until verification. Give direct `initializeMappings` calls a default effective-language argument for existing tests. Remove the documentation's unsupported claim of live runtime language switching.
- Preserve the existing English Vox Populi localization sentinel. It checks whether VP text has loaded, independently of the output language.

### 2. Resolve missing translations consistently

- Update both `localize` and `localizeObjects` to look up the selected language first, English second, and retain the original key only when neither has text.
- In batched localization, fetch English only for unresolved keys, using explicit presence checks so fallback cannot overwrite a selected-language empty string. Preserve nested and embedded text-key substitution. Capture the selected language once for each operation, including recursive substitutions.
- Treat an empty selected-language string as a translation. A missing row or null text permits fallback.

### 3. Provide complete player identity

- In `mcp-server/src/tools/knowledge/get-game-settings.ts`, preserve a failed Lua response before attempting to use its metadata.
- Have `get-game-settings.lua` use its existing `playerID` argument to return `YouAre.Name`, `Leader`, `PlayerID`, and the civilization's stable `Type` for a valid player. Use the same game display names as player information (`GetCivilizationShortDescription` and `GetName`). This intentionally honors custom civilization and leader names, including multiplayer nicknames. If a requested player cannot be read, return an explicit identity-unavailable tool error without caching incomplete identity.
- Copy only `Uniques` from the catalog summary with the same civilization `Type`, then remove the transient type from the returned identity as today. Read permanent teammates from the existing player-information cache. Missing teammate rows or failed catalog enrichment must preserve the basic identity; log enrichment failures. No extra player-information refetch is needed for identity.
- Calls with no player ID or a negative player ID return general game settings. Agent metadata validation also permits absent `YouAre` when `playerID < 0`.
- Add a shared async metadata helper in `strategy-parameters.ts` that reuses complete metadata, otherwise fetches once. Reject failed results with `isFailedToolResult` and `extractErrorText` before caching. For a player-specific call, require string `YouAre.Name` and `Leader` fields and a matching `YouAre.PlayerID`. Throw on failed or incomplete results so the existing seat refresh failure path handles them; briefer requests also reject if identity cannot be obtained. Preserve cancellation checks before publishing results.
- Use the helper in `refreshGameState`, before the cached-state return in `ensureGameState`, and before prompt construction in both `SimpleBriefer` and `SpecializedBriefer`. This repairs incomplete identity when a turn's game state is already cached.

### 4. Preserve past-briefing lookback with localized speed names

- Have `mcp-server/lua/get-game-settings.lua` return a numeric `GameSpeedMultiplier`, using the current game speed's `TrainPercent` divided by 100. Add the optional numeric field to the metadata schema.
- Use a finite positive number in `vox-agents/src/knowledge/game-speed.ts`. Retain the English-name lookup, then the existing 1.0 default, for older metadata or an unavailable multiplier. This changes the past-briefing lookback only. Keep the numeric field in situation metadata and recordings so replay retains the same timing.

### 5. Add focused coverage and update documentation

- Add configuration language tests and extend the existing localization, enum mapping, connection lifecycle, game settings, city information, and strategist metadata tests.
- Add controlled Chinese and Korean translations and actual text keys to the MCP database fixture. Supply English rows preserving the values existing tests expect. Make fixture language selection configurable for dedicated Chinese transport tests while preserving English defaults for existing suites. Follow `tests/mock/server/transport-contract.test.ts`, installing the same database fixture in HTTP and `tests/fixtures/start-source-stdio.ts`. Set the child language explicitly before launch. These transport tests prove Chinese input/output behavior without a live bridge; separate mapping lifecycle tests exercise automatic locale selection with real SQLite mappings.
- Verify Chinese civilization and technology queries, Chinese-name search, identity, event names, and city building filtering. Keep controlled Korean identity and localization regressions for the reported issue. Cover missing-translation fallback, empty translations, cache refresh, explicit overrides, and numeric lookback timing. Include incomplete metadata with an already populated turn cache, failed settings results, player ID `-1`, custom names, a throwing catalog lookup, failed locale acquisition, successful checksums without a locale, and reconnecting from a non-English game to an English game. Treat fixture locale codes as opaque strings.
- Update the example and setting description in `docs/developers/mcp-server/configuration.md` to use `auto`. Rewrite the localization section of `database.md` to describe the translation priority and connection lifecycle. Update the identity contract in `mcp-server/docs/tools.md`. Add a concise player-facing note to the existing troubleshooting page.

## Risks and open questions

- Confirm the locale object and language code in the local Chinese game. Controlled Korean fixtures establish the reported name-mismatch behavior; they do not establish the locale API's output in a live Korean installation.
- The installed game and mods supply translation content. Missing Korean text can remain English through fallback.
- An explicitly configured English database language remains an override. Set it to `auto` to follow a Korean game.
- If the bridge Lua context cannot report its language, English fallback keeps sessions available but database names can still differ from the game's names. The live Chinese check must establish that automatic selection works, and that its reported code has matching `LocalizedText` rows.
- Reopening a stored game under another language can leave previously stored player information, city snapshots, workspace references, and event text in their original language. Rewriting these records or translating an existing session is outside this change. Resuming a Korean session in Korean is included.
- Upgrading an existing non-English session from English database names to automatic localization can leave English action names in agent history. Name-based action tools may reject those old names; agents must obtain current names from fresh tool results. Historical record conversion remains outside scope.

## Verification

Run the affected MCP mock suites and agent tests first. Build MCP before checking agent types, since the agents import MCP's generated types. Run component type checks and the relevant component tests after these changes pass.

Run the dedicated Chinese MCP integration tests over HTTP and stdio, including Chinese input and output round trips, plus the controlled Korean regressions. Then verify the local Chinese game: civilization and technology tools, player identity, city buildings, event names, and one direct and one staffed strategist turn. Record the actual locale code returned by the game, confirm matching localization rows and the current speed's `TrainPercent`, and reconnect to an English game to check language refresh.

Report controlled-test results separately from any live game checks that could not be performed. Leave all changes unstaged.

## Out of scope

Dashboard translation, translating fixed protocol keys and tool names, rewriting agent instruction templates, generating missing Korean translations, historical record translation, and a general identity schema redesign.
