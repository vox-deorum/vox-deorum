# Newspaper research: MCP stored data and recorded games

Part two of [the newspaper research](research.md), based on [the feature specification](spec.md). Repository paths below are relative to the repository root. Local measurements were taken through read-only SQLite connections on 13 November 2026.

## Findings from actual recordings

The local `mcp-server/data/` directory contains **58 `.db` files**. All opened successfully for read-only inspection. Several contain hundreds of turns of city and player history, together with trade, espionage, cultural, and diplomatic records. These are enough to begin the spec's offline evaluation.

Three candidates with long coverage:

| Database filename | Player-summary rows / turns | City rows / turns | Events | Victory rows |
| --- | --- | --- | --- | --- |
| `05af8e1f-0a9b-478c-8f44-71e59656c406.db` | 17,708 / 0 to 499 | 35,538 / 0 to 499 | 644,608 | 451 |
| `8e058d22-8894-47a5-88e1-3fbf7a6c28a2.db` | 16,910 / 0 to 494 | 35,605 / 0 to 494 | 645,903 | 406 |
| `f07b2f21-2d81-4eee-a3f5-d6d850081a25.db` | 22,592 / 0 to 478 | 37,098 / 0 to 478 | 601,645 | 734 |

Each has city and summary records on every turn in its listed range, considered across all entities. This does **not** mean every entity was observed each turn. All three record VP 5.2.7 and DLL build `build-5.2.7-20261024-212847-4f968dd` in metadata. Their historical collectors may differ from the current source, so inspect each recording's schema and values rather than assuming today's interface.

### A concrete replay candidate

In `f07b2f21-2d81-4eee-a3f5-d6d850081a25.db`, player 0 is France. Turns 200 to 300 provide domestic growth, changing trade concentration, known foreign cultural growth, and visible captures. Selecting the last stored French summary at each cutoff gives:

| Cutoff turn | French population | Positive outgoing-route gold from Morocco | Total positive outgoing-route gold | Morocco's share |
| --- | --- | --- | --- | --- |
| 200 | 75 | 0 | 53.03 | 0% |
| 225 | 87 | 62.89 | 89.23 | 70.5% |
| 250 | 85 | 141.20 | 169.24 | 83.4% |
| 275 | 91 | 72.39 | 146.88 | 49.3% |
| 300 | 103 | 51.43 | 109.91 | 46.8% |

The denominator sums positive `FromGold` values in France's outgoing route map. At all five selected cutoffs, every route with positive `FromGold` has a foreign destination, so domestic routes contribute zero to this table. The general calculation should explicitly filter for foreign destinations. This measures the distribution of route gold, without establishing a share of total national income or explaining why a route changed. It uses the final stored summary within each numbered turn, which is a replay convention rather than proof of a shared completed-turn snapshot.

The same game has Zulu summaries visible to France at level 1 across these cutoffs. The final stored Zulu culture rate rises from 174 at turn 200 to 707 at turn 300, and tourism from 98.25 to 345.75. These support an independent foreign-development series. A France-visible capture event at turn 221 records Innsbruck changing from Austria to Songhai. It could seed a recovery series after city identity and lifecycle are reconciled.

Start by checking every five turns through 200 to 300, with an earlier segment around 125 to 175 for first series and short pieces. Retain the full preceding history for valid comparisons. These are promising evaluation segments, not a claim that all editorial scenarios or causation are already demonstrated.

## What is persisted

`mcp-server/src/knowledge/schema/base.ts`, `timed.ts`, `public.ts`, `table-utils.ts`, and `setup.ts` define the store. `KnowledgeManager.loadKnowledge()` opens one SQLite file per game ID. `KnowledgeStore.initialize()` enables WAL and creates missing tables. There is no schema-migration system; `CREATE TABLE IF NOT EXISTS` does not add new columns to an old table.

