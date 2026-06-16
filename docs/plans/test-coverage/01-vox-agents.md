# vox-agents — Agent & Pipeline Test Plan

> See [README.md](README.md) for shared context, conventions, and shared-fixture prerequisites.

vox-agents has the largest body of untested business logic. Coverage today is good for pure utils and some prompt builders; it is thin for the analyst/librarian/oracle/archivist pipelines that produce the actual game behavior. Reuse [mock-mcp-client.ts](../../../vox-agents/tests/helpers/mock-mcp-client.ts) and a new `tests/helpers/fake-vox-context.ts` (spyable `callTool` + `StrategistParameters` builder).

## Analyst

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/analyst/diplomatic-analyst.test.ts` | [diplomatic-analyst.ts](../../../vox-agents/src/analyst/diplomatic-analyst.ts) | `getSystem` embeds `Leader`/`Name` and falls back to defaults when `metadata.YouAre` absent; `getInitialMessages` includes context messages + Context/Report/Memo from `AnalystInput`; gatekeeping & tool wording present | Stub params, fake context |
| `tests/mock/analyst/analyst-base.test.ts` | [analyst.ts](../../../vox-agents/src/analyst/analyst.ts) | Fire-and-forget contract, span/context detachment, `getContextMessages` shape | Fake context |

## Librarian

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/librarian/keyword-librarian.test.ts` | [keyword-librarian.ts](../../../vox-agents/src/librarian/keyword-librarian.ts) | `getOutput` parses valid keyword JSON and calls `search-database` per context with `{Keywords, MaxResults:10}`; empty/whitespace `finalText` → array of `""`; invalid JSON → graceful empty results; contexts with no keywords skip search; `formatSearchResults` renders relevance + fields and drops `Relevance`/`Name`; `getModel` returns low tier; `getActiveTools` returns `[]` | Fake `VoxContext` with spy `callTool` returning canned results |
| `tests/mock/librarian/librarian-utils.test.ts` | [librarian-utils.ts](../../../vox-agents/src/librarian/librarian-utils.ts) | Shared formatting/util helpers | Pure |

## Envoy (fill gaps)

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/envoy/spokesperson.test.ts` | [spokesperson.ts](../../../vox-agents/src/envoy/spokesperson.ts) | Tool set has no intelligence-gathering tools; conveys-position prompt fragments | Stub params/context |
| `tests/mock/envoy/live-envoy.test.ts` | [live-envoy.ts](../../../vox-agents/src/envoy/live-envoy.ts) | Wires briefing/diplomatic-events tools; live prompt fragments; identity | Stub params/context |

## Telepathist

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/telepathist/summarizer.test.ts` | [summarizer.ts](../../../vox-agents/src/telepathist/summarizer.ts) | **Prompt-builder + caching, not data aggregation** — this is a `VoxAgent` subclass. Test `getSystem` embeds `summarizerGuidelines` and the instruction param; instruction-driven prompt assembly; the `createHash`-based cache key is stable for identical inputs and varies on change; `getModel` tier | Stub `TelepathistParameters`, fake context (per [diplomat-prompts.test.ts](../../../vox-agents/tests/mock/envoy/diplomat-prompts.test.ts)) |
| `tests/mock/telepathist/episode-retriever.test.ts` | [episode-retriever.ts](../../../vox-agents/src/telepathist/episode-retriever.ts) | Loads/deserializes episodes from disk; missing files; malformed JSON | `memfs`/tmp dir or `vi.mock('node:fs')` |

