# Stage 9 — Offline orchestrator agent + console cycle

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Build the orchestrator as a registered agent with file-edit and scoped-git sub-agents and tools (and a reserved judge-sub-agent seam), driven by an offline console in the oracle/telepathist family. Assemble its working folder (workflow git, notes, recent run folders, signals, the tool and game-state schema snapshot from cached MCP definitions, the substrate reference, an example `state/`, and the tier list); give it a persistent conversation with stable prefixes and compaction; and let it write **only** drafts, commits, and notes, adopting **through the gate** (Stage 8). The boundary is enforced — no mcp-server, no actions — with a test. Verified: one cycle commits a changelogged, versioned edit that lands on a later run.

Scoped git access must not become a path to mcp-server or a game action; the "cannot act" test is a first-class deliverable (see the Stages 9 and 11 watch-item in [README.md](README.md)).
