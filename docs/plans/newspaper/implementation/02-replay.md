# Plan 2: historical queries for newspaper evaluation

**Status: draft.** For developers connecting MCP's recorded game data to the [newspaper](../implementation.md). Depends on Plan 1's issue identity conventions; the renderer remains usable with fixtures during this work.

## Goal and success criteria

Query the existing dated records for a receiving civilization at a selected turn and supply the facts needed by Plan 3's story detectors. VD already runs MCP. Standalone evaluation reads MCP's SQLite database directly, using the same query and field-selection logic.

## Current state

`mcp-server/src/knowledge/store.ts` already stores dated player summaries, cities, and events. `getMutableKnowledgeHistory()` returns versions with optional player visibility filtering; `getMutableKnowledge()` selects the latest version. Historical queries need a cutoff and bounded comparison history.

`vox-agents/src/archivist/pipeline/extractor.ts` demonstrates read-only access through `better-sqlite3`. The [data research](../research/research-data.md) identifies France in `f07b2f21-2d81-4eee-a3f5-d6d850081a25.db`, turns 125 to 175 and 200 to 300, as an initial evaluation candidate. The [visibility research](../research/research-visibility.md) describes the field restrictions associated with stored access levels.

## Approach

Add newspaper evidence queries under `mcp-server/src/newspaper/` using an explicit `Kysely<KnowledgeDatabase>` connection. MCP calls them against its open database. Vox Agents opens the selected SQLite database read-only and imports the same compiled query and projection modules, without importing `knowledge/store.ts` or `server.ts`. Use the existing workspaces: MCP owns evidence and transport; Vox Agents owns replay orchestration and editorial, issue and render contracts. MCP must not depend on Vox Agents.

## Folder and type ownership

These are implementation destinations; the existing knowledge store remains in place until its pure history reads are extracted.

| Owner and path | Responsibility |
| --- | --- |
| MCP `src/newspaper/evidence.ts` | Browser-safe evidence schemas and inferred query inputs, results and source-reference types. Reuse these contracts across MCP and standalone callers. |
| MCP `src/newspaper/queries.ts` | Pure dated evidence queries taking an explicit `Kysely<KnowledgeDatabase>` connection; no server startup or live refresh. |
| MCP `src/newspaper/projection.ts` | Receiver visibility and reportable-field policy, including nested subjects and private event terms. This is the single owner for Plan 5's future live reporting grants. |
| MCP `src/knowledge/history.ts` | Shared pure history queries extracted from `store.ts`, including cutoff/range reads. Keep this as one module rather than creating a one-file helper subfolder. |
| MCP `src/knowledge/store.ts` | Delegate history reads to `history.ts`; retain connection ownership and live refresh outside the extracted module. |
| Vox Agents `src/newspaper/replay/database.ts` | Read-only `better-sqlite3` and Kysely setup and cleanup, matching MCP's SQLite dialect and `JsonSerializePlugin`/`ParseJSONResultsPlugin` behavior without running schema setup or migrations. |
| Vox Agents `src/newspaper/replay/session.ts` | Settings, cutoff cursor, evidence retrieval and evaluation-session orchestration. Plan 3 adds durable run settings and cursor persistence. |
| Vox Agents `src/newspaper/replay/http.ts` | Replay routes calling the session; inject them into `export/http.ts` before its API/static fallbacks. |
| Vox Agents `src/newspaper/contracts/replay.ts` | Serialized replay settings and response schemas, reusing MCP evidence types and schemas. Keep shared contracts free of Node/DOM types and runtime implementation imports. |
| Vox Agents `newspaper/src/app/api.ts`, `replay.ts`, `inspector.ts` | Browser API client, replay controls and evidence/source inspector. Introduce them in this stage so standalone evaluation is usable before Plan 4. |
| Vox Agents `src/newspaper/console.ts` | CLI argument parsing and wiring of database, session, routes and export service; domain logic stays in its owning modules. |

