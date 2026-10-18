# Stage 1: Workflow format, minimal runtime, and scripted-strategist

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Define the on-disk workflow format (`workflow.ts` plus `subagents/*.json` plus `prompts/*.md`) and a path-based loader. Build a runtime that runs the workflow script in just-bash's `js-exec`, with:

- host primitives exposed through `invokeTool`;
- the workflow definition mounted read-only;
- a wall-clock limit raised for workflow runs, while a compute bound stays in place.

Each run opens one **run session** over the seat workspace: a single view of the store head with an overlay for the run's writes, committed once at run end. Plug the runtime into `VoxPlayer` and the agent registry as `scripted-strategist`.

Keep two outcomes apart. A script that completes without taking any action is a successful no-op, and the runtime adds no call. A script that fails closes the run to actions, then falls back to `keep-status-quo`. Add a keyed `seededIndex` primitive that uses the static `null` strategist's key scheme (sync seed, player, turn, choice label). Recreate `null` and `none` and prove identical action tool-call sequences under a fixed seed through a real turn; for `none` that sequence is empty.

This is the minimum thin slice: the `null` workflow runs end-to-end here. The host primitive surface is a trust boundary, so keep it narrow (see _Risks and watch-items_ in [README.md](README.md)).
