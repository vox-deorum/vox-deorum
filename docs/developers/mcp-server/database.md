# mcp-server — Database

The knowledge store remembers what is happening in a game; the game database holds the rules of the game itself — every unit, building, technology, policy, belief, resource, and AI strategy that Civilization V (with the Vox Populi mod) defines. When an agent asks "what does the Composite Bowman do?" or "what does this economic strategy weight?", the answer comes from here. This page covers how that data is reached. The implementation is `mcp-server/src/database/`.

## Two read-only databases

Civilization V ships its rules as SQLite, and the game writes a debug copy plus a merged localization database into its cache directory when it loads. The MCP server opens both, read-only, through [Kysely](https://kysely.dev) over `better-sqlite3`:

- **The main database** (`Civ5DebugDatabase.db`) holds the structured game data — the tables of units, buildings, technologies, policies, strategies, and the rest.
- **The localization database** (`Localization-Merged.db`) holds the human-readable text for every language, keyed by `TXT_KEY_*` tags.

The server never writes to either; they are the game's data, and the server is purely a consumer. The `DatabaseManager` (`database/manager.ts`) owns both connections, caches them for the life of the session, and is the single point through which database-query tools reach the data. Kysely gives those queries full type-safety against generated schema definitions — `database/database.d.ts` for the main database and `database/localization.d.ts` for the localization one, both produced by `kysely-codegen` (`npm run codegen` regenerates the localization schema).

## Localization and TXT_KEY resolution

Raw rows are full of `TXT_KEY_*` references rather than readable text — a unit's name is stored as a tag, not as "Composite Bowman". The manager resolves these automatically. Given any result object, it walks the whole structure (recursively, through nested objects and arrays, and even through tags embedded inside larger strings), collects every `TXT_KEY_*` reference, looks them all up in one batched query against the localization database for the configured language, and substitutes the readable text back in. If a key has no translation it falls back to the key itself rather than failing, so a missing string degrades gracefully instead of breaking a query. The language defaults to `en_US` and can be changed at runtime.

## Enum mappings

Much of the game's data is referenced by numeric ID — strategy 4, improvement 12, great-person 7 — and those numbers are meaningless to an agent. On startup the manager builds a set of enum mappings: for each of a long list of tables (improvements, buildings, projects, beliefs, units, technologies, policies, resources, religions, promotions, victories, the AI city/economic/military/grand strategies, and more) it reads every row and produces a number-to-name map, localized into readable text, with `-1` mapped to "None". These maps let the rest of the server translate the bare IDs that come back from the game's Lua into names an agent can reason about. Building them is treated as critical: if the mappings can't be read, the server refuses to start, because nothing downstream would make sense.

## Waiting for the game to be ready

There is a startup-ordering wrinkle worth knowing about. The game database files only become complete after Civilization V has launched and the mod has finished loading — so the MCP server may start before its data exists. The manager handles this by retrying: it loops, every five seconds, until both database files are present and openable, then waits for a known late-loading table to appear and for the policy descriptions to actually resolve in the localization database before it reads the enum mappings. Only once the data is genuinely ready does initialization complete. In practice this means the server can be launched alongside the game and will simply wait for it rather than failing.

## How tools use it

The database-query tools (described in [tools.md](tools.md)) don't query Kysely directly in an ad-hoc way — they extend `DatabaseQueryTool`, which sits on top of the `DatabaseManager`. Each such tool provides a cached summary list of its items and a way to fetch one item's full detail; the base class adds fuzzy search and automatic full-detail-on-single-match. The manager's connection caching and localization caching mean repeated queries stay cheap.

## Where the details live

Exact schema is reference data and stays inside the component: the SQLite schema can be exported into `mcp-server/docs/database/`, and the generated enum type definitions live under `mcp-server/src/database/enums/` with a reference copy in `mcp-server/docs/enums/`. The generated API reference for the database module is in `mcp-server/docs/api/database/`.
