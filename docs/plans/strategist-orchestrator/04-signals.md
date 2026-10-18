# Stage 4: Reference signals

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Build the reference signals:

- **Cost** per component, from the step counts on spans and the Stage 2 coefficients.
- **Decision coverage**, a negative signal: the `get-options` inventory compared against the sanctioned actions actually taken.
- **Victory trend**, a generic interface with a score-ratio provider (smoothed, phase-gated).

Each signal is individually enable-able. Verified against a recent game's records.

The civ-bench connector is deferred behind the victory-trend interface, and the LLM decision-quality judge is deferred as a future orchestrator sub-agent. Both leave a clean seam (see _What v1 defers_ in [README.md](README.md)).
