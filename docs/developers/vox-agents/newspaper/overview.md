# Newspaper

The newspaper currently has a fixture renderer proof, with in-game visual acceptance still pending. The renderer guide describes the browser reader and DDS export. Replay, editorial decisions, evaluation, and live integration have short scope pages marked as planned; these will become implementation references as each stage is built.

| Page | Status | Scope |
| --- | --- | --- |
| [Renderer](renderer.md) | Implemented proof | Fixture reading, browser rendering, DDS export, and game viewer |
| [Replay](replay.md) | Planned | Recorded-game evidence and replay |
| [Editorial](editorial.md) | Planned | Heuristic publication decisions and later LLM editing |
| [Evaluation](evaluation.md) | Planned | Offline experiments comparing editorial approaches |
| [Live integration](live-integration.md) | Planned | Scheduling, persistence, archives, and player integration |

The [implementation roadmap](../../../plans/newspaper/implementation.md) describes the stages and their dependencies. Detailed requirements remain in each [implementation plan](../../../plans/newspaper/implementation/).

The implemented source lives in `vox-agents/src/newspaper/`: `contracts/` defines completed publications and reader interaction, `renderer/` owns browser-safe presentation, `export/` owns Node capture and cache delivery, and `host/` serves the local proof. The command entry point is `console.ts`. The plain DOM reader stays in `vox-agents/newspaper/src/`.

To render an issue, supply a completed `IssueDocument` with publication identity, ordered pages, canonical items, and typed links. The [renderer guide](renderer.md) describes that input, the separate render profile and reader state, and the exported bundle. Editorial selection and replay produce publications in later stages.
