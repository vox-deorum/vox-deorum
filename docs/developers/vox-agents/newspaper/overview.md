# Newspaper

The newspaper publishes stories from a Civilization V recording. An authored template can turn Amsterdam's loss of population into a story about departing settlers when the same city trained a settler and still had food to spare. The browser reader and the game use the same publication layout. Replay saves issues, decisions and votes separately from the recording.

| Page | Status | Scope |
| --- | --- | --- |
| [Renderer](renderer.md) | Demo accepted in game; broader acceptance pending | Stored presentation snapshots, browser rendering, DDS export, and game viewer |
| [Replay](replay.md) | Rule evaluation, expressions and audits implemented; stock catalogue publishes nothing until Step 8 | Recording evidence, separate output storage, rule audits, issue reading, votes, preferences, and resume |
| [Editorial](editorial.md) | Step 7 expressions implemented; stock catalogue has two rules and no templates | Rules, configuration, authored choices, selection, feedback, stored presentation, and audits |
| [Evaluation](evaluation.md) | Planned | Offline experiments comparing editorial approaches |
| [Live integration](live-integration.md) | Planned | Live scheduling, MCP archive, save checkpoint IDs, and player integration |

JavaScript expressions in QuickJS decide which developments make news and which accounts are eligible to print. The stock rules are `settler-departure` and `neighbor-puppet-annexed`; use a [template overlay](triggers/examples.md#a-city-shrinks-after-sending-settlers) to publish one now. The stock catalogue records rule audits until step 8 adds the starting stories. See the [handoff and recorded examples](../../../plans/newspaper/implementation/06-trigger-rules.md).

| Trigger page | Status | Scope |
| --- | --- | --- |
| [Trigger overview](triggers/overview.md) | Rules and authored expressions implemented | Trigger entries, evaluation, importance, repeats, grouping, and the workflow for adding coverage |
| [Facts](triggers/facts.md) | City, player, event, pair and incident facts implemented | Cities, players, events, pairs and incidents; reading the past; hidden facts |
| [Constants and shortcuts](triggers/constants.md) | Implemented | Distance measurement, named distances, spans, sizes, type lists and shortcuts |
| [Examples](triggers/examples.md) | Two shipped rules; pair and incident examples run as overlays; settler template overlay | Worked triggers and a publishable template example |
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

The normal VD server injects replay handlers before the newspaper fallbacks and drains replay and export work during shutdown. The JSON catalogue under `vox-agents/newspaper/` supplies runtime editorial settings and authored choices. Installation includes `constants.json`, `defaults.json`, `pages.json`, and the JSON files in `designs/` and `triggers/`. Templates are optional, and the stock catalogue includes none until Step 8.

The plain DOM reader lives in `vox-agents/newspaper/src/reader/`. Its application shell in `vox-agents/newspaper/src/app/` coordinates fixtures, replay controls, stored issues, votes, and evidence/source inspection. Evidence inspection also works without a generated issue. The export entry point remains `src/export-bridge.ts`. The game viewer and data helpers live in `civ5-mod/UI/Newspaper/`.

To render an issue, supply a completed `IssueDocument` with publication identity, ordered pages, canonical items, typed links, and its saved presentation. Configurable design identities select fixed Victorian or modern renderer families; reopening an issue uses the saved colors, fonts, ornaments and layout choices. The [renderer guide](renderer.md) describes the schema 2 input, separate render profile and reader state, and exported bundle.

Offline publication state uses schema 6, IssueDocument uses schema 2, and the replay output database uses SQLite `user_version` 5. [Plan 5](../../../plans/newspaper/implementation/05-live-integration.md) adds a live archive in MCP and a fixed-size checkpoint ID in the Civ V save.
