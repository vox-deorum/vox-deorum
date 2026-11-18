# Newspaper

The newspaper turns recorded game evidence into authored heuristic issues, displays them in a browser, and exports the same publication layout for Civilization V. Offline replay stores issues, editorial decisions, rule audits, series history, votes and preferences in a separate output database. Stage 6 evaluates trigger rules over city, player, event, pair and incident facts. The stock catalogue ships two city rules and no story templates, so a stock replay records skipped checks while each rule audit shows what every subject matched. A recorded 89-check run and browser checks verified reading, voting, and resume before this replacement; those results are [historical](replay.md#historical-heuristic-replay-verification). The fixture demo's links, scrolling and general UI are accepted in game; generated coverage still needs human reading and broader game acceptance. LLM evaluation and live integration remain planned.

| Page | Status | Scope |
| --- | --- | --- |
| [Renderer](renderer.md) | Demo accepted in game; broader acceptance pending | Stored presentation snapshots, browser rendering, DDS export, and game viewer |
| [Replay](replay.md) | Rule evaluation and audits implemented; publication pending authored content | Recording evidence, separate output storage, rule audits, issue reading, votes, preferences, and resume |
| [Editorial](editorial.md) | Stage 6 rule evaluation implemented; stock catalogue has no templates | Rules, configuration, selection, feedback, stored presentation, and audits; later expressions and LLM editing |
| [Evaluation](evaluation.md) | Planned | Offline experiments comparing editorial approaches |
| [Live integration](live-integration.md) | Planned | Live scheduling, MCP archive, save checkpoint IDs, and player integration |

Trigger rules use JavaScript expressions over facts from the MCP databases. The shared runner reads city, player, event, pair and incident facts, constants and shortcuts. Stage 6 evaluates the configured rules and records a per-subject audit; the stock catalogue ships `neighbor-puppet-annexed` and `settler-departure`. Inferred war and peace facts and the built-in pair shortcut are available to ordinary overlay rules, and the two documented diplomacy rules run as overlays. Stage 7 moves template, weight and page conditions to expressions, and stage 8 adds fresh in-game stories. [Plan 6](../../../plans/newspaper/implementation/06-trigger-rules.md) tracks the remaining stages.

| Trigger page | Status | Scope |
| --- | --- | --- |
| [Trigger overview](triggers/overview.md) | Rule evaluation implemented | Trigger entries, evaluation, importance, repeats, grouping, and the workflow for adding coverage |
| [Facts](triggers/facts.md) | City, player, event, pair and incident facts implemented | Cities, players, events, pairs and incidents; reading the past; hidden facts |
| [Constants and shortcuts](triggers/constants.md) | Implemented | Distance measurement, named distances, spans, sizes, type lists and shortcuts |
| [Examples](triggers/examples.md) | Two shipped rules; pair and incident examples run as overlays | Worked triggers, each with a target template sketch |
| [War and peace](triggers/war-and-peace.md) | Inference and rule facts implemented | Declaration cascades, obligations, city-state involvement, score progress and settlements as facts |

The [implementation roadmap](../../../plans/newspaper/implementation.md) describes the stages and their dependencies. Detailed requirements remain in each [implementation plan](../../../plans/newspaper/implementation/).

MCP owns the browser-safe evidence schemas and source references in `mcp-server/src/newspaper/evidence.ts`, archive scope/index/query schemas in `protocol.ts`, historical reads in `queries.ts`, and reportable-field policy in `projection.ts`. The `get-newspaper-evidence` tool calls the same query used by standalone replay, with no live refresh. MCP does not import Vox Agents.

War and peace coverage uses the already recorded `DeclareWar` and `MakePeace` events plus projected relationship snapshots. It adds no DLL events. Inference runs on every check and updates pair memory and its audit. The [war and peace guide](triggers/war-and-peace.md) explains how the editor exposes those observations as incident and pair facts.

Vox Agents owns editing, replay orchestration, publications, and presentation under `vox-agents/src/newspaper/`:

| Location | Responsibility |
| --- | --- |
| `contracts/` | Issues, versioned presentation and offline publication state, archive responses, reader interaction, serialized render data, and replay settings/responses |
| `editorial/` | Check orchestration, rule evaluation, configuration, the fact model, diplomacy inference, selection, presentation, and shared helpers |
| `replay/` | Read-only recording access through MCP's compiled queries, serialized sessions, routes, and atomic output commits |
| `renderer/` | Browser-safe assets, layout, stored presentation resolution, shared reader state, and bridge interfaces |
| `export/` | Browser capture, cache delivery, export queue, and host routes |

The normal VD server injects replay handlers before the newspaper fallbacks and drains replay and export work during shutdown. The JSON catalogue under `vox-agents/newspaper/` supplies runtime editorial settings and authored choices. Installation includes `constants.json`, `defaults.json`, `pages.json`, and the JSON files in `designs/` and `triggers/`. The stock catalogue includes no templates.

The plain DOM reader lives in `vox-agents/newspaper/src/reader/`. Its application shell in `vox-agents/newspaper/src/app/` coordinates fixtures, replay controls, stored issues, votes, and evidence/source inspection. Evidence inspection also works without a generated issue. The export entry point remains `src/export-bridge.ts`. The game viewer and data helpers live in `civ5-mod/UI/Newspaper/`.

To render an issue, supply a completed `IssueDocument` with publication identity, ordered pages, canonical items, typed links, and its saved presentation. Configurable design identities select fixed Victorian or modern renderer families; reopening an issue uses the saved colors, fonts, ornaments and layout choices. The [renderer guide](renderer.md) describes the schema 2 input, separate render profile and reader state, and exported bundle.

Offline publication state uses schema 5, IssueDocument uses schema 2, and the replay output database uses SQLite `user_version` 4. [Plan 5](../../../plans/newspaper/implementation/05-live-integration.md) adds a live archive in MCP and a fixed-size checkpoint ID in the Civ V save.
