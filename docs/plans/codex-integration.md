# Plan: Add "codex" LLM Provider via codex-openai-proxy

## Context

vox-agents talks to LLM providers through the Vercel AI SDK factory in `vox-agents/src/utils/models/models.ts`. We want to support OpenAI Codex models through [codex-app-server-to-proxy](https://github.com/CIVITAS-John/codex-app-server-to-proxy) (npm: `codex-openai-proxy`, pinned **`0.1.0-rc.2`** — the current `next` dist-tag; note the `latest` tag is stale at rc.0, so the exact pin is load-bearing), a local OpenAI-compatible bridge (`127.0.0.1:8787`, `POST /v1/chat/completions` streaming + function tools, `GET /health`, `GET /ready` — 503 until authenticated).

Design constraints:
1. **ChatGPT auth on first launch** → proxy starts lazily, only when a codex model is first *used*. Because stdio is piped (not a TTY), first-run auth uses the **device-code flow** (no auto-opened browser) — the URL surfaces through our logs.
2. **Proxy terminates with vox-agents** (win32 primary, cross-platform).
3. Protocol adaptation needed: `tool_choice` supports only `auto`/`none` (vox defaults to `required`, [vox-agent.ts:113](../../vox-agents/src/infra/vox-agent.ts) → [vox-context.ts:746](../../vox-agents/src/infra/vox-context.ts)); and the proxy surfaces **already-executed internal Codex activity** (commands, file ops, MCP calls) as standard `tool_calls` paired with nonstandard `tool_results`, which the generic AI SDK path misreads as unknown client tools.

**Confirmed keepers:** synchronous `getModel`; lazy startup inside the `fetch` option; promise-coalesced first launch; free-form `provider` string (no type/schema change); embeddings unchanged.

## Files

- **New:** `vox-agents/src/utils/models/codex-proxy.ts` — `CodexProxyManager` class (injectable seams) + module singleton
- **New:** `vox-agents/src/utils/models/codex-middleware.ts` — protocol adaptation middleware
- **Edit:** `vox-agents/src/utils/models/models.ts` — `case "codex":`
- **Edit:** `vox-agents/src/utils/retry.ts` + `vox-agents/src/utils/models/concurrency.ts` — per-attempt cancellation; batch-mode codex gate
- **Edit:** `vox-agents/src/infra/vox-agent.ts` — skip `removeUsedTools` filtering for codex step models (mid-thread consistency)
- **Edit:** `vox-agents/src/utils/config/defaults.ts`, `vox-agents/src/types/constants.ts`, `vox-agents/.env.default`
- **New tests** under `vox-agents/tests/` (mock tier)
- **Docs:** `docs/players/configuration.md`, `docs/players/troubleshooting.md`, `docs/developers/vox-agents/overview.md`

## Step 1 — `codex-proxy.ts` lifecycle manager

`CodexProxyManager` class with **injectable seams** for testability (`spawnFn`, `killFn`, `probeFetch`, logger), exported as a module singleton. State:

```ts
interface ProxyState { mode: 'owned' | 'adopted'; child?: ChildProcess; generation: number; }
let state: ProxyState | null = null;
let startPromise: Promise<void> | null = null;   // PENDING-ONLY (see below)
let generation = 0;                               // monotonic; bumped on every start AND on stop
```

**Env config** (duration values are **validated duration strings** — the proxy CLI parses bare numbers as *milliseconds*, per the [CLI parser](https://github.com/CIVITAS-John/codex-app-server-to-proxy/blob/main/src/core/config.ts)):
- `CODEX_PROXY_PORT` — default `8787`
- `CODEX_PROXY_COMMAND` — default `npx --yes codex-openai-proxy@0.1.0-rc.2`; manager appends `serve --root "<root>" --port <port> --request-timeout <dur> --tool-timeout <dur> --shutdown-timeout 5s`
- `CODEX_PROXY_ROOT` — default dedicated empty dir `path.join(os.tmpdir(), 'vox-codex-root')` (mkdir recursive; must be a stable absolute path — continuation state is keyed **per root**) — Codex needs no repo filesystem access. The persistent state store itself lives under `~/.codex-openai-proxy` (proxy default `--state-dir`), NOT inside the root, so a tmpdir root doesn't endanger persistence
- `CODEX_PROXY_REQUEST_TIMEOUT` — default `"3600s"` (proxy default is 30s — must be passed explicitly; the request deadline aborts downstream Codex work and closes open streams)
- `CODEX_PROXY_TOOL_TIMEOUT` — default `"600s"` (governs both the login/startup deadline and the suspended-tool-call deadline; proxy default 5 min)
- `CODEX_PROXY_STARTUP_TIMEOUT` — ms, default `3_600_000`
- `CODEX_PROXY_API_KEY` — default `"local"`

**URL helpers (two, to prevent path mistakes):** `getCodexProxyApiBase()` → `http://127.0.0.1:<port>/v1` (for `createOpenAICompatible`, which appends `/chat/completions`); `getCodexProxyOrigin()` → `http://127.0.0.1:<port>` (for `/health`, `/ready` probes).

**`ensureCodexProxy()`:**
1. If `state?.mode === 'adopted'`: re-probe `GET <origin>/health` (~1s timeout) every call — external proxies die without child events. Probe failure → clear `state` and fall through to a fresh start (become owner). Owned mode: child events are authoritative, no probe.
2. If `state` is healthy → resolve immediately.
3. If `startPromise` (an in-flight startup) exists → return it.
4. Else start: `const p = startProxy(++generation); startPromise = p; p.finally(() => { if (startPromise === p) startPromise = null; })`. **Pending-only + identity-guarded**: success and failure both clear it (so a dead adopted proxy can trigger a real respawn later), and a stale settle can't erase a newer startup's promise.

**`startProxy(gen)`** — after **every** `await` (probes, spawn, each poll tick), check `gen === generation`; if stale (a `stopCodexProxy()` or newer start happened), abort without touching state — startup must never install a child after shutdown:
1. **Adopt probe:** `GET /health` OK → `state = { mode: 'adopted', generation: gen }`, log adoption, go to readiness poll.
2. **Spawn (owned):** single command string with explicit duration flags.
   - win32: `spawnFn(cmd, { shell: true, windowsHide: true, stdio: ['ignore','pipe','pipe'] })` (Node ≥20.12 blocks `npx.cmd` without shell).
   - POSIX: add `detached: true` → own process group, killable as a tree via `process.kill(-pid, sig)`.
3. **Log piping:** the proxy writes **structured JSON records to stderr** (including normal info and device-code instructions). Parse each stderr line as JSON and route by its `level` field to the matching winston level (fallback `warn` for unparsable lines); stdout lines → `logger.info`. Never map all stderr to warn, and never `stdio: 'inherit'`.
4. **One-time registration** (guard boolean): `processManager.register('codex-proxy', stopCodexProxy)`; plus sync `process.on('exit')` best-effort kill (win32 `taskkill /PID <pid> /F /T`; POSIX `process.kill(-pid,'SIGKILL')`) guarded by owned-child-alive — covers `uncaughtException → process.exit(1)`.
5. **Identity-guarded child events:** `exit`/`error` handlers close over `gen`; no-op unless `state?.generation === gen`. If `processManager.isShuttingDown` ignore; else log, clear `state` (and `startPromise` via its own guard) → lazy respawn on next request.
6. **Readiness poll:** `GET /ready` every 1s until 200 or `CODEX_PROXY_STARTUP_TIMEOUT`, **racing against**: (a) owned child exit → fail fast with exit code + manual-launch hint; (b) adopted health loss → stop polling and restart as owner (don't poll a corpse for an hour); (c) generation staleness → silent abort. While `/health` OK but `/ready` not (auth-pending): after 15s, `warn` every 15s: "Codex proxy is waiting for ChatGPT authentication — open the device-code URL shown above and complete login (first run only)". Deadline → kill child, throw with the manual command (`npx --yes codex-openai-proxy@0.1.0-rc.2 serve --root <dir>`).

**`stopCodexProxy()`:** `generation++` first (invalidates any in-flight startup, including its poll loop); then if owned: SIGTERM the tree (win32: graceful `taskkill /PID /T`, then after ~8s `taskkill /PID /F /T`; POSIX: `process.kill(-pid,'SIGTERM')`, wait ≤8s, then `SIGKILL` the group) — ≥ the proxy's `--shutdown-timeout 5s` we pass at launch. Adopted: nothing to kill. Clear `state`, `startPromise`.

**Documented limitation:** suspended client tool calls (held in memory ~`--tool-timeout`) and active requests are lost on proxy restart; completed `previous_response_id` threads **survive** via the persistent state store under `~/.codex-openai-proxy`, keyed per `--root`. Retry gives request-level recovery.

## Step 2 — `codex-middleware.ts` protocol adaptation

`codexMiddleware(): LanguageModelMiddleware`:

1. **`transformParams`:** map `toolChoice` `{type:'required'}` / `{type:'tool'}` → `{type:'auto'}` (debug log) — otherwise every normal agent turn fails. Also set `includeRawChunks: true` so `wrapStream` can see raw proxy chunks.
2. **Internal-activity filtering — correlate by raw `tool_results`, not by name.** Name-complement filtering is unsafe (hides genuinely hallucinated tool calls; a name collision would let an already-executed internal call through as a client tool). The compatible provider drops the nonstandard `tool_results` field, but the raw data remains available: `response.body` in `wrapGenerate`, raw chunks (via `includeRawChunks`) in `wrapStream`. An internal call is one whose ID appears in `tool_results` — filter exactly those IDs:
   - *Generate:* parse `response.body`'s `tool_results`, drop tool-call content parts with matching IDs; log dropped activity at debug (Codex's actions stay observable).
   - *Stream:* collect internal IDs from raw chunks' `tool_results`; `tool-input-delta`/`tool-input-end` carry only an ID (no `toolName`), so track accepted/rejected IDs from `tool-input-start` onward and filter `tool-input-*`/`tool-call` parts by ID.
   - `finishReason` is a V3 **object** — read/write `finishReason.unified` (and streamed `finish` parts). Per the [README](https://github.com/CIVITAS-John/codex-app-server-to-proxy/blob/main/README.md), internal activity **never causes `finish_reason: "tool_calls"`**, so no normalization as a primary mechanism — keep only a defensive debug log if every call in a `tool_calls`-finish got filtered.
   - History replay is already safe proxy-side: internal-activity entries in a replayed assistant message are automatically stripped by the proxy, so filtered/unfiltered history both work.
   - Implementation option to evaluate first: add a proxy-side flag to mark or suppress internal activity (we own the proxy) — would simplify this middleware to a no-op on that path; the raw-correlation design above works against the pinned version regardless.
3. **Reasoning passthrough (nice-to-have):** the proxy returns a nonstandard top-level `reasoning` summary string that the compatible provider drops. Where present in `response.body` / raw chunks, surface it as a reasoning content part so the agent traces keep Codex's thinking summaries.
4. **Mid-thread consistency constraint:** the proxy **rejects** requests that change `tools`, `reasoning_effort`, or `x_codex` between a tool call and its tool results. This is not hypothetical: `removeUsedTools` ([vox-agent.ts:108](../../vox-agents/src/infra/vox-agent.ts)) filters `activeTools` between steps inside one streamText loop (`prepareStep`, vox-agent.ts:396-417), so the request carrying tool results presents a shrunken tool list → rejected — and `SimpleStrategistBase` ships with it enabled ([simple-strategist-base.ts:27](../../vox-agents/src/strategist/agents/simple-strategist-base.ts)). Fix: in `prepareStep`, skip the used-tools filtering when the resolved step model's provider is `'codex'` (debug log why), and document the constraint. Also ensure reasoning-effort overrides stay constant across a step loop (they do today — resolved once per `getModel`).

## Step 3 — `models.ts` new case

After `case "synthetic":` (~line 164). Shared module-level dispatcher (no per-request `Agent` construction):

```ts
const codexDispatcher = new Agent({
  headersTimeout: 3_600_000, bodyTimeout: 3_600_000,
  connectTimeout: 30_000, keepAliveTimeout: 600_000,
});

case "codex":
  result = createOpenAICompatible({
    baseURL: getCodexProxyApiBase(),          // .../v1 — provider appends /chat/completions
    name: "codex",
    apiKey: process.env.CODEX_PROXY_API_KEY ?? "local",
    includeUsage: true,                        // streamed responses carry usage metadata
    fetch: (async (url, options) => {
      // Race shared startup against THIS request's abort signal: a timed-out attempt
      // stops waiting, but the global startup (OAuth may be in progress) continues.
      await raceWithAbort(ensureCodexProxy(), options?.signal);
      return fetch(url, { ...options, dispatcher: codexDispatcher });
    }) as typeof fetch,
  }).chatModel(config.name);
  result = wrapLanguageModel({ model: result, middleware: codexMiddleware() });
  break;
```

- `raceWithAbort(promise, signal)`: small helper (in codex-proxy.ts or utils) rejecting with an `AbortError` when the signal fires, with listener cleanup; never cancels the underlying startup.
- Middleware order: `codexMiddleware` innermost, standard tail (default `toolRescueMiddleware()`) outside — filtering must run before tool-rescue sees the response.
- `buildProviderOptions`: no change (default branch emits `{ codex: model.options }`; verified `reasoningEffort` → `reasoning_effort`). `getEmbeddingModel`: no change.

## Step 4 — Retry-layer per-attempt cancellation (scoped honestly)

[retry.ts](../../vox-agents/src/utils/retry.ts) races each attempt against a timeout but never aborts the loser — it can deliver a duplicate completion later, and the `isTimedOut` latch disables timeout scheduling for subsequent attempts. Fix in `exponentialRetry`:

- Per-attempt `AbortController`; extend callback to `fn(updateProgress, attempt, attemptSignal)`. Timeout handler aborts the controller in addition to rejecting the race.
- **`handleReject` decision:** a *rescued* timeout (`handleReject()` returns true) does NOT abort — rescue means "let it keep running"; only unrescued timeouts abort. Documented in the jsdoc.
- Move per-attempt state (`isTimedOut`, timer handle) inside the loop so each attempt gets fresh timeout scheduling.
- `finally` per attempt: clear the execution timer and remove the parent `options.abortSignal` listener (no leaks across 100 retries).
- Race parent cancellation **directly** in the `Promise.race` (a callback that ignores signals never settles just because a signal aborted).
- Consumer wiring — this fix is only as cross-cutting as its consumers: `streamTextWithConcurrency` ([concurrency.ts:137](../../vox-agents/src/utils/models/concurrency.ts)) threads `attemptSignal` into `streamText`'s `abortSignal` (merge caller signal via `AbortSignal.any`) and gates late `onChunk`/`onStepFinish`/transform callbacks on `!attemptSignal.aborted` (in addition to the existing `maxIteration !== iteration` guard). Other `exponentialRetry` callers (batch submission, telepathist) don't consume the signal yet — unchanged behavior, noted as follow-up, not claimed fixed.

## Step 5 — Batch mode gate

"Batch path unchanged" is false in practice: when batch mode is active, **every** request routes through `getBatchManager().enqueue` ([concurrency.ts:90](../../vox-agents/src/utils/models/concurrency.ts)) and `getBatchEndpoint` throws a generic error for unlisted providers. Add an explicit, intentional gate beside the existing prompt-mode rejection (concurrency.ts:96):

```ts
if (modelConfig.provider === 'codex') {
  throw new Error(
    `Batch mode does not support the local codex provider ('codex/${modelConfig.name}'): ` +
    `requests go through a local ChatGPT-authenticated proxy with no batch API. ` +
    `Run without batch mode or choose a batch-capable model.`);
}
```

(Chosen over silent live fallback for consistency with the prompt-mode precedent — batch experiments shouldn't silently mix live traffic.)

## Step 6 — Registry, UI, env, docs

**`defaults.ts`** (`concurrencyLimit: 2` — one ChatGPT account):

```ts
'codex/gpt-5.4-mini':  { provider: 'codex', name: 'gpt-5.4-mini',  options: { concurrencyLimit: 2 } },
'codex/gpt-5.6-luna':  { provider: 'codex', name: 'gpt-5.6-luna',  options: { concurrencyLimit: 2 } },
'codex/gpt-5.6-terra': { provider: 'codex', name: 'gpt-5.6-terra', options: { concurrencyLimit: 2 } },
'codex/gpt-5.6-sol':   { provider: 'codex', name: 'gpt-5.6-sol',   options: { concurrencyLimit: 2 } },
```

Only `gpt-5.4-mini` is documented and there's no models endpoint — **validate each slug with a live completion during implementation**; drop/adjust rejected entries.

**`constants.ts`:** add `{ label: 'Codex (ChatGPT)', value: 'codex' }` to `llmProviders` — label + value only (the dropdown data shape supports nothing else).

**`vox-agents/.env.default`:** add commented `CODEX_PROXY_PORT/COMMAND/ROOT/REQUEST_TIMEOUT/TOOL_TIMEOUT/STARTUP_TIMEOUT/API_KEY` entries with defaults.

**Docs** (no `vox-agents/README.md` exists):
- `docs/players/configuration.md`: enabling codex models, first-run device-code auth (URL appears in logs — piped stdio means no auto-opened browser), env vars, npx needs network on first launch.
- `docs/players/troubleshooting.md`: stuck auth (run the serve command manually once), port conflicts (`CODEX_PROXY_PORT`), orphan/restart behavior.
- `docs/developers/vox-agents/overview.md`: architecture note — lazy subprocess lifecycle, middleware, security posture (loopback-only bind, `Origin`-header requests rejected, but **no local bearer-token check**: any process running as the user can call the proxy; apiKey is a placeholder), restart semantics (suspended tools/active requests lost; completed `previous_response_id` threads persist under `~/.codex-openai-proxy` per root), and the mid-thread consistency rule (`tools`/`reasoning_effort`/`x_codex` frozen between a tool call and its results — `removeUsedTools` incompatible with codex models).

## Edge cases handled

| Risk | Handling |
|---|---|
| `tool_choice: required` | middleware → `auto` |
| Internal activity as tool_calls | raw `tool_results` ID correlation (collision-safe, keeps hallucination detection) |
| Duration flags misparsed as ms | duration strings (`3600s`), validated env vars |
| Concurrent first calls | coalesced pending-only `startPromise` |
| Adopted proxy dies (incl. mid-poll) | per-call re-probe; poll races health loss → respawn as owner |
| Stale starts/settles/child events | generation stamp checked after every await; identity-guarded promise clear |
| Shutdown during startup | `stopCodexProxy` bumps generation → in-flight startup self-aborts |
| Timed-out attempt waits on OAuth | fetch races startup vs request signal (startup itself uncancelled) |
| Duplicate completions after timeout | per-attempt AbortController + aborted-gated late callbacks |
| Proxy graceful shutdown cut short | `--shutdown-timeout 5s` + ≥8s wait before force-kill |
| POSIX shell/npx tree survives | `detached: true` + process-group kill |
| Batch mode | explicit descriptive rejection in `streamTextWithConcurrency` |
| Mid-thread `tools`/`reasoning_effort` change rejected | `prepareStep` skips `removeUsedTools` filtering for codex models (affects `SimpleStrategistBase`) |
| Proxy overload (100 concurrent, 429 `overloaded`) | `concurrencyLimit: 2` keeps vox far below the cap |

## Verification

**Mock tests** (`vox-agents/tests/`, mock tier — no live tier; `tests/real` is unwired):
1. *Lifecycle* (via injectable `spawnFn`/`killFn`/`probeFetch` seams; plus one real-child fixture — a tiny node script as fake proxy — for command construction and tree termination): concurrent `ensureCodexProxy` coalescing; failed start retryable; **adopted proxy dies → next ensure respawns as owner** (regression for the pending-only promise); stale generation events ignored; stop-during-startup installs nothing; readiness poll fails fast on child exit.
2. *Middleware:* `required`/`tool` → `auto`; internal-call filtering in generate + stream via raw `tool_results` IDs, including **name-collision** (internal call named like a client tool → still filtered) and **hallucinated tool** (unknown name, no tool_result → passes through to tool-rescue); ID-only `tool-input-delta`/`end` filtering; `finishReason.unified` handling; usage passthrough with `includeUsage`; nonstandard `reasoning` summary surfaced as a reasoning part.
3. *Retry:* timed-out attempt gets aborted; rescued (`handleReject`) timeout does not abort; fresh timeout per attempt; parent-signal race settles a signal-ignoring callback; no timer/listener leaks.
4. *Batch gate:* codex model + active batch manager → descriptive throw.
5. *prepareStep gate:* `removeUsedTools` agent + codex step model → tool list unchanged between steps; non-codex model → filtering still applies.

**Manual live checks:**
1. Standalone serve with pinned version → device-code auth → `curl <origin>/ready` → one completion per model slug (validates all four entries).
2. Lazy start: non-codex default → no proxy process; codex default via `config.json` → proxy appears at first LLM call; a full agent turn with game tools completes (proves `required`→`auto` + filtering under real internal activity).
3. Lifecycle: Ctrl+C → tree gone; induced crash → sync `'exit'` kill; `taskkill /F` vox-agents → next run adopts orphan; kill proxy mid-run → next request respawns and succeeds.
4. `npm run type-check` + full mock suite green.
