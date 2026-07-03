# Stage 3 — SES sandbox & script API

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Build the model-agnostic script interface — sequencing, conditionals, awaited and parallel sub-agent calls, a seeded deterministic RNG, and plain compute — run under `ses` in a worker thread with a wall-clock kill switch and a memory cap. Compartments expose only injected host primitives, the manifest allowlists are enforced at the boundary, and no external packages are allowed. Unit-tested against a fake host, with no game.

SES is adopted directly here (no restricted-runtime-first framing). Compartments expose only injected primitives, and the allowlist boundary is the trust boundary, so keep the injected surface narrow and audited (see the Stage 3 watch-item in [README.md](README.md)).
