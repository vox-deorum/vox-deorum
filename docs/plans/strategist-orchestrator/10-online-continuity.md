# Stage 10 — Cross-game continuity + online triggers (later phase)

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Carry the version line and notes across games (a new game's first cycle inherits prior history and notes through the same git line). Add **online mode**: fire a cycle during play on an in-game trigger — a cost spike against the rolling average; every N runs; a budget exhaustion or script failure; a victory-trend decline — config-gated, with the edit landing on a subsequent run and never the one in flight. Both modes are config-gated; offline already shipped in Stage 9.

This is the later-phase stage: nothing else in the plan depends on it (see *What v1 defers* in [README.md](README.md)).
