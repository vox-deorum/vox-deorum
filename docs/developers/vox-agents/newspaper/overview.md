# Newspaper

The newspaper turns recorded game evidence into authored heuristic issues, displays them in a browser, and exports the same publication layout for Civilization V. Offline replay stores issues, editorial decisions, series history, votes and preferences in a separate output database. A recorded 89-check run and browser checks verified reading, voting, and resume. The fixture demo's links, scrolling and general UI are accepted in game; generated coverage still needs human reading and broader game acceptance. LLM evaluation and live integration remain planned.

| Page | Status | Scope |
| --- | --- | --- |
| [Renderer](renderer.md) | Demo accepted in game; broader acceptance pending | Stored presentation snapshots, browser rendering, DDS export, and game viewer |
| [Replay](replay.md) | Recorded publication and browser workflow verified | Recording evidence, separate output storage, issue reading, votes, preferences, and resume |
| [Editorial](editorial.md) | Heuristic implementation; reading acceptance pending | Configured detection, authored stories, series, feedback, and stored presentation; later LLM editing |
| [Evaluation](evaluation.md) | Planned | Offline experiments comparing editorial approaches |
| [Live integration](live-integration.md) | Planned | Live scheduling, MCP archive, save checkpoint IDs, and player integration |

The new trigger design uses JavaScript expressions over facts from the MCP databases. The shared expression runner is implemented; published issues still use the fixed detectors and existing templates. [Plan 6](../../../plans/newspaper/implementation/06-trigger-rules.md) tracks the remaining work.

| Trigger page | Status | Scope |
| --- | --- | --- |
| [Trigger overview](triggers/overview.md) | Runner implemented; trigger rules planned | Trigger entries, evaluation, importance, repeats, grouping, and the workflow for adding coverage |
| [Facts](triggers/facts.md) | Target design | Cities, players, events, pairs and incidents; reading the past; hidden facts |
| [Constants and shortcuts](triggers/constants.md) | Target design | Distance measurement, named distances, spans, sizes, type lists and shortcuts |
| [Examples](triggers/examples.md) | Target design | Worked triggers, each with a template sketch |
| [War and peace](triggers/war-and-peace.md) | Inference implemented; rules are target design | Declaration cascades, obligations, city-state involvement, score progress and settlements as facts |

The [implementation roadmap](../../../plans/newspaper/implementation.md) describes the stages and their dependencies. Detailed requirements remain in each [implementation plan](../../../plans/newspaper/implementation/).

MCP owns the browser-safe evidence schemas and source references in `mcp-server/src/newspaper/evidence.ts`, archive scope/index/query schemas in `protocol.ts`, historical reads in `queries.ts`, and reportable-field policy in `projection.ts`. The `get-newspaper-evidence` tool calls the same query used by standalone replay, with no live refresh. MCP does not import Vox Agents.

War and peace coverage uses the already recorded `DeclareWar` and `MakePeace` events plus projected relationship snapshots. It adds no DLL events. The [war and peace guide](triggers/war-and-peace.md) explains how those observations become incident and pair facts.

Vox Agents owns editing, replay orchestration, publications, and presentation under `vox-agents/src/newspaper/`:

| Location | Responsibility |
| --- | --- |
| `contracts/` | Issues, versioned presentation and offline publication state, archive responses, reader interaction, serialized render data, and replay settings/responses |
| `editorial/` | Check orchestration, configuration, city, national, event, and diplomacy measurement, selection, presentation, and shared helpers |
| `replay/` | Read-only recording access through MCP's compiled queries, serialized sessions, routes, and atomic output commits |
| `renderer/` | Browser-safe assets, layout, stored presentation resolution, shared reader state, and bridge interfaces |
| `export/` | Browser capture, cache delivery, export queue, and host routes |

The normal VD server injects replay handlers before the newspaper fallbacks and drains replay and export work during shutdown. The JSON catalogue under `vox-agents/newspaper/` supplies runtime editorial settings and authored choices. Installation explicitly includes `defaults.json`, `pages.json`, and the `designs/`, `templates/`, and `triggers/` JSON files.

The plain DOM reader lives in `vox-agents/newspaper/src/reader/`. Its application shell in `vox-agents/newspaper/src/app/` coordinates fixtures, replay controls, stored issues, votes, and evidence/source inspection. Evidence inspection also works without a generated issue. The export entry point remains `src/export-bridge.ts`. The game viewer and data helpers live in `civ5-mod/UI/Newspaper/`.

To render an issue, supply a completed `IssueDocument` with publication identity, ordered pages, canonical items, typed links, and its saved presentation. Configurable design identities select fixed Victorian or modern renderer families; reopening an issue uses the saved colors, fonts, ornaments and layout choices. The [renderer guide](renderer.md) describes the schema 2 input, separate render profile and reader state, and exported bundle.

Offline publication state uses schema 3, IssueDocument uses schema 2, and the replay output database uses SQLite `user_version` 2. [Plan 5](../../../plans/newspaper/implementation/05-live-integration.md) adds a live archive in MCP and a fixed-size checkpoint ID in the Civ V save.
