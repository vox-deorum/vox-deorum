# Stage 10 — Verify

> Part of the documentation revamp. Shared goals, writing principles, and target structure live in [README.md](README.md). The full source plan is [`../plan.md`](../plan.md).
>
> Depends on Stage 9 — final pass after all migration and cleanup.

## Objective

Confirm the revamp is complete and consistent: no broken links, no stale references, and component `docs/` folders hold only reference material.

## Work items

1. **Broken-link sweep.** Check every markdown link across `docs/` and the repo for targets that no longer exist or moved during Stages 6–9.
2. **Stale-reference sweep.** Find prose that still describes the old layout, points readers to deleted component README/prose docs, or duplicates content now living under `/docs/`.
3. **Reference-only check.** Confirm each component `docs/` folder contains only exact reference data (event schemas, message formats, generated API listings, toolchain/db-schema/debugging) — no prose that should have moved to `/docs/developers/`.
4. **Cross-consistency check.** Confirm the paired pages written in different stages still agree: `civ5-dll/connection.md` ↔ `bridge-service/connection.md`; `bridge-service` ↔ `mcp-server/bridge.md`; `civ5-mod/ui.md` ↔ `vox-agents/envoy.md`/`ui.md`; and Stage 7 `architecture.md`/`protocol.md` against the component folders they summarize.
5. **Structure check.** Confirm the actual `docs/` tree matches the target structure in [README.md](README.md), and that both entry points are reachable from `docs/README.md` and the root `README.md`.

## Done when

No broken or stale links remain, paired pages agree, component `docs/` folders are reference-only, and the tree matches the target structure. At this point `../plan.md` describes the standing organization and its "Maintenance" rules take over.
