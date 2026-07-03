# Stage 1 — Cost currency & cache-aware telemetry

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Capture token usage including cached tokens — provider-reported where available, **estimated from adjacent same-turn calls otherwise** — so telemetry carries cache data. Define cost-weighted tokens as the single cost unit, with a per-tier and per-operation (cache-read, read, write) coefficient config, and surface cost per call. Verified against existing telemetry databases.

The adjacent-call cache estimate ships in this stage, not later, so downstream stages have real cache data to verify budgets and the cost signal against. The estimate must be conservative and clearly flagged in telemetry against provider-reported counts (see the Stage 1 watch-item in [README.md](README.md)).
