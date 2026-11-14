# Plan 2: historical queries for newspaper evaluation

**Status: draft.** For developers connecting MCP's recorded game data to the [newspaper](../implementation.md). Depends on Plan 1's issue identity conventions; the renderer remains usable with fixtures during this work.

## Goal and success criteria

Query the existing dated records for a receiving civilization at a selected turn and supply the facts needed by Plan 3's story detectors. VD already runs MCP. Standalone evaluation reads MCP's SQLite database directly, using the same query and field-selection logic.

## Current state

`mcp-server/src/knowledge/store.ts` already stores dated player summaries, cities, and events. `getMutableKnowledgeHistory()` returns versions with optional player visibility filtering; `getMutableKnowledge()` selects the latest version. Historical queries need a cutoff and bounded comparison history.

`vox-agents/src/archivist/pipeline/extractor.ts` demonstrates read-only access through `better-sqlite3`. The [data research](../research/research-data.md) identifies France in `f07b2f21-2d81-4eee-a3f5-d6d850081a25.db`, turns 125 to 175 and 200 to 300, as an initial evaluation candidate. The [visibility research](../research/research-visibility.md) describes the field restrictions associated with stored access levels.

## Approach

Add newspaper query functions under `mcp-server/src/newspaper/` that operate on an existing database connection without starting the live server. MCP calls them against its open database. Standalone evaluation imports the compiled functions and opens the selected database read-only with the existing SQLite dependency. Choose a connection interface compatible with both callers during implementation.

A query takes the receiver, previous check, cutoff, and the comparison range needed by a detector. For each subject, select the latest applicable version at or before the cutoff, breaking same-turn ties by that table's insertion ID; include earlier versions when a comparison needs them. Select events within the requested turn range. Apply the receiver's recorded access and the selected fields before returning data to the editor.

Keep the result small: selected summary/city fields, relevant events, their existing IDs and turns, and the available condition values. These records are the editor's evidence. Source references point directly to database rows or events. Add result fields when a detector or the inspector needs them.

## Ordered implementation

1. **Add historical queries.** Extend the existing knowledge query code with cutoff and range reads for the summaries, cities, and events used by Plan 3. Share those reads with the newspaper query functions. Preserve missing values and original record dates. Use the existing schema types.

2. **Select reportable fields.** Reuse or extract field selection from the existing knowledge tools where suitable. Include own domestic and trade measures, permitted basic foreign-city facts, met civilizations' national culture/tourism, and supported public events, including war declarations involving the receiver. Filter nested event subjects and private terms as needed. Stored visibility levels determine access; new trade and espionage reporting rules belong to Plan 5.

3. **Connect standalone evaluation.** Extend Plan 1's console and browser controls with database path, receiver, turn range, and publication interval. Open the database read-only and advance the cutoff for each check. Show the returned records and source references in the developer inspector. Save the run settings and cursor with the separate publication output introduced in Plan 3.

4. **Supply conditions and comparisons as needed.** Query dated era, technology/policy events, and religion for the chosen templates. Leave unavailable conditions unknown so Plan 3 can use a broadly eligible design. Use recorded game speed, then an explicit override, otherwise a labelled Standard assumption. Keep calculations in the story detectors: normalize route-yield sentinels, define denominators, and resolve route partners or city continuity only for stories that require them. Use existing city IDs by default; link a capture only when supporting records establish continuity.

## Verification

Use small SQLite fixtures to check cutoff selection, same-turn ordering, event ranges, field permissions, and missing values. Adding a future row or an unpermitted field must leave earlier editorial input unchanged. Verify the standalone reader leaves source data unchanged and returns the same selected facts as the MCP query path.

Run focused Vitest tests and the affected workspace type checks, building MCP before Vox Agents when compiled imports require it. Query the candidate French turns and trace domestic, trade, and foreign-culture examples to their source records. Record unsupported examples beside the evaluation output.

## Risks and open questions

Older databases can have missing columns, stale city rows, or mixed save histories. Use a suitable recording for the initial evaluation and skip comparisons whose required data is unreliable. Missing historical unlocks may limit design transitions. The candidate still needs a verified merged-story and fade-and-return example for Plan 4.

## Out of scope

A separate replay subsystem, copied observation storage, recording fingerprinting or branch reconstruction, new live collection, trigger tuning, and article generation.