| Tables | Content and newspaper use |
| --- | --- |
| `GameMetadata` | Game ID, last event/save markers, VP/build versions, seeds, and game settings when collected. Useful for provenance and game-speed scaling. It is a current key/value map with no historical versions. |
| `PlayerInformations` | Player key, civilization, leader, team, human/major flags. Public identity lookup, with no observation turn. A public storage classification does not mean every civilization is known to the reader. |
| `PlayerSummaries` | Population, cities, territory, gold/rate, happiness, yield rates, era, technology count, policy branches, religions, military figures, resources, relationships, routes, spies, deals, quests, and diplomat points. Main source for national comparisons and the reader's own relationships. |
| `CityInformations` | City key, owner display name, city name, coordinates, population, religion, defense/health/status, stores and yields, local happiness, buildings, wonders, Great Work count, and current production. Main source for domestic contrasts and permitted local foreign reports. |
| `GameEvents` | Event ID, turn, type, payload, creation time, and per-player visibility. Useful for founding, capture, razing, religion, war/peace, trade completion, policies, technologies, and other milestones. |
| `VictoryProgress` | Global versioned row with domination, science, culture, and diplomacy objects. Includes culture influence text, Congress delegates, proposals, active resolutions, and their descriptions. Coverage depends on calls to its getter. |
| `PlayerOptions` | Timed available strategies, possible technologies/policies, and forced next choices. These are available choices, not an inventory of completed research or adopted policies. |
| `PlayerOpinions` | Versioned viewpoint-specific opinion text. Requires a separate decision about which material belongs in a publication. |
| `StrategyChanges`, `PersonaChanges`, `FlavorChanges`, `PolicyChanges`, `ResearchChanges`, `RelationshipChanges`, `TacticalZones` | AI analysis and steering records. `PolicyChanges` and `ResearchChanges` record steering decisions rather than gameplay completion. Keep them outside ordinary factual newspaper input. |
| `DiplomaticMessages` | Durable conversation and deal messages, with participant and role metadata. Publication rights need an explicit policy. |
| `RenderEvents` | UI/render-time telemetry with millisecond timestamps, turn, event name, and payload. It has no per-reader visibility columns and is not a general news source. |

Timed rows carry `ID`, `Turn`, `Payload`, `CreatedAt`, and `Player0` through `Player21`. Mutable rows add `Key`, `Version`, `IsLatest`, and a `Changes` array. `PlayerInformations` uses public rows. `RenderEvents` has its own schema.

## Collection cadence and the meaning of history

`KnowledgeStore.handleGameEvent()` stores accepted events and advances `lastID`. Its `PlayerDoneTurn` handling refreshes all player summaries and cities when the barbarian slot, player 63, finishes. For major player IDs below 22, it refreshes that player's opinions, strategy, and persona. These are separate refresh paths.

Queries can add more observations. `get-players`, `get-cities`, `get-victory-progress`, and `get-options` call live Lua getters and usually persist their results. Victory progress and options have no equivalent unconditional round-end refresh in that handler. A recording made without those tool calls can have empty or sparse tables. Human-only live use must establish collection without relying on a strategist to call them.

`storeMutableKnowledgeBatch()` inserts a version only when `detectChanges()` finds changed fields. Visibility columns are compared too. Consequently:

- No new version can mean an unchanged value, an unobserved entity, a failed collection, or an entity that no longer exists.
- `Turn` dates the stored changed version. It does not independently record the last successful observation of every unchanged field.
- More than one version can occur in a turn. The sampled French game contains several Zulu summary versions within turn 200.
- Batches are transactional per table. The concurrent player and city refreshes do not create a common atomic snapshot across tables.

The current collectors read true game state and attach visibility flags. Visibility projection happens later, in tools. Stored data must pass the newspaper's field policy before it reaches a trigger or an editor. [The visibility research](research-visibility.md) details this boundary.

## Replay cutoff, missing entities, and timelines

The current API is insufficient for a historical reader by itself. `getMutableKnowledge()` selects `IsLatest = 1`; `getMutableKnowledgeHistory()` returns all versions in descending version order. Neither accepts an as-of cutoff. The live city/player tools collect again, and their formatted output removes storage metadata. `get-events` has turn and event-ID filters, but can also consult a current summary for resource redaction.

For an offline replay, read a stable recording without invoking live getters. Within a verified single timeline, a useful end-of-numbered-turn convention is to choose the newest row with `Turn <= cutoff`, ordering ties by the table's insertion ID. Apply historical visibility and field projection before deriving comparisons. This convention still needs an explicit rule for snapshots captured during a turn and for cross-table comparisons.

Do not use `IsLatest` to reconstruct an earlier turn. Do not compare insertion IDs between tables: their sequences are independent. Game event IDs have their own turn/sequence encoding. `CreatedAt` uses wall-clock seconds, while render time and metadata timestamps use milliseconds; they do not supply a common gameplay boundary.

### City identity and disappearance

