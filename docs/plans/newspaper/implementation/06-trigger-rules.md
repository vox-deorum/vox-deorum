# Plan 6: trigger rules

**Status: open.** The owner accepted the mechanics of the 14 stock rules and 15 authored templates. Stages 4a, 4b and 5 through 7 are implemented. The [trigger facts](../../../developers/vox-agents/newspaper/triggers/facts.md#covert-presence-and-roster-points) and [knowledge reference](../../../../mcp-server/docs/knowledge.md) describe how Stage 4a derives covert presence and access to detail from existing rosters.

[Plan 4](04-triggers-templates-and-styles.md) owns trigger tuning, template writing and language styles, and decides which of the new capabilities become stock stories. [Plan 7](07-llm-editors.md) uses that baseline for LLM editing and comparison.

## Goal and success criteria

Stage 4c will let a catalogue author describe forces observed on the receiver's fronts and report the type and port of a new ship. [Catalogue probes](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) verify what observations can support.

The strategist's tools (`get-cities`, `get-players`, `get-events`, `get-military-report`) keep their current outputs.

## What is missing today

| Wanted | Gap |
| --- | --- |
| Front reports | The recorder already saves private `TacticalZones` rows with posture and visible unit counts. The newspaper does not read them yet. |
| Ship launches | The newspaper already joins some `CityTrained` rows to a unit type and city. Generic event flags can include witnesses to a different unit or city with the same local ID. |

## Stages

Extend the existing [probe overlay and tests](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) with each stage. The examples below are acceptance probes. Test the evidence and the claims it supports so catalogue authors can change the wording. Each stage updates the affected documentation.

### Stage 4b: espionage operations

**Implemented.** Live and replay derive private reports from recorded operations, player turns, team technology gains and election results. The [event facts](../../../developers/vox-agents/newspaper/triggers/facts.md#event) explain when a technology is inferred and when a defender report can name its source. The [replay guide](../../../developers/vox-agents/newspaper/replay.md#replaying-private-espionage-reports) shows the India and Ottoman reports for the same operation.

### Stage 4c: front reports and ship launches

Derive reports in the shared newspaper query and projection from existing rows. For example, the Netherlands can report a Withdraw assessment off Stuttgart or a new Frigate at Rotterdam. The recorder, stored schemas and DLL stay as they are.

1. **Fronts and visible forces.** Read `TacticalZones` for the exact receiver and cutoff turn, requiring the row's `PlayerID` to match and its receiver visibility flag to be 2. Keep the latest row by insertion ID per nonzero `ZoneID`. Carry the recorded city label, zone domain, posture and visible unit counts by civilization and type through the evidence contract and inspector as cited `self.tacticalZones` facts. Treat each row as an observation: Withdraw is an assessment, the zone domain does not classify individual units, and the rows cannot establish fleet or army totals. For national context, use the existing reported military strength or count of units that need supply. Missing rows, including in an older recording without the table, leave the front unknown. Spy and vassal access do not open another seat's observations.
2. **Port reports.** For the receiver's own `CityTrained` within the event window, reuse the `trainedUnit` and `cityAtEvent` joins. Require one earlier `UnitCreated` on the same turn for the same `PlayerID` and `UnitID`, and take the port name from the dated city match for that owner and `CityID`. Cite the two events and the city observation. Make the derived port detail available to the `city.trained` probe only for the training player, since generic visibility can come from a different owner's unit or city. The probe matches a short catalogue list of recorded naval types, as the settler rules do for settlers. Require both purchase flags to be explicitly false. Skip ambiguous matches and unrecognized types. Leave custom ship names, purchases and foreign launches outside the probe.
3. **Probes and docs.** Add a front report for a zone with a named city and a port report to the probe overlay. Document what the counts and launch joins can establish in the [trigger facts](../../../developers/vox-agents/newspaper/triggers/facts.md) and [replay guide](../../../developers/vox-agents/newspaper/replay.md).

### Stage 5: unhappiness by cause

**Implemented.** City observations record nonzero [unhappiness causes](../../../developers/vox-agents/newspaper/triggers/facts.md#city) for the newspaper at full access. The [Opinion probe](../../../developers/vox-agents/newspaper/triggers/examples.md#an-opinion-piece-on-city-unhappiness) can use recorded boredom. Strategists still get only net happiness through `get-cities`, and their tool lists omit `get-newspaper-evidence`.

### Stage 6: masthead and vocabulary

**Implemented.** See [printable terms](../../../developers/vox-agents/newspaper/triggers/constants.md#terms) and [masthead and terms](../../../developers/vox-agents/newspaper/editorial.md#masthead-and-terms). The [catalogue probes](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) cover an ideology title and motto, a moved capital, and a lost vassal relationship.

### Stage 7: genre, memory and chance

**Implemented.** Variants can add [subheadlines and bylines](../../../developers/vox-agents/newspaper/editorial.md#authoring-choices). Expressions can read [publication memory](../../../developers/vox-agents/newspaper/triggers/overview.md#publication-memory), and rules can use [seeded chance](../../../developers/vox-agents/newspaper/triggers/overview.md#chance). The [probes](../../../developers/vox-agents/newspaper/triggers/examples.md#probe-catalogue-examples) cover the Opinion page, obituaries, a peace follow-up, a hundredth issue and a quiet spell.

## Verification

After each stage, run from the repository root, in this order: `npm run build -w mcp-server`, `npm run test:mock -w mcp-server`, `npm run test:mock -w vox-agents -- tests/mock/newspaper`, `npm run type-check -w vox-agents` and `npm run build:newspaper -w vox-agents`. The MCP server is built first because the newspaper replay loads its compiled output.

For Stage 4b, test the projection and facts with missing and ambiguous gains, a killed spy with a matching gain, a defender report across a cutoff, anonymous and identified defender reports, bystanders, and election losses without an assigned spy. Replay the [existing Netherlands recording](../../../developers/vox-agents/newspaper/replay.md#historical-evidence-query-verification) around turn 216 for India (player 1) and the Ottomans (player 5) with the probe overlay. Check that recordings without matching rows still replay and that strategist results are unchanged.

For Stage 4c, use the same recording and probe overlay for the Netherlands (player 7). At turn 235, match the Stuttgart front to the recorded Withdraw assessment and sighted units. At turn 282, match the Frigate launch at Rotterdam to its training, creation and city rows. The gold purchase of a Trireme at Amsterdam on turn 179 should not trigger a launch. Cover missing or foreign zone observations, duplicate or wrong-owner creation IDs, missing purchase flags, and bystanders with generic event visibility. In a short live game with a human seat and no strategist, check the same visibility rules and finish Stage 4a's in-game roster and access checks. Verify that the strategist's tools retain their current behavior.

## Out of scope

- Shipping probes as stock stories, and shared language styles: [Plan 4](04-triggers-templates-and-styles.md).
- Spy names, ranks and mission assignments; gold amounts, stolen great works, coups and exact defender notifications; and ongoing foreign covert assignments.
- Complete national military rosters and new access grants, foreign tactical maps, individual unit names and movement histories, and city event coverage beyond recorded ship launches.
- Names for eras and beliefs in events, which are recorded as numbers.
- The list of technologies a player holds (only a count is captured), game year, World Congress resolutions.
- Stable keys such as `CIVILIZATION_HUNS`. The catalogue keeps matching recorded display names.
