# Newspaper: grounding and later design questions

Supporting notes for [spec.md](spec.md). These separate observed repository facts from proposed product behavior. Paths below are relative to the repository root; no implementation is approved by this document.

## 1. VP technology grounding

The checked-in VP sources are the authority for this draft:

- `civ5-dll/(2) Vox Populi/Database Changes/Tech/TechTreeSweeps.sql` rebuilds prerequisites and groups tree positions by era and tier. It places Writing in Classical, Education in Medieval, Printing Press in Renaissance, Industrialization in Industrial, Radio in Modern, Computers in Atomic, and Telecommunications and Internet in Information. It contains no Mass Media node.
- `civ5-dll/(2) Vox Populi/Database Changes/Tech/TechChanges.sql` explicitly moves Writing to Classical, Railroad to Industrial, and Electricity to Modern. It enables corporations at Corporations, map trading at Navigation, and technology trading at Scientific Theory. It assigns additional trade-route capacity to several technologies, including Electricity and Telecommunications, and a tourism influence modifier to Internet.
- `civ5-dll/(2) Vox Populi/Database Changes/Tech/NewTechs.xml` adds Corporations in Modern.
- `civ5-dll/(2) Vox Populi/Database Changes/Text/en_US/Tech/TechTextChanges.sql` describes VP's technology changes, including Radio's Broadcast Tower. Final unlock checks should use the loaded game database and active game options rather than tooltip prose alone.

Useful prerequisite details: Radio requires Electricity and Corporations; Computers requires Refrigeration and Atomic Theory; Telecommunications requires Electronics and Computers; Internet requires Telecommunications and Satellites. Steam Power and Railroad precede Industrialization. The tree branches, so a civilization can reach a later medium without the earlier ones. Variant weights keyed to individual technologies handle this.

Internal identifiers include `TECH_PRINTING_PRESS`, `TECH_RADIO`, `TECH_COMPUTERS`, `TECH_TELECOM`, and `TECH_INTERNET`. VP uses internal era names `ERA_POSTMODERN` and `ERA_FUTURE` for Atomic and Information in relevant data. Player-facing text should use localized names.

## 2. Existing evidence and its limits

| Source | What exists | What the newspaper must still establish |
| --- | --- | --- |
| `mcp-server/src/knowledge/schema/timed.ts` and `schema/setup.ts` | Versioned player and city records, including yields, city population, local happiness, religion, trade-route details, deals, supply, and other measures. | Which histories are complete enough for each comparison, and which fields are permitted for the receiving civilization. |
| `mcp-server/src/tools/knowledge/get-cities.ts` | Basic and detailed city views, with detailed fields available at visibility level 2. | Historical reads need equivalent field filtering. Omitting `PlayerID` currently selects full detail, so newspaper access must always bind the civilization explicitly. |
| `mcp-server/src/tools/index.ts` | Tools for cities, players, events, diplomacy, victory progress, and database reference material. | A narrow newspaper data contract. The tool catalogue itself is not a guarantee of a safe historical query or sufficient evidence. |
| `mcp-server/src/knowledge/store.ts`, `manager.ts`, and `schema/base.ts` | A per-game SQLite store, timed knowledge, versioned knowledge, and per-player visibility fields. | A coherent reporting cutoff, freshness, and safe handling of game loads and branches for newspaper input. |
| `mcp-server/lua/game-identity.lua` | An existing `Modding.OpenSaveData()` use for game identity and a last-sync timestamp. | Whether this mechanism should own editions, how publication commits interact with saves, and how to identify alternate branches within the same game and turn. |
| `vox-agents/AGENTS.md` and `src/infra/agent-registry.ts` | Background agent patterns and registered agent families. | A newspaper worker that operates for human seats, including template-only sessions, independently of strategic decision-making. |

Player and city histories offer promising starting points for concentration and contrast stories. The city schema contains net happiness, not a full VP needs breakdown; it also has a Great Work count without a complete theming inventory. Important building lists are filtered and cannot prove the absence of every building. Infrastructure connections, detailed religion pressure, corporation reach, and Congress proposal details each need a separate data-availability check before promising their story families.

