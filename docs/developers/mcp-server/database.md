# mcp-server: Database

The game database holds the rules of the game itself: every unit, building, technology, project, policy, belief, resource, and AI strategy that Civilization V (with the Vox Populi mod) defines. When an agent asks "what does the Composite Bowman do?" or "what does this economic strategy weight?", the answer comes from here.

This is distinct from the knowledge store: the knowledge store remembers what is _happening_ in a game, while the game database holds the static _rules_. This page covers how that rules data is reached. The implementation is `mcp-server/src/database/`.

## Two read-only databases

Civilization V ships its rules as SQLite. When the game loads, it writes a debug copy plus a merged localization database into its cache directory, `My Games/Sid Meier's Civilization 5/cache/` under the user's Documents folder. The MCP server opens both, read-only, through [Kysely](https://kysely.dev) over `better-sqlite3`:

| Database | File | Holds |
| --- | --- | --- |
| **Main** | `Civ5DebugDatabase.db` | structured game data: tables of units, buildings, technologies, policies, strategies, and the rest |
| **Localization** | `Localization-Merged.db` | human-readable text for every language, keyed by `TXT_KEY_*` tags |

The server never writes to either: this is the game's data, and the server is purely a consumer. Where it looks for that cache directory is configurable; see [configuration.md](configuration.md).

The `DatabaseManager` (`database/manager.ts`) owns both connections, opens them at startup and again when a connected game doesn't match them, and is the single point through which database-query tools reach the data. Kysely gives those queries full type-safety against generated schema definitions: `database/database.d.ts` for the main database and `database/localization.d.ts` for the localization one. Both are produced by `kysely-codegen` (`npm run codegen` regenerates the localization schema).

## Localization and TXT_KEY resolution

Raw rows are full of `TXT_KEY_*` references rather than readable text: a unit's name is stored as a tag, not as "Composite Bowman". The manager resolves these automatically.

Given any result object, it walks the whole structure recursively, through nested objects and arrays, and even through tags embedded inside larger strings. It collects every `TXT_KEY_*` reference, looks them all up in one batched query against the localization database for the configured language, and substitutes the readable text back in.

If a key has no translation, the manager falls back to the key itself rather than failing, so a missing string degrades gracefully instead of breaking a query. A key that is present with empty text resolves to an empty string; `localizeObjects` (`database/manager.ts`) does not leave the raw tag in the result. The language defaults to `en_US` and can be changed at runtime.

## Enum mappings

Much of the game's data is referenced by numeric ID (strategy 4, improvement 12, great-person 7), and those numbers are meaningless to an agent. The manager builds a set of enum mappings to translate them.

For each of a long list of tables (improvements, buildings, projects, beliefs, units, technologies, policies, resources, religions, promotions, victories, the AI city/economic/military/grand strategies, and more) it reads every row and produces a number-to-name map, localized into readable text, with `-1` mapped to "None". The rest of the server uses these maps in both directions:

- Events and reports turn the bare IDs from the game's Lua into names an agent can reason about.
- Action tools such as `set-research` and `set-policy` turn an agent's chosen name back into the ID they send to the game.

A row ID is only meaningful for the exact database the game loaded. A cache file left over from an earlier session or a different mod set shifts the IDs, so a Shrine can read as the Mausoleum of Halicarnassus and a research choice can land on the wrong tech. The mappings are therefore built only once a game is connected, and only after checking them against it:

1. When the DLL connects, `KnowledgeManager` runs `lua/get-table-checksums.lua`. For each mapped table, that script returns a row count and a checksum of the ID and Type of every row, taken in ID order, as the live game sees them in `GameInfo`. Because the order is part of the checksum, two rows that swap IDs are caught.
2. `reloadMappings` computes the same checksums from the cache database (`tableChecksum` in `database/manager.ts`). It also checks that the localization database has Vox Populi's text, which renames Legalism to Ceremony. If anything differs, the cache may have been rewritten since the files were opened, so it reopens them and checks once more.
3. If everything matches, the new mappings replace the old ones, and the server switches to the game and announces it to agents, including clients that connect later. Each verified rebuild also bumps a database generation, so summaries that database tools cached from an earlier file (see below) are read again.
4. If it still differs, the server clears the mapped tables, so lookups fail rather than translate names with the wrong IDs. It logs an error that names the mismatched tables, the database path and its modification time, closes the previous game's knowledge store, and pauses the game. It sends neither `GameSwitched` nor `DLLConnected`, so agents don't start, and incoming game events are dropped until the DLL reconnects.

If the game can't answer yet, for example because the DLL isn't connected, the server doesn't pause. When the DLL connects, it checks again. Every reconnection rebuilds the mappings, since a reload or a different game may change the tables.

## Waiting for the database files

The MCP server may start before Civilization V has created its cache. `loadDatabaseWithRetry` only waits until both database files exist and can be read, retrying every five seconds with no attempt limit. The mappings are built later, when a game connects, so the server needs no guess about when the mod has finished loading.

If the log shows the retry message repeating forever, the cache folder is missing: start Civilization V once with the mod enabled. If a game pauses right after connecting with a mapping error, the server is reading a different or outdated cache than the running game. Check the reported path against the game's Documents folder and the `database.documentsPath` setting.

## How tools use it

### Query contract

The [database-query tools](tools.md) extend **DatabaseQueryTool** on top of `DatabaseManager`. Each supplies summaries and a full-detail fetch; the base class adds fuzzy search and chooses the report form:

| Input | Report |
| --- | --- |
| `Detailed: false` (default) | Summaries, with automatic full-detail expansion when exactly one result remains. |
| `Detailed: true` | Full details for every result. |

Summaries are cached by database generation and fetched again on the next query after a verified mapping rebuild. This prevents results from an older cache file surviving a game connection. After localization and tooltips, a subclass's `formatItem` hook can clean the items, as `get-policy` does with `formatPolicyHelp`.

### Game tooltips

Full reports for `get-unit`, `get-building`, `get-technology`, and `get-project` carry the game's tooltip in `Help`. `fetchGameTooltips` (`src/database/helpers/game-tooltips.ts`) calls the mod's `VoxDeorumReferenceTooltips` through the bridge in batches of 50. On `INVALID_FUNCTION`, it fires `LuaEvents.VoxDeorumReferenceRegister` to request registration, then retries once.

Before `stripTags` removes game markup, yield and resource icons become localized names from `Yields` and `Resources`, so "+1 Production +1 Gold" retains the meaning of each amount. An icon whose next word already names it is omitted.

### Failures

With `Detailed: true`, a failed full-report fetch, failed tooltip call, or missing tooltip fails the whole result: `Count: 0`, `Items: []`, and `Error`. Automatic single-result expansion keeps the summary when a full fetch throws, and keeps the database `Help` text when a tooltip call fails or returns no tooltip for an entry.

## Where the details live

Exact schema is reference data and stays inside the component:

- the SQLite schema can be exported into `mcp-server/docs/database/`,
- the generated enum type definitions live under `mcp-server/src/database/enums/`, with a reference copy in `mcp-server/docs/enums/`, and
- the generated API reference for the database module is in `mcp-server/docs/api/database/`.
