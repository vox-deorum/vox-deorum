# Plan 6: trigger rules

**Status: open.** The rule engine, 14 stock rules and 15 authored templates are in place, and the owner accepted their mechanics. Stage 2 added [recorded names, ideology, team links and world news](../../../developers/vox-agents/newspaper/triggers/facts.md). Stage 3 is next.

[Plan 4](04-triggers-templates-and-styles.md) owns trigger tuning, template writing and language styles, and decides which of the new capabilities become stock stories. [Plan 7](07-llm-editors.md) uses that baseline for LLM editing and comparison.

## Goal and success criteria

The remaining stages let a catalogue author write an opinion piece on a city's boredom, report the birth of a named great person abroad or the theft of a technology, and give a paper a masthead that follows the game.

Each remaining stage adds a group of capabilities and verifies it with [catalogue probes](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior).

One rule holds throughout: the strategist's tools (`get-cities`, `get-players`, `get-events`) return what they return today.

## What is missing today

| Wanted | Gap |
| --- | --- |
| Great people by their own name, at birth, use and death | Only the unit type is recorded ("Great Scientist"). The paper cannot report an unwitnessed birth or any death (`UnitPrekill`). |
| Espionage stories | Both espionage hooks are stored as `EspionageResult` (two payload shapes), and election rigging as `ElectionResultSuccess` and `ElectionResultFailure`. None is projected. The stolen technology never reaches the recorder, because the DLL adds it to the notification after the hook has fired. |
| Unhappiness by cause | Only net `HappinessDelta` is captured. The DLL exposes each cause to Lua. |
| Masthead that follows the game; shared vocabulary | `design.title` is copied raw. No motto. No way to define a word once and print it in many templates. |
| Opinion pieces, obituaries, letters | Variants cannot set a subheadline or byline. |
| Retractions, anniversaries of our own reporting, rare pieces | Expressions cannot read publication state. No chance source. |

## Stages

Extend the existing [probe overlay and tests](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) with each stage. Stages 3 to 5 change the MCP server projection and the fact builders. Stage 4 also changes the DLL. Stages 6 and 7 change only the editor. Each stage rewrites the affected sections of the documentation pages named in its last bullet.

### Stage 3: great people by name

- `mcp-server/lua/event-visibility.lua`, `addUnit`: when `unit:IsGreatPerson()` and `unit:HasName()`, add `GreatPerson = unit:GetNameNoDesc()` to the unit metadata. The unit still exists when `UnitCreated`, `GreatPersonExpended` and `UnitPrekill` fire.
- `mcp-server/src/tools/knowledge/get-events.ts`: remove the `GreatPerson` key from unit metadata in both output paths, including `Original`, so the strategist's output is unchanged.
- `projection.ts`: publish the name as `Person`. Add `UnitPrekill` to `newspaperEventConfigs` (`OwnerID`, `UnitID`, `UnitType`, `PlotX`, `PlotY`, `AttackingPlayerID`, `DelayKill`), projected only for a named great person, only for the row with `DelayKill` false (the hook fires twice per death), and skipped when the same unit has a `GreatPersonExpended` event in the same turn (using an expended great person also kills the unit).
- World news: add `UnitCreated` with a `Person` to the existing world news list. Births abroad are news; uses and deaths abroad are reported only when the receiver witnessed them.
- `facts/event.ts`: `event.person`, and `event.kind` with the values `born`, `expended`, `died` for these three events.
- Probes: `probe-foreign-birth` (a named birth by a met civilization, unseen city), `probe-obituary` (a named great person is expended or dies; one expenditure yields one story).
- Docs: `triggers/facts.md`, `mcp-server/docs/knowledge.md`.

### Stage 4: espionage

Espionage is private to its two parties. The Lua visibility also marks players who see the city plot, so the newspaper applies its own gate.

- **DLL.** In `CvPlayerEspionage::UpdateSpyMessage` (`civ5-dll/CvGameCoreDLL_Expansion2/CvEspionageClasses.cpp`), fire `EspionageNotificationData` again with the stolen technology and amount, under a `// Vox Deorum:` comment. Today the hook fires in `AddSpyMessage` before the technology is chosen, so the recorder only ever sees "no technology". Build with `build-and-copy.bat`.
- `projection.ts`: new config option `partiesOnly`, which projects an event only when the receiver is one of its named players. Add:

  | Stored event | Shape | Published to | Fields |
  | --- | --- | --- | --- |
  | `EspionageResult` | Notification: `SourcePlayerID`, `TargetPlayerID` | The target, when `SpyResult` is Detected, Identified, Killed or KilledNotIdentified (the game tells the target nothing about an undetected spy). The source, always. | City position, `SpyResult`, `Tech`, `AmountStolen`, `TargetPlayerID` |
  | `EspionageResult` | Spy owner: `SpyOwnerID`, `SpyIndex` | The spy owner | `SpyOwnerID`, `SpyResult`, city position |
  | `ElectionResultSuccess` | `PlayerID`, `SpyID`, `Value`, `CityX`, `CityY` | The rigging player | All |
  | `ElectionResultFailure` | `PlayerID`, `SpyID`, `DiminishAmount`, `CapitalX`, `CapitalY` | That player, when `SpyID` is 0 or more (their own spy was outplayed) | All |

  For the target, `SourcePlayerID` and the enriched `SourcePlayer` object are published only when `SpyResult` is Identified or Killed. Example: "a spy stole Printing Press from Amsterdam" names Persia only if the spy was identified.
