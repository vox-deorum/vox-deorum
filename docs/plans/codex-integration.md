# Add the Codex LLM provider

> Implementation plan. Add `codex` as a native-tool LLM provider backed by `codex-openai-proxy`. The proxy starts only when a Codex model is first used, authenticates with the player's ChatGPT account, and owns all Codex-specific protocol behavior. A preparatory refactor moves Claude Code and Codex provider code into dedicated modules and gives both providers one shared host-tool policy.

## Goal and success criteria

Vox agents can select a model such as `codex/gpt-5.4-mini` in the existing model configuration and use the normal AI SDK tool loop without an OpenAI API key.

The integration is complete when:

- Starting Vox without a Codex model does not download or launch the proxy.
- The first Codex request downloads the exact pinned proxy and Codex CLI through `npx` when they are not already cached.
- Existing Codex authentication is reused, or first-run device authentication is visible in Vox logs.
- Game tools execute through the normal AI SDK function-tool flow, including proxy-supported tool-result continuation and retry.
- Codex and Claude Code host tools are disabled by default and configured through the single shared `hostTools` model option, resolved by one policy helper.
- The provider refactor changes no behavior other than the `hostTools` rename and the provider-options leak fix, and the full test suite stays green after it.
- An owned proxy process exits with Vox. A compatible proxy that was already running is adopted and left running.
- Non-Codex providers, embeddings, batch experiments, and existing model configuration keep their current behavior.

## Current state

- `vox-agents/src/utils/models/models.ts` constructs every LLM provider synchronously. A custom `fetch` function can perform lazy asynchronous startup without changing `getModel()`.
- The Claude Code case is the largest inline block in the provider switch. It rebinds the model configuration to force prompt-mode tool middleware, expands the `claudeCodeTools` option against a safe tool set, always blocks `Bash`, creates a temporary working directory keyed by `workingDirId`, runs the CLI under `dontAsk` with path-scoped write permissions, and wraps the result with the usage-limit response middleware. Two more claude-code special cases sit after the switch: the system-message normalization wrap and the structured tool-call flag passed to the tool-rescue middleware.
- `buildProviderOptions()` has no claude-code branch. Its default branch passes the model options through, so Vox-only options leak into the provider options today.
- `getModel()` already accepts a `workingDirId`. `buildProviderOptions()` does not, and its only caller is `vox-agents/src/infra/vox-context.ts`.
- Model providers and model names are open-ended configuration strings. The UI already accepts an arbitrary model name, so Codex does not need a built-in model registry.
- `streamTextWithConcurrency()` applies the existing per-model concurrency limit and owns the outer retry loop.
- `codex-openai-proxy@0.1.0-rc.2` depends exactly on `@openai/codex@0.144.5` and launches that package-owned executable. Installing the proxy at the workspace root and invoking it through `npx` both download Codex.
- The published proxy supports implicit client-tool continuation by matching pending tool-call IDs. A corrected tool-result request refreshes the pending deadline. Accepted results are consumed once so a retry cannot apply them twice.
- The published proxy still exposes several behaviors that Vox should not patch locally: limited `tool_choice` support, observational internal activity represented as function calls, immutable continuation bindings, and no per-request host-tool allowlist. These are proxy contract issues.

## Design decisions

### Keep installation lazy

Launch an exact proxy version with `npx --yes codex-openai-proxy@<version>`. Do not add the proxy to the root dependencies.

The proxy already brings its compatible Codex CLI as an exact dependency. A root dependency would place Codex in every release installer even when the player never uses this provider. The lazy path keeps Codex optional, at the cost of requiring npm registry access on the first Codex request.

Do not launch the moving `next` tag. The implementation must pin the exact version that passes the proxy contract checks below.

### Keep Codex protocol behavior in the proxy

Vox will use `@ai-sdk/openai-compatible` without custom parsing of raw chunks, reasoning fields, or internal activity. When the proxy does not produce safe standard Chat Completions behavior, fix and publish the proxy, then update the exact pin.

This boundary also means Vox does not register model slugs, translate Codex internal activity, add Codex-specific telemetry, or maintain a second continuation implementation.

### Extract provider modules

