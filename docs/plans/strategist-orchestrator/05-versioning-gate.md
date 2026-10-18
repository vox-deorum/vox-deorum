# Stage 5: Git-backed versioning, commit gate, and dry-run testbed

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Stand up the versioning:

- the orchestrator-managed workflow git repository, seeded from the in-repo seeds;
- a per-seat branch or ref as the `current` pointer;
- a runtime that resolves and **pins** the seat's version at run start, with the record stamping it.

Build the **adoption gate**:

1. Static checks over script, manifest, and prompt references.
2. A **stubbed dry-run** (stubbed models and actions) against a recent `records/turn-N` snapshot and its recorded decision context from the seat's workspace store.
3. On pass, advance the seat ref atomically.

The dry-run harness doubles as the hand-authoring and development testbed. Verified by committing a hand-edited version that a live run pins and picks up mid-game.

A run reads its seat ref once at start, and the atomic ref advance is what keeps an adopted edit off the run in flight (see _Risks and watch-items_ in [README.md](README.md)). There is no automatic rollback: `git revert` stays available as a deliberate edit.
