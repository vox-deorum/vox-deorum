# Plan 6: trigger rules

**Status: open.** The rule engine, 14 stock rules and 15 authored templates are in place, and the owner accepted their mechanics. The [event facts and reporting rules](../../../developers/vox-agents/newspaper/triggers/facts.md#event) include named great people and world news. Stages 6 and 7 are implemented with catalogue probes and reader coverage. Stage 4 starts with passive espionage and agent presence.

[Plan 4](04-triggers-templates-and-styles.md) owns trigger tuning, template writing and language styles, and decides which of the new capabilities become stock stories. [Plan 7](07-llm-editors.md) uses that baseline for LLM editing and comparison.

## Goal and success criteria

The remaining stages let a catalogue author report what a spy sees in a city, distinguish an absent diplomat from an unobserved one, report the theft of a technology, and count own and visible foreign military units. They also add opinions on city unhappiness.

Each remaining stage adds a group of capabilities and verifies it with [catalogue probes](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior).

One rule holds throughout: the strategist's tools (`get-cities`, `get-players`, `get-events`) return what they return today.

## What is missing today

| Wanted | Gap |
| --- | --- |
| Passive espionage and presence | `PlayerSummaries.Spies` already stores each player's agents, including diplomats, with display locations and states and current network points. It lacks stable assignment fields and Vox Populi's `RevealCityScreen` flag. The old `DiplomatPoints` collector looks for a `CityOwner` field Lua does not return. |
| Espionage stories | The recorder stores the queued outcome as `EspionageResult` and records elections. The operation row precedes the reward and does not show what the defender was eventually told. |
| Unit rosters | `TacticalZones` stores per-zone counts by civilization and unit type. Its storage misses the unassigned zone, and the rows don't identify which report they came from. |
| Unhappiness by cause | Only net `HappinessDelta` is captured. The DLL exposes each cause to Lua. |

## Stages

Extend the existing [probe overlay and tests](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) with each stage. Stages 4 through 5 change MCP recording or projection and the fact builders. Stage 4b also changes the DLL. Stages 6 and 7 change only the editor. Each stage rewrites the affected sections of the documentation pages named in its last bullet.

### Stage 4: passive espionage and agent presence

Derive the facts from the existing player summaries and city observations. The existing plot visibility path already covers events witnessed through a spy. This stage adds no table, refresh, or DLL binding.

- **Roster.** In `get-player-summary.lua`, add a private assignment object to each `Spies` entry with the city ID and plot, unlocalized state, and `RevealCityScreen`. For an active diplomat at the host's current capital, include the host player ID. Use the existing spy and city getters. A recorded empty roster is an observed absence; missing rosters or legacy entries that could match leave the fact unknown. Omit the assignment object from strategist output, including full access.
- **Cities.** At the cutoff, derive `city.ourSpyPresent` from the receiver's non-diplomat agents stationed at the matching city. Gathering intelligence, surveillance, election rigging and counterintelligence count; travelling does not. Expose full detail when the current uninterrupted `RevealCityScreen` grant was recorded before a readable city observation. Keep basic detail while that order is unknown. Cite the roster with the city and end the grant when the spy leaves or the city is replaced. City history keeps its existing access rules.
- **Diplomats.** For a known foreign major, look for an active diplomat in the receiver's roster whose host is that player (`player.ourDiplomatThere`), and in that player's roster whose host is the receiver (`player.theirDiplomatHere`). Expose only the resulting booleans on the cutoff view. Use an active outgoing diplomat's recorded `Network` points in the existing newspaper policy and deal gates. The stock Vox Populi thresholds are 200 and 800, and active diplomats do not spend points. Keep the contact, event visibility and deal-party rules. Use the cutoff roster for the cutoff view even when the foreign summary is unchanged. For events, use a roster recorded before the event, comparing turn and recording time. Withhold the grant when ordering is ambiguous. Leave the strategist's `DiplomatPoints` path alone.
- **Visibility and probes.** Cite the summary that establishes each derived fact. Keep raw assignments out of newspaper evidence and leave general summary version tracking as it is. Test travel, arrival, a city observation before and after unlock, and recall; zero-point and inbound-only visits; empty and legacy rosters; events before and after a permission was observed; and a bystander who receives no covert assignment facts.
- **Docs.** `triggers/facts.md`, `replay.md` and `mcp-server/docs/knowledge.md`.

### Stage 4b: espionage operations

In Vox Populi, use existing operations for the spy's fate and report rewards and defender notifications where they happen. A spy can be killed and the theft can still go through. The newspaper cites each fact directly; the notification queue stays unchanged.

- **Existing events.** Project the stored `EspionageResult` from `EspionageNotificationData` to the source alone. For a surviving, unidentified spy in Vox Populi, report that the spy survived and omit the defender's detection status. Correct the legacy hook to declare its existing seven integer arguments. Leave the separate spy-owner result hook blocked. Project election success to its `PlayerID`, and failure only to its `PlayerID` when `SpyID >= 0`. Normalize election influence from `Value` or `DiminishAmount / 100`, and resolve failure's `CapitalX` and `CapitalY` like other event plots.
- **Private reports.** Register one new `EspionageReport` event in MCP and the DLL under `MOD_EVENTS_ESPIONAGE`. For the attacker, emit one fact per confirmed tech grant in `DoStealTechnology` or positive gold transfer in `CvCity::DoEventChoice`. For the defender, emit at actual notification delivery in `ProcessSpyMessages`, including from saves. Pass only the outcome and rewards shown in the notification, and use `-1` for a withheld source ID. Use `RecipientID` rather than `PlayerID` to keep it off the strategist feed, with a case in `event-visibility.lua` that bypasses team and plot visibility. Require the exact recipient in newspaper projection and exclude the event from both formats in `get-events.ts`. Mark DLL edits with `// Vox Deorum:` and run `build-and-copy.bat`.
- **Facts and probes.** Expose `event.spyResult`, `event.tech`, `event.amount`, `event.thief` when known, and `event.victim` as applicable. `probe-tech-stolen` uses only facts that actually name the tech; `probe-spy-lost` uses the outcome; `probe-rigged-election` uses the existing election rows. Test a known and unknown thief, a killed spy whose theft still goes through, several techs in one mission, two operations in one city and turn, delivery from a save, suppressed delivery after conquest, a plot witness and teammate, and an election alert without a spy.
- Docs: `triggers/facts.md`, `mcp-server/docs/knowledge.md`, the espionage pages under `mcp-server/docs/events/`.

### Stage 4c: military unit rosters

Derive own and foreign military counts from the receiver's recorded tactical zones. A foreign roster counts units the receiver saw, including units seen through a spy's map sight. It makes no claim about the foreign player's total forces. Use the report's existing unit categories. Reports are saved when a caller requests one, usually during the receiver's strategist turn before moves; a receiver with no report that turn has no roster.

- **Store one summary per report.** In `getters/military-report.ts`, sum the existing zone `Units` counts across the report, including zone 0. Store that aggregate in `Payload.UnitRoster` on one row of the same `TacticalZones` batch. Use an empty zone 0 row if a successful report has no zones. Fill required zone 0 columns on the storage copy. In `storeTimedKnowledgeBatch`, preserve `Payload` and await the inserts. A storage failure leaves the strategist's military report intact. Older rows without an aggregate remain readable but supply no roster.
- **Project.** Read the latest row with `Payload.UnitRoster` on the cutoff turn for the receiver's `PlayerID` and visibility. Check civilization labels for ambiguity across the recorded identities, then keep known majors. A report with no units for a resolved player yields an empty list. A missing report leaves the roster unknown. Cite the single `TacticalZones` row and expose only `{name, count}` entries in `player.unitRoster` and `self.unitRoster`.
- **Probes.** Count own and visible foreign units across two zones, including unassigned units. Test a second report on the same turn that drops a zone, an empty report, an ambiguous civilization label, a missing report, a different receiver's report, and a storage failure that leaves the strategist report available. Check the shared batch writer still saves player options and relationship changes. Verify the paper never prints an army total for a rival based on what it saw.
- **Docs.** `triggers/facts.md`, `replay.md` and `mcp-server/docs/knowledge.md`.

### Stage 5: unhappiness by cause

- `mcp-server/lua/get-city-information.lua`, level 2 block: build `UnhappinessSources`, an object of the nonzero readings below. Each value is that cause's own reading for the city. The game's final total also applies a population cap and handles resistance, razing and puppets separately, so rules compare causes with each other and against small thresholds.

  | Key | Lua getter on `City` |
  | --- | --- |
  | `Culture` (boredom) | `GetUnhappinessFromYield(YieldTypes.YIELD_CULTURE)` |
  | `Gold` (poverty) | `GetUnhappinessFromYield(YieldTypes.YIELD_GOLD)` |
  | `Science` (illiteracy) | `GetUnhappinessFromYield(YieldTypes.YIELD_SCIENCE)` |
  | `Distress` | `GetUnhappinessFromYield(YieldTypes.YIELD_FOOD)` |
  | `Religion` | `GetUnhappinessFromReligiousUnrest()` |
  | `Isolation`, `Famine`, `PillagedTiles`, `Buildings` | `GetUnhappinessFromIsolation()`, `GetUnhappinessFromFamine()`, `GetUnhappinessFromPillagedTiles()`, `GetUnhappinessFromBuildings()` |
  | `Specialists` | `getUnhappinessFromSpecialists()` |

- `mcp-server/src/knowledge/schema/timed.ts` and `schema/setup.ts`: nullable JSON column `UnhappinessSources` on `CityInformations`.
- `projectNewspaperCity`: pick `UnhappinessSources` through a newspaper-only field list whenever the paper has full city detail, including a Stage 4 city-screen grant at cutoff. `cityDetailFields` and the `get-cities` schema stay as they are.
- `vox-agents/src/newspaper/editorial/facts/city.ts`: detailed fact `city.unhappiness` with `culture`, `gold`, `science`, `distress`, `religion`, `isolation`, `famine`, `pillaged`, `buildings`, `specialists`, and `top`, the name of the largest cause. A cause missing from the object reads 0.
- Probe: `probe-culture-opinion` (an own city where `city.unhappiness.top == 'culture'` and `city.unhappiness.culture >= 2`). It gains its opinion styling in stage 7.
- Docs: `triggers/facts.md`, `mcp-server/docs/knowledge.md`.

### Stage 6: masthead and vocabulary

**Implemented.** See [printable terms](../../../developers/vox-agents/newspaper/triggers/constants.md#terms) and [masthead and terms](../../../developers/vox-agents/newspaper/editorial.md#masthead-and-terms). The [catalogue probes](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) cover an ideology title and motto, a moved capital, and a lost vassal relationship.

### Stage 7: genre, memory and chance

**Implemented.** Variants can add [subheadlines and bylines](../../../developers/vox-agents/newspaper/editorial.md#authoring-choices). Expressions can read [publication memory](../../../developers/vox-agents/newspaper/triggers/overview.md#publication-memory), and rules can use [seeded chance](../../../developers/vox-agents/newspaper/triggers/overview.md#chance). The [probes](../../../developers/vox-agents/newspaper/triggers/examples.md#probe-catalogue-examples) cover the Opinion page, obituaries, a peace follow-up, a hundredth issue and a quiet spell. The opinion probe uses synthetic city data until Stage 5 records unhappiness causes.

## Verification

After each stage, run from the repository root, in this order: `npm run build -w mcp-server`, `npm run test:mock -w mcp-server`, `npm run test:mock -w vox-agents -- tests/mock/newspaper`, `npm run type-check -w vox-agents` and `npm run build:newspaper -w vox-agents`. The MCP server is built first because the newspaper replay loads its compiled output.

Test new projection fields and gates under `mcp-server/tests/newspaper/` and new facts under `vox-agents/tests/mock/newspaper/editorial/facts/`. Use synthetic summaries and events for automated replay and check the Lua roster in the game. Verify a third player who sees a city receives neither covert presence nor a private espionage operation. Check strategist results against the same inputs.

After Stage 5, build the DLL, play a short game and replay it with `--config vox-agents/newspaper/probes`. Check the spy's city screen before and after the unlock and both directions of diplomat presence. On a turn when the receiver's strategist ran, compare the newspaper counts with that military report. A named great person, a stolen technology and `UnhappinessSources` appear in the newspaper evidence. Verify `get-events`, `get-players`, `get-cities` and `get-military-report` retain their existing behavior.

## Out of scope

- Shipping probes as stock stories, and shared language styles: [Plan 4](04-triggers-templates-and-styles.md).
- Spy names, ranks and mission assignments as newspaper facts; ongoing foreign covert assignments; additional city event coverage; complete foreign rosters from diplomat unlocks; unit positions and tactical deployments. The operation hooks do not report mission type, stolen great works or coups for this plan.
- Names for eras and beliefs in events, which are recorded as numbers.
- The list of technologies a player holds (only a count is captured), game year, World Congress resolutions.
- Stable keys such as `CIVILIZATION_HUNS`. The catalogue keeps matching recorded display names.
