# Stage 9 — Cleanup

> Part of the documentation revamp. Shared goals, writing principles, and target structure live in [README.md](README.md). The full source plan is [`../plan.md`](../plan.md).
>
> Depends on Stages 2–8 — only delete a source once its prose has been distilled into the standing pages.

## Objective

Slim the root README into a front door, delete the migrated component markdown and prose docs, remove historical plan folders, and fix all inbound links.

## Work items

### Slim the root README

Reduce root `README.md` to: project pitch, screenshot, quick-start link to `docs/players/getting-started.md`, developer link to `docs/developers/architecture.md`, and license. It becomes a front door, not a manual.

Keep `AGENTS.md` (agent/contributor working rules) and `LICENSE.md`. The per-component `AGENTS.md` files also stay — working instructions, not documentation.

### Delete migrated prose (distilled in Stages 4–6)

- `vox-agents/README.md` (Stage 6)
- `vox-agents/install.md` (Stages 7–8)
- `bridge-service/docs/CONFIGURATION.md` (Stage 4)
- `bridge-service/docs/ERROR-HANDLING.md` (Stage 4)
- `bridge-service/docs/DEVELOPMENT.md` (Stage 4)
- `mcp-server/docs/DEVELOPMENT.md` (Stage 5)
- `mcp-server/docs/KNOWLEDGE.md` (Stage 5) — delete **unless** it carries exact reference data
- `vox-agents/docs/obs.md` (Stage 6)
- `vox-agents/docs/oracle.md` (Stage 6)
- `vox-agents/docs/plans/telepathist.md` (Stage 6)
- `vox-agents/docs/plans/webui-plan.md` (Stage 6)
- `vox-agents/docs/plans/` — remove the folder once both plans are distilled

### Do NOT delete (kept in place)

- `bridge-service/README.md`, `mcp-server/README.md` — folded into overviews; remove only after confirming no unique reference remains.
- `civ5-dll/README.md`, `civ5-dll/CvGameCoreDLL_Expansion2/GAMECORE_OVERVIEW.md` — originals stay (separate submodule with upstream history).
- All `*/docs/` reference material flagged "Keep" in the component stages (event schemas, message formats, generated API listings, toolchain/db-schema/debugging docs).
- `docs/versions/*.md`.

### Fix inbound links

Update every reference that pointed at a moved or deleted file to its new home under `/docs/`.

## Done when

The root README is a front door, every migrated prose source is deleted, `vox-agents/docs/plans/` is gone, and no link points at a removed file.
