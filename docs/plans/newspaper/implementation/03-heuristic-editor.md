# Plan 3: heuristic newspaper and publication state

**Status: implementation and automated verification complete; manual acceptance pending.** The implementation is described in the [editorial guide](../../../developers/vox-agents/newspaper/editorial.md), [replay guide](../../../developers/vox-agents/newspaper/replay.md), and [renderer guide](../../../developers/vox-agents/newspaper/renderer.md). The replay guide records the verified publication, voting, browser, and resume measurements. See the [roadmap](../implementation.md) for later stages.

## Reading acceptance

Review generated issues with the owner before treating this stage's editorial quality as accepted. The [replay command](../../../developers/vox-agents/newspaper/replay.md) produces readable reports, audit records and selected PNG previews from saved recordings. Use early, ordinary, merged, quiet-return, and incoming-war examples. Check that coverage is useful, prose reads naturally, short pieces add value, and page composition keeps a useful mix of subjects. Inspect evidence and decision records when a choice is surprising.

Exercise generated issues in the browser and game at representative paper widths and zoom levels. Record readability, links, scrolling, section tabs, shared-item votes, and missing-texture behavior. The fixture game demo and automated browser checks do not complete these broader game checks; retain their detailed gates in [Plan 1](01-renderer.md).

Thresholds, decay, novelty, tag-window length, vote strength, and content minimums remain explicit catalogue tuning values. Carry reading findings into [Plan 4](04-offline-evaluation.md), which broadens designs, finishes archive filtering and series navigation, and adds the constrained LLM editor and evaluation.

## Live persistence boundary

The versioned SQLite store and publication contracts serve offline runs. The early save-capacity and coexistence proof in [Plan 5](05-live-integration.md) remains pending and must precede commitment to the live checkpoint representation. Measure real generated archives as well as fixtures, including immutable text, presentation snapshots, evidence summaries, and compact decisions. Offline database size does not prove that the same representation fits a Civilization V save.

Runtime LLM writing, live generation, game-owned storage, and richer media remain in later stages.
