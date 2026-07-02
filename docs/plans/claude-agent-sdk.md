# Add the Claude Code (Agent SDK) provider

> Implementation plan. Register `ai-sdk-provider-claude-code` as a new `claude-code` LLM provider so vox-agents can route any agent through the locally-installed Claude Agents SDK. The provider has no native AI-SDK tool calling, so vox-agents **game tools always stay in the existing prompt-mode emulation lane**. Built-in CLI tools (Read/Write/WebFetch/…, never Bash) are an explicit per-model opt-in that runs under `permissionMode: 'dontAsk'` with Write/Edit path-scoped to a temp folder keyed to `gameID-playerID`; when on, the injected tool-prompt gets a co-existence preamble (overridable per model) and the CLI-executed tool calls are surfaced into vox-agents telemetry.

## Stages

Three independently-shippable, ordered checkpoints. Each keeps the package type-checking and the mock test suite green.

- [x] **Stage 1 — Core provider (pure-text, prompt-mode game tools).** ✅ DONE (2026-06-30). Any agent can use `claude-code/sonnet` as a drop-in text model with full prompt-mode tool calling. This is the ~95% case.
- [ ] **Stage 2 — Optional built-in CLI tools + temp folder + prompt override.** `options.claudeCodeTools` opt-in (`['everything']` = a vetted safe set; Bash never allowed) under `dontAsk` with path-scoped Write/Edit; `options.claudeCodePromptOverride`; thread `gameID-playerID` into `getModel()`; tool-rescue middleware learns an optional `preamble`.
- [ ] **Stage 3 — Built-in tool-call telemetry.** Surface CLI-executed built-in tool calls/results (which arrive as `providerExecuted: true` AI-SDK parts — confirmed in provider source) as vox-agents per-tool spans mirroring the `mcp-tool.*` shape.

## Background

`ai-sdk-provider-claude-code` (repo `ben-vargas/ai-sdk-provider-claude-code`, npm same name) is a community Vercel AI SDK provider that drives Anthropic's Claude **Agent SDK** / Claude Code CLI as a subprocess. Facts verified against the installed `3.5.0` and `@anthropic-ai/claude-agent-sdk` `0.3.x`:

- **Exports** `createClaudeCode` and `claudeCode`; factory call `createClaudeCode()(modelId, settings?)` returns `@ai-sdk/provider`'s `LanguageModelV3` (no cast needed). Also `createAiSdkMcpServer`, `createSdkMcpServer`, `tool`, error guards (`isAuthenticationError`).
- **Model ids** `'haiku' | 'sonnet' | 'opus'` or a full id (`'claude-sonnet-4-6'`).
- **AI SDK** `3.x` targets `ai@^6`; the monorepo pins `ai@^6.0.0` (root `package.json:44`). Compatible.
- **Auth** local Claude Code CLI **subscription** auth — does **not** read `ANTHROPIC_API_KEY`. Prerequisite: a recent authenticated `claude` CLI.
- **No native tools.** AI SDK `tools`/`toolChoice` (≠ `'auto'`) and sampling params are ignored with a warning — and the one call site sets none of them.
- **Settings used** (all on `ClaudeCodeSettings`): `cwd`, `tools?: string[] | {type:'preset', preset:'claude_code'}` (availability; `[]` is the **documented** "disable all built-in tools"), `allowedTools`/`disallowedTools` (permission rules, accept path specifiers like `Edit(docs/**)`), `permissionMode`, `settingSources`, `effort?: 'low'|'medium'|'high'|'xhigh'|'max'`, `thinking` (accepts `{type:'disabled'}`).
- **`permissionMode: 'bypassPermissions'` additionally requires `allowDangerouslySkipPermissions: true`** (SDK-enforced safety flag). We avoid it entirely: `'dontAsk'` ("don't prompt; deny if not pre-approved") plus `allowedTools` rules gives the same no-prompt behavior with deny-by-default instead of bypass.
- **`settingSources` is load-bearing.** Agent SDK `0.3.x` made *omitting* it load ALL filesystem settings (`CLAUDE.md`, `.claude/settings.json`) — this repo root has both. We pass `settingSources: []` explicitly (the provider also defaults to `[]`).
- **Provider-executed tool parts.** Every CLI-executed tool surfaces as AI-SDK `tool-call`/`tool-result`/`tool-error` parts stamped `providerExecuted: true, dynamic: true` — the builders (`buildToolCallPart`/`buildToolResultPart`) are shared by `doGenerate` and `doStream`, and oversized tool results are truncated before emission. This is Stage 3's foundation.
- **Platform.** `@anthropic-ai/claude-agent-sdk` ships per-platform binaries via `optionalDependencies` (Windows `win32-x64` included). CI/Docker must keep optional deps.

