# Test Coverage Expansion Plans

## Context

The Vox Deorum monorepo (vox-agents, mcp-server, bridge-service, vox-agents/ui) has **73 existing Vitest test files** organized into a clean tier structure (`tests/mock` → `tests/real` → `tests/live`). Coverage is strong for *pure utilities* (random seeds, config diff, INI parsing, similarity math, transcript reconciliation) and for *bridge-service connection/route/service* logic, but thin for the **agent/pipeline business logic** that drives the game loop and for **mcp-server tools and the knowledge store**. Several large, complex modules (game orchestration, intelligence filtering, batch replay, multi-source extraction, the in-memory knowledge store) have **no tests at all** — where silent regressions are most likely as the diplomacy/conversation system evolves (the focus of recent commits).

These documents propose a **comprehensive set of new mock-tier unit tests** across all four packages. They are **plans only** — no test files are written yet. Each proposal names the new test file, the source under test, the cases to cover, and the mocking strategy, all following conventions already present in the repo.

## Documents

| File | Scope |
|---|---|
| [01-vox-agents.md](01-vox-agents.md) | vox-agents agent & pipeline logic (analyst, librarian, telepathist, oracle, archivist, infra, utils) |
| [02-mcp-server.md](02-mcp-server.md) | mcp-server tools, getters, and knowledge store |
| [03-bridge-service.md](03-bridge-service.md) | bridge-service event-pipe gap |
| [04-ui-web.md](04-ui-web.md) | vox-agents web server, SSE manager, routes, and Vue components |

## Corrections to note before implementing

All named source targets were re-verified to exist. The following mischaracterizations and overlaps were found during review and are reflected in the per-package docs — read them before writing the affected tests:

- `vox-agents/src/utils/diplomacy/transcript.ts` is **already** covered by [transcript-io.test.ts](../../../vox-agents/tests/mock/diplomacy/transcript-io.test.ts) — do not re-test it.
- `infra/vox-civilization.ts` is the **Civ5 process-lifecycle manager** (spawn/kill/crash-recovery/seed save+restore), *not* a player/civ metadata accessor, and it is already exercised by the live test [tests/live/game/vox-civilization.test.ts](../../../vox-agents/tests/live/game/vox-civilization.test.ts). See 01 for the corrected mock scope.
- `telepathist/summarizer.ts` is a `VoxAgent` **prompt builder** (system prompt + hash-based caching), not a pure data aggregator. See 01.
- `oracle/replayer.ts` is already partly covered by [replayer-cache.test.ts](../../../vox-agents/tests/mock/oracle/replayer-cache.test.ts); the new `replayer.test.ts` must scope to the non-cache paths. See 01.
- The UI has **no `ConversationPanel` / `DecisionPanel` and no human-decision component** — the conversation surface is the `ui/src/components/chat/` set; nothing in `ui/src` consumes present-decision. See 04 for real component names.

Before writing any proposed test, re-confirm the target is actually uncovered (grep `tests/` for the module name) and skim the source to confirm its real shape — the survey had several such false positives.

## Testing conventions to reuse (do not reinvent)

All new tests must match existing patterns:

- **Framework**: Vitest, ESM, `*.test.ts`, placed under `tests/mock/<area>/` per package. Default command `npm run test:mock`.
- **vox-agents MCP mocking**: use the shared fixture [mock-mcp-client.ts](../../../vox-agents/tests/helpers/mock-mcp-client.ts) — `installMockMcpClient()`, `respondWith(tool, result)`, `mcp.calls(tool)`, `structuredResult(...)`, and `mockMcpClientModule()` via `vi.mock('../../../src/utils/models/mcp-client.js', ...)`. See [transcript-io.test.ts](../../../vox-agents/tests/mock/diplomacy/transcript-io.test.ts) for the canonical shape.
- **mcp-server store mocking**: use the in-memory-SQLite fixture pattern in [helpers.ts](../../../mcp-server/tests/mock/diplomacy/helpers.ts) — `setupDiplomacyStore(turn)` builds a real `KnowledgeStore` on `:memory:` and redirects the `knowledgeManager` singleton; `seedPlayer(...)` seeds rows. This runs the *real* store path with no bridge/DLL. Generalize it into a shared `mcp-server/tests/mock/helpers.ts` for store/getter/action tests.
- **bridge-service mocking**: use `tests/test-utils/` (`mock-dll-server.ts`, `isolated-mock.ts`, `helpers.ts`). Single-fork pool is required.
- **LLM-agent classes**: these are mostly prompt builders. Test their *pure* methods directly (instantiate the class, call `getSystem`/`getInitialMessages`/`getOutput`/`getModel`) with a stub `StrategistParameters` and a fake `VoxContext` — do **not** invoke a real model. See [diplomat-prompts.test.ts](../../../vox-agents/tests/mock/envoy/diplomat-prompts.test.ts).
- **Stable assertions only**: do not snapshot or compare whole prompts, whole markdown output, or mutable prose. For prompt builders, import shared prompt-section constants/builders and assert the assembled prompt includes those referenced outputs, dynamic input values, stable tool IDs, and branch-specific sections. For formatters, assert key facts/fields and parsed behavior rather than exact wording or whitespace.

## Shared-fixture work (do this first, before any package's tests)

1. Promote `setupDiplomacyStore`/`seedPlayer` to a package-level `mcp-server/tests/mock/helpers.ts`.
2. Add `vox-agents/tests/helpers/fake-vox-context.ts` — a spyable `VoxContext` (stub `callTool`) plus a `StrategistParameters` builder.

## Cross-package verification

- Per package: `npm run test:mock` must stay green (single-fork pool preserved).
- Coverage deltas: `npm run test:coverage` in each package; compare the v8 `text` summary before/after. mcp-server already emits HTML under `mcp-server/coverage/`; generate the same for vox-agents and bridge-service (currently empty).
- No test may reach a live game/OBS/DLL — every new test is mock-tier (in-memory store, mocked `node-ipc`, mocked MCP client, fake VoxContext). No `tests/real`/`tests/live` additions.
- `npm run build` (tsc) and ESLint stay clean for new `*.test.ts` files.