Claude Code and Codex provider code lives in `vox-agents/src/utils/models/providers/`, a flat directory of provider-prefixed files. Small single-call cases such as `openai` and `anthropic` stay in the `models.ts` switch. Provider modules import shared types and sibling helpers only, never `models.ts`, so imports stay one-way. `resolveToolFraming()` and the middleware ordering after the provider switch stay in `models.ts` because they cut across providers.

### Unify the host-tool policy

Both providers read one model option, `options.hostTools`:

- Missing or empty means no host tools and no temporary directory.
- `['everything']` selects each provider's vetted expansion. Claude Code expands it locally to its safe tool set. Codex forwards the sentinel unchanged, and the pinned proxy expands it to a versioned, vetted non-shell set.
- Any other value is an explicit allowlist.
- Shell and arbitrary command execution remain blocked even when requested.
- Network access remains disabled unless the selected capability explicitly requires and enables it.
- File writes are limited to a temporary directory keyed by game and player, using the existing `workingDirId` passed to `getModel()`.

The proxy must enforce tool availability on the Codex side. A temporary working directory and a read-only sandbox are not substitutes for disabling tools.

`hostTools` replaces the `claudeCodeTools` option with no backward-compatible alias. Because the model options type has an open index signature, a stale `claudeCodeTools` key would silently produce a pure-text model, so the Claude Code builder fails fast with a clear migration message whenever it sees the old key.

## Step 1: Establish the proxy contract

Before changing Vox, validate the latest proxy package against the real AI SDK adapter. If any check fails, fix the proxy, publish a new prerelease, and use that exact version throughout this plan.

The required contract is:

1. The package owns and pins the compatible Codex CLI executable.
2. `tool_choice: "required"`, `"auto"`, and `"none"` are accepted with behavior suitable for the normal Vox tool loop.
3. Standard `tool_calls` contain only client-defined functions that the client must execute. Already-executed Codex activity may remain in an extension field, but must not appear as an executable client call.
4. Reasoning uses fields already understood by `@ai-sdk/openai-compatible`. Vox does not parse a second proprietary stream.
5. Client tool results can continue a pending Codex turn using the standard assistant and tool messages emitted by the AI SDK. Corrected retries remain possible until results are accepted, and accepted results are applied once.
6. The proxy retains the original tool and policy binding while accepting a continuation. Changes made by Vox between AI SDK steps do not require a provider check in `VoxAgent.prepareStep()`.
7. Host tools are disabled by default and can be enabled only through a validated per-request allowlist. The proxy enforces the working-directory, sandbox, network, and blocked-shell rules.
8. `/health` identifies the service, proxy version, and protocol version. `/ready` distinguishes a listening process from an authenticated, usable one.

Define the request extension as `providerOptions.codex.x_codex` in Vox and `x_codex` in the serialized request body. Its integration fields are `cwd` and `host_tools`. Vox sends an empty `host_tools` array by default, an explicit allowlist unchanged, or the `everything` sentinel unchanged. When `host_tools` is empty, Vox omits `cwd` and creates no temporary directory; confirm the proxy accepts that shape. The proxy validates and expands the value, blocks shell capabilities, and derives the effective sandbox and network policy. Verify this exact round trip through the real compatible adapter before publishing the proxy.

Keep captured streaming and non-streaming fixtures for this exact version. They become the contract inputs for the Vox adapter tests.

## Step 2: Extract provider modules and unify the host-tool policy

A pure refactor with no Codex code, which can proceed in parallel with Step 1. It is complete when `npm run test:all` passes with no behavior change other than the `hostTools` rename and the provider-options leak fix.

Create `vox-agents/src/utils/models/providers/`:

| File | Contents |
| --- | --- |
| `host-tools.ts` | `resolveHostToolPolicy()`, its result type, and the `everything` sentinel constant. |
| `claude-code.ts` | `buildClaudeCodeModel()` plus the safe and blocked tool-set constants, moved out of `models.ts` and still exported for tests. |
| `claude-code-prompt.ts` | Moved from `src/utils/models/` with exports unchanged. |
| `claude-code-response.ts` | Moved from `src/utils/models/` with exports unchanged. |

`resolveHostToolPolicy()` receives the requested `hostTools` value plus per-provider settings: an optional expansion for the `everything` sentinel, the blocked tool list, and the working-directory namespace and id. It returns the allowed tool list and, only when that list is non-empty, a created temporary directory under the OS temporary directory. Deny-by-default and the sentinel semantics live in this helper and are stated nowhere else.

