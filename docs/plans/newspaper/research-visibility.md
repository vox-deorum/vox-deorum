# Newspaper research: visibility and foreign reporting

Part three of [the newspaper research](research.md), based on [the feature specification](spec.md). Repository paths below are relative to the repository root.

## Finding

The MCP store keeps a shared version of true game state plus per-player visibility. Its live tools then remove selected fields. That is a useful starting point, but it does not fully implement the newspaper's three reporting channels: direct access, trade routes, and spies or diplomats with increasing strength.

The spec deliberately allows the newspaper to teach the player something new. Its rules can grant more information than an existing screen. They still need to say which source grants which fields, where, and when. Existing visibility flags alone do not express that policy.

## What current access levels mean

`mcp-server/src/knowledge/schema/base.ts` defines `Player0` through `Player21`. Actual values are 0, 1, and 2. They are access levels, despite some comments describing them as booleans. Their meaning depends on the table:

| Situation | City snapshot | Player summary | Event |
| --- | --- | --- | --- |
| Owner or same team | Level 2 | Level 2 | Involved player/team normally receives level 2 through payload analysis. |
| Met foreign civilization | No automatic city access | Level 1 | Selected event types propagate at level 1. |
| City plot ever revealed | Level 1 | No effect | Selected tile events propagate at level 1. |
| Plot currently visible | Still uses the revealed-city branch | No effect | Plot-based event analysis can grant level 2. |
| Spy in a major civilization's city | Level 2 only for a non-diplomat with `EstablishedSurveillance` | No general level upgrade | No dedicated spy-source branch. |
| Diplomat in a foreign city | Excluded from the spy upgrade | Intended field gates use a separate diplomat-point map | No dedicated diplomat-source branch. |
| Trade route | No dedicated upgrade | Own route records are detailed fields | No dedicated trade-source branch. |

Sources: `mcp-server/lua/get-city-information.lua`, `get-player-summary.lua`, and `event-visibility.lua`. The city script also requires the viewing player to be alive. The matrix describes these collectors; it is not a complete description of every visibility mechanic in the game.

### Ever revealed is different from current sight

`getCityVisibility()` uses `plot:IsRevealed()` and then the collector reads the city's current population, religion, defense, health, and other values. It does not preserve the last city state seen before fog returned, or require `IsVisible()` for those basic values. The current `get-cities` tool therefore supplies fresh basic values for a previously revealed city.

That is existing MCP behavior. The newspaper design must decide whether it represents an ongoing public reporting channel or whether direct visual reporting stops updating after sight is lost. The latter cannot be reconstructed precisely from these city flags: they do not distinguish present sight from past reveal. An old level-1 record must not be described as proof of current sight.

## Field projection in the existing tools

### Cities

`mcp-server/src/tools/knowledge/get-cities.ts` calls the live collector, then applies the viewer's city flag:

| Level | Returned information |
| --- | --- |
| 0 | City omitted. |
| 1 | City ID, coordinates, population, majority religion, defense, health percentage, puppet/occupied/coastal flags, wonders, razing turns, and resistance turns. |
| 2 | Adds food and production stores/rates, current production and turns left, gold/science/culture/faith/tourism, local happiness, building count, filtered important buildings, and Great Work count. |

The type in `schema/timed.ts` places wonders, razing, and resistance with detailed fields, while the tool emits them at level 1. The tool's schema names `IsCapital`, but the projection does not copy it. Use the executed projection when describing today's output, and choose an explicit newspaper field list.

Omitting `PlayerID` assigns level 2 to every returned city. The generic store readers filter rows when given a player ID, but return full rows without field projection. A row passing `PlayerN > 0` is therefore insufficient evidence that every stored column is permitted.

### Player summaries

`get-players.ts` gives met major civilizations a broad national view: score, era, population, city count, territory, gold/rate, happiness, culture/tourism, technology count, military strength, relationships, and available resources survive its level-1 processing. Foreign cultural development can therefore use existing met-civilization summary fields without requiring access to every foreign city.

