# Stage 7: Cross-game continuity and online triggers (later phase)

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Carry the version line and notes across games: a new game's first cycle inherits prior history and notes through the same git line.

Add **online mode**, which fires a cycle during play on an in-game trigger:

- a cost spike against the rolling average;
- every N runs;
- a budget exhaustion or script failure;
- a victory-trend decline.

The edit lands on a subsequent run, never the one in flight. Both modes are config-gated; offline mode ships in Stage 6.

Nothing else in the plan depends on this stage (see _What v1 defers_ in [README.md](README.md)).