- `facts/event.ts`: `event.spyResult`, `event.tech`, `event.amount`, `event.thief` (when published), `event.victim`. `facts/event-city.ts`, `eventPlot`: read `CapitalX` and `CapitalY` as a position.
- Probes: `probe-tech-stolen` (a technology is stolen from us; one variant names the thief, one runs when the thief is unknown), `probe-spy-lost` (our spy is killed abroad), `probe-rigged-election` (our agent rigs a city-state election).
- Docs: `triggers/facts.md`, `mcp-server/docs/knowledge.md`, the espionage pages under `mcp-server/docs/events/`.

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
- `projectNewspaperCity`: pick `UnhappinessSources` at level 2 through a newspaper-only field list. `cityDetailFields` and the `get-cities` schema stay as they are.
- `vox-agents/src/newspaper/editorial/facts/city.ts`: detailed fact `city.unhappiness` with `culture`, `gold`, `science`, `distress`, `religion`, `isolation`, `famine`, `pillaged`, `buildings`, `specialists`, and `top`, the name of the largest cause. A cause missing from the object reads 0.
- Probe: `probe-culture-opinion` (an own city where `city.unhappiness.top == 'culture'` and `city.unhappiness.culture >= 2`). It gains its opinion styling in stage 7.
- Docs: `triggers/facts.md`, `mcp-server/docs/knowledge.md`.

### Stage 6: masthead and vocabulary

- **Terms.** New `terms` group in `constants.json`: a name mapped to an expression that reads globals and returns text or a number. Example: `"ruler": "self.ideology == 'Order' ? 'the Party' : 'the Crown'"`, `"capital": "self.capital.name"`. Terms are for printing: templates, titles and mottos use `{{terms.ruler}}`, and expressions keep reading facts directly. Validate in `config/constants.ts`, compile in `config/expressions.ts` beside shortcuts, evaluate once per check in `check.ts`, and keep each term's source rows. `templateFacts` in `selection/templates.ts` merges terms into `placeholders`, and `placeholderSources` adds a term's sources to a variant that prints it. A term with no value is absent, so the existing `printable` check drops a variant that prints it.
- **Title and motto.** `designSchema` in `config/schema.ts` gains optional `motto`. `presentIssue` in `presentation/issue.ts` runs `title` and `motto` through the existing `substitute` with the terms and uses the result in the source note. `chooseDesign` leaves out a design whose title or motto still holds a placeholder. The publication object in `contracts/issue.ts` gains optional `motto`, drawn under the masthead in `vox-agents/newspaper/src/reader/`.
- Probes: `probe-communist-press` gains the title "The {{terms.capital}} Worker" and a motto; `probe-capital-masthead` (the title follows a moved capital); `probe-vassal-strapline` (a term names our master with `players.find(p => p.master)`; the design is eligible only while we have one).
- Docs: `triggers/constants.md`, `editorial.md`.

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

Test new projection fields and gates under `mcp-server/tests/newspaper/` and new facts under `vox-agents/tests/mock/newspaper/editorial/facts/`. Examples: a third player who sees the city gets no espionage event; an unwitnessed foreign birth carries no coordinates; `get-events` returns a great person event without the `GreatPerson` key.

After stage 5, build the DLL, play a short game and replay it with `--config vox-agents/newspaper/probes`. A named great person, a stolen technology and `UnhappinessSources` appear in the newspaper evidence, and `get-events` and `get-cities` return the same fields as before.

## Out of scope

- Shipping probes as stock stories, and shared language styles: [Plan 4](04-triggers-templates-and-styles.md).
- Espionage detail the hooks do not carry: the mission type, stolen great works, coups, and the roster of our own spies (recorded only as display text).
- Names for eras and beliefs in events, which are recorded as numbers.
- The list of technologies a player holds (only a count is captured), game year, World Congress resolutions.
- Stable keys such as `CIVILIZATION_HUNS`. The catalogue keeps matching recorded display names.
