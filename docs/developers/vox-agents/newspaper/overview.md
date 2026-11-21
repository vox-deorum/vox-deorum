# Newspaper

The newspaper turns a Civilization V recording into a publication for one player. For example, a city that shrank after training settlers can get a story about their departure if it still has food to spare. The editor uses evidence visible to the receiving player. Replay saves each issue, its audit, and reader votes in a separate database.

With [workspace dependencies](../../setup.md) installed, run from the repository root: `npm run newspaper:preview -w vox-agents`. Open **Mockups** to browse designs or **Recorded** to open an MCP recording. The [replay guide](replay.md) also covers the command line, evidence inspection, and resuming a run.

| To work on | Start here |
| --- | --- |
| What makes news | [Trigger rules](triggers/overview.md), [facts](triggers/facts.md), [constants and shortcuts](triggers/constants.md), and [worked examples](triggers/examples.md) |
| Diplomatic coverage | [War and peace](triggers/war-and-peace.md) explains how events and relationships become incidents and pair history. |
| Which stories print | [Editorial decisions](editorial.md) covers templates, style, selection, continuity, and votes. |
| How a story reads | [Writing rules](writing.md) gives examples for authors of templates. |
| How an issue looks | [Designs](designs.md) covers the stock catalogue and adding a visual treatment. |
| How an issue reaches the reader | [Renderer](renderer.md) covers issue input, browser rendering, DDS export, and the in-game sample. |

MCP owns the historical queries, evidence schemas, and visibility policy in `mcp-server/src/newspaper/`. Replay calls the same dated query as the `get-newspaper-evidence` MCP tool. The query reads recorded data for one player without refreshing it from the game.

Vox Agents owns replay, editing, and presentation in `vox-agents/src/newspaper/`. QuickJS evaluates expressions from the JSON catalogue in `vox-agents/newspaper/` against the permitted facts. A saved issue keeps its prose, links, and presentation, so reopening it preserves how it was published. The browser reader and game export use the same layout code; the game viewer is in `civ5-mod/UI/Newspaper/`.

The [evaluation guide](evaluation.md) describes how to review authored stories and the planned comparison with model editing. [Live integration](live-integration.md) will add automatic publication during play. See the [roadmap](../../../plans/newspaper/implementation.md) for the plan.
