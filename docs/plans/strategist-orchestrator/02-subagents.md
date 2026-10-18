# Stage 2: Sub-agent execution

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Implement sub-agents from their manifests (role, model tier, reasoning effort, prompt template, action/read/write allowlists, output file, budget), mapped onto the existing `modelTiers`, the `@effort` suffix, and `getActiveTools`.

- **File grants.** Build a scoped filesystem view over the run session for each invocation. It holds only the granted mounts, allows writes only where granted, and applies past-turn windows as read filters. The invocation's shell tool and its template reads both use this view. Views never change the seat-wide workspace.
- **Templates and outputs.** A markdown template engine interpolates `records/` files via `jsonToMarkdown`. Free-text responses are auto-written into the run session, where the script and later children see them at once. Briefings are also archived through `SeatRecords.recordBriefing`.
- **Cost and budgets.**
  - Define the cost currency as per-tier coefficients over the normalized step counts.
  - Charge each step to a per-invocation ledger and the run ledger as it finishes.
  - Let in-flight parallel steps finish, an overshoot of at most one step per child.
  - Refuse new invocations once the run budget is exhausted.
  - Give an exhausted sub-agent the continuation nudge, no tools, and one final step with capped output.
- **Parallel calls and cancellation.** One host-side fan-out primitive runs a batch concurrently and rejects colliding output files. On failure or timeout, abort outstanding children and wait for them to settle before the fallback, so no late action lands.

The allowlist design reserves a future memory/RAG tool grant.

Verify with:

- a single-LLM workflow;
- a grant-violation test;
- a budget-exhaustion test;
- a parallel fan-out test;
- a failure with children still in flight.

See _Risks and watch-items_ in [README.md](README.md).
