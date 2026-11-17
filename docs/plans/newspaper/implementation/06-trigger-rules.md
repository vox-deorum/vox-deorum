# Plan 6: trigger rules

**Handoff: the expression runner, recorded evidence, city/player/event facts, constants and shortcuts are in place. Step 5, trigger evaluation, waits for owner confirmation.** Published issues still use the existing detectors and templates. See the [trigger overview](../../../developers/vox-agents/newspaper/triggers/overview.md) and [roadmap](../implementation.md).

## Goal

Replace the 32 fixed detectors with rules. A trigger becomes a JavaScript expression over a fact model, so a story such as "a neighboring foreign city changed from puppet to occupied" is a catalogue entry. Code supplies facts, including distance and other inferred facts. Gameplay value comes first: facts are inferred freely from the MCP server databases.

## Decisions

| Area | Decision |
| --- | --- |
| Expression language | JavaScript, run in QuickJS, for every condition: triggers, templates, variants, weights, pages and designs |
| Engine | Use QuickJS directly for newspaper expressions. The player workspace's `just-bash` runner provides shell services and starts a new script on each call. Newspaper rules need a reusable compiled catalogue and only the facts supplied by the editor. |
| Existing catalogue | Delete all legacy triggers and story templates in step 5. In step 8, write fresh headlines and bodies for the 14 documented examples. Tell the reader what happened in their world; keep rule outcomes and evidence diagnostics in the audit. |
| War and peace | The inference code stays and produces `incident` and `pair` facts. Its triggers become ordinary rules. |
| Compatibility | None for old trigger IDs, the `op`/`field`/`value` conditions, `compositeOf`, or saved publication checkpoints. Start fresh runs. |

## Build order

Use one numbered step per handoff. GPT-6.2-Sol implements the step, OpenCode handles bounded batch work, and Claude Code Opus reviews the step's diff in a fresh session. Return material findings to Sol and repeat verification and review. Record the verified result and next step here, do not stage changes, and wait for the owner's confirmation before starting the next step.

| Step | Work | Done when |
| --- | --- | --- |
| 5. Trigger evaluation | The new trigger schema, subject listing, ordered `when` evaluation, `values`, `importance`, `urgent`, `repeat` state, `group`, and the audit record. Remove `developments/` detectors and the detector dispatch. | The two owner examples, `neighbor-puppet-annexed` and `settler-departure`, fire on controlled evidence and stay silent when one `when` entry is false. |
| 6. War and peace facts | Reshape `diplomacy/` output into `incident` and `pair` facts and delete its trigger creation. The existing `resumed`, `observed` and `partial` stages become the flags of the same names, and the pair keeps its last wartime score as `lastWarScore`. | The documented incident and pair rules fire on the existing diplomacy test recordings. |
| 7. Templates and other conditions | Move template, variant, weight, page and design conditions to expressions. Templates name `triggers` and read `values`. Remove `shared/conditions.ts` and `compositeOf`. | The example templates publish, and a variant with a false `when` is never chosen. |
| 8. Starting catalogue | Add the triggers from the examples page with full templates. | Each starting trigger fires in a test with controlled evidence, and a fresh replay of the Netherlands recording publishes issues from the new catalogue. |
| 9. Reading | Read the replay with the owner and tune constants and importance. | The owner accepts the starting set as a base for writing more rules. |

## Inputs for step 5

- **Folder layout:** Put subject enumeration, ordered rule evaluation, repeats, grouping and audit construction under `vox-agents/src/newspaper/editorial/rules/`, with matching tests under `tests/mock/newspaper/editorial/rules/`. Keep schemas, overlays and expression preparation in `editorial/config/`, fact accessors in `editorial/facts/`, and database access in `newspaper/replay/`. Keep war and peace inference in `editorial/diplomacy/` for step 6.
- **Load once per catalogue:** `loadEditorialConfig` and `parseEditorialConfig` validate new and restored catalogues. When adding the new trigger schema, compile rules and shortcuts together with `prepareTriggerExpressions(rules, config.constants)` and retain the runner and slots in memory. Save the authored JSON. For each game, pass `scaleEditorialConstants(config.constants, speed.multiplier)` as the batch's `constants`; use `resolveEditorialSpan` for named or numeric windows and repeat intervals.
- **Read once per check:** Give `readReplayFacts` the scaled `long` and the longest enabled window. Share the returned model across rule groups. A group's exclusive `windowFromTurn` defaults to the previous check. It controls histories and event lists; the reporting period selects event subjects. The runner returns source rows and any hidden field per expression. Carry these into the audit, and stop evaluating a subject at the first failed condition.
- **Acceptance:** Replace the detector dispatch and remove the legacy trigger and story catalogues. Use the documented [neighbor annexation and settler departure examples](../../../developers/vox-agents/newspaper/triggers/examples.md) to test matches, nonmatches and audits. Fresh in-game headlines and bodies are step 8. Start a fresh replay; no old newspaper checkpoint or template compatibility is required.

