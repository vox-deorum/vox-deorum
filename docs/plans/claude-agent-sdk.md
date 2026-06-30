# Add the Claude Code (Agent SDK) provider

> Implementation plan. Register `ai-sdk-provider-claude-code` as a new `claude-code` LLM provider so vox-agents can route any agent through the locally-installed Claude Agents SDK. The provider has no native AI-SDK tool calling, so vox-agents **game tools always stay in the existing prompt-mode emulation lane**. Built-in CLI tools (Read/Write/WebFetch/…, never Bash) are an explicit per-model opt-in that runs in a temp folder keyed to `gameID-playerID`; when on, the injected tool-prompt is made co-existence-aware (overridable per model) and the CLI-executed tool calls are surfaced into vox-agents telemetry.

## Stages

The work lands in three independently-shippable, ordered checkpoints. Each keeps the package type-checking and the mock test suite green.

- [ ] **Stage 1 — Core provider (pure-text, prompt-mode game tools).** Install the package; add the `claude-code` case to `getModel()` (forces prompt middleware, `settingSources: []`, effort-only reasoning, no built-in tools); register `claude-code/{sonnet,opus,haiku}` defaults; add the UI provider entry; first `models.ts` unit test. After this, any agent can use `claude-code/sonnet` as a drop-in text model with full prompt-mode tool calling. This is the ~95% case.
- [ ] **Stage 2 — Optional built-in CLI tools + temp folder + prompt override.** Add `options.claudeCodeTools` (opt-in list; `['everything']` = a vetted safe set; Bash never allowed) and `options.claudeCodePromptOverride`; thread `gameID-playerID` into `getModel()` for the per-seat temp `cwd`; teach the tool-rescue middleware an optional `preamble` so the game-tool prompt can disambiguate game actions from built-in CLI tools.
- [ ] **Stage 3 — Built-in tool-call telemetry.** Surface the CLI-executed built-in tool calls/results (which arrive as `providerExecuted` AI-SDK parts) into vox-agents per-tool spans, mirroring the existing `mcp-tool.*` span shape.

## Background

`ai-sdk-provider-claude-code` (repo `ben-vargas/ai-sdk-provider-claude-code`, npm `ai-sdk-provider-claude-code`) is a community Vercel AI SDK provider that drives Anthropic's Claude **Agent SDK** / Claude Code CLI as a subprocess. Facts verified against the package source (`3.5.x`) and `@anthropic-ai/claude-agent-sdk` (`0.3.x`):

- **Exports** `createClaudeCode` and `claudeCode` (`src/index.ts`); factory call `createClaudeCode()(modelId, settings?)`. Also `createAiSdkMcpServer`, `createSdkMcpServer`, `tool`, error guards (`isAuthenticationError`).
- **Model ids** `'haiku' | 'sonnet' | 'opus'` or a full id (`'claude-sonnet-4-6'`).
- **AI SDK** latest `3.x` targets `ai@^6`; the monorepo pins `ai@^6.0.0` (root `package.json:44`). Compatible.
- **Auth** local Claude Code CLI **subscription** auth — does **not** read `ANTHROPIC_API_KEY`. Prerequisite: a recent `claude` CLI installed and authenticated. `effort`/`thinking` are `0.3.x`-era features.
- **No native tools.** AI SDK `tools`/`toolChoice` (≠ `'auto'`) are ignored with a warning. Sampling params (`temperature`, `topP`, `maxOutputTokens`, …) likewise — and the one call site sets none of them.
- **Settings used** (all present directly on `ClaudeCodeSettings`): `cwd?: string`, `allowedTools?: string[]`, `disallowedTools?: string[]`, `permissionMode?: PermissionMode` (`'default'|'acceptEdits'|'bypassPermissions'|'plan'|'dontAsk'|'auto'`), `settingSources?: ('user'|'project'|'local')[]`, `effort?: 'low'|'medium'|'high'|'xhigh'|'max'`, `thinking?: {type:'adaptive'}|{type:'enabled',budgetTokens?}|{type:'disabled'}`.
- **`settingSources` is load-bearing.** Agent SDK `0.3.x` changed the default so *omitting* `settingSources` loads ALL filesystem settings (`CLAUDE.md`, `.claude/settings.json`). This repo root has both. We must **explicitly** pass `settingSources: []` to keep them out of agent prompts.
- **Platform.** Pulls `@anthropic-ai/claude-agent-sdk`, shipped as per-platform binaries via `optionalDependencies` (Windows `win32-x64` included). CI/Docker must keep optional deps.