At level 1, the tool removes settlement targets, current research, next-policy timing, faith/science rates, route maps, spies, and military supply. Policy lists normally become branch counts. It intends to unlock policy detail at 200 diplomat points, military-unit counts at 500, and diplomatic-deal detail at 800. City-state output receives further reductions and quest filtering.

Two concrete mismatches affect reuse:

- `get-player-summary.lua` populates `DiplomatPoints` by checking `spy.CityOwner`. `CvLuaPlayer::lGetEspionageSpies()` exposes coordinates and diplomat flags, but no `CityOwner`. The checked-in producer and consumer therefore do not match. The sampled French recording has no non-null `DiplomatPoints` rows, consistent with this gap; the recording alone does not establish its cause.
- The tool tries to remove `; War Weariness: ...` from foreign relationship text, while the collector writes `; Our War Weariness: ...`. Copying the entire relationship string can retain detail the projection intended to remove.

These are research findings for later implementation scope. They were not fixed here. They also show why deriving triggers from a selected factual subset is clearer than passing entire current tool reports to an editor.

`getPlayerVisibility()` in `src/utils/knowledge/visibility.ts` returns full visibility when the perspective is omitted **or the target summary is missing**. The newspaper should treat a missing historical permission record as unknown, with any independently established public facts handled explicitly.

### Events, victory data, and opinions

`event-visibility.lua` grants involved teams access, propagates selected public developments to met teams, and uses current plot sight or a revealed-tile whitelist for local developments. The met whitelist includes war, peace, religion, ideology, and deals. The revealed-tile whitelist includes city creation, religion conversion, puppeting, razing, capture, and nuclear detonation. These are source-specific rules, rather than one universal definition of visibility.

`get-events.ts` filters event rows at level 1, but does not provide a separate field projection for levels 1 and 2. All accepted viewers receive the shared payload after general cleanup. It strips `DealMade.TradedItems`, while formatted `FromGives` and `ToGives` terms can remain. A basic event flag cannot be treated as blanket permission for every nested payload field.

`VictoryProgress` is stored as one global row. Its `PlayerN` columns default to zero because the getter supplies no flags; the tool instead filters civilization names using player summaries. A blanket `PlayerN > 0` filter would discard this table entirely. Conversely, accepting its whole object would include unmet civilizations and nested details. The current name filter does not comprehensively handle references such as `Contender`, captured-capital names, or proposal proposers. Unknown names are kept. The newspaper needs a deliberate projection of these objects using contact at the cutoff.

Opinions and diplomatic messages also need a content decision. Own AI evaluations, hidden relationship adjustments, steering rationale, and private transcripts should not become background facts by virtue of being stored. Public agreements or statements can enter through an explicitly allowed source.

## Trade reporting: what can be built from current evidence?

The receiving civilization's own summary contains outgoing and incoming routes, including city/civilization labels and yields. `GetTradeRoutes()` supplies its originating routes; `GetTradeRoutesToYou()` supplies foreign routes ending in its cities. This establishes commercial relationships even when the city collector grants no additional access.

The spec says trade brings news, usually from the destination city. A destination-city reporting rule would be **new newspaper behavior**. A sensible first experiment could let an active own outgoing route supply a defined subset of civilian facts from its foreign destination, such as population, majority religion, and selected economic or cultural measures. The product still needs to choose those fields and whether incoming routes also provide reports from their foreign origins.

Important boundaries:

- A route to one city does not establish access to every city in the partner civilization or its national private records.
- Domestic routes support domestic stories without creating foreign permissions.
- The reader's routes do not expose trade between two other civilizations.
- A route recorded at turn 250 does not justify reporting destination changes from turn 200 unless access then is independently supported.
- Ending a route can stop new reports while leaving dated prior intelligence in the archive.

The current snapshot keys are formatted names, with no structured route ID or endpoint IDs. A selected recording can support a carefully checked simulation by matching its own route labels to stored cities at each cutoff. Label that as a simulated newspaper trade policy, because current city flags do not record that grant. New collection should retain endpoint IDs, coordinates, reporting period, and access source.

## Spies, diplomats, and strength