### Why game tools stay in prompt-mode (and the MCP bridge is rejected)

vox-agents has one real SDK chokepoint: `getModel(config): LanguageModel` (`src/utils/models/models.ts:100`) is imported only by `src/infra/vox-context.ts` and called once at `vox-context.ts:771` (inside `executeAgentStep`), feeding the single `streamText` in `streamTextWithConcurrency` (`concurrency.ts:171`). That call always passes `tools`, `activeTools`, `toolChoice`.

For no-native-tool providers, `toolRescueMiddleware({ prompt: true })` strips `tools` from the request (`tool-rescue/middleware.ts:108-111`), injects a JSON tool-call protocol as a system message (`middleware.ts:82-105`), and re-synthesizes `tool-call`/`tool-result` stream parts from the model's text (`middleware.ts:115-292`, `tool-rescue/extract.ts`). Already shipping for ~15 models (`defaults.ts`).

A bridge that turns game tools into native Claude/MCP tools (`createAiSdkMcpServer`) was investigated and **rejected**. The game tools are doubly coupled to the AI-SDK loop:

1. **In-process state.** `send-message`, `close-conversation`, `call-negotiator`, the negotiator's `accept-deal`/`propose-deal`/`reject-deal`, and the `call-*` agent tools mutate `VoxContext` AsyncLocalStorage state — `currentInput.outcome` (`negotiator-utils.ts:501,541,632,681`), the abort signal, `forkRun()` (`agent-tools.ts:79-86`), and a dedup `WeakMap` keyed on the AI-SDK per-step `messages`. An out-of-loop bridge has none of it.
2. **Stream-part visibility.** Turn termination (`stopCheck`, `live-envoy.ts:121-129`, `vox-agent.ts:194-198`), transcript archival (`collectSpokenReply`, `transcript-utils.ts:181-219`), live UI streaming (`send-message-stream.ts:163-208`), per-tool telemetry, and token accounting all read game-tool calls **as AI-SDK stream parts / `StepResult`**. Bridged tools surface only as `providerExecuted: true, dynamic: true` parts with `mcp__…` names — a shape none of that code matches.

So: **game tools are always prompt-mode for claude-code.** Built-in CLI tools, when enabled, run in the CLI's own loop alongside (Stage 2), and we read their `providerExecuted` parts for telemetry only (Stage 3), never control flow.

---

## Stage 1 — Core provider (pure-text, prompt-mode game tools) ✅

> **Status: implemented (2026-06-30).** `npm run type-check` clean; full mock suite green (new `tests/mock/utils/models.test.ts`, 6 tests). Built against `ai-sdk-provider-claude-code@3.5.0`. **Not yet run:** the manual real-CLI SAFETY-GATE turn (needs an authenticated `claude` CLI) — still required before relying on `claude-code/*` in production.

### 1.1 Dependency
Monorepo-root `package.json` `dependencies`: `"ai-sdk-provider-claude-code": "^3.5.0"` (guarantees the `effort`/`thinking` and top-level `tools` fields this plan uses). Keep `optionalDependencies` on install. Import smoke-check: `node -e "import('ai-sdk-provider-claude-code').then(()=>console.log('ok'))"` — no import-time CLI spawn.