### Why game tools stay in prompt-mode (and the MCP bridge is rejected)

vox-agents has one real SDK chokepoint: `getModel(config): LanguageModel` (`src/utils/models/models.ts:99`) is imported only by `src/infra/vox-context.ts:25` and called once at `vox-context.ts:761` (inside `executeAgentStep(parameters, …)` of `VoxContext`), feeding the single `streamText` in `streamTextWithConcurrency` (`concurrency.ts:171`). That call always passes `tools`, `activeTools`, `toolChoice` (`vox-context.ts:771-773`).

For no-native-tool providers, `toolRescueMiddleware({ prompt: true })` (selected by `config.options.toolMiddleware === 'prompt'`, `models.ts:194-199`) strips `tools` from the request (`tool-rescue/middleware.ts:108-112`), injects a JSON tool-call protocol as a system message (`middleware.ts:82-105`, `tool-rescue/prompt.ts:37`), and re-synthesizes `tool-call`/`tool-result` stream parts from the model's text (`middleware.ts:122-146, 215-256`, `tool-rescue/extract.ts`). This is already shipping for ~15 models (`defaults.ts:61-200`).

A bridge that turns game tools into native Claude/MCP tools (`createAiSdkMcpServer`) was investigated and **rejected**. The game tools are doubly coupled to the AI-SDK loop:

1. **In-process state.** `send-message`, `close-conversation`, `call-negotiator`, the negotiator's `accept-deal`/`propose-deal`/`reject-deal`, and the `call-*` agent tools mutate `VoxContext` AsyncLocalStorage state — `currentInput.outcome` (`negotiator-utils.ts:501,541,632,681`), the abort signal, `forkRun()` (`agent-tools.ts:79-86`), and a dedup `WeakMap` keyed on the AI-SDK per-step `messages`. An out-of-loop bridge has none of it.
2. **Stream-part visibility.** Turn termination (`stopCheck`, `live-envoy.ts:121-129`, `vox-agent.ts:194-198`), transcript archival (`collectSpokenReply` reads `send-message` tool-call parts, `transcript-utils.ts:181-219`), live UI streaming (`onChunk` rebuilds the reply from tool chunks, `send-message-stream.ts:163-208`), per-tool telemetry spans, and token accounting all read game-tool calls **as AI-SDK stream parts / `StepResult`**. `createAiSdkMcpServer` surfaces calls only as `providerExecuted:true, dynamic:true` parts with `mcp__…` names — the shape none of that code matches.

So: **game tools are always prompt-mode for claude-code.** Built-in CLI tools, when enabled, run in the CLI's own loop alongside (Stage 2), and we read their `providerExecuted` parts for telemetry (Stage 3) rather than for control flow.

---

## Stage 1 — Core provider (pure-text, prompt-mode game tools)

### 1.1 Dependency
Add to the monorepo-root `package.json` `dependencies` (with the other `@ai-sdk/*` providers):
```jsonc
"ai-sdk-provider-claude-code": "^3.0.0",
```
`npm install` from the repo root; keep `optionalDependencies`. Smoke-check no import-time CLI spawn: `node -e "import('ai-sdk-provider-claude-code').then(()=>console.log('ok'))"`.

### 1.2 Provider case — `src/utils/models/models.ts`
Imports near the other provider imports (`models.ts:8-22`):
```ts
import { createClaudeCode, type ClaudeCodeSettings } from 'ai-sdk-provider-claude-code';
```
The middleware tail of `getModel` switches on `config.options?.toolMiddleware` (`models.ts:187-205`). To **force** prompt mode for claude-code (it is mandatory — game tools must be emulated), the `claude-code` case rebinds `config` so the tail's `"prompt"` branch is taken regardless of how the model was configured. Add the case alongside `case "anthropic":` (`models.ts:152-157`):
```ts
case "claude-code": {
  // Game tools MUST be prompt-emulated for this provider — force it.
  config = { ...config, options: { ...config.options, toolMiddleware: 'prompt' } };
  const opts = config.options ?? {};
  const settings: ClaudeCodeSettings = {
    settingSources: [],      // explicit: never load CLAUDE.md / .claude/settings.json
    tools: [],               // Stage 1: remove ALL built-in tools from context (availability layer)
  };
  // reasoningEffort -> Claude Code `effort` only (non-adaptive), all models.
  if (opts.reasoningEffort === 'minimal') {
    settings.thinking = { type: 'disabled' };
  } else if (opts.reasoningEffort) {
    settings.effort = opts.reasoningEffort; // narrowed to 'low'|'medium'|'high' ⊆ EffortLevel
  }
  result = createClaudeCode()(config.name, settings);
  break;
}
```
`buildProviderOptions()` needs **no** claude-code branch — it falls to the default branch (`models.ts:318-321`) yielding `{ 'claude-code': model.options }`, exactly like the other prompt-mode providers, and is inert (the provider reads its config from the construction-time `settings`, not runtime `providerOptions`).

