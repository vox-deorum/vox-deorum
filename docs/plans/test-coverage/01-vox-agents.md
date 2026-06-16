# vox-agents — Agent & Pipeline Test Plan

> See [README.md](README.md) for shared context, conventions, and shared-fixture prerequisites.

vox-agents has the largest body of untested business logic. Coverage today is good for pure utils and a few prompt-composition tests; it is thin for the analyst/librarian/oracle/archivist pipelines that produce the actual game behavior. Reuse [mock-mcp-client.ts](../../../vox-agents/tests/helpers/mock-mcp-client.ts) and a new `tests/helpers/fake-vox-context.ts` (spyable `callTool` + `StrategistParameters` builder).

## Assertion stability rule

Do **not** add snapshot tests or compare whole prompt/markdown strings. Prompts are allowed to evolve. For prompt builders, assert stable composition contracts instead: dynamic values from parameters/input are present, imported prompt-section constants/builders are included by reference, stable tool IDs appear where they define an interface, and branch behavior includes/omits the right sections. Avoid testing exact examples, sentence order, policy wording, or full rendered prose unless the source under test is itself a serializer.

## Analyst

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/analyst/diplomatic-analyst.test.ts` | [diplomatic-analyst.ts](../../../vox-agents/src/analyst/diplomatic-analyst.ts) | `getSystem` embeds dynamic `Leader`/`Name` and falls back to defaults when `metadata.YouAre` is absent; stable MCP tool IDs (`get-briefing`, `get-diplomatic-events`) are present without asserting the gatekeeping prose; `getInitialMessages` prepends context messages and includes the three `AnalystInput` values (`Context`, `Content`, `Memo`) | Stub params, fake context |
| `tests/mock/analyst/analyst-base.test.ts` | [analyst.ts](../../../vox-agents/src/analyst/analyst.ts) | `fireAndForget`, `toolChoice`, input schema, active tool IDs, `getExtraTools` exposes `get-briefing`, `getContextMessages` delegates to the shared game-context builder. Span/context detachment belongs in `agent-tools.test.ts`, not here | Fake context |

## Librarian

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/librarian/keyword-librarian.test.ts` | [keyword-librarian.ts](../../../vox-agents/src/librarian/keyword-librarian.ts) | `getInitialMessages` includes each supplied context and marks empty inputs; `getOutput` parses valid keyword JSON and calls `search-database` per context with `{Keywords, MaxResults:10}`; empty/whitespace `finalText` -> array of `""`; invalid JSON -> graceful empty results; contexts with no keywords skip search; formatted output includes result names, relevance values, and non-filtered fields without snapshotting the full markdown; `getModel` low-tier override contract; `getActiveTools` returns `[]` | Fake `VoxContext` with spy `callTool` returning canned results |
| `tests/mock/librarian/librarian-utils.test.ts` | [librarian-utils.ts](../../../vox-agents/src/librarian/librarian-utils.ts) | `extractBriefingContexts` simple mode preference order (`workingMemory` over current briefing over empty); specialized mode returns military/economy/diplomacy contexts in order from either working memory or reports; missing recent state falls back cleanly | Pure |

## Envoy (fill gaps without duplicating current tests)

Existing coverage already checks Spokesperson/Diplomat tool sets and identity in [diplomat-prompts.test.ts](../../../vox-agents/tests/mock/envoy/diplomat-prompts.test.ts) and [identity.test.ts](../../../vox-agents/tests/mock/envoy/identity.test.ts). Extend those only where the behavior is not already covered.

| New/changed test file | Target | Cases | Mocking |
|---|---|---|---|
| Extend `tests/mock/envoy/diplomat-prompts.test.ts` | [spokesperson.ts](../../../vox-agents/src/envoy/spokesperson.ts), [envoy-prompts.ts](../../../vox-agents/src/envoy/envoy-prompts.ts) | Spokesperson `getSystem` assembles imported references (`worldContext`, `noDecisionPower`, `communicationStyle`, `audienceSection(...)`) plus dynamic audience/identity values; normal mode includes stable `get-briefing`/`get-diplomatic-events` tool IDs; special mode omits the tool section. Do not hard-code the prompt prose | Stub params/context |
| `tests/mock/envoy/live-envoy.test.ts` | [live-envoy.ts](../../../vox-agents/src/envoy/live-envoy.ts) | `getInitialMessages` uses shared game context, filters special-message tokens from normal transcript history, appends a hint in normal mode, appends `greetingSpecialMessages['{{{Greeting}}}'].prompt` by reference in special mode, `prepareStep` clears active tools in special mode, `getExtraTools` exposes `get-briefing` | Stub params/context |

