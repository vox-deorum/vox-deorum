# vox-agents UI & Web Server Test Plan

> See [README.md](README.md) for shared context, conventions, and shared-fixture prerequisites.

Two surfaces are under-tested here: the **vox-agents web backend** (`src/web/` — Express server, SSE manager, routes) which has no unit tests, and the **Vue UI** which currently tests only `ParamsList` and `TextMessage`. The UI uses Vitest + jsdom + Vue Test Utils (see [setup.ts](../../../vox-agents/ui/tests/setup.ts) with its EventSource shim and fake timers).

## Web backend (vox-agents/src/web)

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/web/sse-manager.test.ts` | [web/sse-manager.ts](../../../vox-agents/src/web/sse-manager.ts) | Client registration/tracking, event push to channel, cleanup on disconnect, stats | Stub `better-sse` channel/session |
| `tests/mock/web/routes.test.ts` | [web/routes/](../../../vox-agents/src/web/routes/) | The four route modules are `agent.ts`, `config.ts`, `session.ts`, `telemetry.ts`. Assert each handler returns the expected JSON shape & status code (e.g. session status/configs, config read+diff, agent listing) plus error paths. Prioritize `config.ts` and `session.ts` (most logic); `agent.ts`/`telemetry.ts` have heavy registry/fs coupling — stub aggressively or defer | `supertest` against the Express app with stubbed VoxContext/VoxSession + registries |

Note: `supertest` is already a dev dependency in the monorepo (used by bridge-service route tests), so the route-test pattern is established.

## Vue components (vox-agents/ui)

Existing: `tests/mock/components/ParamsList.test.ts`, `TextMessage.test.ts` (note `TextMessage.vue` lives under `components/chat/`). The conversation/transcript surface is the **`components/chat/` set** — there is no `ConversationPanel`, and **no human-decision/`DecisionPanel` component exists** (nothing in `ui/src` consumes present-decision/human-decision). Target real, high-value untested components:

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/components/chat/ChatMessages.test.ts` | [chat/ChatMessages.vue](../../../vox-agents/ui/src/components/chat/ChatMessages.vue) | Renders an ordered message list; dispatches each message to the right child by role/type (text/reasoning/tool-call/tool-result); empty-transcript state | Vue Test Utils + jsdom |
| `tests/mock/components/chat/ToolCallMessage.test.ts` & `ToolResultMessage.test.ts` | chat/ToolCallMessage.vue, chat/ToolResultMessage.vue | Tool name/args rendering, result/error formatting, collapsed/expanded state | Vue Test Utils |
| `tests/mock/components/chat/ReasoningMessage.test.ts` | chat/ReasoningMessage.vue | Reasoning block render + collapse | Vue Test Utils |
| `tests/mock/components/ChatSessionsList.test.ts` | [ChatSessionsList.vue](../../../vox-agents/ui/src/components/ChatSessionsList.vue) | Session list render, selection/emit, empty state | Vue Test Utils |
| `tests/mock/api/client.test.ts` | [api/client.ts](../../../vox-agents/ui/src/api/client.ts) | The only untested `ui/src/api` helper (log-utils/telemetry-utils already covered): request shaping, SSE/EventSource handling, error mapping | EventSource shim from setup |

> Confirmed against `ui/src/components/` on review. If a conversation/decision UI is added later (e.g. tied to `present-decision`), add its tests then — it does not exist yet.

## Suggested order

1. `sse-manager.test.ts` (pure-ish, fast).
2. `routes.test.ts` via supertest.
3. Vue component tests, prioritizing the conversation/diplomacy UI.
