# Stage 6 — Component: vox-agents

> Part of the documentation revamp. Shared goals, writing principles, and target structure live in [README.md](README.md). The full source plan is [`../plan.md`](../plan.md).
>
> Depends on Stage 1. Builds on Stage 5 (the MCP tools the agents consume). Last and largest component stage.

## Objective

Create and write `docs/developers/vox-agents/`: the LLM strategic-AI framework at the top of the stack. Read the `src/` subsystems as the primary source; fold the README's framework overview and per-agent sections out across the agent pages; distill the shipped design plans into standing pages.

## Pages

- `overview.md` — The VoxAgent framework: base class, lifecycle, context, how pieces fit.
- `strategist.md` — In-game strategic AI: turn-based agents, sessions, per-player state, modes.
- `envoy.md` — Player-facing chat agents: spokespersons and diplomats.
- `support-agents.md` — Briefers, analysts, librarians — cooperative agents the others invoke.
- `telepathist.md` — Post-game conversational analysis over recorded telemetry.
- `oracle.md` — Counterfactual "what-if" prompt-replay experiments.
- `archivist.md` — Batch episode extraction from finished games.
- `ui.md` — The web dashboard (Vue) and its Express/SSE backend.
- `media.md` — OBS capture and the narrators video-generation pipeline.
- `observability.md` — Tracing and logging (OpenTelemetry/Langfuse); inspecting agent behavior.

## Sources

| Source | Action |
|---|---|
| `vox-agents/README.md` | Fold framework overview into `overview.md`; split per-agent sections across `strategist.md`, `envoy.md`, `support-agents.md`, `telepathist.md`, `oracle.md`, `archivist.md`, `ui.md`. Delete original in Stage 9. |
| `vox-agents/docs/obs.md` | OBS/narrators prose → `media.md`; tracing/logging prose → `observability.md`. Delete original in Stage 9. |
| `vox-agents/docs/oracle.md` | Move prose into `oracle.md`. Delete original in Stage 9. |
| `vox-agents/docs/plans/telepathist.md` | Shipped plan — distill current behavior into `telepathist.md`, then delete in Stage 9. |
| `vox-agents/docs/plans/webui-plan.md` | Shipped plan — distill current behavior into `ui.md`, then delete in Stage 9. |
| `vox-agents/docs/plans/` | Remove the folder in Stage 9 once both plans are distilled. |
| `src/` subsystems + README agent sections | Write `strategist.md`, `envoy.md`, `support-agents.md`, `archivist.md` from source. |
| `vox-agents/docs/api/` | Keep (generated reference). |

## Feeds forward

- `envoy.md`/`ui.md` align with Stage 3 `civ5-mod/ui.md` (the in-game chat surface) — keep terminology consistent.
- Stage 7 `architecture.md` summarizes this folder for the agent layer.
- Stage 8 player docs draw heavily here: `playing.md` from `strategist.md`/`envoy.md` (what the AI does), `configuration.md` from provider/model handling, `replay.md` from the Replayer described in `ui.md`/`telepathist.md`.

## Done when

The `vox-agents/` folder is written in prose, every agent has its page, generated `api/` is left in place, and the shipped plans' behavior is captured in the standing pages (their deletion happens in Stage 9). No source embedded as raw code.