## Telepathist

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/telepathist/summarizer.test.ts` | [summarizer.ts](../../../vox-agents/src/telepathist/summarizer.ts) | **Prompt-builder + caching, not data aggregation** - this is a `VoxAgent` subclass. Test `getSystem` includes `summarizerGuidelines` by imported constant plus dynamic leader/civilization names; `getInitialMessages` includes exact input `instruction`, `text`, and optional `reminder`, wraps non-heading data in `# Data`, and preserves pre-headed data; `buildToolSummaryInstruction` includes the tool name and inquiry when provided without asserting the prose; `summarizeWithCache` returns cache hits without `callAgent`, stores cache misses, and treats changed text/instruction/reminder as a distinct cache entry without asserting the hash value. Do not test a `getModel` tier unless the class adds a `getModel` override | Stub `TelepathistParameters`, fake context (per [diplomat-prompts.test.ts](../../../vox-agents/tests/mock/envoy/diplomat-prompts.test.ts)) |
| `tests/mock/telepathist/episode-retriever.test.ts` | [episode-retriever.ts](../../../vox-agents/src/telepathist/episode-retriever.ts) | Programmatic `handleMessage`: greeting/initialize picks thread turn or first available turn, numeric messages parse a requested turn, unavailable turns snap to closest, missing turn streams a usage hint and records an assistant message, retrieval errors stream an error. Mock `requestEpisodesFromTelemetry` and `formatEpisodeResults`; assert dynamic facts and state changes, not exact streamed prose | `vi.mock` episode utils, fake thread/params |

## Oracle

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/oracle/replayer.test.ts` | [replayer.ts](../../../vox-agents/src/oracle/replayer.ts) | **Scope to non-cache paths** - schema-cache behavior is already covered by [replayer-cache.test.ts](../../../vox-agents/tests/mock/oracle/replayer-cache.test.ts); extend that file or stay disjoint from it. New cases: model-override expansion including duplicate-model repetitions, configured concurrency cap, `modifyPrompt` merge behavior, `extractColumns` context, per-row error mapping, CSV/trail writes. Use opaque system/message arrays; do not assert prompt prose. (Schema-only field stripping lives in `schema-tools.test.ts` below - do not duplicate.) | Fake `VoxContext` (reuse the `vi.mock` shape from replayer-cache.test.ts), tmp dir |
| `tests/mock/oracle/retriever.test.ts` | [retriever.ts](../../../vox-agents/src/oracle/retriever.ts) | CSV parsing/filtering, telemetry DB discovery/open failure rows, rationale turn fallback (`turn` then `turn - 1`), prompt extraction success/error mapping, optional retrieved JSON write path | Mock `db-resolver`/`prompt-extractor`, tmp CSV/output dir |
| `tests/mock/oracle/schema-tools.test.ts` | [utils/schema-tools.ts](../../../vox-agents/src/oracle/utils/schema-tools.ts) | Schema-only wrappers strip `_meta.autoComplete` fields from properties/required, apply optional schema rewriter, replace all `mcpToolMap` entries with non-executing tools, load cached tool definitions or return false on missing/malformed cache | Pure/tmp cache |
| `tests/mock/oracle/prompt-extractor.test.ts` | [utils/prompt-extractor.ts](../../../vox-agents/src/oracle/utils/prompt-extractor.ts) | Telemetry span traversal: choose latest valid `strategist.turn.N` root, target-agent selection/fallback, system/message/tool/model extraction from span attributes, malformed JSON tolerance, rationale fuzzy matching. Do not plan a `cleanToolArtifacts` assertion unless the source starts using that helper; cleanup itself belongs in `text-cleaning.test.ts` | Seeded in-memory telemetry Kysely |
| `tests/mock/oracle/output.test.ts` | [utils/output.ts](../../../vox-agents/src/oracle/utils/output.ts) | `resolvePath`, `getTrailBase`/`getTrailPaths`, `writeCsv` fields including extracted columns/repetition/errors, `readReplayCache` defaults/legacy tolerance, `writeTrail` creates JSON + markdown without snapshotting markdown prose | tmp dir |

## Archivist

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/archivist/extractor.test.ts` | [pipeline/extractor.ts](../../../vox-agents/src/archivist/pipeline/extractor.ts) | `extractTurnContexts` keeps latest rows per `(Key, Turn)` and assembles player/city/victory context; `extractPlayerEpisodes` merges game knowledge with telepathist summaries, computes diplomacy/victory/basic fields, honors `agentTurns`, and handles missing telepathist DBs | Seeded in-memory Kysely DBs + tmp telepathist SQLite |
| `tests/mock/archivist/selector.test.ts` | [pipeline/selector.ts](../../../vox-agents/src/archivist/pipeline/selector.ts) | Landmark selection groups by player, excludes turn 0 when alternatives exist, marks selected `(turn, playerId)` keys, returns null for no vectors, and reports stable stats without asserting logger text | Fake `EpisodeWriter` |
| `tests/mock/archivist/transformer.test.ts` | [pipeline/transformer.ts](../../../vox-agents/src/archivist/pipeline/transformer.ts) | Derived episode fields: share/per-pop/gap/religion/ideology calculations, neutral neighbor fallback, vector dimensions/ranges, missing/null source values | Pure fixture `RawEpisode` + `TurnContext` |
| `tests/mock/archivist/writer.test.ts` | [pipeline/writer.ts](../../../vox-agents/src/archivist/pipeline/writer.ts) | DuckDB table creation, episode appender round-trip including list vectors, game-outcome upsert, processed-player/turn/landmark queries, text/embedding updates, delete/reset helpers | tmp DuckDB |
| `tests/mock/archivist/game-state-vector.test.ts` | [pipeline/game-state-vector.ts](../../../vox-agents/src/archivist/pipeline/game-state-vector.ts) | `reportsToTurnContext` skips unmet/defeated string entries and maps live MCP reports; `reportsToRawEpisode` aggregates city yields, policies, minor allies, diplomacy, victory fields; `buildLiveGameStateVector` returns dimensions or `undefined` when player data is unavailable | Fixture live `GameState` |
| `tests/mock/archivist/vectors.test.ts` | [utils/vectors.ts](../../../vox-agents/src/archivist/utils/vectors.ts) | `parseDistance`/`parseStance`, neighbor filtering/sorting/padding, safe military ratio behavior, game-state vector dimensions/ranges and grand-strategy one-hot contract | Pure |
| `tests/mock/archivist/sql.test.ts` | [utils/sql.ts](../../../vox-agents/src/archivist/utils/sql.ts) | SQL helpers escape quotes, build REAL array literals, include all era labels in the CASE expression without whitespace-sensitive snapshots, and map DuckDB result rows by column name | Pure |