The engine binding `CvLuaPlayer::lGetEspionageSpies()` exposes agent ID, coordinates, rank key, state, stored/max network points, network generation, diplomat status, `EstablishedSurveillance`, and `RevealCityScreen` when a city exists. The summary keeps only role, a location string, state, network, and network per turn. Localized rank and agent ID survive inside the dictionary key, rather than as structured fields.

There is also a semantic trap. In `CvEspionageClasses.cpp`, `HasEstablishedSurveillance()` checks specific states. Under VP, being in `GATHERING_INTEL` or `SCHMOOZE` alone does not satisfy it. `CvCityEspionage::GetRevealCityScreen()` is a separate permission, and the city collector does not use it. A report must not assume that every spy already gathering intelligence gets the collector's level-2 city flag.

The spec's increasing-strength rule needs its own field tiers. Rank, accumulated network, current mission, and city-screen permission are different inputs. Decide which controls access, rather than treating rank and network as interchangeable. The existing 200/500/800 diplomat gates concern national fields; they are not an implemented graded city-news system.

A live collector can preserve these structured facts from existing bindings, derive the destination owner through the city at the spy's coordinates, and record the granted fields with a date. For older recordings, the condensed summary can support experimental rules based on the role/location/network that actually remain. It cannot reliably recover discarded city-screen permission or exact surveillance state. Do not invent those fields when evaluating replay.

## Historical evidence contract

Historical visibility must be evaluated before trigger generation, template matching, merging, and LLM input. Restricting the final prose cannot undo an editorial choice influenced by future or private facts.

A proposed observation contract should preserve:

| Property | Purpose |
| --- | --- |
| Campaign, timeline/checkpoint, and receiving civilization | Keep branches and seat perspectives separate. |
| Subject IDs, with display labels | Follow places and civilizations despite renaming; link city objects across capture. |
| Field, value, and units/definition | Make comparisons compatible and interpretations checkable. |
| Observed turn and known-by turn where they differ | Date the underlying state and when the receiver obtained it. Existing recordings do not always distinguish them. |
| Access source and granted field set | Explain direct sight, public/met knowledge, trade reports, or espionage. Existing 0/1/2 flags do not retain all these reasons. |
| Source row/event reference | Trace a published fact back to the recording. |

For example, if a spy reported city output on turn 220 and departed on turn 221, a turn-225 issue can cite the turn-220 report. It must not update that output from a turn-225 true-state row merely because the old spy report was detailed. The last permitted observation may differ by field. Gaining a source later also does not automatically grant the reader an earlier detailed history.

For events, bound the event turn/ID and evaluate nested fields using the receiver's knowledge then. `get-events` accepts an exact `Turn` or event-ID bounds `After` and `Before`; it has no implicit replay cutoff. Its resource postprocessing reads the latest stored summary, with a possible live fallback. An offline historical query must supply historical resource knowledge explicitly to avoid using later discoveries.

For snapshots, select only rows at or before the cutoff from a reconciled timeline, then apply field-specific permissions and freshness. Never join old city values to today's contacts, routes, spies, or public identities and treat the result as historical knowledge. Static `PlayerInformations` can resolve identity internally, but must not reveal an unmet civilization's name in output.

Reader perspectives currently cover major slots 0 through 21. City-states and barbarians can be subjects; observers use separate UI seat handling rather than a `PlayerN` permission column. [The UI research](research-ui.md) covers that distinction.

## What remains to decide and verify

The initial policy needs four concrete decisions: which basic facts remain publicly current after a city is revealed; what each trade direction reports; how spy/diplomat strength grants fields; and which event or diplomatic details are publishable. These decisions belong in the technical design before trigger thresholds are tuned.

Verification should exercise an unmet neighbor becoming met, sight being lost, a route starting and ending, a spy travelling/establishing/leaving, diplomat strength changes, city capture, and an old save being loaded. At each cutoff, inspect the factual input as well as the article. Existing recordings can test supported transitions and proposed rules where source evidence survives; missing historical sight or espionage permissions require new collection or a clearly labelled simulation.
