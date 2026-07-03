# Stage 2 — Working-folder model & run-record renderer (online + offline)

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Define the per-seat and per-run working-folder layout, and a single renderer that produces `state/*.json` snapshots and the markdown run record plus per-sub-agent transcripts from **either** the live knowledge reports (online, during a run) **or** the telemetry spans (offline, rebuilt for the orchestrator) — one code path, two sources. Include the `shared/` and `artifacts/` areas and retention. Verified by rendering both state and record from a past game's spans and matching a live run.

The online and offline paths must produce identical `state/*.json`, or equivalence and the orchestrator's evidence diverge; the shared code path is the guard (see the Stage 2 watch-item in [README.md](README.md)).
