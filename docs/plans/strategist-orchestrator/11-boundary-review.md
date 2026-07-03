# Stage 11 — Closing security/boundary review + deferred-seam confirmation

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Run the closing static review: the orchestrator cannot reach mcp-server or issue a game action (only script, manifest, prompt, and note writes plus scoped git succeed); the never-stall guarantees hold on every terminal path; and committed versions are substantively distinct. Confirm each reserved seam stays cleanly addable — the judge sub-agent, the civ-bench connector, and `learned` plus RAG-backed memory.
