# Stage 6 — Recreate baseline + briefed + staffed, with bootstrap equivalence tests

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Recreate `simple`, `simple-briefed`, and `simple-staffed` as workflows (briefer sub-agents; `shared/` carrying briefer and focus requests; three concurrent briefers for staffed). Add the one-time mock-tier tests: **prompt equivalence** against the static originals' `getSystem`/`getInitialMessages`, and **tool-call equivalence** for `null`/`none`. This is the acceptance gate for the workflow half, and it also proves the `state/` snapshot writer is complete.

`learned` and episode retrieval are deferred with the memory expansion. The static strategists in `vox-agents/src/strategist/agents/simple-strategist-base.ts` are the canonical reference oracle for the equivalence tests.
