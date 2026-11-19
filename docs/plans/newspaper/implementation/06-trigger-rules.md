# Plan 6: trigger rules

**Status: open.** The rule engine, 14 stock rules and 15 authored templates are in place, and the owner accepted their mechanics. The [event facts and reporting rules](../../../developers/vox-agents/newspaper/triggers/facts.md#event) include named great people and world news. Stage 6 is implemented with catalogue probes and reader coverage. Stage 4 starts with passive espionage and agent presence.

[Plan 4](04-triggers-templates-and-styles.md) owns trigger tuning, template writing and language styles, and decides which of the new capabilities become stock stories. [Plan 7](07-llm-editors.md) uses that baseline for LLM editing and comparison.

## Goal and success criteria

The remaining stages let a catalogue author report what a spy sees in a city, distinguish an absent diplomat from an unobserved one, report the theft of a technology, and count own and visible foreign military units. They also add opinions on city unhappiness.

Each remaining stage adds a group of capabilities and verifies it with [catalogue probes](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior).

One rule holds throughout: the strategist's tools (`get-cities`, `get-players`, `get-events`) return what they return today.

## What is missing today

| Wanted | Gap |
| --- | --- |
| Passive espionage and presence | `get-city-information.lua` reads the old surveillance flag. Vox Populi exposes city screen access as `RevealCityScreen`. `PlayerSummaries.Spies` already records the player's own agents, including diplomats, with display locations and states. The separate points collector looks for a `CityOwner` field the spy API does not supply. The game exposes both directions of diplomat presence, but the newspaper does not record them. |
| Espionage stories | The recorder stores notification data as `EspionageResult` and also records election outcomes. The DLL bridge blocks the separate spy-owner result hook. The newspaper projects neither kind yet, and technology is added to the queued notification after the recording hook. |
| Unit rosters | The military report already saves unit counts by civilization, unit type and zone in `TacticalZones`. The newspaper does not yet read those reports, and older rows have no report ID to separate repeated reports on the same turn. |
| Unhappiness by cause | Only net `HappinessDelta` is captured. The DLL exposes each cause to Lua. |
| Opinion pieces, obituaries, letters | Variants cannot set a subheadline or byline. |
| Retractions, anniversaries of our own reporting, rare pieces | Expressions cannot read publication state. No chance source. |

## Stages

Extend the existing [probe overlay and tests](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) with each stage. Stages 4 through 5 change MCP recording or projection and the fact builders. Stage 4b also changes the DLL. Stages 6 and 7 change only the editor. Each stage rewrites the affected sections of the documentation pages named in its last bullet.

### Stage 4: passive espionage and agent presence

Use the existing DLL Lua interfaces to record what the receiver knows. A spy may be stationed before the city screen opens. Our diplomat abroad and their diplomat in our capital are separate facts. The strategist keeps the existing display roster; newspaper rules use IDs and booleans instead of parsing display names and localized states. The existing plot visibility path already records witnessed events.

- **Capture.** Add `lua/newspaper-espionage.lua` and its getter behind the existing end-of-round refresh in `knowledge/store.ts`. Capture one successful observation per living major, using the same observed turn as the city refresh. Store it in a newspaper-only timed table, `NewspaperEspionage`, with `PlayerID`, the refresh event ID and the existing timed `Payload` and visibility fields. This keeps another player's spy movements from creating extra city or player versions in the bystander's evidence. Isolate collection failures from the existing refreshes; a failed sample supplies no observation. Create the table before writing, check for its presence in read-only replay, and remove invalidated captures alongside their refresh events on resync.
- **Cities.** Index the receiver's own non-diplomat agents by city, matching coordinates and recording the city's ID and plot. Use the unlocalized state keys for gathering intelligence, surveillance, rigging an election and counterintelligence. Travelling, unassigned and dead agents do not count. Record `CityScreen` only for a stationed agent with `RevealCityScreen`. At the cutoff, use the receiver's capture to add `city.ourSpyPresent` and grant full detail on a matching readable city. Cite both observations; a recall or city replacement ends the grant. Existing access rules still govern city history. A successful capture with no spy there reads false; a missing capture is hidden.
- **Diplomats.** For each known foreign major, record the booleans from `IsMyDiplomatVisitingThem` and `IsOtherDiplomatVisitingMe`. For our active diplomat, match the agent to the host capital and compare `MaxNetworkPointsStored` with the `RevealPolicyTree` and `RevealTradeDeals` entries in `SpyPassiveBonusesDiplomat`, following the game's scaling rule. At the cutoff, cite the receiver's capture for `player.ourDiplomatThere` and `player.theirDiplomatHere`; an observed absence is false and a missing observation stays hidden. Use policy and deal permissions in the existing dated gates for policy branches, witnessed policy adoption and foreign `DealMade` terms. Retain contact, full-access and deal-party rules. If no structured capture supports the grant, keep basic visibility; the old points field never recorded working permissions. Replace synthetic points fixtures with structured captures.
- **Projection.** In `newspaper/queries.ts`, read the receiver's capture for the cutoff and the dated captures for existing policy and deal gates. An event may only use a capture whose refresh event ID precedes it. Add the table to evidence source references. Attach presence and city-screen detail to the cutoff view even when the city or host summary has not changed that turn. A city-screen grant needs a successful city refresh at that cutoff. Leave the new presence facts unavailable on history accessors. A foreign covert assignment has no presence flag. Stage 4b can report an observed detection.
- **Probes.** Test a spy travelling, arriving, unlocking city detail and leaving; a diplomat with zero points; and an incoming visit with no outgoing diplomat. Use an unchanged city and an unchanged foreign summary across two captures. Verify a bystander's evidence is unchanged, a failed sample differs from an empty one, and an older database remains readable and writable in the appropriate modes.
- **Docs.** `triggers/facts.md`, `replay.md` and `mcp-server/docs/knowledge.md`.

### Stage 4b: espionage operations

Espionage is private to its two parties. The Lua visibility also marks players who see the city plot, so the newspaper applies its own gate.

- **Operation and update capture.** Keep the existing `AddSpyMessage` hook. Correct its argument signature in `CustomMods.h` and tag the queued message with a recorder key from the bridge's event sequence. Keep the key in memory so the save format stays the same. In `UpdateSpyMessage`, emit a private update with that key and the updated technology and gold only when the game finds the queued message. A message loaded from a save has no key; skip the update record in that case.
- **Delivery capture.** In `ProcessSpyMessages`, emit a separate, self-contained row at the defender's notification, after the game checks the city still belongs to the target. Include the final reportable fields and omit the source's ID when the game withholds it. The row works for messages loaded from a save. An undetected operation or a dropped notification has no delivery row. Register both private event types in `CvConnectionSchema.cpp` and MCP's event registry and generator. Mark Vox Deorum changes with `// Vox Deorum:` and build with `build-and-copy.bat`.
- **Assembly.** The source sees the operation on its recorded turn. Join its last update by recorder key, operation turn and parties, and cite both rows. If the update is missing, report only the original outcome. For the target use the delivery row, at its own turn; old operation rows without delivery evidence cannot establish a story for the target. Treat missing game values as unknown; `AmountStolen` is gold. Filter both private row types out of both `get-events` formats and the strategist feed, and strip the recorder key from the existing hook. Leave the original spy-owner hook blocked.
- `projection.ts`: new config option `partiesOnly`, which projects an event only when the receiver is one of its named players. Add:

  | Stored event | Shape | Published to | Fields |
  | --- | --- | --- | --- |
  | `EspionageResult` | Queued operation or defender delivery | Source at the operation; target at delivery | City position, `SpyResult`, `Tech`, `AmountStolen`, `TargetPlayerID`, and `SourcePlayerID` when allowed below |
  | `ElectionResultSuccess` | `PlayerID`, `SpyID`, `Value`, `CityX`, `CityY` | The rigging player | All |
  | `ElectionResultFailure` | `PlayerID`, `SpyID`, `DiminishAmount`, `CapitalX`, `CapitalY` | That player, when `SpyID` is 0 or more (their own spy was outplayed) | All |

  Teammates and plot witnesses are third parties. For the target, `SourcePlayerID` and the enriched `SourcePlayer` object are published only when the game names the spy's country: Identified or Killed. For the source, report the outcome their own notification establishes; in Vox Populi, a surviving, unidentified spy's notification does not distinguish Detected from Undetected, so report success without the defender's detection status.
- `facts/event.ts`: `event.spyResult`, `event.tech`, `event.amount`, `event.thief` (when published), `event.victim`. For election stories, normalize `event.amount` to influence points: success uses `Value`, failure uses `DiminishAmount / 100`. `facts/event-city.ts`, `eventPlot`: read `CapitalX` and `CapitalY` as a position.
- Probes: `probe-tech-stolen` (known and unknown thief), `probe-spy-lost` (our spy is killed abroad), `probe-rigged-election` (our agent rigs a city-state election). Test two same-turn operations at one plot, multiple updates, a delivery on the next turn, a message loaded from a save, a conquered city that suppresses delivery, an undetected spy, a teammate, and an election alert for a player with no spy.
- Docs: `triggers/facts.md`, `mcp-server/docs/knowledge.md`, the espionage pages under `mcp-server/docs/events/`.

### Stage 4c: military unit rosters

Derive own and foreign military counts from the receiver's recorded tactical zones. A foreign roster counts units the receiver saw, including units seen through a spy's map sight. It makes no claim about the foreign player's total forces. Use the report's existing unit categories. Reports are saved when a caller requests one, usually during the receiver's strategist turn before moves; a receiver with no report that turn has no roster.

- **Identify one report.** `getters/military-report.ts` saves one `TacticalZones` batch per report. Give the rows a shared report ID in the existing `Payload` JSON. In `storeTimedKnowledgeBatch`, preserve `Payload` and await all inserts in the transaction. Prepare separate storage rows so `get-military-report` returns the original zones. In storage, fill zone 0's required columns with neutral values and retain any unassigned units. When the successful report has no zones, save one empty zone 0 row. Catch storage failures in the getter so the strategist still gets its report. Older rows without a report ID have no reliable batch boundary and stay unavailable. No roster table or new game collector is needed.
- **Project.** In `newspaper/queries.ts`, take the latest complete batch on the cutoff turn by insertion ID, restricted to the receiver's `PlayerID` and visibility. In `projection.ts`, sum positive counts in `Units` across its zones, including zone 0. Resolve civilization labels to known majors and withhold ambiguous matches. Skip city-state and barbarian labels. A complete batch with no units for a resolved player yields an empty list. If there is no report on that turn, the fact is hidden. Add `TacticalZones` to the evidence source table enum and cite the report rows. Expose only `{name, count}` entries in cutoff `player.unitRoster`, including `self.unitRoster`.
- **Probes.** Count own and visible foreign units across two zones, including unassigned units. Test a second report on the same turn that drops a zone, an empty report, an ambiguous civilization label, a missing report, a different receiver's report, and a storage failure that leaves the strategist report available. Verify the paper never prints an army total for a rival based on what it saw.
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

- **Genre.** `authoredVariantSchema` gains optional `subheadline` and `byline`, both with placeholders. `presentIssue` fills the existing `subheadline` item field, which the reader already draws. `byline` is a new optional `IssueItem` field in `contracts/issue.ts`, drawn under the headline in `newspaper/src/reader/story.ts`. Both join `printable` and `placeholderSources`. The probe overlay's `pages.json` adds an Opinion page that collects the `opinion` tag; its test publishes more stories than the front page holds, since a section whose stories all fit on the front page is not drawn.
- **Memory.** New global `press` and helper `printed`, built in `check.ts` from the publication state and passed to trigger rules (through `evaluateTriggerRules` in `rules/evaluate.ts`), templates and presentation. The helper lives in `facts/guest.ts`.

  | Name | Value |
  | --- | --- |
  | `press.issues` | Number of issues published |
  | `press.lastIssueTurn` | Turn of the last issue, or `null` |
  | `printed(ruleId)` | `{turn, count}`: the latest turn and the number of published articles that rule supported; `null` when none |
  | `printed(ruleId, subject)` | The same, for articles about that subject. `subject` is a city, player or pair fact, matched by the subject key that rules of that kind already use. |

  The candidate built in `selection/templates.ts` carries its rule definition IDs through selection. `publishedItemRecordSchema` in `contracts/publication.ts` gains optional `ruleIds` and `subject` (the candidate's subject key), written in `check.ts`. A grouped article is recorded under its group subject.
- **Chance.** `editorialTriggerRuleSchema` gains optional `chance`, from 0 to 1. In `rules/evaluate.ts` the draw comes after `when` and `repeat` pass: once per subject, or once per group key for a grouped rule. The draw is a number in [0, 1) hashed from the check's identity seed, the rule ID and the subject or group key, with the hashing in `shared/determinism.ts`. A failed draw records the audit outcome `chance` (new value in `contracts/triggers.ts`) and writes no repeat memory.
- Probes: `probe-culture-opinion` and `probe-obituary` gain subheadline and byline; `probe-retraction` (the overlay's own pair rule `probe-peace` prints a peace story, and a second pair rule fires when the pair is at war again while `turn - printed('probe-peace', pair).turn <= short`); `probe-hundredth-issue`; `probe-quiet-spell` (no issue for `medium` turns, `chance: 0.25`).
- Docs: `triggers/overview.md`, `triggers/facts.md`, `triggers/examples.md` (three probes as worked examples), `editorial.md`.

## Verification

After each stage, run from the repository root, in this order: `npm run build -w mcp-server`, `npm run test:mock -w mcp-server`, `npm run test:mock -w vox-agents -- tests/mock/newspaper`, `npm run type-check -w vox-agents` and `npm run build:newspaper -w vox-agents`. The MCP server is built first because the newspaper replay loads its compiled output.

Test new projection fields and gates under `mcp-server/tests/newspaper/` and new facts under `vox-agents/tests/mock/newspaper/editorial/facts/`. Use synthetic capture rows for automated replay and check the Lua capture in the game. Verify a third player who sees a city receives neither covert presence nor a private espionage operation. Check strategist results against the same inputs.

After Stage 5, build the DLL, play a short game and replay it with `--config vox-agents/newspaper/probes`. Check the spy's city screen before and after the unlock and both directions of diplomat presence. On a turn when the receiver's strategist ran, compare the newspaper counts with that military report. A named great person, a stolen technology and `UnhappinessSources` appear in the newspaper evidence. Verify `get-events`, `get-players`, `get-cities` and `get-military-report` retain their existing behavior.

## Out of scope

- Shipping probes as stock stories, and shared language styles: [Plan 4](04-triggers-templates-and-styles.md).
- Spy names, ranks and mission assignments as newspaper facts; ongoing foreign covert assignments; additional city event coverage; complete foreign rosters from diplomat unlocks; unit positions and tactical deployments. The operation hooks do not report mission type, stolen great works or coups for this plan.
- Names for eras and beliefs in events, which are recorded as numbers.
- The list of technologies a player holds (only a count is captured), game year, World Congress resolutions.
- Stable keys such as `CIVILIZATION_HUNS`. The catalogue keeps matching recorded display names.
