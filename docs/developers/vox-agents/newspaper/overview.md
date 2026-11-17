# Newspaper

The newspaper turns recorded game evidence into authored heuristic issues, displays them in a browser, and exports the same publication layout for Civilization V. Offline replay stores issues, editorial decisions, series history, votes and preferences in a separate output database. A recorded 89-check run and browser checks verified reading, voting, and resume. The fixture demo's links, scrolling and general UI are accepted in game; generated coverage still needs human reading and broader game acceptance. LLM evaluation and live integration remain planned.

| Page | Status | Scope |
| --- | --- | --- |
| [Renderer](renderer.md) | Demo accepted in game; broader acceptance pending | Stored presentation snapshots, browser rendering, DDS export, and game viewer |
| [Replay](replay.md) | Recorded publication and browser workflow verified | Recording evidence, separate output storage, issue reading, votes, preferences, and resume |
| [Editorial](editorial.md) | Heuristic implementation; reading acceptance pending | Configured detection, authored stories, series, feedback, and stored presentation; later LLM editing |
| [Trigger overview](triggers/overview.md) | Implemented catalogue; recording tuning pending | Shared controls, evidence, repeat rules, and the workflow for adding coverage |
| [War and peace](triggers/war-and-peace.md) | Local inference; recording tuning pending | Declaration cascades, obligations, city-state involvement, score progress, and settlements |
| [Evaluation](evaluation.md) | Planned | Offline experiments comparing editorial approaches |
| [Live integration](live-integration.md) | Planned; save-capacity proof pending | Live scheduling, game-owned persistence, archive access, and player integration |

Trigger coverage is documented by category. Each page names its catalogue and template file and covers conditions, defaults, evidence caveats, placeholders, and repeat rules.

| Category | Page | Catalogue file |
| --- | --- | --- |
| Cities | [City triggers](triggers/cities.md) | `triggers/cities.json` |
| Domestic economy | [Domestic economy triggers](triggers/economy.md) | `triggers/economy.json` |
| Trade | [Trade triggers](triggers/trade.md) | `triggers/trade.json` |
| Diplomacy | [Diplomacy triggers](triggers/diplomacy.md) | `triggers/diplomacy.json` |
| Science | [Science triggers](triggers/science.md) | `triggers/science.json` |
| Culture and politics | [Culture and politics triggers](triggers/culture.md) | `triggers/culture.json` |
| Religion | [Religion triggers](triggers/religion.md) | `triggers/religion.json` |
| Recovery | [Recovery triggers](triggers/recovery.md) | `triggers/recovery.json` |
| War | [War triggers](triggers/war.md) | `triggers/war.json` |
| Peace | [Peace triggers](triggers/peace.md) | `triggers/peace.json` |

The [implementation roadmap](../../../plans/newspaper/implementation.md) describes the stages and their dependencies. Detailed requirements remain in each [implementation plan](../../../plans/newspaper/implementation/).

MCP owns the browser-safe evidence schemas and source references in `mcp-server/src/newspaper/evidence.ts`, archive scope/index/query schemas in `protocol.ts`, historical reads in `queries.ts`, and reportable-field policy in `projection.ts`. The `get-newspaper-evidence` tool calls the same query used by standalone replay, with no live refresh. MCP does not import Vox Agents.

War and peace coverage uses the already recorded `DeclareWar` and `MakePeace` events plus projected relationship snapshots. It adds no DLL events. The [war and peace guide](triggers/war-and-peace.md) explains how those observations become conflict accounts.

Vox Agents owns editing, replay orchestration, publications, and presentation under `vox-agents/src/newspaper/`:

| Location | Responsibility |
| --- | --- |
| `contracts/` | Issues, versioned presentation and offline publication state, archive responses, reader interaction, serialized render data, and replay settings/responses |
| `editorial/` | Configuration, evidence detection, authored writing, selection, series, feedback, presentation and validation |
| `replay/` | Read-only recording access through MCP's compiled queries, serialized sessions, routes, and atomic output commits |
| `renderer/` | Browser-safe assets, layout, stored presentation resolution, shared reader state, and bridge interfaces |
| `export/` | Browser capture, cache delivery, export queue, and host routes |

The normal VD server injects replay handlers before the newspaper fallbacks and drains replay and export work during shutdown. The JSON catalogue under `vox-agents/newspaper/` supplies runtime editorial settings and authored choices. Installation explicitly includes `defaults.json`, `pages.json`, and the `designs/`, `templates/`, and `triggers/` JSON files.

The plain DOM reader lives in `vox-agents/newspaper/src/reader/`. Its application shell in `src/app/` coordinates fixtures, replay controls, stored issues, votes, and evidence/source inspection. Evidence inspection also works without a generated issue. The export entry point remains `src/export-bridge.ts`. The game viewer and data helpers live in `civ5-mod/UI/Newspaper/`.

To render an issue, supply a completed `IssueDocument` with publication identity, ordered pages, canonical items, typed links, and its saved presentation. Configurable design identities select fixed Victorian or modern renderer families; reopening an issue uses the saved colors, fonts, ornaments and layout choices. The [renderer guide](renderer.md) describes the schema 2 input, separate render profile and reader state, and exported bundle.

Offline publication state uses schema 3, IssueDocument uses schema 2, and the replay output database uses SQLite `user_version` 2. These offline versions do not define the live game checkpoint format, which awaits the measured save-capacity proof in [Plan 5](../../../plans/newspaper/implementation/05-live-integration.md).