Each provider owns its mapping of the resolved policy:

- Claude Code translates it into the adapter settings: tool availability, the `dontAsk` permission mode, the path-scoped permission list for `Write` and `Edit`, and the working directory. The existing comments about availability versus permission layering and about not setting `disallowedTools` move with the code.
- Codex translates it into the `x_codex` request extension in Step 4.

`buildClaudeCodeModel()` returns both the constructed model and the rebound configuration, because it forces prompt-mode tool middleware and the middleware selection after the switch must read the rebound value. The `models.ts` case reassigns its local configuration from that return value.

Also in this step:

- Rename `claudeCodeTools` to `hostTools` in `vox-agents/src/types/config.ts` and rewrite its doc comment to cover both providers.
- Add the fail-fast migration error for a lingering `claudeCodeTools` key.
- Extend `buildProviderOptions()` with an optional runtime identity argument carrying `workingDirId`, and add a claude-code branch that returns an empty provider-options object, since every Claude Code setting is applied at construction time. This closes the current leak of Vox-only options.
- Update `vox-agents/src/infra/vox-context.ts` to compute the game-and-player identity once per step and pass it to both `getModel()` and `buildProviderOptions()`. This keeps provider construction and the request policy on the same temporary directory.
- Update the import paths in `models.ts` and the module comment in `src/utils/telemetry/claude-code-spans.ts`; the telemetry code stays where it is.
- Move `tests/mock/utils/claude-code-prompt.test.ts` and `tests/mock/utils/claude-code-response.test.ts` under `tests/mock/utils/providers/`. Keep `tests/mock/utils/models.test.ts` in place, switch its fixtures to `hostTools`, update the mocked import paths, and add assertions for the migration error and for prompt-mode middleware still engaging through the rebound configuration.

## Step 3: Add the lazy proxy manager

Create `vox-agents/src/utils/models/providers/codex-proxy.ts` with a testable `CodexProxyManager` and a module singleton.

### Configuration

Support these environment variables and validate them before spawning:

- `CODEX_PROXY_PORT`, default `8787`, as an integer from 1 through 65535.
- `CODEX_PROXY_COMMAND`, default `npx --yes codex-openai-proxy@<exact-version>`.
- `CODEX_PROXY_ROOT`, default a stable absolute directory under the OS temporary directory.
- `CODEX_PROXY_REQUEST_TIMEOUT`, default shorter than the Codex outer attempt deadline.
- `CODEX_PROXY_TOOL_TIMEOUT`, used for first-run login and suspended client tools.
- `CODEX_PROXY_STARTUP_TIMEOUT`, a positive millisecond duration.

The manager appends the proxy's `serve`, `--root`, `--port`, timeout, and graceful-shutdown arguments. Treat a custom command as trusted operator configuration. Validate every appended value and test Windows quoting for paths containing spaces and shell metacharacters.

Expose separate helpers for the origin and API base so health probes never acquire the `/v1` prefix.

### State and startup

Represent stopped, starting, ready-owned, and ready-adopted states explicitly.

`ensureCodexProxy()` runs from the provider's custom `fetch` function:

1. Return immediately from a ready-owned state whose child is still alive.
2. Return the same in-flight promise to every caller while startup is in progress.
3. Probe `/health` on the configured port.
4. Adopt the process only when its service, version, and protocol identity match the pinned contract. Wait for `/ready` before returning.
5. If the port is unused, spawn the pinned command and record ownership immediately, before waiting for readiness.
6. If the port belongs to an incompatible or unidentified service, fail this Codex request with a clear port and version message. Vox itself remains running.
7. Poll `/ready` until authentication succeeds, the owned child exits, the adopted process disappears, the caller aborts, or the startup deadline expires.

Re-probe a ready-adopted process on every `ensureCodexProxy()` call because it has no child events. If it disappears, clear the adopted state and start an owned process. If it disappears during readiness polling, make the same transition within the current startup. Owned child exit and error events clear only the matching generation. A connection-level failure from the provider fetch also invalidates the matching ready state so the existing outer retry can run startup again.

