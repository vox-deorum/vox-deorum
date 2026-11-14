# Plan 2: replay and evidence foundation

**Status: draft.** For developers preparing recorded games for the [newspaper](../implementation.md). Depends on Plan 1's issue identity conventions; the renderer remains usable with fixtures while this adapter is built.

## Goal and success criteria

Produce a stable, inspectable **evidence window** for one receiving civilization at each reporting cutoff. It contains only facts that the civilization may know by that cutoff, with dates, units, subject identities, and source references. It runs without a game, bridge, or live MCP connection and never modifies the source recording.

## Current state

`mcp-server/src/knowledge/store.ts` opens writable databases, initializes schema, and enables WAL. `manager.ts` manages live context and initialization. Their normal startup paths are unsuitable for read-only replay. `schema/base.ts`, `timed.ts`, `public.ts`, and `setup.ts` describe the tables, but older recordings must be inspected for their actual columns.

The archivist already reads recordings offline. `vox-agents/src/archivist/pipeline/extractor.ts` opens game databases read-only with `better-sqlite3`, and archivist modules import MCP schema types through relative paths into `mcp-server/dist/`. The replay adapter follows both conventions.

The [data research](../research/research-data.md) identifies France in `f07b2f21-2d81-4eee-a3f5-d6d850081a25.db`, turns 125 to 175 and 200 to 300, as an initial candidate. It also documents change-only histories, capture changing city IDs, stale city rows, mutable metadata, and incomplete rewind cleanup. The [visibility research](../research/research-visibility.md) shows that a positive visibility flag does not authorize every stored field.

## Approach and contracts

Implement a dedicated read-only adapter under proposed `vox-agents/src/newspaper/replay/`, using existing `better-sqlite3`. Put evidence DTOs and the pure field/source projection in `mcp-server/src/newspaper/`. Vox Agents imports their compiled modules from `mcp-server/dist/newspaper/`, so these modules must not import live-server code. The replay adapter calls that projection on recorded rows; Plan 5's MCP evidence tool calls it on live observations. Keep editorial comparisons in Vox Agents and avoid importing the live knowledge manager into replay.

| Proposed record | Contents |
| --- | --- |
| `RecordingSelection` | Source fingerprint, explicit recording branch/segment, receiving player, cutoff range and resolved interval, game speed and its source, observed schema, replay conventions, and known limitations. |
| `Observation` | Subject key, measure, value and units, observed turn, known-by turn, reporting source and granted fields/period, source table/key/version or event ID, and reconstruction confidence. |
| `EvidenceWindow` | Campaign/recording/timeline identity, receiver, previous check and cutoff, newly relevant facts, permitted comparison history, historical condition context, and omitted-field reasons. |
| Subject identity | Civilization ID; city-object ID plus a reconciled place/founding episode when established; trade relationship identified by the two civilizations and direction. Labels remain dated display data. |

A cutoff means the end of a numbered turn in the selected recording convention. Pick each table's latest row with `Turn <= cutoff`, breaking same-turn ties by that table's insertion ID. Never compare insertion IDs across tables or treat the result as a proven simultaneous game snapshot.

## Ordered implementation

1. **Open and inspect recordings.** Add `replay/recording.ts` with a read-only connection and a consistent read transaction. Open a closed recording directly. For a database that MCP may still be writing, first take a consistent snapshot copy that includes committed WAL content, because read-only access to a WAL database can still need its side files. Record actual table/column coverage and a content fingerprint. Scan insertion order for backward turns and contradictory lifecycle records; require an explicit segment choice when branches are ambiguous. Absence of a detected rewind does not prove a clean timeline.

2. **Reconstruct dated facts.** Add `replay/history.ts`. Implement as-of reads and bounded event windows, retaining preceding history for comparisons. Preserve missing fields as unknown. A change-only row's old turn does not establish a recent collection; record what is actually known about observation timing. Validate denominator definitions, route-yield sentinels, and national versus city measures before calculating changes.