### 1.3 Default models — `src/utils/config/defaults.ts`
After the `anthropic/claude-*` entries (`defaults.ts:75-86`):
```ts
'claude-code/sonnet': { provider: 'claude-code', name: 'sonnet', options: { toolMiddleware: 'prompt' } },
'claude-code/opus':   { provider: 'claude-code', name: 'opus',   options: { toolMiddleware: 'prompt' } },
'claude-code/haiku':  { provider: 'claude-code', name: 'haiku',  options: { toolMiddleware: 'prompt' } },
```
(The forced rebind in 1.2 makes `toolMiddleware: 'prompt'` redundant here, but keep it explicit for clarity/consistency.) Do **not** change `config.json`'s `default`.

### 1.4 UI provider list — `src/types/constants.ts:25-34`
Add to `llmProviders`: `{ label: 'Claude Code', value: 'claude-code' }`. No `apiKeyFields` entry (CLI subscription auth).

### 1.5 Tests — new `tests/mock/utils/models.test.ts`
No per-provider test for `models.ts` exists today (the mock tier stubs `models.js` wholesale), so this is the first. Mock the package (both exports) returning a `MockLanguageModelV3` from `ai/test` so the middleware `wrapLanguageModel` tail accepts it:
```ts
import { MockLanguageModelV3 } from 'ai/test';
let captured: any;
vi.mock('ai-sdk-provider-claude-code', () => {
  const factory = vi.fn((_id: string, settings: any) => { captured = settings; return new MockLanguageModelV3(); });
  return { createClaudeCode: () => factory, claudeCode: factory };
});
```
Assert: `getModelConfig('claude-code/sonnet')` resolves to the registered entry; `getModel({provider:'claude-code',name:'sonnet',options:{toolMiddleware:'prompt'}})` → captured `settingSources: []`, `tools: []`; `reasoningEffort:'high'` → `effort:'high'`, no `thinking`; `'minimal'` → `thinking:{type:'disabled'}`, no `effort`.

---

## Stage 2 — Optional built-in CLI tools + temp folder + prompt override

### 2.1 Config options — `src/types/config.ts`
Add to `LLMConfig.options` (after `systemPromptFirst`, `config.ts:30`):
```ts
/**
 * claude-code only: built-in CLI tools to enable. Undefined/empty = pure text
 * model (no tool execution). ['everything'] = a vetted safe set. Any other list
 * = an explicit whitelist. Bash is NEVER enabled, even if listed. When enabled,
 * the CLI runs in a temp folder keyed to gameID-playerID.
 */
claudeCodeTools?: string[];
/**
 * claude-code only: replaces the auto-generated co-existence preamble prepended
 * to the prompt-mode tool instructions (used to disambiguate built-in CLI tools
 * from vox-agents game tools when built-in tools are enabled).
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
Replace the dead `useToolPrompt` option (`models.ts:99`, never read) with a working-dir id:
```ts
export function getModel(config: Model, options?: { workingDirId?: string }): LanguageModel
```
Extend the `claude-code` case from 1.2 to handle built-in tools and the co-existence preamble. Declare a `let claudeCodePreamble: string | undefined;` **before** the middleware switch, set it here, and pass it into the `"prompt"` middleware branch (2.4). Replace the fixed `tools: []` with:
```ts
const requested = opts.claudeCodeTools;
if (!requested || requested.length === 0) {
  settings.tools = [];                        // pure text: no built-ins available
} else {
  const expanded = (requested.length === 1 && requested[0] === 'everything')
    ? CLAUDE_CODE_SAFE_TOOLS
    : requested;
  const allowed = expanded.filter(t => !CLAUDE_CODE_BLOCKED_TOOLS.includes(t));
  settings.tools = allowed;                    // availability: only the vetted built-ins in context
  settings.allowedTools = allowed;             // permission: auto-approve them
  settings.disallowedTools = CLAUDE_CODE_BLOCKED_TOOLS; // defense in depth: Bash never in context
  settings.permissionMode = 'bypassPermissions';        // no interactive prompts for the vetted set
  const id = options?.workingDirId ?? 'default';
  const dir = path.join(os.tmpdir(), 'vox-claude-code', id);
  fs.mkdirSync(dir, { recursive: true });
  settings.cwd = dir;
  // Co-existence: tell the model these are CLI tools, distinct from the JSON game actions.
  claudeCodePreamble = opts.claudeCodePromptOverride
    ?? `## Built-in tools\nYou also have these built-in CLI tools, called natively (NOT via the JSON format below): ${allowed.join(', ')}.\nUse the JSON tool-call format ONLY for the game actions listed under "Available Tools".`;
}
```
(`tools` is the availability layer — only these built-ins are in Claude's context; `allowedTools` is the permission layer. Setting `tools` is what actually bounds the surface, so `bypassPermissions` can only ever auto-approve the vetted set. Confirm during implementation that the provider exposes a top-level `tools` field; if it only honors `allowedTools`, restrict availability via `disallowedTools` for the unwanted built-ins instead.)
Add node imports at the top of `models.ts`: `import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';`.