Use an identity-guarded startup promise whose success and failure handlers clear only that promise. Do not discard a promise returned by `finally`, since a failed startup could create an unhandled rejection.

Race each caller's wait against its abort signal without cancelling the shared authentication process. A stopped or superseded startup must reject its current waiters and must never install a stale child as ready.

Classify invalid configuration, an incompatible port occupant, missing npm tooling, and an authentication deadline as non-retryable errors. Treat an owned child crash or a lost compatible proxy as retryable. This prevents the outer retry loop from launching the same terminal failure repeatedly.

### Logging and shutdown

- Parse structured proxy records from stderr and route each record through the matching Winston level.
- Preserve the device-login URL and instructions in logs, while redacting tokens and other sensitive fields.
- Register one asynchronous shutdown hook with `ProcessManager`.
- On Windows, terminate the owned process tree gracefully, wait longer than the proxy's shutdown timeout, then force termination if necessary.
- On POSIX, launch an owned process group, send `SIGTERM`, then use `SIGKILL` after the grace period.
- Add a synchronous best-effort exit handler for fatal paths that call `process.exit()` directly.
- Never terminate an adopted proxy.

Active requests and suspended client-tool calls do not survive an owned proxy restart. Completed proxy continuations may survive through the proxy state directory.

## Step 4: Register the provider

Create `vox-agents/src/utils/models/providers/codex.ts` and edit `vox-agents/src/utils/models/models.ts`:

1. Add `buildCodexModel()` and a `case "codex"` in `models.ts` that delegates to it. The builder uses `createOpenAICompatible()` with the proxy API base, provider name `codex`, fixed non-secret placeholder API key `local`, usage enabled, and a shared long-lived Undici dispatcher. The adapter may send the placeholder as an inert local authorization header, but Vox does not expose it as configuration.
2. Use a custom `fetch` that awaits `ensureCodexProxy()`, respects the request abort signal, and then sends the request through the shared dispatcher.
3. The builder permits an unset tool middleware or `rescue`, both of which preserve native function tools while rescuing malformed calls. It rejects `prompt` or `gemma` with a clear error instead of silently changing the tool protocol.
4. Add `buildCodexProviderOptions()` and delegate the codex branch of `buildProviderOptions()` to it. The function resolves the shared host-tool policy with no local expansion and the Codex blocked-shell set, then combines it with the runtime identity into the stable `x_codex` policy required by Step 1. It forwards outbound fields by whitelist: only the reasoning-effort field confirmed by the Step 1 fixtures and the `x_codex` extension. A whitelist is required because the open index signature on model options makes any strip list incomplete; the known Vox-only options that must never reach the HTTP body include `hostTools`, `toolMiddleware`, `thinkMiddleware`, `concurrencyLimit`, `systemPromptFirst`, `framing`, and `embeddingSize`.

Do not add Codex middleware, model defaults, embedding support, or response parsing.

## Step 5: Integrate with execution policy

Edit `vox-agents/src/utils/models/concurrency.ts`:

- Reject Codex explicitly when the Oracle batch manager is active. The local ChatGPT-authenticated proxy has no batch API, and live fallback would mix execution modes.
- Give Codex an inactivity timeout longer than the sum of the proxy startup and request deadlines, plus a small shutdown margin. Proxy streaming and game-tool activity continue refreshing it through the existing progress callbacks. The proxy must finish or cancel its own request before Vox considers an outer retry.
- Keep the existing per-model concurrency behavior. Do not add an account-wide Codex limiter or a Codex-specific default.

Leave `retry.ts`, `VoxAgent.prepareStep()`, and MCP execution unchanged. Proxy-supported continuation and the contract from Step 1 own Codex game-tool retries and binding stability.

## Step 6: Configuration and documentation

Edit `vox-agents/src/types/constants.ts` to add `{ label: 'Codex (ChatGPT)', value: 'codex' }` to the provider dropdown. Do not add entries to `defaults.ts`; players enter any model name exposed to their Codex account.

The `hostTools` option itself lands in Step 2; here, verify its doc comment covers both providers.

Update `vox-agents/.env.default` with the proxy lifecycle variables and correct its general API-key guidance. Do not add a proxy API-key setting. The adapter's fixed `local` placeholder is not a credential and does not authenticate the loopback proxy.

Update:

- `docs/players/configuration.md`: explain ChatGPT authentication, arbitrary Codex model names, the first-use npm download, the shared `hostTools` option for Codex and Claude Code, the breaking rename from `claudeCodeTools` and its fail-fast error message, and the relevant environment variables. Correct the general claim that every provider requires an API key.
- `docs/players/troubleshooting.md`: cover device login, npm or network failure, incompatible port occupants, startup timeouts, and manual foreground launch.
- `docs/developers/vox-agents/overview.md`: describe the lazy subprocess, proxy-owned protocol boundary, adoption rules, default-denied host tools, and restart semantics.
- `vox-agents/AGENTS.md`: record the Codex provider boundary, the rule that protocol defects are fixed in the proxy rather than parsed in Vox, and the layout rule that provider-specific code lives under `src/utils/models/providers/` with one-way imports from `models.ts`.
- The release notes for the next version: call out the breaking `claudeCodeTools` to `hostTools` rename and the migration step.

## Verification

### Proxy contract

Run the captured-fixture and live contract checks before pinning the proxy version:

1. Standard streaming and non-streaming text responses work through `@ai-sdk/openai-compatible`.
2. Required, automatic, and disabled tool choice behave as expected.
3. A game tool call suspends the Codex turn, accepts the AI SDK's assistant and tool messages, tolerates a corrected retry, and applies the result once.
4. Internal Codex activity never becomes an executable client tool call.
5. Default configuration exposes no Codex host tools.
6. An explicit safe allowlist exposes only the requested tools, blocks shell execution, confines writes to the temporary working directory, and leaves network disabled unless selected.
7. Health responses provide the identity needed for safe adoption.

### Vox mock tests

Add tests under `vox-agents/tests/mock/` for:

- `resolveHostToolPolicy()` behavior: empty input, the sentinel with and without an expansion, blocked-tool filtering, and directory creation only when tools are enabled.
- The Claude Code migration error for a lingering `claudeCodeTools` key.
- The claude-code provider-options branch returning an empty object.
- Concurrent lazy callers sharing one startup.
- Failed startup remaining retryable.
- Owned and adopted readiness behavior.
- Stop during startup and stale child events.
- Lazy failure for an occupied incompatible port.
- Owned process-tree shutdown and adopted-process preservation.
- Provider construction and the exact outbound request body.
- Vox-only model options being absent from the proxy request.
- Default-empty and explicit `hostTools` policies for both providers.
- Rejection of non-native tool middleware.
- Batch-mode rejection and the Codex attempt deadline.
- Captured proxy fixtures completing a full AI SDK game-tool loop without client-side Codex parsing.

Use fake timers and injected process, probe, platform, and shutdown functions so the mock suite does not wait on production timeouts or install signal handlers.

After Step 2 and again at the end, confirm a repository-wide search finds `claudeCodeTools` only in historical plan documents.

### Manual checks

1. Start Vox with a non-Codex model and confirm that no proxy or npm download occurs.
2. Run an existing Claude Code model configuration migrated to `hostTools` and confirm identical behavior, including the temporary working directory and blocked `Bash`.
3. Select a Codex model with an empty npm cache, complete device authentication from the logged instructions, and finish a game-tool turn.
4. Restart Vox and confirm that authentication is reused.
5. Run with host tools omitted and confirm that Codex performs no command, file, network, MCP, or app activity.
6. Enable a safe host-tool subset and confirm the temporary-directory and network boundaries.
7. Stop Vox normally and through its fatal exit path, then confirm that the owned process tree is gone.
8. Start a compatible proxy manually and confirm lazy adoption without later termination.
9. Occupy the configured port with another service and confirm that only the first Codex request fails.

Finish with `npm run build:all` and `npm run test:all` from the repository root.

## Out of scope

- Codex embeddings or Oracle batch support.
- A built-in Codex model catalog or model discovery UI.
- An account-wide Codex concurrency limit.
- Advanced `hostTools` controls in the configuration UI. Configuration-file support is the only interface.
- A backward-compatible alias for `claudeCodeTools`.
- Extracting the remaining small provider cases out of `models.ts`.
- Vox-side parsing of Codex reasoning or internal activity.
- Codex-specific telemetry spans.
- Installing Codex in every Vox release for offline-first use.