3. **Resolve subjects.** Add `subjects.ts`. Link a city through capture only when event and coordinate evidence support continuity. Distinguish a new founding after razing, and stop active-city coverage when removal is established. If ownership or continued existence is uncertain, omit roster-dependent comparisons. Match old route labels only when their endpoints resolve uniquely at the cutoff; otherwise exclude that route from claims needing endpoint identity and report incomplete coverage.

4. **Project historical access before deriving triggers.** Add `mcp-server/src/newspaper/evidence.ts`, pure types, and a versioned field policy. Vox Agents imports only these pure modules from MCP. The initial policy below uses recorded permissions and explicit field lists. It must operate on each observation, not pass complete database rows downstream. Keep true-state data private to the adapter; the editor receives only projected records and derived comparisons.

5. **Reconstruct condition context.** Obtain era, technologies, policies, religion, and game-speed evidence at the cutoff. Use recorded acquisition events and justified initial state; today's mutable metadata cannot establish historical unlocks. Track unknown conditions explicitly so Plan 3 can retain a broadly eligible design/template without inventing unlocks. Prefer a recorded campaign speed, then an explicit replay override. If neither exists, use Standard and mark it as assumed in `RecordingSelection` and the inspector. Resolve the interval through the configured speed factors and persist the resulting turn count.

6. **Expose the replay workflow.** Extend Plan 1's `src/newspaper/console.ts` command and browser host with recording selection, cutoff advance, and a developer evidence inspector outside the publication. Save run configuration, evidence references, omissions, and the cursor to a separate output directory. Plan 3 adds generated issues and publication state to this output.

## Initial recorded-data policy

| Source | Initial handling |
| --- | --- |
| Own civilization and confirmed own cities | Whitelist the recorded measures needed for domestic comparisons and own trade income. Verify ownership at the cutoff. |
| Met major civilization | Use an explicit subset of the live level-1 national projection, including culture/tourism and public identity. Never include unmet names through a static identity lookup. |
| Level-1 foreign city | Treat the selected basic fields as recorded public-city reports under the existing ever-revealed convention. Do not describe the record as current visual sight. |
| Level-2 foreign city | Whitelist civilian fields; label the source as recorded detailed access unless its specific cause is established. Do not infer spy strength or access to other cities. |
| Own trade records | Support the receiver's route-income and partner stories. Extra foreign-city access needs a proven route endpoint and an explicitly labelled policy simulation; it is excluded from the baseline run. |
| Events | Whitelist supported event types and payload fields, including nested subjects, using historical contact/access. Include war declarations involving the receiver for Plan 3's urgent coverage. Keep private deal terms and internal AI records out of the baseline. |
| Missing permission or source history | Unknown. Preserve an older permitted observation with its original date where justified; do not refresh it from later true state. |

Newly learned history requires both an observed turn and a justified acquisition turn at or before the cutoff. The baseline adapter must not invent retrospective grants. Trade and graded espionage extensions receive their live field matrix in Plan 5; simulations must remain distinguishable in evaluation outputs.

## Verification

Use small synthetic SQLite recordings to check cutoff boundaries, same-turn ordering, missing columns, changing access, captured/razed/refounded cities, ambiguous route labels, and source immutability. Add a future row or private field and verify the earlier evidence window is unchanged. Check that an unknown population or yield does not become zero.

Run focused Vitest tests for the MCP projection and Vox Agents replay adapter. Build/type-check `mcp-server` before `vox-agents` so its compiled projection modules are available, and run the newspaper reader type check if its inspector changes. Run the candidate French segments and manually trace domestic, trade, and foreign-culture examples to source records. Report measured coverage and unresolved gaps without claiming that the candidate already demonstrates every required story lifecycle.

## Risks and open questions

The chosen recordings may not contain a trustworthy merged-story or fade-and-return example. Find another segment or use a labelled synthetic fixture for the contract test, while leaving recorded-game evaluation incomplete until a suitable segment is found. Missing exact historical unlocks may limit design transitions. Same-turn branches can remain indistinguishable and must be recorded as a limitation.

## Out of scope

Writing to source databases, changing existing live tool visibility, collecting new live fields, trigger tuning, and article generation.
