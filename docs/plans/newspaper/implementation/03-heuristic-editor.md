# Plan 3: heuristic newspaper and publication state

**Status: implementation and automated verification complete.** The [editorial guide](../../../developers/vox-agents/newspaper/editorial.md) and [replay guide](../../../developers/vox-agents/newspaper/replay.md) describe publication, voting, and resume. [Plan 6](06-trigger-rules.md) replaced the initial catalogue and closed with the owner's acceptance of the stock news mechanics.

## Reading acceptance

Carry editorial reading acceptance and catalogue tuning into [Plan 4](04-triggers-templates-and-styles.md), including story mix, continuity, voice, thresholds, decay, novelty, votes, and content minimums. The broader checks for generated issues in the game remain in [Plan 1](01-renderer.md). [Plan 7](07-llm-editors.md) adds model editing and comparisons.

## Live persistence boundary

The versioned SQLite store and publication contracts serve offline runs. [Plan 5](05-live-integration.md) will store live issues and editorial state in MCP's per-game database, referenced by a fixed-size checkpoint ID in the Civ V save. Use generated archives and fixtures to measure MCP storage and lookup costs.