Use type-only imports where only a type is needed. Evidence and replay contract schemas may depend on other browser-safe contract schemas; they must not pull database connections, query implementations, services or browser code into the shared contract boundary. During implementation, update `mcp-server/AGENTS.md` and `vox-agents/AGENTS.md` for these owners. Update `docs/developers/vox-agents/newspaper/replay.md` for standalone startup, read-only queries and inspector behavior, and `overview.md` in that directory for the MCP evidence and Vox Agents orchestration boundary.

A query takes the receiver, previous check, cutoff, and the comparison range needed by a detector. For each subject, select the latest applicable version at or before the cutoff, breaking same-turn ties by that table's insertion ID; include earlier versions when a comparison needs them. Select events within the requested turn range. Apply the receiver's recorded access and the selected fields before returning data to the editor.

Keep the result small: selected summary/city fields, relevant events, their existing IDs and turns, and the available condition values. These records are the editor's evidence. Source references point directly to database rows or events. Add result fields when a detector or the inspector needs them.

## Ordered implementation

1. **Add historical queries.** Extract shared pure reads into `knowledge/history.ts` and have the existing store delegate while retaining live refresh behavior outside that module. Add cutoff and range reads for the summaries, cities, and events used by Plan 3. `newspaper/queries.ts` consumes those reads through its explicit typed connection. Define structural inputs/results/source references in `evidence.ts`. Preserve missing values and original record dates. Use the existing schema types.

2. **Select reportable fields.** Reuse or extract field selection from the existing knowledge tools into `newspaper/projection.ts` where suitable. Include own domestic and trade measures, permitted basic foreign-city facts, met civilizations' national culture/tourism, and supported public events, including war declarations involving the receiver. Filter nested event subjects and private terms as needed. Stored visibility levels determine access; new trade and espionage reporting grants extend this same policy module in Plan 5.

3. **Connect standalone evaluation.** Extend Plan 1's console with database path, receiver, turn range, and publication interval, wired through `replay/database.ts`, `session.ts`, and `http.ts`. Add `app/api.ts`, `replay.ts`, and `inspector.ts` to the browser shell now. Open the database read-only, advance the cutoff for each check, and show records and source references in the inspector. Keep settings and cursor in the session here; Plan 3 persists them with separate publication output. Inject replay routes into the existing export host before its fallbacks, keeping ordinary MCP/dashboard startup out of the standalone path.

4. **Supply conditions and comparisons as needed.** Query dated era, technology/policy events, and religion for the chosen templates. Leave unavailable conditions unknown so Plan 3 can use a broadly eligible design. Use recorded game speed, then an explicit override, otherwise a labelled Standard assumption. Keep calculations in the story detectors: normalize route-yield sentinels, define denominators, and resolve route partners or city continuity only for stories that require them. Use existing city IDs by default; link a capture only when supporting records establish continuity.

## Verification

Use small SQLite fixtures under `mcp-server/tests/newspaper/` to check cutoff selection, same-turn ordering, event ranges, field permissions, and missing values. Adding a future row or an unpermitted field must leave earlier editorial input unchanged. Verify the standalone reader leaves source data unchanged, performs no migrations or live refresh, and returns the same selected facts as the MCP query path, including JSON field decoding. Test offline imports without starting MCP or importing the live store/server.

Mirror Vox Agents replay, contract and HTTP/service modules under `vox-agents/tests/mock/newspaper/`. Check cursor advancement, injected-route ordering and read-only connection cleanup with controlled evidence. Use the existing browser type check and build for the API client, controls and inspector; avoid tests tied to inspector prose.

Run focused Vitest tests and the affected workspace type checks, building MCP before Vox Agents when compiled imports require it. Query the candidate French turns and trace domestic, trade, and foreign-culture examples to their source records. Record unsupported examples beside the evaluation output.

## Risks and open questions

Older databases can have missing columns, stale city rows, or mixed save histories. Use a suitable recording for the initial evaluation and skip comparisons whose required data is unreliable. Missing historical unlocks may limit design transitions. The candidate still needs a verified merged-story and fade-and-return example for Plan 4.

## Out of scope

A general-purpose replay subsystem beyond this newspaper evaluation session, copied observation storage, recording fingerprinting or branch reconstruction, new live collection, trigger tuning, and article generation.
