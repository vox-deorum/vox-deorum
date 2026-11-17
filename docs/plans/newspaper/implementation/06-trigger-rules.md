# Plan 6: trigger rules

**Handoff: steps 1 and 2 supply the expression runner and the recorded evidence it will use. Step 3, building the fact model, waits for owner confirmation.** The [facts reference](../../../developers/vox-agents/newspaper/triggers/facts.md) describes the target facts. Published issues still use the existing detectors and templates. See the [trigger overview](../../../developers/vox-agents/newspaper/triggers/overview.md) for the runner contract and the [roadmap](../implementation.md) for the other newspaper plans.

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
| 3. Fact model (paused) | Builders under `editorial/facts/` for `city`, `player`, `event` and the globals, with hex distance, snapshots (`before`, `previous`, `at`, `history`), hidden-fact handling and source references. | Tests cover each inferred fact with a present value, a hidden value and a first observation. |
| 4. Constants and shortcuts | `vox-agents/newspaper/constants.json`, its schema, overlay merging, game-speed scaling of spans, and `is.<name>` shortcuts. | A constant overridden in an overlay changes the outcome of a rule that uses it. |
| 5. Trigger evaluation | The new trigger schema, subject listing, ordered `when` evaluation, `values`, `importance`, `urgent`, `repeat` state, `group`, and the audit record. Remove `developments/` detectors and the detector dispatch. | The two owner examples, `neighbor-puppet-annexed` and `settler-departure`, fire on controlled evidence and stay silent when one `when` entry is false. |
| 6. War and peace facts | Reshape `diplomacy/` output into `incident` and `pair` facts and delete its trigger creation. The existing `resumed`, `observed` and `partial` stages become the flags of the same names, and the pair keeps its last wartime score as `lastWarScore`. | The documented incident and pair rules fire on the existing diplomacy test recordings. |
| 7. Templates and other conditions | Move template, variant, weight, page and design conditions to expressions. Templates name `triggers` and read `values`. Remove `shared/conditions.ts` and `compositeOf`. | The example templates publish, and a variant with a false `when` is never chosen. |
| 8. Starting catalogue | Add the triggers from the examples page with full templates. | Each starting trigger fires in a test with controlled evidence, and a fresh replay of the Netherlands recording publishes issues from the new catalogue. |
| 9. Reading | Read the replay with the owner and tune constants and importance. | The owner accepts the starting set as a base for writing more rules. |

## Open points

| Question | How to settle it |
| --- | --- |
| How will rules read inferred and hidden facts? | Step 1 passes JSON data into a fresh sandbox per check. Step 3 must build the guest-side accessors for history, hidden facts and source tracking. Step 5 must use those accessors for ordered rule evaluation and audits. |
| How is map geometry kept for wrap-aware distance? | The settings tool records `mapWidth`, `mapHeight`, `mapWrapX` and `mapWrapY` as internal metadata for the active knowledge store, and hides them from tool responses and `get-metadata`. A future distance builder can read this geometry internally. Validate a stored value before using it, otherwise use unwrapped distance. |
| Which unit and building names go into the type lists? | Take them from the Netherlands recording's `UnitCreated` and `CityConstructed` events in step 4. |

## Inputs for step 3

Use the same read-only newspaper query for replay and MCP. Pass `historyFromTurn` as the cutoff minus the larger of the longest enabled trigger window and `long`, in recorded turns, clamped at -1. The query extends history to the previous check if that was earlier. For example, with a cutoff of 21, a previous check of 20 and a history start of 10, the ordinary event list covers turn 21. History covers turns 11 through 21 and has a separate baseline at or before 10. A start of -1 includes events on turn zero.

Build snapshots from the baseline and dated rows. Stop carrying a value at a visibility gap or known city removal. Read joined values and their `relatedSources` from the evidence; a missing position, unit name or owner is unknown. Preserve both recorded founding event names. `UnitCityFounded` is the founding event present in the Netherlands recording. A positive Golden Age award can extend an existing age. See the [evidence reference](../../../developers/vox-agents/newspaper/triggers/facts.md#evidence-the-facts-rely-on) for field access. Snapshot history uses the original subject key; when an archive reuses a city ID, confirm the plot and owner before assuming continuity. Player identities, diplomacy and settings have separate sources; only expose fields the receiver can see. Read wrap geometry internally for distance and keep it out of tool results and prompts.

## Verification

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
