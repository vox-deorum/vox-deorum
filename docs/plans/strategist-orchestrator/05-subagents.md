# Stage 5 — Sub-agent execution

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Implement sub-agent execution: the manifest fields (role, tier-to-model, reasoning effort, prompt template, action/read/write allowlists, output file, budget); the markdown template engine interpolating game-state files via `jsonToMarkdown`; auto-write of free-text responses; model-agnostic composition; per-sub-agent and per-run **cost budgets with graceful degradation** (strip action tools, ask for a final response); **parallel sub-agent calls**; and the `shared/` cross-turn area. The allowlist design reserves a future memory/RAG tool grant. Verified with a single-LLM workflow, a budget-exhaustion test, and a parallel-fan-out test.

Budgets are in cost units, so the currency from Stage 1 must be trustworthy before budgets gate behavior; a runaway LLM loop and a `while (true)` must both die (see the Stages 1 and 5 watch-item in [README.md](README.md)).
