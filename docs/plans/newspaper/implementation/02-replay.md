# Plan 2: historical queries for newspaper evaluation

**Status: complete.** Historical evidence queries, recorded visibility filtering, read-only replay, and source inspection are implemented and verified against a self-play recording.

The [replay developer guide](../../../developers/vox-agents/newspaper/replay.md) owns the implemented behavior, module boundaries, startup commands, and acceptance results. It includes the tested recording and settings, source-traced domestic, trade, and foreign-culture examples, and recording limitations.

No work remains in this stage. [Plan 3](03-heuristic-editor.md) uses recorded evidence to publish and store issues. Plans [4b](04b-story-mining.md) and [4c](04c-variant-drafting.md) use recorded evidence to find story types and read drafted variants; [Plan 7](07-llm-editors.md) compares editors, and [Plan 5](05-live-integration.md) reuses the historical query during play.