The collector stores `city:GetID()` as `Key`. In this VP tree, `TContainer.h` allocates global IDs through `GetNextGlobalID()`, so treating these as universally player-local IDs would be incorrect. However, `CvPlayer::acquireCity()` deletes the old city object and calls `initCity()` to create a replacement at the same coordinates. **A capture can change the city key.**

For a series following a place, link the old and new objects using capture evidence and coordinates. Coordinates alone also need a founding episode to distinguish a rebuilt settlement after razing. City names can change and must remain display labels.

The collector stops returning razed cities and cities of dead players, but the store does not add tombstones or clear their latest rows. In `05af8e1f-0a9b-478c-8f44-71e59656c406.db`, where player 0 is Rome, `CityInformations` has 173 rows marked latest while latest player summaries total 104 cities. These counts come from different surviving histories, so they are not a synchronized discrepancy measurement; they demonstrate why latest city rows cannot be assumed to represent the current roster. Historical membership requires founding, capture, and removal evidence or recorded collection membership.

City rows also lack a numeric owner ID. Majors use civilization display names; all city-states share `Owner = "City-States"`. Exact city-state identity requires other evidence. New collection should retain stable player IDs alongside display names.

### Save rewinds and branches

`mcp-server/lua/game-identity.lua` persists a UUID and last-sync timestamp through `Modding.OpenSaveData()`. This identifies a campaign. It does not distinguish two branches loaded from the same save.

On resync, `dropEventsAfterId()` deletes `GameEvents` with IDs **greater than or equal to** the first resumed event ID. That cleanup does not rewind mutable histories, options, transcripts, or every other table. The manager's normal turn update only advances its turn value. A database must therefore be checked for rewind and branch contamination before using it as a recording. The sampled French summaries had no backwards turn step in insertion order, but that check cannot prove the absence of same-turn branches.

The offline publication should keep its issue, series, vote, preference, and editorial-decision history with the replay output, including each issue's chosen design, layout variants, and page order. The live design later needs a save-restored publication checkpoint and reconciliation of MCP's copy with that loaded timeline. See [UI persistence primitives](research-ui.md).

## Field quality and useful story limits

| Subject | Usable evidence | Limit or normalization needed |
| --- | --- | --- |
| National and local happiness | `HappinessPercentage` from `GetExcessHappiness()`; city `HappinessDelta` from `getHappinessDelta()`. | Different measures. There is no persisted city needs breakdown to explain poverty, distress, illiteracy, or boredom. Check the active happiness option. |
| City production and yields | City rate fields and current production. | Food is net `FoodDifference()`; production uses `GetCurrentProductionDifference(false, false)`. Tourism is `GetBaseTourism()/100`. Do not treat these as interchangeable with national net income or effective tourism influence. |
| Trade dependency | The reader's outgoing/incoming route maps have yields, domain, and remaining turns. | Endpoints are formatted names, with no route or city IDs in the snapshot. Non-positive yields become `-1`; normalize this sentinel before sums. `Available` is the current capacity key, despite the schema comment saying `Not assigned`. |
| Religious change | City majority religion and national majority/founded religion, plus conversion events. | No follower distribution or pressure history in city rows. Majority changes support reports; causes need more evidence. |
| Buildings and cultural centers | Per-city yields, `Wonders`, `GreatWorkCount`, `BuildingCount`. | `ImportantBuildings` is filtered by technology and prerequisite chains in `getters/city-information.ts`. An absent entry does not prove a building is absent. No complete Great Work/theming inventory. |
| Congress | `VictoryProgress.DiplomaticVictory` includes proposals, proposer names, descriptions, active resolutions, enactment turns, delegates, and votes needed. | It is already richer than a delegate count. Collection frequency, display-name keys, and perspective filtering need checking. Presence does not prove a proposal's eventual result or a player's intent. |
| Spies and diplomats | Own spy map records role, location, state, network, and network per turn. | Rank and agent ID are embedded in a localized dictionary key. Structured rank, coordinates, surveillance, and city-screen permission are discarded. Diplomat-point collection also has a binding mismatch, described in the visibility research. |
| Infrastructure and corporations | Some events and filtered buildings can suggest developments. | No complete time series of connections, capacity, corporation franchises, or local resource access. Do not promise these families from the core tables alone. |

The current major-player gold collector calls `CalculateGoldRate()`, while the schema comment describes `CalculateGoldRateTimes100()/100`. Use the collector and recording values to establish precision. Store source definitions with a trigger's evidence so editorial text does not silently compare incompatible metrics.

