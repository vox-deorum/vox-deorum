# vox-agents UI & Web Server Test Plan

> See [README.md](README.md) for shared context, conventions, and shared-fixture prerequisites.

Two surfaces are under-tested here: the **vox-agents web backend** (`src/web/` — Express server, SSE manager, routes) and the **Vue UI**. There is already a small UI real-tier backend smoke test in [backend.test.ts](../../../vox-agents/ui/tests/real/backend.test.ts), but it only covers health/session basics. The Vue mock tier currently tests only `ParamsList` and `TextMessage`. The UI uses Vitest + jsdom + Vue Test Utils (see [setup.ts](../../../vox-agents/ui/tests/setup.ts) with its inert EventSource shim and fake timers).

## Web backend (vox-agents/src/web)

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/web/sse-manager.test.ts` | [web/sse-manager.ts](../../../vox-agents/src/web/sse-manager.ts) | Sets SSE headers and initial heartbeat on `addClient`; tracks client count; removes clients on `close`; broadcasts `event:`/`data:` frames; tolerates write failures; `sendHeartbeat`, `closeAll`, and `startHeartbeat` work with fake timers | Stub Express `Response` (`setHeader`, `write`, `end`, `on`) |
| `tests/mock/web/routes.test.ts` | [web/routes/](../../../vox-agents/src/web/routes/) | The four route modules are `agent.ts`, `config.ts`, `session.ts`, `telemetry.ts`. Assert each handler returns the expected JSON shape & status code (session status/configs/start-stop guards, `/api/config` read/write/check, agent listing/chat guards, telemetry listing/upload errors) plus error paths. Prioritize `config.ts` and `session.ts`; `agent.ts`/`telemetry.ts` have heavy registry/fs coupling, so stub aggressively or split them into separate files | `supertest` against the exported Express `app` or mounted routers with stubbed registries, filesystem, MCP client, and VoxContext/VoxSession |

Note: `supertest` is already a dev dependency in the monorepo (used by bridge-service route tests), so the route-test pattern is established.

## Vue components (vox-agents/ui)

Existing: `tests/mock/components/logging/ParamsList.test.ts`, `tests/mock/components/chat/TextMessage.test.ts` (note `TextMessage.vue` lives under `components/chat/`). The conversation/transcript surface is the **`components/chat/` set** — there is no `ConversationPanel`, and **no human-decision/`DecisionPanel` component exists** (nothing in `ui/src` consumes present-decision/human-decision). Target real, high-value untested components:

| New test file | Target | Cases | Mocking |
|---|---|---|---|
| `tests/mock/components/chat/ChatMessages.test.ts` | [chat/ChatMessages.vue](../../../vox-agents/ui/src/components/chat/ChatMessages.vue) | Empty-transcript state, passes messages/labels/metadata into `ChatMessage`, initial auto-scroll and `scrollTrigger` behavior with a stubbed `virtua/vue` `VList` | Vue Test Utils + jsdom |
| `tests/mock/components/chat/ChatMessage.test.ts` | [chat/ChatMessage.vue](../../../vox-agents/ui/src/components/chat/ChatMessage.vue) | Dispatches string and array content to `TextMessage`, `ReasoningMessage`, and `ToolCallMessage`; filters `tool-result` parts into the matching tool-call result; cleans tool artifacts from text; preserves chronological non-result parts | Stub child components and `cleanToolArtifacts` |
| `tests/mock/components/chat/ToolCallMessage.test.ts` | chat/ToolCallMessage.vue | Spinner vs completed icon, tool name rendering, detail dialog entries for input/output, click opens details | Vue Test Utils; stub `DetailDialog` |
| `tests/mock/components/chat/ToolResultMessage.test.ts` | chat/ToolResultMessage.vue | Low-priority legacy/standalone component: string result, JSON-ish result, null/undefined hidden state | Vue Test Utils; stub `vue-json-pretty` |
| `tests/mock/components/chat/ReasoningMessage.test.ts` | chat/ReasoningMessage.vue | Reasoning block render + collapse | Vue Test Utils |
| `tests/mock/components/chat/ChatSessionsList.test.ts` | [ChatSessionsList.vue](../../../vox-agents/ui/src/components/chat/ChatSessionsList.vue) | Session list render, fallback title/agent naming, selection emit, resume/delete emits without also selecting the row, hidden actions, empty state slot | Vue Test Utils; stub PrimeVue children if needed |
| `tests/mock/api/client.test.ts` | [api/client.ts](../../../vox-agents/ui/src/api/client.ts) | Untested `ui/src/api` helper (log-utils/telemetry-utils already covered): fetch URL/method/body shaping for active endpoints, error mapping for JSON and text failures, upload errors, connection replacement/cleanup for logs/session/agent SSE streams | Stub `fetch`, `EventSource`, and `sse.js` `SSE` explicitly; close all connections after each test |

> Confirmed against `ui/src/components/` on review. If a conversation/decision UI is added later (e.g. tied to `present-decision`), add its tests then — it does not exist yet.

## Suggested order

1. `sse-manager.test.ts` (pure, fast, no backend).
2. `ChatMessage.test.ts` + `ToolCallMessage.test.ts` (highest chat-surface value).
3. `routes.test.ts` via supertest, starting with config/session.
4. Remaining Vue component tests and `api/client.test.ts`.
