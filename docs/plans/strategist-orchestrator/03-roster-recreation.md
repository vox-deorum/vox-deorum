# Stage 3: Recreate baseline, briefed, and staffed with bootstrap equivalence tests

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Move the decision context `VoxPlayer` prepares after `recordTurn` into one builder shared by live runs and dry-runs. That context is the events merged across turns pacing skipped, the last completed decision turn, and the overflow trim rule. Record the builder's output as `records/turn-N/decision.{md,json}`.

Recreate `simple`, `simple-briefed`, and `simple-staffed` as workflows:

- briefer sub-agents;
- cross-turn state in `game/` carrying briefer and focus requests for the current game;
- the staffed strategist's branch between one combined briefer and three concurrent specialized briefers.

Add the one-time mock-tier tests:

- **Prompt equivalence** against the static originals' `getSystem`/`getInitialMessages`, with fixtures for a decision after skipped turns and for both staffed branches.
- **Tool-call equivalence** for `null`/`none`.

These tests are the acceptance gate for the workflow half. They also prove that `records/turn-N` plus the decision context carries everything the original prompts consume.

`learned` and episode retrieval are deferred with the memory expansion. The static strategists (`vox-agents/src/strategist/agents/`, with system prompts in the built-in templates under `vox-agents/prompts/`) are the reference oracle for the equivalence tests.