### 1.2 Provider case — `src/utils/models/models.ts:156-174`
```ts
import { createClaudeCode, type ClaudeCodeSettings } from 'ai-sdk-provider-claude-code';
```
The middleware tail of `getModel` switches on `config.options?.toolMiddleware` (`models.ts:207-225`). The `claude-code` case (alongside `case "anthropic":`) **forces** prompt mode by rebinding `config` so the tail's `"prompt"` branch always runs:
```ts
case "claude-code": {
  // No native AI-SDK tool calling — game tools MUST be prompt-emulated; force it.
  config = { ...config, options: { ...config.options, toolMiddleware: 'prompt' } };
  const opts = config.options ?? {};
  const settings: ClaudeCodeSettings = {
    settingSources: [], // explicit: never load CLAUDE.md / .claude/settings.json
    tools: [],          // Stage 1: disable all built-in CLI tools (zero host tool execution)
  };
  // reasoningEffort -> `effort` (non-adaptive); 'minimal' disables thinking instead.
  if (opts.reasoningEffort === 'minimal') {
    settings.thinking = { type: 'disabled' };
  } else if (opts.reasoningEffort) {
    settings.effort = opts.reasoningEffort; // 'low'|'medium'|'high' ⊆ EffortLevel
  }
  result = createClaudeCode()(config.name, settings);
  break;
}
```
`buildProviderOptions()` needs **no** claude-code branch — the default branch yields `{ 'claude-code': model.options }`, inert (the provider reads construction-time `settings`, not runtime `providerOptions`).

### 1.3 Default models — `src/utils/config/defaults.ts:87-101`
`claude-code/{sonnet,opus,haiku}` entries with `provider: 'claude-code'` and **no** `options.toolMiddleware` — prompt mode is forced unconditionally in the provider case, so storing it on the config would be dead weight; a comment in `defaults.ts` says so. `config.json`'s `default` is unchanged.

### 1.4 UI provider list — `src/types/constants.ts:28`
`{ label: 'Claude Code', value: 'claude-code' }` in `llmProviders`. No `apiKeyFields` entry (CLI subscription auth).