Keep city positions and ownership tied to permitted database rows. Map dimensions and wrap flags stay private in replay and never go into rules, tool responses or LLM prompts. The DLL, event payloads and collection stay unchanged. The [facts reference](../../../developers/vox-agents/newspaper/triggers/facts.md#evidence-the-facts-rely-on) describes the limitations of older recordings.

## Verification

Step 4 is verified. GPT-6.2-Sol implemented the catalogue and runtime shortcuts. OpenCode checked packaging, updated the authoring guides and fixed the presentation fixture identified by Opus and the full test run. Claude Code Opus (`claude-opus-5-5`) found no material runtime defects and verified the corrected historical shortcut example. The Vox Agents build, including the reader and UI, passed. All 421 newspaper tests passed across 43 files. The installer includes `newspaper/constants.json` alongside the other catalogue files.

In the Netherlands recording below, receiver 7 on turn 150 could see Akkad (city 1258) and Bursa (city 1757), each nine tiles from the nearest Dutch city. The rule `city.is.neighbor` was false for both with the built-in seven-tile cutoff and true for both with `{"distances":{"neighboring":9}}` in an overlay. Both measurements cited the two city records. The built-in unit and building lists use names checked against this recording’s `UnitCreated` and `CityConstructed` events.

Step 3 is verified. GPT-6.2-Sol implemented the facts, OpenCode checked the layout and helped with projection and docs, and Claude Code Opus (`claude-opus-5-5`) independently reviewed the changes. The final review found no material issues in the revisions. All 98 MCP newspaper and private settings tests passed, including HTTP and stdio. The 411 Vox Agents newspaper tests passed across the full run and focused reruns: one layout test failed to load the export bridge during the full run and two browser suites timed out closing. The layout test and both teardown paths passed when rerun after the build. The MCP and Vox Agents builds and focused lint checks passed.

The read-only replay check used the Netherlands archive named below. At cutoff 21, previous check 20, the Dutch receiver saw the Warrior trained at Amsterdam; Germany did not. The Shrine appeared in the longer city building list, outside that reporting period. At turn 350 the Dutch receiver had 71 visible cities; at turn 439 it had 75. Both checks evaluated historical facts within the existing 64 MB QuickJS limit. The transport shares repeated citations and decodes records as needed. The fixture in `vox-agents/tests/mock/newspaper/replay/facts.test.ts` covers private wrap geometry and event windows through the same replay entry point.

Step 1 is verified. GPT-6.2-Sol implemented the runner, OpenCode checked the documentation, and the final Claude Code Opus review (`claude-opus-5-5`) found no material correctness defects. All 369 newspaper mock tests passed across 37 files, and the MCP build, Vox Agents type check, and newspaper build passed. For step 5, derive `TriggerExpressionFields` from the new trigger schema and connect `prepareTriggerExpressions` when the catalogue loads or is restored.

Step 2 is verified. GPT-6.2-Sol implemented the recorded evidence reads. OpenCode checked the stored fields and reference pages. Sol addressed the Opus findings on witnessed removals and repeated reads for old city observations. A fresh Claude Code Opus review (`claude-opus-5-5`) found no material correctness or disclosure issues. All 95 MCP newspaper and private settings tests passed, including HTTP and stdio. All 369 Vox Agents newspaper tests, the MCP build, Vox Agents type check and newspaper build passed. No live game was needed.

Step 2 was also checked against the Netherlands recording in `mcp-server/archive/self-play/0d749c4f-69a7-4682-81b3-8fa70f38c012_1794782175768.db`, opened read-only. With a previous check of 20, cutoff 21 and history start 10, player 7 saw Amsterdam train a Warrior at (66, 12), backed by the turn-20 city row and the turn-21 unit creation. The turn-12 Shrine appeared only in history. Player 0 saw neither event. The DLL, event recording and city collection were unchanged.

Step 1 measured 200 expressions over 100 subjects in one sandbox call on Node 22.23.3: 21.4 ms to compile the catalogue, 84.7 ms for the first check and 55.5 ms median across five more checks. This measures expression evaluation on supplied facts. It excludes database reads and issue selection. To repeat it in PowerShell:

```powershell
$env:VD_EXPRESSION_BENCHMARK = '1'
npm run test:mock -w vox-agents -- tests/mock/newspaper/editorial/expression-batch.test.ts --silent=false
```

```sh
npm run build -w mcp-server
npm run test:mock -w mcp-server -- tests/newspaper
npm run test:mock -w vox-agents -- tests/mock/newspaper
npm run type-check -w vox-agents
npm run build:newspaper -w vox-agents
```

After step 8, generate a fresh replay with the [replay CLI](../../../developers/vox-agents/newspaper/replay.md#generate-examples-from-the-command-line) and confirm each example trigger appears in at least one audit, either firing or stopping at a named `when` entry.

When each step lands, remove the "target design" status line from the developer pages it completes and delete the finished row from this plan.
