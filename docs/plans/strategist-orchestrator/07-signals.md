# Stage 7 — Reference signals

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Build the reference signals: per-component cost surfacing (from Stage 1); the **decision-coverage** negative signal (`get-options` inventory against sanctioned actions actually taken); and a **generic victory-trend interface with a score-ratio provider** (smoothed, phase-gated). Each signal is individually enable-able. Verified against a recent game's records.

The civ-bench connector is deferred behind the victory-trend interface; the LLM decision-quality judge is deferred as a future orchestrator sub-agent. Both leave a clean seam (see *What v1 defers* in [README.md](README.md)).
