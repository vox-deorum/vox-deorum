# mcp-server — Tools, Getters & Knowledge Store Test Plan

> See [README.md](README.md) for shared context, conventions, and shared-fixture prerequisites.

mcp-server has 320 source files but only ~16 test files. Many of those source files are generated event schemas and enum references, so the highest-value gap is narrower than the raw count: the store, getters, and action tools that mutate game state are largely untested. The good news: the diplomacy tests already established a **real in-memory `KnowledgeStore`** fixture ([helpers.ts](../../../mcp-server/tests/mock/helpers.ts)) that runs the real store path with no bridge/DLL. Promote it to `mcp-server/tests/mock/helpers.ts` and build on it.

## Knowledge store & manager

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/knowledge/store.test.ts` | [knowledge/store.ts](../../../mcp-server/src/knowledge/store.ts) | `storePublicKnowledge`/`getPublicKnowledge` round-trips; `storeMutableKnowledge`/`getMutableKnowledge` versioning, `IsLatest`, change-ignore fields, no-op update when there are no changes, turn stamping, visibility filtering; `storeTimedKnowledge`/`insertRenderEvent` minimal persistence; `handleGameEvent` validates known schemas and sends MCP notifications in a narrow mocked case | Real in-memory store; mock bridge/gameDatabase/MCP notifications only for event-handling cases |
| `tests/mock/knowledge/manager.test.ts` | [knowledge/manager.ts](../../../mcp-server/src/knowledge/manager.ts) | `extractRenderEventForStorage`; load/save/shutdown lifecycle with a temp DB; `getTurn`/`getActivePlayerId` defaults and updates; `updateTurn` ignores backwards turns; `updateActivePlayer` only changes when a game identity exists | In-memory/temp store; mock `syncGameIdentity`, bridge events, and timers |

## Getters (one test file each)

Target dir: [knowledge/getters/](../../../mcp-server/src/knowledge/getters/). Each getter's query/aggregation runs against a **seeded in-memory store**; assert visibility is honored and empty-data behavior is sane.

| New test file | Target |
|---|---|
| `tests/mock/knowledge/getters/player-opinions.test.ts` | player-opinions.ts |
| `tests/mock/knowledge/getters/player-strategy.test.ts` | player-strategy.ts |
| `tests/mock/knowledge/getters/player-relationships.test.ts` | player-relationships.ts |
| `tests/mock/knowledge/getters/player-options.test.ts` | player-options.ts |
| `tests/mock/knowledge/getters/victory-progress.test.ts` | victory-progress.ts |
| `tests/mock/knowledge/getters/military-report.test.ts` | military-report.ts |
| `tests/mock/knowledge/getters/city-information.test.ts` | city-information.ts |
| `tests/mock/knowledge/getters/diplomatic-messages.test.ts` | diplomatic-messages.ts |
| `tests/mock/knowledge/getters/player-summary.test.ts` | player-summary.ts |
| `tests/mock/knowledge/getters/game-identity.test.ts` | game-identity.ts |
| `tests/mock/knowledge/getters/player-flavors.test.ts` | player-flavors.ts |
| `tests/mock/knowledge/getters/player-information.test.ts` | player-information.ts |
| `tests/mock/knowledge/getters/player-persona.test.ts` | player-persona.ts |

> The dir also contains `random-seeds.ts` — verify whether it's worth a getter test or is covered elsewhere before adding it (it is more infra than game-state query).

## Action tools (state mutation)

Action tools call Lua via `LuaFunctionTool.call`, then post-process and write to the store. **Mock the Lua boundary** (usually `LuaFunction.prototype.execute`, or an equivalent direct spy on the tool's call path) returning a canned result; do not boot the bridge. Assert the store-write + change-detection + replay-push logic. Start with `set-strategy` — it has the richest post-processing.

| New test file | Target | Cases |
|---|---|---|
| `tests/mock/actions/set-strategy.test.ts` | [set-strategy.ts](../../../mcp-server/src/tools/actions/set-strategy.ts) | Lua array-vs-object result normalization, `"Tweaked by In-Game AI(...)"` rationale wrapping, `detectChanges` → replay-message push, enum name↔id resolution, `StrategyChanges` rows written with correct visibility/turn |
| `tests/mock/actions/set-persona.test.ts` | set-persona.ts | Schema validation, store write, change detection, replay push |
| `tests/mock/actions/set-relationship.test.ts` | set-relationship.ts | As above |
| `tests/mock/actions/set-policy.test.ts` | set-policy.ts | Enum resolution + store write |
| `tests/mock/actions/set-research.test.ts` | set-research.ts | Enum resolution + store write |
| `tests/mock/actions/set-flavors.test.ts` & `unset-flavors.test.ts` | set-flavors.ts, unset-flavors.ts | Flavor set/unset, store deltas |
| `tests/mock/actions/set-metadata.test.ts` | set-metadata.ts | Config update |
| `tests/mock/actions/relay-message.test.ts` | relay-message.ts | Message-to-leader shaping |
| `tests/mock/actions/present-decision.test.ts` | present-decision.ts | Blocking-decision/notification contract |
| `tests/mock/actions/keep-status-quo.test.ts` | keep-status-quo.ts | Status-quo noop |
| `tests/mock/actions/pause-game.test.ts` & `resume-game.test.ts` | pause-game.ts, resume-game.ts | Bridge pause/resume call shaping (lower priority — thin wrappers) |
| `tests/mock/actions/set-production-mode.test.ts` | set-production-mode.ts | Enum/mode resolution + store write |

## Query tools & abstract bases

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/knowledge/get-diplomatic-events.test.ts` | [get-diplomatic-events.ts](../../../mcp-server/src/tools/knowledge/get-diplomatic-events.ts) | Diplomatic-history filtering by player pair, ordering, visibility (critical for the new diplomacy system) | In-memory store |
| `tests/mock/tools/abstract/action.test.ts` | [tools/abstract/action.ts](../../../mcp-server/src/tools/abstract/action.ts) | `sourceTurnField` default contract, `resolveSourceTurn`, `trimRationale`, `pushAction` delegation, shared annotations/metadata. Schema validation belongs to registration/tool-runner coverage or concrete tool tests, not this abstract helper | Test subclass + stub `knowledgeManager`/`pushPlayerAction` |
| `tests/mock/tools/abstract/database-query.test.ts` | tools/abstract/database-query.ts | DB-abstraction lookup contract | Seeded DB |
| `tests/mock/tools/search-database.test.ts` | [general/search-database.ts](../../../mcp-server/src/tools/general/search-database.ts) | Fuzzy search ranking, cross-tool reciprocal-rank fusion, `MaxResults`, result keys/relevance/field preservation, empty keyword/tool-error tolerance | Mock `getTool(...)` database tool summaries first; add a seeded-DB variant only if needed |
| `tests/mock/databases/get-strategies-flavors.test.ts` | get-economic/military-strategy, get-flavors | DB-lookup formatting | Existing real-tier DB fixture |
| `tests/mock/bridge/manager.test.ts` | [bridge/manager.ts](../../../mcp-server/src/bridge/manager.ts) | HTTP client lifecycle to bridge-service, health/script/pause/resume request shaping, queued Lua batch success/error mapping, event-pipe delimiter parsing and SSE fallback/retry | Fake `HttpClient`/`EventSource`/`net.createConnection`; use fake timers and call `shutdown()` to stop the queue loop |

## Suggested order

1. Promote `setupDiplomacyStore`/`seedPlayer` to `tests/mock/helpers.ts`.
2. `store.test.ts` + `manager.test.ts` (foundation).
3. Getters (mechanical, high coverage-per-effort).
4. `set-strategy.test.ts` first, then remaining action tools.
5. Abstract bases + query tools + bridge manager.