## Oracle

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/oracle/replayer.test.ts` | [replayer.ts](../../../vox-agents/src/oracle/replayer.ts) | **Scope to non-cache paths** — schema-cache behavior is already covered by [replayer-cache.test.ts](../../../vox-agents/tests/mock/oracle/replayer-cache.test.ts); extend that file or stay disjoint from it. New cases: model-override resolution, p-limit concurrency cap, per-row result mapping, CSV/trail path assembly. (Schema-only field stripping lives in `schema-tools.test.ts` below — do not duplicate.) | Fake `VoxContext` (reuse the `vi.mock` shape from replayer-cache.test.ts), mock fs |
| `tests/mock/oracle/retriever.test.ts` | [retriever.ts](../../../vox-agents/src/oracle/retriever.ts) | Row filtering/selection against a seeded in-memory episode DB | In-memory DuckDB/Kysely |
| `tests/mock/oracle/schema-tools.test.ts` | [utils/schema-tools.ts](../../../vox-agents/src/oracle/utils/schema-tools.ts) | Schema load/cache, complex-field stripping for schema-only mode | Pure |
| `tests/mock/oracle/prompt-extractor.test.ts` | [utils/prompt-extractor.ts](../../../vox-agents/src/oracle/utils/prompt-extractor.ts) | Prompt extraction from experiment configs | Pure |
| `tests/mock/oracle/output.test.ts` | [utils/output.ts](../../../vox-agents/src/oracle/utils/output.ts) | CSV write + trail path resolution | tmp dir |

## Archivist

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/archivist/extractor.test.ts` | [pipeline/extractor.ts](../../../vox-agents/src/archivist/pipeline/extractor.ts) | Multi-source merge (game-knowledge + telepathist summaries), cross-player turn context, normalization, empty/partial sources | Seeded in-memory Kysely DBs |
| `tests/mock/archivist/selector.test.ts` | [pipeline/selector.ts](../../../vox-agents/src/archivist/pipeline/selector.ts) | Turn/player selection heuristics & event filtering | Fixture events |
| `tests/mock/archivist/transformer.test.ts` | [pipeline/transformer.ts](../../../vox-agents/src/archivist/pipeline/transformer.ts) | Episode filtering/truncation transforms | Pure |
| `tests/mock/archivist/writer.test.ts` | [pipeline/writer.ts](../../../vox-agents/src/archivist/pipeline/writer.ts) | JSON/CSV serialization, metadata encoding, multi-format output | tmp dir |
| `tests/mock/archivist/game-state-vector.test.ts` | [pipeline/game-state-vector.ts](../../../vox-agents/src/archivist/pipeline/game-state-vector.ts) | Compact state-snapshot construction, domain aggregation | Fixture state |
| `tests/mock/archivist/vectors.test.ts` | [utils/vectors.ts](../../../vox-agents/src/archivist/utils/vectors.ts) | Vector normalization/ops | Pure |
| `tests/mock/archivist/sql.test.ts` | [utils/sql.ts](../../../vox-agents/src/archivist/utils/sql.ts) | SQL builder fragments | Pure |

## Narrators / Infra / Utils

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/narrators/world-congress.test.ts` | [utils/world-congress.ts](../../../vox-agents/src/narrators/utils/world-congress.ts) | WC event extraction/formatting | Fixtures |
| `tests/mock/narrators/workspace.test.ts` | [workspace.ts](../../../vox-agents/src/narrators/workspace.ts) | Workspace dir/file layout | tmp dir |
| `tests/mock/infra/vox-civilization.test.ts` | [vox-civilization.ts](../../../vox-agents/src/infra/vox-civilization.ts) | **Process-lifecycle orchestration, not metadata** — already covered live by [tests/live/game/vox-civilization.test.ts](../../../vox-agents/tests/live/game/vox-civilization.test.ts) (launches Civ5). Mock-tier scope: seed save→restore round-trip, bind-to-existing-process path, exit-callback registration/firing, crash-recovery attempt handling — all with its `utils/game/*` deps mocked (those utils are already independently tested) | `vi.mock` the `civ5-ini`/`civ5-user-files`/`windows-process` helpers and `child_process.spawn` |
| `tests/mock/utils/text-cleaning.test.ts` | [models/text-cleaning.ts](../../../vox-agents/src/utils/models/text-cleaning.ts) | Turn-marker stripping, JSON extraction from LLM text | Pure |
| `tests/mock/utils/agent-tools.test.ts` | [tools/agent-tools.ts](../../../vox-agents/src/utils/tools/agent-tools.ts) | Agent-invoking tool wiring (call-diplomat-analyst), error propagation | Fake context spy |
| `tests/mock/strategist/strategy-parameters.test.ts` | [strategy-parameters.ts](../../../vox-agents/src/strategist/strategy-parameters.ts) | Game-state snapshot assembly, metadata projection, context-message construction | Fixture state |

## Deferred (orchestration — integration-tier, not mock unit tests)

`strategist-session.ts`, `vox-player.ts`, and `telepathist.ts` are large state machines with deep MCP/agent coupling. Propose **focused unit tests on extractable helpers** (crash-recovery attempt counting, seating coordination, turn-dispatch decisions) rather than full end-to-end mocks; full-loop coverage belongs in the `tests/live/game` tier and is out of scope here.

## Suggested order

1. Add `tests/helpers/fake-vox-context.ts`.
2. Pure/low-effort: keyword-librarian, diplomatic-analyst, text-cleaning, schema-tools, transformer/vectors/sql, vox-civilization.
3. DB-seeded: archivist extractor/selector/writer, oracle retriever/replayer.
4. Remaining envoy/narrator/infra/utils.

Batch each subsystem into its own commit for reviewable coverage deltas.
