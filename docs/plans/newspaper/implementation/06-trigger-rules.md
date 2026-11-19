# Plan 6: trigger rules

**Status: implemented.** The owner accepted the mechanics of the 14 stock rules and 15 authored templates. The [trigger facts](../../../developers/vox-agents/newspaper/triggers/facts.md#covert-presence-and-roster-points) and [knowledge reference](../../../../mcp-server/docs/knowledge.md) describe how Stage 4a derives covert presence and access to detail from existing rosters. The in-game acceptance check depends on [Plan 5](05-live-integration.md).

[Plan 4b](04b-story-mining.md) decides which story types, including the new capabilities here, become stock stories. [Plan 4a](04a-styles.md) owns styles and [Plan 4c](04c-variant-drafting.md) owns template writing. [Plan 7](07-llm-editors.md) builds LLM editing and comparison on that catalogue.

## Goal and success criteria

Catalogue authors can describe forces observed on the receiver's fronts and report the type and port of a new ship. [Catalogue probes](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) verify what observations can support.

The strategist's tools (`get-cities`, `get-players`, `get-events`, `get-military-report`) keep their current outputs.

## Stages

Extend the existing [probe overlay and tests](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) with each stage. The examples below are acceptance probes. Test the evidence and the claims it supports so catalogue authors can change the wording. Each stage updates the affected documentation.

### Stage 4b: espionage operations

**Implemented.** Live and replay derive private reports from recorded operations, player turns, team technology gains and election results. The [event facts](../../../developers/vox-agents/newspaper/triggers/facts.md#event) explain when a technology is inferred and when a defender report can name its source. The [replay guide](../../../developers/vox-agents/newspaper/replay.md#replaying-private-espionage-reports) shows the India and Ottoman reports for the same operation.

### Stage 4c: front reports and ship launches

**Implemented.** The shared query reads [private tactical observations](../../../developers/vox-agents/newspaper/triggers/facts.md#tactical-observations) from the receiver's cutoff turn and derives [port names](../../../developers/vox-agents/newspaper/triggers/facts.md#inferred-city-facts) for its own completed training. The [replay guide](../../../developers/vox-agents/newspaper/replay.md#replaying-front-reports-and-ship-launches) shows the Stuttgart assessment, Rotterdam launch and Amsterdam purchase. The recorder, stored schemas and DLL are unchanged.

### Stage 5: unhappiness by cause

**Implemented.** City observations record nonzero [unhappiness causes](../../../developers/vox-agents/newspaper/triggers/facts.md#city) for the newspaper at full access. The [Opinion probe](../../../developers/vox-agents/newspaper/triggers/examples.md#an-opinion-piece-on-city-unhappiness) can use recorded boredom. Strategists still get only net happiness through `get-cities`, and their tool lists omit `get-newspaper-evidence`.

### Stage 6: masthead and vocabulary

**Implemented.** See [printable terms](../../../developers/vox-agents/newspaper/triggers/constants.md#terms) and [masthead and terms](../../../developers/vox-agents/newspaper/editorial.md#masthead-and-terms). The [catalogue probes](../../../developers/vox-agents/newspaper/triggers/overview.md#probe-catalogue-behavior) cover an ideology title and motto, a moved capital, and a lost vassal relationship.

### Stage 7: genre, memory and chance

**Implemented.** Variants can add [subheadlines and bylines](../../../developers/vox-agents/newspaper/editorial.md#authoring-choices). Expressions can read [publication memory](../../../developers/vox-agents/newspaper/triggers/overview.md#publication-memory), and rules can use [seeded chance](../../../developers/vox-agents/newspaper/triggers/overview.md#chance). The [probes](../../../developers/vox-agents/newspaper/triggers/examples.md#probe-catalogue-examples) cover the Opinion page, obituaries, a peace follow-up, a hundredth issue and a quiet spell.

## Verification

After each stage, run from the repository root, in this order: `npm run build -w mcp-server`, `npm run test:mock -w mcp-server`, `npm run test:mock -w vox-agents -- tests/mock/newspaper`, `npm run type-check -w vox-agents` and `npm run build:newspaper -w vox-agents`. The MCP server is built first because the newspaper replay loads its compiled output.

For Stage 4b, test the projection and facts with missing and ambiguous gains, a killed spy with a matching gain, a defender report across a cutoff, anonymous and identified defender reports, bystanders, and election losses without an assigned spy. Replay the [existing Netherlands recording](../../../developers/vox-agents/newspaper/replay.md#historical-evidence-query-verification) around turn 216 for India (player 1) and the Ottomans (player 5) with the probe overlay. Check that recordings without matching rows still replay and that strategist results are unchanged.

For Stage 4c, use the [three Netherlands replay cases](../../../developers/vox-agents/newspaper/replay.md#replaying-front-reports-and-ship-launches). Automated checks cover missing or foreign zones, ambiguous creation IDs, missing purchase flags and bystanders with generic event visibility. Once Plan 5 delivers in-game issues, check Stage 4a roster access and Stage 4c reporting from a human seat without a strategist.

## Out of scope

- Shipping probes as stock stories: [Plan 4b](04b-story-mining.md). Shared styles: [Plan 4a](04a-styles.md).
- Spy names, ranks and mission assignments; gold amounts, stolen great works, coups and exact defender notifications; and ongoing foreign covert assignments.
- Complete national military rosters and new access grants, foreign tactical maps, individual unit names and movement histories, and city event coverage beyond recorded ship launches.
- Names for eras and beliefs in events, which are recorded as numbers.
- The list of technologies a player holds (only a count is captured), game year, World Congress resolutions.
- Stable keys such as `CIVILIZATION_HUNS`. The catalogue keeps matching recorded display names.