## Narrators / Infra / Utils

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/narrators/world-congress.test.ts` | [utils/world-congress.ts](../../../vox-agents/src/narrators/utils/world-congress.ts) | Returns null for empty input; ignores non-civ diplomatic keys; includes status/votes, sorted delegates, contender, active resolutions/proposals, and resolution result facts. Assert key facts, not the whole summary string | Fixtures |
| `tests/mock/narrators/workspace.test.ts` | [workspace.ts](../../../vox-agents/src/narrators/workspace.ts) | Workspace dir/file layout, context read/write/missing error, episodes read/write/null, `openGameDb` success/failure with DB opener mocked | tmp dir + `vi.mock` knowledge DB opener |
| `tests/mock/infra/vox-civilization.test.ts` | [vox-civilization.ts](../../../vox-agents/src/infra/vox-civilization.ts) | **Process-lifecycle orchestration, not metadata** — already covered live by [tests/live/game/vox-civilization.test.ts](../../../vox-agents/tests/live/game/vox-civilization.test.ts) (launches Civ5). Mock-tier scope: seed save→restore round-trip, bind-to-existing-process path, exit-callback registration/firing, crash-recovery attempt handling — all with its `utils/game/*` deps mocked (those utils are already independently tested) | `vi.mock` the `civ5-ini`/`civ5-user-files`/`windows-process` helpers and `child_process.spawn` |
| `tests/mock/utils/text-cleaning.test.ts` | [models/text-cleaning.ts](../../../vox-agents/src/utils/models/text-cleaning.ts) | Turn-marker stripping, tool-call artifact cleanup, tool call/result text formatting branches, truncation/error placeholders, rescue prompt branch by `toolChoice`. JSON extraction is covered by tool-rescue tests, not here | Pure |
| `tests/mock/utils/agent-tools.test.ts` | [tools/agent-tools.ts](../../../vox-agents/src/utils/tools/agent-tools.ts) | Agent-invoking tool wiring: description/schema defaults, non-fire-and-forget execution and output-schema parsing, fire-and-forget immediate return plus detached `context.execute`, parameter getter use, error propagation/span status | Fake context spy |
| `tests/mock/strategist/strategy-parameters.test.ts` | [strategy-parameters.ts](../../../vox-agents/src/strategist/strategy-parameters.ts) | `refreshGameState` tool-call fanout/error handling/culling, `ensureGameState` cache and in-flight dedupe, `getGameState` closest-turn lookup, `buildGameContextMessages` metadata projection and dynamic state sections without asserting full prompt prose. `mergeCachedEvents`/decision windows already have coverage in `pacing.test.ts` | Fixture state + fake context |

## Deferred (orchestration — integration-tier, not mock unit tests)

`strategist-session.ts`, `vox-player.ts`, and `telepathist.ts` are large state machines with deep MCP/agent coupling. Propose **focused unit tests on extractable helpers** (crash-recovery attempt counting, seating coordination, turn-dispatch decisions) rather than full end-to-end mocks; full-loop coverage belongs in the `tests/live/game` tier and is out of scope here.

## Suggested order

1. Add `tests/helpers/fake-vox-context.ts`.
2. Pure/low-effort: keyword-librarian, librarian-utils, diplomatic-analyst, text-cleaning, schema-tools, transformer/vectors/sql, world-congress.
3. Prompt-composition cases that follow the assertion stability rule: summarizer, envoy/live-envoy.
4. DB/tmp-dir seeded: archivist extractor/writer, oracle retriever/replayer/output, workspace.
5. Remaining infra/utils: vox-civilization, agent-tools, strategy-parameters.

Batch each subsystem into its own commit for reviewable coverage deltas.
