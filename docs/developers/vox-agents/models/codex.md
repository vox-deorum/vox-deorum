# Codex proxy

Codex models run through `codex-openai-proxy`, a small local server that signs in with the player's ChatGPT account and speaks an OpenAI-style API. Vox Agents starts a pinned version of it with `npx` the first time a Codex model is used. It is not a workspace dependency.

The current pin is `codex-openai-proxy@0.1.0-rc.34`, which bundles `@openai/codex@0.159.3`.

This page covers how the proxy runs, the contracts Vox Agents relies on, and how to update the pin. The code is in `src/utils/models/providers/codex-proxy.ts`, `codex.ts`, and `codex-response.ts`.

## How the proxy runs

**Starting.** The proxy starts lazily, on the first Codex request. It never reuses a server already listening on its port, because the `/health` and `/ready` responses do not prove it is the right program. Instead it scans upward from the configured port for a free one, and fails only when every candidate is taken. `CODEX_PROXY_COMMAND` overrides the launch command for trusted setups.

**Requests.** Each model request opens a fresh local connection (HTTP keep-alive is off). Failed requests follow the normal retry policy.

**Restarting.** The manager restarts the proxy after five failures in a row, counting connection failures and HTTP 5xx responses. Any other response, including validation and rate-limit errors, resets the count, and so does starting a new proxy. Warnings the proxy prints on stderr are logged but do not count as failures.

## Contracts Vox Agents relies on

These are the proxy behaviors the adapter code depends on. A release that changes any of them needs adapter code and test fixtures updated in the same change.

### Quota errors

| Error | Meaning |
| --- | --- |
| HTTP 429 with `usage_limit_exceeded` | Temporary ChatGPT quota exhaustion. May include `error.x_codex.reset_at` (Unix seconds), or a decimal `Retry-After` header when that field is missing. The same error can also arrive inside an SSE stream. |
| `insufficient_credits`, `workspace_usage_limit_exceeded` | Final. Not retried. |

### Instruction sources

Successful responses report `x_codex.instructionSources`, the instruction-file paths the app-server used. The proxy rejects missing or malformed values before sending HTTP 200.

- Non-streaming responses carry it on the response.
- Streaming responses carry it on the first SSE chunk only.

Vox Agents stores the paths in plain text as `s.instruction_sources` telemetry. Treat this as disclosure of local file paths.

### Thread continuation

Within one agent run, Vox Agents sends the previous step's response id as `previous_response_id`, so the proxy can continue the same Codex thread. The proxy decides whether it can. If not, it runs the full transcript on a fresh thread and reports `x_codex.threadReused: false` instead of failing. Vox Agents always sends the full visible transcript (with Codex's own activity removed), so a fresh thread always has a complete history.

Each Codex model step records the outcome as `host.thread_reuse`:

| Value | Meaning |
| --- | --- |
| `reused` | The proxy continued the thread. |
| `tried_failed` | A previous id was sent, but a fresh thread ran. |
| `fresh` | No previous id was sent. |

A step that was [compacted](../framework/compaction.md) sends the full compacted history instead of continuing the thread.

### Error classification

`codex-response.ts` keeps the retry rules narrow:

| Retry | Errors |
| --- | --- |
| Yes | `thread_busy`; app-server `Transport channel closed`. |
| No | `tool_results_required`, `tool_results_without_pending_call`, `thread_not_resumable`, `duplicate_tool_call_id`; malformed activity; unexplained disconnects after built-in activity, since their effects cannot be safely repeated. |

## Updating the pin

### 1. Check the release

Look at the npm tags and history before picking a version:

```bash
npm view codex-openai-proxy dist-tags time --json
npm view codex-openai-proxy@<version> version dependencies --json
```

The `latest` tag may not be the newest prerelease, so check tags such as `next` too.

Read the candidate's release notes and command help for changes to:

- the `serve` arguments and duration syntax,
- the `/health` and `/ready` responses,
- request policy fields such as sandbox, web search, and tool choice,
- streamed `tool_calls`, `tool_results`, errors, and diagnostic records,
- anything in [Contracts Vox Agents relies on](#contracts-vox-agents-relies-on).

### 2. Update the repository

From the repository root, run the updater with a full version or an rc shorthand:

```bash
npm run update:codex-proxy -- rc.12
```

The script checks the version with npm, reads the bundled `@openai/codex` version, and updates the source pin, the exact-command test, this page, and the manual start command in [operations.md](../../operations.md). It does not install the proxy or touch the lockfile. If it is interrupted, run it again to fix any remaining references.

If a contract changed, also update `codex.ts`, `codex-response.ts`, and their tests in `vox-agents/tests/mock/utils/providers/`. Search for version-specific text that needs a manual update:

```bash
rg "codex-openai-proxy@|Codex rc\.|Proxy rc\.|proxy.*rc\." vox-agents docs
```

Leave version references in implementation plans alone, unless the plan is still active and the update changes what it intends to build.

### 3. Verify

Run the focused tests from the repository root:

```bash
npm run test --workspace=vox-agents -- tests/mock/utils/providers/codex-proxy.test.ts tests/mock/utils/providers/codex.test.ts
npm run type-check --workspace=vox-agents
```

For a release that changes a contract, add fixtures for every changed request or response shape. Then start the exact package in the foreground with the command in [operations.md](../../operations.md), and confirm before merging:

- readiness and sign-in,
- a normal Codex response,
- Codex's own tool activity,
- cancellation,
- clean shutdown.
