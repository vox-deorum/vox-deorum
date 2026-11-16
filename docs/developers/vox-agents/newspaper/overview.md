# Newspaper

The newspaper has a working in-game demo and read-only recording replay with evidence inspection. The demo's links, scrolling, and general UI are accepted in Civilization V; replay is verified against a self-play recording. Broader renderer testing needs generated issues from real evidence. Editorial generation, evaluation, and live integration remain planned.

| Page | Status | Scope |
| --- | --- | --- |
| [Renderer](renderer.md) | Demo accepted in game | Fixture reading, browser rendering, DDS export, and game viewer; broader checks await real issues |
| [Replay](replay.md) | Implemented and verified | Recorded-game evidence, cutoff controls, and source inspection |
| [Editorial](editorial.md) | Planned | Heuristic publication decisions and later LLM editing |
| [Evaluation](evaluation.md) | Planned | Offline experiments comparing editorial approaches |
| [Live integration](live-integration.md) | Planned | Scheduling, persistence, archives, and player integration |

The [implementation roadmap](../../../plans/newspaper/implementation.md) describes the stages and their dependencies. Detailed requirements remain in each [implementation plan](../../../plans/newspaper/implementation/).

MCP owns the browser-safe evidence schemas and source references in `mcp-server/src/newspaper/evidence.ts`, historical reads in `queries.ts`, and reportable-field policy in `projection.ts`. The `get-newspaper-evidence` tool calls the same query used by standalone replay, with no live refresh. MCP does not import Vox Agents.

Vox Agents owns replay orchestration, publications, and presentation under `vox-agents/src/newspaper/`. `contracts/` defines publications, reader interaction, serialized render data, and replay settings/responses. `replay/` owns the read-only connection and serialized session, using MCP's compiled queries. `renderer/` owns browser-safe presentation and bridge interfaces; `export/` owns capture, cache delivery, the reusable export service, and host routes. The normal VD server injects replay handlers before the newspaper fallbacks and drains replay and export work during shutdown.

The plain DOM reader lives in `vox-agents/newspaper/src/reader/`. Its application shell in `src/app/` coordinates fixtures, replay controls, and evidence/source inspection without requiring generated issues. The export entry point remains `src/export-bridge.ts`. The game viewer and data helpers live in `civ5-mod/UI/Newspaper/`.

To render an issue, supply a completed `IssueDocument` with publication identity, ordered pages, canonical items, and typed links. The [renderer guide](renderer.md) describes that input, the separate render profile and reader state, and the exported bundle. Replay currently supplies evidence; later editorial work will turn it into publications and persist separate output.
