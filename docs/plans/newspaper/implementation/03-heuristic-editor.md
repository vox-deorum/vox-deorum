# Plan 3: heuristic newspaper and publication state

**Status: publication, voting and resume are complete and verified. Archive navigation in the browser remains.** The [editorial guide](../../../developers/vox-agents/newspaper/editorial.md) and [replay guide](../../../developers/vox-agents/newspaper/replay.md) describe publication, voting, and resume. [Plan 6](06-trigger-rules.md) replaced the initial catalogue and closed with the owner's acceptance of the stock news mechanics.

## Remaining work: archive navigation

Finish bounded archive filters for date, page, civilization, and city, and make series links open the archived page at the linked report. Extend the replay store and browser shell with the shared archive contracts in `mcp-server/src/newspaper/protocol.ts` and Vox Agents' `contracts/archive.ts`. Keep the archive and evidence inspector outside the publication, and preserve shared votes across page appearances.

Verify in the browser reader: each filter narrows the issue list, a series link lands on the earlier report, and a vote made from the archive shows on every page where the article appears. Run `npm run build -w vox-agents` and `npm run test:mock -w vox-agents -- tests/mock/newspaper`.

## Where the rest went

Story types, styles and wording belong to Plans [4a](04a-styles.md), [4b](04b-story-mining.md) and [4c](04c-variant-drafting.md). The broader checks for generated issues in the game remain in [Plan 1](01-renderer.md). [Plan 7](07-llm-editors.md) adds model editing and comparisons.

## Live persistence boundary

The versioned SQLite store and publication contracts serve offline runs. [Plan 5](05-live-integration.md) reuses the editor during play and keeps the latest issue in memory.
