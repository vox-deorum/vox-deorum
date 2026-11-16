# Plan 2: historical queries for newspaper evaluation

**Status: complete.** Historical evidence queries, recorded visibility filtering, read-only replay, and source inspection are implemented and verified against a self-play recording.

The [replay developer guide](../../../developers/vox-agents/newspaper/replay.md) owns the implemented behavior, module boundaries, startup commands, and acceptance results. It includes the tested recording and settings, source-traced domestic, trade, and foreign-culture examples, and recording limitations.

No work remains in this stage. Continue with [Plan 3: heuristic newspaper](03-heuristic-editor.md) to turn evidence into generated issues and supply real content for further renderer acceptance. Durable replay output belongs to Plan 3, editorial comparisons to [Plan 4](04-offline-evaluation.md), and live collection and save integration to [Plan 5](05-live-integration.md).
