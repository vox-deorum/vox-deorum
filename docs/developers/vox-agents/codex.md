# Updating the Codex proxy

This guide is for developers updating the managed `codex-openai-proxy` release used by vox-agents. Vox Deorum launches an exact version through `npx` on the first Codex request. The proxy is not a workspace dependency.

The current pin is `codex-openai-proxy@0.1.0-rc.24`, which bundles `@openai/codex@0.153.4`.

## Check the release

Inspect the npm dist-tags and publication history before choosing a version:

```bash
npm view codex-openai-proxy dist-tags time --json
npm view codex-openai-proxy@<version> version dependencies --json
```

Do not assume the `latest` tag identifies the newest prerelease. Check tags such as `next`. The update script queries the exact candidate and reads its bundled `@openai/codex` version from the npm registry.

Review the candidate's release notes and command help for changes to:

- the `serve` arguments and duration syntax;
- the `/health` and `/ready` responses;
- request policy fields such as sandbox, web search, and tool choice;
- streamed `tool_calls`, `tool_results`, errors, and diagnostic records.

The proxy reports temporary ChatGPT quota exhaustion as HTTP 429 with the stable `usage_limit_exceeded` error code. It may include `error.x_codex.reset_at` as Unix seconds, or a decimal `Retry-After` header when that field is unavailable. The same error envelope can appear in an SSE stream before the compatible adapter reduces it to a message. `insufficient_credits` and `workspace_usage_limit_exceeded` are terminal quota states, not retry signals.

Successful responses report `x_codex.instructionSources`, the exact instruction-file paths used by the app-server. The proxy rejects missing or malformed values before sending HTTP 200. Aggregate responses carry it at response level. Streaming responses carry it on the first SSE chunk only. Vox Agents preserves the paths as sensitive plaintext in `s.instruction_sources` telemetry, so treat the value as local filesystem disclosure.

Continuation admission belongs to the proxy. When a requested continuation is unavailable, the proxy executes the supplied complete transcript on a fresh Codex thread and reports `x_codex.threadReused: false` instead of rejecting the request, so the adapter handles no selector errors. Vox Agents always sends the full client-visible transcript with provider-executed activity stripped from replay, which keeps a fallback transcript completely paired. The adapter still marks deterministic typed errors such as `tool_results_required`, `tool_results_without_pending_call`, `thread_not_resumable`, and `duplicate_tool_call_id` as non-retryable in `codex-response.ts`, while transient states such as `thread_busy` stay retryable.

These are integration contracts. A compatible dependency update needs only the version edits below. A contract change also needs adapter code and captured response fixtures updated in the same change.

## Update the repository

Run the updater from the repository root with a full version or an rc shorthand:

```bash
npm run update:codex-proxy -- rc.12
```

The script verifies the target package with npm, validates each operational reference, and updates the source pin, exact-command test, developer guide, and player troubleshooting command. It does not install the proxy or change the lockfile. If a write is interrupted, run the same command again to repair any remaining references.

If the activity contract changed, update `codex.ts`, `codex-response.ts`, and their tests under `vox-agents/tests/mock/utils/providers/`. Search for version-specific descriptions that need a manual contract update:

```bash
rg "codex-openai-proxy@|Codex rc\.|Proxy rc\.|proxy.*rc\." vox-agents docs
```

Implementation plans record the contract used when a feature was designed. Leave those historical version references intact unless the plan is still active and the update changes its intended implementation.

## Verify the update

Run the focused proxy and response-adapter tests from the repository root:

```bash
npm run test --workspace=vox-agents -- tests/mock/utils/providers/codex-proxy.test.ts tests/mock/utils/providers/codex.test.ts
npm run type-check --workspace=vox-agents
```

For a contract-changing release, add focused fixtures for every changed request or response shape. Then start the exact package in the foreground with the command from the player troubleshooting guide. Confirm readiness, authentication, a normal Codex response, provider-executed tool activity, cancellation, and clean shutdown before merging.

Keep response failure classification narrow. App-server `Transport channel closed` failures are transient and retryable. Malformed activity and unclassified disconnects after built-in activity remain terminal because their effects cannot be replayed safely.
