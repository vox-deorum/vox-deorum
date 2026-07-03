# Stage 4 — Workflow format + minimal runtime + `scripted-strategist`

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Define the on-disk workflow format (`workflow.ts` plus `subagents/*.json` plus `prompts/*.md`) and a path-based loader/resolver; build a runtime that runs a no-LLM script inside the working folder, plugged into `VoxPlayer` and the registry as `scripted-strategist`; and wire script-completion and script-failure fallback to `keep-status-quo`. Recreate `null` and `none`, and prove identical action tool-call sequences under a fixed seed through a real turn.

This is the minimum thin slice: the `null` workflow runs end-to-end here, so no large untested chunk is left for the end.
