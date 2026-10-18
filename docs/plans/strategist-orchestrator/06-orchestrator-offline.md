# Stage 6: Offline orchestrator agent and console cycle

> Part of the strategist-orchestrator plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: not yet drafted.** This stub records the stage's objective from the build-order outline; the full plan (`## Approach` / `## Work items` / `## Reuse` / `## Verify` / `## Done when`) is written when this stage is picked up.

## Objective

Build the orchestrator as a registered agent with file-edit and scoped-git sub-agents and tools (and a reserved judge-sub-agent seam), driven by an offline console in the oracle/telepathist family.

Its working folder holds:

- the workflow git and its notes;
- materialized seat workspaces (records, decision context, briefings, and `game/` notes);
- run transcripts rendered from telemetry spans the way the oracle retriever reads them;
- signals;
- the schema snapshot from the cached MCP tool definitions (`saveToolCache`/`loadToolCache` in `VoxContext`);
- the substrate reference;
- an example `records/turn-N`;
- the tier list.

Give it a persistent conversation with stable prefixes. The existing compaction in `executeAgent` handles growth within a cycle. Across cycles, add a **rollover**:

1. Past a size threshold, the orchestrator writes a persisted summary note.
2. Older cycles move to an archive file in its notes.
3. The next cycle resumes from the stable prefix, the summary, and the most recent cycles in full.

Verify that the conversation stays bounded and earlier conclusions stay referenced across several resumed cycles.

It writes **only** drafts, commits, and notes, and adopts **through the gate** (Stage 5). The boundary (no mcp-server, no actions) is enforced with a test. Verified: one cycle commits a changelogged, versioned edit that lands on a later run. Scoped git access must not become a path to mcp-server or a game action, so the "cannot act" test is a first-class deliverable (see _Risks and watch-items_ in [README.md](README.md)).
