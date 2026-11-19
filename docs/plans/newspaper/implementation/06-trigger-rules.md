# Plan 6: trigger rules

**Status: open.** The rule engine, 14 stock rules and 15 authored templates are in place, and the owner accepted their mechanics. The [event facts and reporting rules](../../../developers/vox-agents/newspaper/triggers/facts.md#event) include named great people and world news. Stages 5 through 7 are implemented. Stage 4 starts with passive espionage and agent presence.

[Plan 4](04-triggers-templates-and-styles.md) owns trigger tuning, template writing and language styles, and decides which of the new capabilities become stock stories. [Plan 7](07-llm-editors.md) uses that baseline for LLM editing and comparison.

## Goal and success criteria

The remaining stages let a catalogue author report what a spy sees in a city, distinguish an absent diplomat from an unobserved one, report the theft of a technology, analyze the receiver's fronts, describe complete military rosters where access allows, and name a ship and its launch port.

Each remaining stage adds a group of capabilities and verifies it with [catalogue probes](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior).

The strategist's tools (`get-cities`, `get-players`, `get-events`, `get-military-report`) keep their current outputs.

## What is missing today

| Wanted | Gap |
| --- | --- |
| Passive espionage and presence | Newspaper projection still needs to interpret the recorded spy rosters and city observations. |
| Espionage stories | The recorder stores the queued outcome as `EspionageResult` and records elections. The operation row precedes the reward and does not show what the defender was eventually told. |
| Tactical zones | [Human player recording](../../human-player-recording.md) adds shared, seat-private tactical assessments. Stage 4c reads those records. |
| National military rosters | The existing sight-based counts cannot establish a nation's full force, individual names, or who could see a full foreign roster. |
| Named launches | `CityTrained` identifies a player, city and unit; the newspaper can sometimes get the type from `UnitCreated`. The recorder's generic unit and city lookups can resolve IDs against the wrong owner. |

## Stages

Extend the existing [probe overlay and tests](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) with each stage. The examples below are acceptance probes. Test the evidence and the claims it supports so catalogue authors can change the wording. Each stage updates the affected documentation.

### Stage 4a: passive espionage and agent presence

**Implemented.** Live issues and replay derive these facts from the same spy rosters, player identities and city observations. `PlayerSummaries.Spies` already stores each agent's role, location (`City (Civilization)` when assigned), localized state and current network points. The [trigger facts](../../../developers/vox-agents/newspaper/triggers/facts.md#covert-presence-and-roster-points) explain the approximation.

Examples:

- A profile of Copenhagen can cite boredom from a turn when our stationed spy had at least 500 points there, while the spy still meets that threshold. Below it, the profile uses basic city facts.
- The capital desk reports that Denmark has a diplomat here while we have none there, when both rosters establish those facts. The desk stays silent about an unobserved visit.
- A political briefing covers one branch Denmark already holds, from the newest readable tier including ideology, when our active diplomat has at least 200 recorded network points there. A report of a particular adoption still needs a readable event.

Implementation:

- **Presence.** Match locations to a unique recorded city and owner. Use known state labels to identify stationed spies and diplomats. In Vox Populi, a nonnegative recorded balance also identifies a spy gathering intelligence or a diplomat schmoozing, even if the state label is unfamiliar. Check the receiver's roster for `city.ourSpyPresent` and `player.ourDiplomatThere`, and check a known foreign major's roster only for `player.theirDiplomatHere` at the receiver's capital. An empty roster or a clear miss establishes absence. Leave missing or ambiguous evidence unknown.
- **City detail.** Keep owner and teammate access. For other Vox Populi major cities, use a matching stationed spy with at least 500 current points as the city-screen proxy. Full detail needs a readable city row and a qualifying match on both the observation turn and the cutoff turn. Use basic detail when the match fails, for example after a recall or when the balance falls below 500. Leave city history and event visibility rules in place.
- **Policy and deal detail.** Use the receiver's outgoing diplomat's current points in the newspaper's existing gates (200 for policies, 800 for deal terms). Use the cutoff roster for the current view, even if the foreign summary is older. For events, use the latest roster from an earlier turn so a later arrival cannot open an earlier event. Keep the existing contact, event visibility and deal-party rules.
- **Evidence and probes.** These stock thresholds approximate access. Spending points can hide a bonus the game still grants. Cite the supporting rows and expose only the derived facts and permitted details. Test travel, arrival, recall, threshold crossings, an inbound visit that grants no insight, older events, and missing or ambiguous evidence. Verify bystanders receive no covert facts and strategist reports stay unchanged. Document the approximation in [facts](../../../developers/vox-agents/newspaper/triggers/facts.md), [replay](../../../developers/vox-agents/newspaper/replay.md) and [knowledge](../../../../mcp-server/docs/knowledge.md) when implemented.

### Stage 4b: espionage operations

In Vox Populi, use existing operations for the spy's fate and report rewards and defender notifications where they happen. A spy can be killed and the theft can still go through. The newspaper cites each fact directly; the notification queue stays unchanged.

Examples:

- Our paper reports that we stole Navigation and separately reports that our spy was killed, citing the confirmed reward and the outcome. It can publish both without guessing that two same-turn reports describe the same spy mission.
- The defender's paper reports a theft with the details given in the alert. If the source was withheld, the paper leaves the thief unnamed.
- An election dispatch names the city-state and reports how much influence our spy gained on success or we lost after our spy's failed attempt. A loss of influence without an assigned spy does not qualify.

Implementation:

- **Existing events.** Project the stored `EspionageResult` from `EspionageNotificationData` to the source alone; require `SourcePlayerID` so it cannot be confused with the separate blocked hook. Match the recorded enum text and report the spy's fate without exposing what the defender learned. Correct the queue hook to declare its existing seven integer arguments. Old queue rows can supply the attacker's outcome only. Project election success to its `PlayerID`, and failure only to its `PlayerID` when `SpyID >= 0`. Use `Value` for the gain and `-DiminishAmount / 100` for the loss. Normalize both coordinate pairs to the capital plot in newspaper evidence and keep the existing event schemas.
- **Private reports.** Add `EspionageReport.ts` to the MCP event schemas and register its DLL hook in `CustomMods.h` under `MOD_EVENTS_ESPIONAGE`. Regenerate the event index and connection schemas and copy the native schemas into the DLL. For the attacker, emit one fact per confirmed tech grant in `DoStealTechnology` or positive gold transfer in `CvCity::DoEventChoice`. For the defender, emit at actual notification delivery in `ProcessSpyMessages`, including from saves. Identify whether the report is for the attacker or defender, include only that recipient's outcome and rewards, and use `-1` for a withheld source ID. Use `RecipientID` rather than `PlayerID` to keep it off the strategist feed. Return from the recipient case in `event-visibility.lua` before generic team and plot visibility. Require the exact recipient in newspaper projection and exclude the event from both formats in `get-events.ts`. Mark DLL edits with `// Vox Deorum:` and run `build-and-copy.bat`.
- **Facts and probes.** Expose `event.spyResult`, `event.tech`, `event.amount`, `event.thief` when known, and `event.victim` as applicable. For elections, expose success or failure, signed influence change including zero, and the city-state label from the recorded capital plot when resolved. `probe-tech-stolen` uses only facts that actually name the tech; `probe-spy-lost` uses only the attacker's outcome; `probe-rigged-election` uses the existing election rows. Test a known and unknown thief, a killed spy whose theft still goes through, several techs in one mission, and two operations in one city and turn. The defender gets only what the game displays, including the last tech on a notice updated more than once. Test delivery from a save, suppression after conquest, a plot witness and teammate, and an election alert without a spy.
- **Docs.** `triggers/facts.md`, `mcp-server/docs/knowledge.md` and the espionage pages under `mcp-server/docs/events/`.

### Stage 4c: military reporting and named launches

Examples:

- The war desk lists two Pikemen and one Crossbowman in our tactical zone near Antwerp and reports a Withdraw assessment. The assessment describes conditions at the observation; it does not mean the units retreated.
- A fleet review counts our ships under Sea, shows Sea Beggars by type and includes them under the Corvette class. It lists any individually named ships and counts aircraft aboard carriers under Air. The national count includes units outside the tactical zones.
- A foreign dispatch counts Denmark's full fleet after the military roster grant. A master can also report its vassal's fleet. Neither grant opens the foreign tactical map or proves where a unit is stationed.
- The ports column reports “A new Carrier launched at Rotterdam.” It can also name a ship that is christened at creation, for example “The Great Galleass la nave Armera launched at Venice.” A later player rename can appear in a fleet roster. A purchase can be reported as a purchase.

Implementation:

- **Access at capture.** Give the receiver its own national roster and the rosters of known living major civilizations with a qualifying grant. A diplomat must be schmoozing at the target's current capital. Match the `RevealMilitaryUnitCount` unlock in `EspionageOverview.lua`: compare `MaxNetworkPointsStored` against the lowest configured threshold, scaled by game speed where requested (stock 500). Two additional newspaper grants are proposed: a non-diplomat spy stationed in a city the target still owns, with `RevealCityScreen` checked at capture; and the receiver's team being the target team's direct master (`Teams[targetTeam]:IsVassal(receiverTeam)`). Stock Vox Populi assigns masters diplomats in their vassals' capitals when espionage is enabled. Those diplomats use the normal unlock; the proposed master grant applies immediately while vassalage lasts. Ordinary map sight, inbound agents, and sharing a team do not grant rosters. No foreign grant opens tactical zones. The stock diplomat popup shows class totals under default unit names; the newspaper can list actual types, support units and individual names.
- **Collect national rosters.** Run a private `get-newspaper-military.lua` collector through a knowledge getter at the existing end-of-round `PlayerDoneTurn` refresh. Cover every living major as a receiver, including humans and seats without a strategist. Check grants in the same Lua call as the unit scan, and record the grant kind with each authorized roster. Capture `Game.GetGameTurn()` and skip the sample if it crossed the round event's turn. Iterate each subject's live units once, using the military report's combat, nuclear and support classification. Group by numeric subject, actual unit type, class and `GetDomainType`. Count each unit once, including cargo, aircraft and units outside sight or tactical zones. Store printable domain, type and class labels and attach individual names obtained from `HasName()` and `GetNameNoDesc()`. Resolve name keys through `Locale`; preserve literal names and duplicates. National rosters carry no unit locations.
- **Store and project national rosters.** Add `NewspaperMilitaryObservations` to the knowledge schema and saved-game setup, indexed by receiver and turn. Store one complete observation per receiver in an awaited insert, with the round event ID and only the national rosters that receiver may read. Drop observations from an abandoned branch when the store rewinds its events. In `queryNewspaperEvidence`, check that the table exists for legacy replay, then read the exact receiver's latest row on the cutoff turn. Missing is unknown; an observed zero force is empty. Add the source to `evidence.ts` and carry cited `self.militaryRoster` and `player.militaryRoster` facts through the editor, expression accessors and evidence inspector. Keep the table out of generic knowledge tool results.
- **Read the receiver's tactical assessment.** Use the shared history reader from [human player recording](../../human-player-recording.md) for the cutoff turn. Expose the cited `self.tacticalZones` fact only; a missing observation yields no front story. Key fronts with city anchors by owner, city and domain. Describe the zone roster as of the receiver's own turn end. National rosters describe the end of the round, when counts can differ. A foreign national roster or spy grant cannot open another seat's assessment.
- **Record named launches.** In `event-visibility.lua`, capture a private `NewspaperTraining` receipt for `CityTrained` using `Players[PlayerID]:GetCityByID(CityID)` and `:GetUnitByID(UnitID)`. Record the city name, unit type and domain, optional localized individual name, and recipient IDs: the owner plus viewers who can see both the training city and the actual unit, allowing for cargo concealment. Attach it only to the stored event; strip it from both `get-events` formats. In `queries.ts`, query the receipt's recipient list within the event window, deduplicate by event ID and use that list for the whole newspaper event even if the generic flags disagree. The ports probe uses receipt fields, requires a known owner, a sea unit, a recorded city and both purchase flags false. Treat purchases separately. A later roster grant or rename reveals no launch details. Legacy training rows keep their existing evidence and cannot trigger the named-launch probe.
- **Probes.** Report the named front from a recorded assessment for the receiver on the cutoff turn. Check that a missing assessment or a foreign assessment leaves the front unreported. Check land, sea and air counts, a replacement type, duplicate names, an empty roster and a missing one. Exercise all grants, including spy recall, vassal release, and an unrelated teammate. After a grant ends, verify the latest same-turn observation cannot fall back to an older one. Test a Carrier launch, a Great Galleass named at creation, a later rename, gold and faith purchases, colliding IDs, a concealed unit and a receiver with only national roster access. Check collection failure, save rewind and replay of an older database.
- **Docs.** `triggers/facts.md`, `replay.md` and `mcp-server/docs/knowledge.md`.

### Stage 5: unhappiness by cause

**Implemented.** City observations record nonzero [unhappiness causes](../../../developers/vox-agents/newspaper/triggers/facts.md#city) for the newspaper at full access. The [Opinion probe](../../../developers/vox-agents/newspaper/triggers/examples.md#an-opinion-piece-on-city-unhappiness) can use recorded boredom. Strategists still get only net happiness through `get-cities`, and their tool lists omit `get-newspaper-evidence`. Stage 4a uses the same detail fields when it infers city-screen access.

### Stage 6: masthead and vocabulary

**Implemented.** See [printable terms](../../../developers/vox-agents/newspaper/triggers/constants.md#terms) and [masthead and terms](../../../developers/vox-agents/newspaper/editorial.md#masthead-and-terms). The [catalogue probes](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) cover an ideology title and motto, a moved capital, and a lost vassal relationship.

### Stage 7: genre, memory and chance

**Implemented.** Variants can add [subheadlines and bylines](../../../developers/vox-agents/newspaper/editorial.md#authoring-choices). Expressions can read [publication memory](../../../developers/vox-agents/newspaper/triggers/overview.md#publication-memory), and rules can use [seeded chance](../../../developers/vox-agents/newspaper/triggers/overview.md#chance). The [probes](../../../developers/vox-agents/newspaper/triggers/examples.md#probe-catalogue-examples) cover the Opinion page, obituaries, a peace follow-up, a hundredth issue and a quiet spell.

## Verification

After each stage, run from the repository root, in this order: `npm run build -w mcp-server`, `npm run test:mock -w mcp-server`, `npm run test:mock -w vox-agents -- tests/mock/newspaper`, `npm run type-check -w vox-agents` and `npm run build:newspaper -w vox-agents`. The MCP server is built first because the newspaper replay loads its compiled output.

Test new projection fields and gates under `mcp-server/tests/newspaper/` and new facts under `vox-agents/tests/mock/newspaper/editorial/facts/`. Use synthetic summaries and events for automated replay and check the Lua roster in the game. Verify a third player who sees a city receives neither covert presence nor a private espionage operation. Check strategist results against the same inputs.

Replay an existing recording with `--config vox-agents/newspaper/probes` to check Stage 4a against stored spy balances and both directions of diplomat presence. Once Stage 4 is complete, build the DLL, play a short game and replay it with the same probes. Include a human seat without a strategist. Match the paper's stance and zone roster to the shared observation and compare authorized national counts with actual units, including units outside those zones. Check the evidence for a carrier launch at its named port, a named great person, a stolen technology and `UnhappinessSources`. Verify `get-events`, `get-players`, `get-cities` and `get-military-report` retain their existing behavior.

## Out of scope

- Shipping probes as stock stories, and shared language styles: [Plan 4](04-triggers-templates-and-styles.md).
- Spy names, ranks and mission assignments as newspaper facts; ongoing foreign covert assignments; foreign tactical maps; individual unit coordinates and movement histories; and city event coverage beyond named military production. The operation hooks do not report mission type, stolen great works or coups for this plan.
- Names for eras and beliefs in events, which are recorded as numbers.
- The list of technologies a player holds (only a count is captured), game year, World Congress resolutions.
- Stable keys such as `CIVILIZATION_HUNS`. The catalogue keeps matching recorded display names.