### 1.5 Tests — `tests/mock/utils/models.test.ts`
First per-provider unit test for `models.ts`. Mocks the package (both exports) via a `vi.hoisted` capture holder (a plain `let` trips Vitest's mock-hoisting guard), returning `MockLanguageModelV3` from `ai/test` so the `wrapLanguageModel` tail accepts it. Asserts: `getModelConfig('claude-code/sonnet')` resolves to the registered entry (with `toolMiddleware` undefined per 1.3); captured `settingSources: []` and `tools: []`; `reasoningEffort:'high'` → `effort:'high'`, no `thinking`; `'minimal'` → `thinking:{type:'disabled'}`, no `effort`; neither set when unconfigured.

---

## Stage 2 — Optional built-in CLI tools + temp folder + prompt override

### 2.1 Config options — `src/types/config.ts` (`LLMConfig.options`, after `systemPromptFirst`)
```ts
/**
 * claude-code only: built-in CLI tools to enable. Undefined/empty = pure text
 * model (no tool execution). ['everything'] = a vetted safe set. Any other list
 * = an explicit whitelist. Bash is NEVER enabled, even if listed. When enabled,
 * the CLI runs under dontAsk in a temp folder keyed to gameID-playerID, with
 * Write/Edit path-scoped to that folder.
 */
claudeCodeTools?: string[];
/**
 * claude-code only: replaces the auto-generated co-existence preamble prepended
 * to the prompt-mode tool instructions (disambiguates built-in CLI tools from
 * vox-agents game tools when built-in tools are enabled).
 */
claudeCodePromptOverride?: string;
```

### 2.2 Vetted/blocked tool constants — `src/utils/models/models.ts`
```ts
// Vetted safe built-in tools that `['everything']` expands to (Bash excluded).
const CLAUDE_CODE_SAFE_TOOLS = ['Read','Glob','Grep','WebFetch','WebSearch','Write','Edit','TodoWrite'];
// Never enabled, even if explicitly listed.
const CLAUDE_CODE_BLOCKED_TOOLS = ['Bash'];
```

### 2.3 Signature + built-in-tool wiring — `getModel`
Replace the dead `useToolPrompt` option (`models.ts:100`, never read) with a working-dir id:
```ts
export function getModel(config: Model, options?: { workingDirId?: string }): LanguageModel
```
Extend the `claude-code` case. Declare `let claudeCodePreamble: string | undefined;` **before** the middleware switch, set it here, pass it into the `"prompt"` middleware branch (2.4). Replace the fixed `tools: []` with:
```ts
const requested = opts.claudeCodeTools;
if (!requested || requested.length === 0) {
  settings.tools = [];                         // pure text: no built-ins in context
} else {
  const expanded = (requested.length === 1 && requested[0] === 'everything')
    ? CLAUDE_CODE_SAFE_TOOLS
    : requested;
  const allowed = expanded.filter(t => !CLAUDE_CODE_BLOCKED_TOOLS.includes(t));
  const id = options?.workingDirId ?? 'default';
  const dir = path.join(os.tmpdir(), 'vox-claude-code', id);
  fs.mkdirSync(dir, { recursive: true });
  settings.cwd = dir;
  settings.tools = allowed;                    // availability: bare names only
  // Permission layer: dontAsk = never prompt, DENY anything not pre-approved
  // below. No bypassPermissions (which would need allowDangerouslySkipPermissions
  // and approve everything, everywhere). Write/Edit rules are path-scoped to the
  // temp cwd — relative rule paths resolve against the session cwd.
  settings.permissionMode = 'dontAsk';
  settings.allowedTools = allowed.map(t =>
    t === 'Write' || t === 'Edit' ? `${t}(./**)` : t);
  settings.disallowedTools = CLAUDE_CODE_BLOCKED_TOOLS; // defense in depth
  // Co-existence: these are CLI tools, distinct from the JSON game actions.
  claudeCodePreamble = opts.claudeCodePromptOverride
    ?? `## Built-in tools\nYou also have these built-in CLI tools, called natively (NOT via the JSON format below): ${allowed.join(', ')}.\nUse the JSON tool-call format ONLY for the game actions listed under "Available Tools".`;
}
```
Layering: `tools` bounds what is *in context* (availability), `allowedTools` is what may *run* (permission), `dontAsk` denies the rest without prompting. **`cwd` is NOT a sandbox** — it only resolves relative paths — so the path confinement comes from the `Write(./**)`/`Edit(./**)` rules plus dontAsk's deny-by-default. If manual verification (below) shows relative rule paths not resolving against `cwd`, switch to absolute patterns built from `dir` (forward-slashed, `//`-prefixed).
Node imports at the top of `models.ts`: `import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';`.

### 2.4 Middleware preamble — `src/utils/models/tool-rescue/{types,middleware}.ts`
Add `preamble?: string;` to `ToolRescueOptions` (`types.ts:10-22`). In `transformParams`, after `const toolPrompt = createToolPrompts(...)` (`middleware.ts:82`):
```ts
const withPreamble = toolPrompt && options?.preamble ? `${options.preamble}\n\n${toolPrompt}` : toolPrompt;
```
and use `withPreamble` where `toolPrompt` is consumed (`middleware.ts:92-105`). In `getModel`'s `"prompt"` branch (`models.ts:214-219`), pass `preamble: claudeCodePreamble` alongside `prompt`/`systemPromptFirst`. It is `undefined` for non-claude-code models — behavior unchanged. Known gap, acceptable: `transformParams` early-returns when a step has no game tools (`middleware.ts:77`), so such a step gets no preamble — but there is no JSON protocol to disambiguate then either.

### 2.5 Thread the seat id — `src/infra/vox-context.ts:771`
`parameters` (`AgentParameters` with `gameID:string`, `playerID:number`) is in scope in `executeAgentStep`. Change `model: getModel(stepModel)` to:
```ts
model: getModel(stepModel, { workingDirId: `${parameters.gameID}-${parameters.playerID}` }),
```
This is the only call site of the module-level `getModel` (the `VoxAgent.getModel` methods are unrelated config resolvers).

### 2.6 Tests — extend `tests/mock/utils/models.test.ts`
- `claudeCodeTools: ['everything']` + `{workingDirId:'g1-3'}` → captured `tools` deep-equals `CLAUDE_CODE_SAFE_TOOLS` (no `Bash`); `allowedTools` is the same list with `Write`/`Edit` replaced by `Write(./**)`/`Edit(./**)`; `disallowedTools: ['Bash']`; `permissionMode: 'dontAsk'`; `cwd` ends with `path.join('vox-claude-code','g1-3')` (build the expectation with `path.join` — literal `/` fails on Windows) and the folder exists.
- `claudeCodeTools: ['Read','Bash']` → captured `tools` equals `['Read']` (Bash filtered).
- Tool-rescue middleware: `toolRescueMiddleware({prompt:true, preamble:'PRE'})` `transformParams` prepends `PRE` to the injected system message; `claudeCodePromptOverride` flows through as the preamble. Clean up temp folders in `afterEach`.

---

## Stage 3 — Built-in tool-call telemetry

When built-in tools are enabled, the CLI executes them in its own loop; the provider surfaces each as AI-SDK `tool-call`/`tool-result` (or `tool-error`) parts stamped `providerExecuted: true, dynamic: true`. **Confirmed in the `3.5.0` source:** the part builders stamp these unconditionally for every CLI-executed tool and are shared by `doGenerate`/`doStream`; the stream path emits them for any tool arriving via `content_block` events; oversized tool results are truncated before emission (capping token growth when the parts flow into the next step's converted history). The middleware-synthesized game-tool parts are *not* provider-executed, so the two populations are cleanly separable. Built-in tool calls currently get no vox-agents span — the existing per-tool spans live in the in-process `execute` of `mcp-tools.ts:112-176` / `simple-tools.ts` / `agent-tools.ts`, which built-in tools never hit.

### 3.1 Extract + span — `src/infra/vox-context.ts` (`executeAgentStep`)
Read the parts from **`stepResponse.content`**, not `stepResponse.response.messages`. `stepResponse` is the last `StepResult` (`vox-context.ts:800`), and `StepResult.content` carries `providerExecuted` on **both** the `tool-call` and `tool-result` variants, with the tool-result `output` unwrapped. The `response.messages` layer structurally **drops** `providerExecuted` from tool-results (only the tool-*call* keeps it) and wraps `output` in a `{type:'json',value}` envelope — filtering there would silently match nothing.

After `stepResponse` resolves, gate on `stepModel.provider === 'claude-code'` (zero-cost otherwise), then walk `stepResponse.content` for parts with `providerExecuted === true` (key on that alone — `dynamic` is also true but irrelevant), pair `tool-call` with its `tool-result`/`tool-error` by `toolCallId`, and emit one span per call mirroring the `mcp-tool.*` shape:
```ts
// span name `claude-code-tool.<toolName>`, kind CLIENT, attributes:
//   'tool.name', 'tool.type': 'claude-code-builtin', 'vox.context.id': this.id,
//   'game.turn': String(parameters.turn), 'tool.input': JSON.stringify(input),
//   'tool.output': JSON.stringify(output); tool-error or isError -> ERROR status.
```
The tools already ran inside the CLI, so these are retrospective point-in-time spans under the step span, not timed wrappers.

### 3.2 Tests
Unit-test the extraction helper with a synthetic `stepResponse.content` containing a `providerExecuted` tool-call + tool-result pair, a `providerExecuted` tool-call + tool-error pair, and a normal (non-provider-executed) game-tool part. Assert only the built-in pairs produce span records (fake tracer/span recorder), the error pair gets ERROR status, and the game-tool part is ignored.

---

## Cross-cutting risks

- **SAFETY GATE — `tools: []` must mean zero host tool execution.** It is the default path for all three registered models. Type/doc-level: resolved — the Agent SDK documents `[]` as "Disable all built-in tools" and the provider forwards it. **Still outstanding:** one empirical real-CLI turn confirming a `claude-code/sonnet` generation has no built-in tools available and runs none — required before production use.
- **Bash is unconditionally blocked** — excluded from `tools`/`allowedTools` and listed in `disallowedTools`. Extend `CLAUDE_CODE_BLOCKED_TOOLS` if other shell-adjacent built-ins appear.
- **Deny-by-default permission posture.** `dontAsk` + explicit `allowedTools` means anything unlisted is denied, never prompted; `bypassPermissions` (and its required `allowDangerouslySkipPermissions`) is never used. Residual, accepted by the opt-in: `Read`/`Glob`/`Grep` are read-only but **not path-scoped** — they can read host files into the agent context — and `WebFetch`/`WebSearch` reach the network. Only `Write`/`Edit` are confined to the temp folder, and that confinement rests on the path-scoped rules (not `cwd`) — verify it empirically (below).
- **Structured output through prompt-mode.** `vox-context.ts:786` sets `experimental_output: Output.object(...)` alongside prompt-mode tools — identical to every other prompt-mode provider, so claude-code inherits existing behavior. The provider's "structured mode bypasses tool bridging" note concerns the rejected MCP bridge. Verify a real turn with both a schema and active tools anyway.
- **Co-existence is experimental.** Built-in tools + prompt-mode game tools in one turn is new; the preamble (overridable via `claudeCodePromptOverride`) is the mitigation. The default (no built-in tools) is the proven path.
- **Temp folders persist and are reused** (deterministic `vox-claude-code/<gameID>-<playerID>`); two games sharing a gameID-playerID pair on one host share the folder. No cleanup policy.
- **CLI prerequisite.** A recent authenticated `claude` CLI is required (`effort` needs Agent SDK `0.3.x`); missing/old CLI fails at runtime — optionally surface a friendlier message via `isAuthenticationError`.
- **Throughput.** Each call is a CLI subprocess; `streamTextWithConcurrency` + `options.concurrencyLimit` gate parallelism if subprocess pressure appears.

## Verification

- `cd vox-agents && npm run type-check` — clean after each stage.
- `cd vox-agents && npm test` (mock tier) — `models.test.ts`, middleware preamble, and Stage-3 extraction tests pass; full suite stays green.
- Manual (authenticated `claude` CLI), one session covering the outstanding gates:
  1. Default config: a diplomacy turn on `claude-code/sonnet` with an output schema and active tools — prompt-mode tool calls parse, the object parses, no spurious rescue, **zero** host tools run.
  2. `claudeCodeTools: ['everything']`: the `vox-claude-code/<gameID>-<playerID>` folder is created/reused; built-in tools run (never Bash); a `Write` to an **absolute path outside the temp folder is denied** (confirms the path-scoped rules resolve against `cwd` — if not, switch to absolute rule patterns per 2.3); the calls appear as `claude-code-tool.*` spans (Stage 3).

## Out of scope

- **Embeddings** (`getEmbeddingModel`) and **oracle batch** — no claude-code path.
- **MCP tool bridging** of game tools (`createAiSdkMcpServer`) — rejected above.
- **Session persistence/resume/fork, sandbox, plugins, skills, hooks** and other `ClaudeCodeSettings` features.
- **`config.json` `default`** — unchanged.