Trade-completion events retain endpoint IDs but do not contain the snapshot's route income. Route keys can collide or become ambiguous after renaming or when civilizations share display names. Historical parsing can support the selected English recordings after checking names; a new collector should preserve structured endpoints and route identity.

## Conditions and technology grounding

The shared conditions in the spec need the receiving civilization's state at the cutoff. `PlayerSummaries.Technologies` is a count, `CurrentResearch` is formatted text, and `PlayerOptions.Technologies` lists choices. None is a complete researched-technology set. Reconstruct unlocks from a complete sequence of `TeamTechResearched`/`TeamSetHasTech` events or record an initial researched set and subsequent changes. Late starts and recordings that begin midgame need that baseline. Policy branch lists help, but they use localized names and the relevant perspective must permit them.

The original spec's technology grounding remains valid in the checked-in VP sources:

| Milestone | VP era / identifier |
| --- | --- |
| Writing | Classical, `TECH_WRITING` |
| Education | Medieval, `TECH_EDUCATION` |
| Printing Press | Renaissance, `TECH_PRINTING_PRESS` |
| Industrialization | Industrial, `TECH_INDUSTRIALIZATION` |
| Radio | Modern, `TECH_RADIO` |
| Computers | Atomic, `TECH_COMPUTERS` |
| Telecommunications | Information, `TECH_TELECOM` |
| Internet | Information, `TECH_INTERNET` |

`civ5-dll/(2) Vox Populi/Database Changes/Tech/TechTreeSweeps.sql` rebuilds prerequisites and era/tier layout. `TechChanges.sql` explicitly moves Writing to Classical, Railroad to Industrial, and Electricity to Modern. `NewTechs.xml` adds Corporations in Modern. The tree has no Mass Media node; the proposed media stage uses Radio. Internal era names include `ERA_POSTMODERN` and `ERA_FUTURE` for Atomic and Information.

Radio requires Electricity and Corporations; Computers requires Refrigeration and Atomic Theory; Telecommunications requires Electronics and Computers; Internet requires Telecommunications and Satellites. Steam Power and Railroad precede Industrialization. Branching allows a later medium without all earlier milestones, supporting the spec's independent technology weights.

`TechChanges.sql` also assigns corporations to Corporations, map trading to Navigation, technology trading to Scientific Theory, route capacity to several technologies, and a tourism influence modifier to Internet. The loaded database and active game options remain the authority for live conditions. This research does not establish a complete historical game-option snapshot in every recording.

## Readiness for the first offline evaluation

Domestic contrasts, own trade concentration, known foreign culture/tourism trends, visible religious changes, and selected diplomatic developments have enough backing to investigate now. Detailed needs, graded espionage reports, complete infrastructure explanations, and reliable cross-capture city series need additional collection or reconciliation.

Before generating a sequence, verify the selected perspective, table/field coverage, historical contact, city lifecycle, compatible measures, and timeline. Record the chosen within-turn convention and retain source row/event references with every trigger. Compare heuristic and LLM editions from the same permitted evidence and separate publication histories. A local reader should let us inspect issues, change or clear votes, and resume with the saved history and preferences.

The candidate segments establish useful observations. The following editorial demonstrations still need to be selected or exercised:

| Demonstration | Candidate and remaining work |
| --- | --- |
| Series starts, continues, fades, and returns | France's changing trade concentration is a candidate for a continuing series. Find a quiet interval followed by a meaningful new development under the same series key. The five sampled cutoffs do not establish a fade-and-return sequence. |
| Merged-template installment | Look for an observed diplomatic change involving a trade partner during a relevant trade-concentration period. Verify compatible subjects and dates, then identify the supporting records and an authored composite variant for the heuristic editor. No particular pairing has been verified yet. |
| Continuity across editor modes | Within one replay history, switch from LLM to heuristic editing and back. Check that an authored template can continue an LLM-originated series through the same key and that existing articles and votes survive. |
| LLM disabled or generation fails | Replay the same segment with LLM use disabled and with a controlled generation failure. Check that LLM-only templates are skipped when unavailable, unfinished items are omitted, and available scripted content still produces a useful issue. This requires an editor prototype. |

Record the selected cutoffs and evidence for each demonstration, and label any synthetic scenario separately from recorded-game results. Assess short-piece variety and useful hints alongside continuity; a successful data query alone does not establish the reading experience.