The current city tool obtains city information through its getter. A later design must distinguish collecting fresh game state from reading stored reporting snapshots, so a background edition does not accidentally mix turns or perform excessive live queries. Existing storage retains versions when values change, so an absent new version does not by itself mean an observation is missing or a value is zero.

Foreign reporting needs a field-level evidence contract. For example, `get-cities.ts` includes wonders, razing, and resistance in its basic view, while `timed.ts` groups them under detailed visibility. Resolve that difference when choosing the initial foreign triggers. The same schema also stores AI strategy records, private relationship values, and diplomatic transcripts; newspaper queries should select the permitted game observations explicitly.

## 3. Technical direction already requested

- Develop and evaluate against recordings first, meaning the per-game knowledge stores the MCP server already keeps. Advance the reporting cutoff through a recorded game and retain issues, series history, editorial choices, and player feedback between checks.
- Algorithms detect tagged triggers and match templates. Templates supply variants and authored combinations for merged items. Triggers, templates, and variants share one set of conditions (researched technology, adopted policy, civilization, era, and similar). A variant has conditions for eligibility and a weight made of a base value plus conditional adjustments.
- Every item has an importance value and one or more series keys. Items sharing a key form a series, whose importance grows with each item, fades with time, and adds to the selection weight of later items with that key.
- An LLM or heuristic editor selects items by weight and combines template angles into coherent items. The LLM can propose additional combinations and ad hoc templates.
- Both modes share publication history and support the complete editorial loop. Authored variants are the non-LLM writing path, and shared series keys let either mode continue the other's series.
- Item votes adjust series and tag weights. Topic controls come later.
- Foreign coverage may use what the civilization accesses directly, what trade routes bring from the partner (usually the destination city), and what spies or diplomats report at their strength. Section 2's visibility notes are input for that later design.
- After offline evaluation, connect the editorial loop to a background worker for live games and build the in-game reader. The game save owns the archive and editorial memory; MCP holds a queryable copy.

## 4. Questions for the implementation plan

Resolve these after the product spec and initial series examples are agreed. Begin with recording coverage and offline evaluation; live scheduling, game-save integration, and the in-game interface follow.

1. **Recording coverage:** identify suitable existing per-game knowledge stores, their civilization perspective, and observation coverage. Choose segments showing domestic and foreign developments over enough turns to evaluate series. Inventory required fields, numerical definitions, visibility, and game-option dependencies for the selected triggers.
2. **Offline replay:** expose only observations available by each reporting cutoff, distinguishing unchanged stored values from missing observations. Choose a readable output format, a simple vote-entry workflow, and resumable editorial history. Compare editors from the same starting point with separate output histories.
3. **Editorial state:** define how series keys are formed, how importance accumulates and fades, trigger identity, template combinations, repetition, and evidence summaries. Choose the shared condition vocabulary and the configuration format for conditions and variant weights. Record an item with several keys once, with links from each series history. Choose simple rules for how editable votes adjust series and tag weights.
4. **Editor contract:** define the evidence, series history, preferences, and candidate angles supplied to each editor. Include eligible triggers with no authored template. Specify how series decisions, generated angles, and merged items are recorded and checked; bound model work and provide heuristic fallback.
5. **Live integration:** choose a completed-turn boundary suitable for human play, publication commit timing, and handling of drafts that finish late. Prototype game-save persistence, including autosaves, and reconcile observations with loaded timelines. Verify recovery after loss of the MCP copy and exclusion of alternate histories at the same turn. A game ID plus turn alone is insufficient to distinguish branches.
6. **Reading experience:** begin with local issue and series browsing and feedback. Later decide unread indicators, seat handling, historical rendering, and navigation under VP + EUI. Choose an initial language policy for authored variants and generated prose, with localized names and explicit fallback behavior.

## 5. Later verification

First evaluate readable issue sequences from recorded games: series progression, fading and return, template combinations, short pieces, and the effect of feedback. Use the same recording segments to compare heuristic and LLM editors. Check that later observations never influence earlier editions and that resumed replays preserve editorial history.

Later automated checks should cover trigger comparisons, series continuity, merged items, variant selection, editable votes, tags, and editor fallback. Live MCP integration needs both supported transports. Save restoration, same-turn branching, background timing, and UI readability also need in-game checks.

This change creates planning documents only. It requires no build, game deployment, or production-code tests.