### 2.4 Middleware preamble — `src/utils/models/tool-rescue/{types,middleware}.ts`
Add to `ToolRescueOptions` (`types.ts:10-22`): `preamble?: string;`. In `middleware.ts transformParams`, after `const toolPrompt = createToolPrompts(...)` (`middleware.ts:82`), prepend the preamble:
```ts
const withPreamble = toolPrompt && options?.preamble ? `${options.preamble}\n\n${toolPrompt}` : toolPrompt;
```
and use `withPreamble` where `toolPrompt` is currently consumed (`middleware.ts:92-105`). Then in `getModel`'s `"prompt"` middleware branch (`models.ts:194-199`), pass `preamble: claudeCodePreamble` alongside the existing `prompt`/`systemPromptFirst` options. `claudeCodePreamble` is `undefined` for non-claude-code models, so their behavior is unchanged.

### 2.5 Thread the seat id — `src/infra/vox-context.ts:761`
`parameters` (`AgentParameters` with `gameID:string`, `playerID:number`, `vox-agent.ts:24-33`) is in scope. Change `model: getModel(stepModel)` to:
```ts
model: getModel(stepModel, { workingDirId: `${parameters.gameID}-${parameters.playerID}` }),
```
This is the only real call site.

### 2.6 Tests — extend `tests/mock/utils/models.test.ts`
- `claudeCodeTools: ['everything']` + `{workingDirId:'g1-3'}` → captured `tools` and `allowedTools` deep-equal `CLAUDE_CODE_SAFE_TOOLS` (no `Bash`), `disallowedTools: ['Bash']`, `permissionMode:'bypassPermissions'`, `cwd` ends with `vox-claude-code/g1-3` (folder exists).
- `claudeCodeTools: ['Read','Bash']` → captured `tools` and `allowedTools` equal `['Read']` (Bash filtered).
- A tool-rescue middleware test: `toolRescueMiddleware({prompt:true, preamble:'PRE'})` `transformParams` prepends `PRE` to the injected system message; `claudeCodePromptOverride` flows through as the preamble. Clean up temp folders in `afterEach`.

---

## Stage 3 — Built-in tool-call telemetry

When built-in tools run, the CLI executes them in its own loop and the provider surfaces each as an AI-SDK `tool-call`/`tool-result` part with `providerExecuted: true` (distinct from the middleware-synthesized game-tool parts, which are not provider-executed). These appear in `stepResponse.response.messages` and `result.steps[*]`. They currently get no vox-agents span (the existing per-tool spans live in the in-process `execute` of `mcp-tools.ts:112-176` / `simple-tools.ts` / `agent-tools.ts`, which built-in tools never hit).

### 3.1 Extract + span — `src/infra/vox-context.ts` (`executeAgentStep`)
After `stepResponse` is resolved and messages gathered (`vox-context.ts:806`), add a helper that walks `stepResponse.response.messages` for parts with `providerExecuted === true` and `type` `tool-call`/`tool-result`, pairs them by `toolCallId`, and emits one span per call mirroring the `mcp-tool.*` shape:
```ts
// span name `claude-code-tool.<toolName>`, kind CLIENT, attributes:
//   'tool.name', 'tool.type': 'claude-code-builtin', 'vox.context.id': this.id,
//   'game.turn': parameters.turn, 'tool.input': JSON.stringify(input),
//   'tool.output': JSON.stringify(result), and isError -> ERROR status.
```
These are retrospective (the tool already ran in the CLI), so they are point-in-time spans under the step span, not timed wrappers. Gate the walk on `stepModel.provider === 'claude-code'` to keep it zero-cost for other providers.

### 3.2 Verify the surface
Confirm empirically (a real claude-code run with `claudeCodeTools` set) that built-in tool activity actually arrives as `providerExecuted` parts in `response.messages`/`steps`. If a given CLI tool does not surface that way, fall back to reading the provider's stream parts in the `concurrency.ts` `fullStream` drain (`concurrency.ts:171-182`) and emitting spans there instead. The research confirmed this shape for `createAiSdkMcpServer` (bridged) tools and that `buildToolCallPart`/`buildToolResultPart` are shared by `doGenerate`/`doStream`; built-in tools are the one thing to confirm.

### 3.3 Tests
Unit-test the extraction helper with a synthetic `stepResponse.response.messages` containing a `providerExecuted` tool-call + tool-result pair and a normal (non-provider-executed) game-tool part, asserting only the built-in pair produces a span record (use a fake tracer / span recorder) and the game-tool part is ignored.

---

## Cross-cutting risks

- **SAFETY GATE — `tools: []` must mean zero host tool execution.** It's the default path for all three registered models. The Agent SDK availability layer documents `tools: []` as "all built-ins removed," but the provider's exposure of that field must be confirmed. Before merging Stage 1, empirically confirm a `claude-code/sonnet` generation has no built-in tools available and runs **none**. If the provider doesn't honor a top-level `tools` field, fall back to `disallowedTools` covering every built-in (or whatever the provider documents as the availability control).
- **Bash is unconditionally blocked**, both by exclusion from `allowedTools` and by `disallowedTools: ['Bash']`. If other shell-exec-adjacent built-ins should also be blocked (e.g. a future `KillShell`), extend `CLAUDE_CODE_BLOCKED_TOOLS`.
- **`bypassPermissions` runs real tools on the host.** The vetted set includes `Write`/`Edit`/`WebFetch`/`WebSearch`; `cwd` scopes file ops to the temp folder but web tools reach the network. This is an explicit opt-in.
- **Structured output through prompt-mode.** `vox-context.ts:776` sets `experimental_output: Output.object(...)` in the same call as prompt-mode tools — identical to every other prompt-mode provider today, so claude-code inherits existing behavior. The provider's "structured mode bypasses tool bridging" note concerns the MCP bridge we are not using; still, verify a real diplomacy turn with both an output schema and active tools parses correctly and rescues no spurious tool call.
- **Co-existence is experimental.** Built-in tools + prompt-mode game tools in one turn is new; the preamble (overridable via `claudeCodePromptOverride`) is the mitigation. The default (no built-in tools) is the proven path. Verify before relying on the combined mode.
- **Temp folders persist and are reused** (deterministic `vox-claude-code/<gameID>-<playerID>`); two games with the same player number on one host share the folder. No cleanup policy is added.
- **CLI prerequisite / version.** A recent authenticated `claude` CLI is required; `effort` needs `0.3.x`. Missing/old CLI fails at runtime — optionally surface a friendlier message via `isAuthenticationError`.
- **Throughput.** Each call uses a CLI subprocess; the existing `streamTextWithConcurrency` + `options.concurrencyLimit` gate parallelism if subprocess pressure appears.

## Verification

- `cd vox-agents && npm run type-check` — clean after each stage.
- `cd vox-agents && npm test` (mock tier) — new/extended `tests/mock/utils/models.test.ts` and the middleware preamble + Stage-3 extraction tests pass; full suite stays green (the mock tier never reaches the real `getModel`).
- Import smoke: `node -e "import('ai-sdk-provider-claude-code').then(()=>console.log('ok'))"`.
- Manual (recent authenticated `claude` CLI): point an agent at `claude-code/sonnet` and run a diplomacy turn with both an output schema and active tools — confirm prompt-mode tool calls parse, the object parses, no spurious rescue, and (default config) **zero** host tools run. Then set `claudeCodeTools: ['everything']` and confirm the `vox-claude-code/<gameID>-<playerID>` folder is created/reused, built-in tools run (never Bash), and their calls appear as `claude-code-tool.*` spans (Stage 3).

## Out of scope

- **Embeddings** (`getEmbeddingModel`) and **oracle batch** — no claude-code path (no embedding/batch endpoint).
- **MCP tool bridging** of game tools (`createAiSdkMcpServer`) — rejected above.
- **Session persistence/resume/fork, sandbox, plugins, skills, hooks** and other `ClaudeCodeSettings` features.
- **`config.json` `default`** — left unchanged.
