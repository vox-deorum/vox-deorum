# Plan 6: trigger rules

**Handoff: replay now evaluates the two shipped city rules and saves their audits.** The old detectors and story templates have been removed. A stock replay can record a development without printing an issue. Step 6 exposes war and peace facts and starts after owner confirmation. See the [trigger overview](../../../developers/vox-agents/newspaper/triggers/overview.md) and [roadmap](../implementation.md).

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
| 6. War and peace facts | Expose the existing diplomacy inference as `incident` and `pair` facts. The existing `resumed`, `observed` and `partial` stages become the flags of the same names, and the pair keeps its last wartime score as `lastWarScore`. | The documented incident and pair rules fire on the existing diplomacy test recordings. |
| 7. Templates and other conditions | Move template, variant, weight, page and design conditions to expressions. Templates name `triggers`, read rule `values`, and gain subject names, IDs and period placeholders from visible facts. Remove `shared/conditions.ts` and `compositeOf`. | The example templates publish, and a variant with a false `when` is never chosen. |
| 8. Starting catalogue | Add the triggers from the examples page with full templates. | Each starting trigger fires in a test with controlled evidence, and a fresh replay of the Netherlands recording publishes issues from the new catalogue. |
| 9. Reading | Read the replay with the owner and tune constants and importance. | The owner accepts the starting set as a base for writing more rules. |

## Inputs for step 6

- Follow the [war and peace reference](../../../developers/vox-agents/newspaper/triggers/war-and-peace.md) and the [incident and pair examples](../../../developers/vox-agents/newspaper/triggers/examples.md). Use the existing `DeclareWar`, `MakePeace` and visible relationship rows. City coordinates come from recorded city rows. The DLL, event formats and collection stay unchanged. Map dimensions and wrap flags stay private to replay.
- Keep inference in `editorial/diplomacy/`. Its `inferWarAndPeace` updates pair memory and returns an inspector audit on every check, including skipped ones. It no longer makes triggers. Preserve participant roles, causes, ownership of source rows, reporting dates, and gaps when exposing that information to rules.
- Build the new fact accessors under `editorial/facts/`; put model and visibility tests under `tests/mock/newspaper/editorial/facts/`. Subject enumeration, repeats, grouping and auditing belong in `editorial/rules/`, with matching tests. Standalone database reads stay in `replay/`. `rules/subjects.ts` currently returns no pairs or incidents.
- A transition currently clears pair score samples, and inference retains 30 Standard turns. Carry the last wartime score into peace and keep enough evidence for the configured `long` window (40 Standard turns by default). Preserve the direction of scores and require visible observations across a claimed continuous span. A skipped issue or a resumed run must yield the same facts as uninterrupted play.
- Run the documented vassal and stalled-war rules over the existing diplomacy fixtures. Give every story about the same incident a shared selection conflict key while keeping follow-up series specific to each rule and subject. Confirm that unrelated declarations stay separate, missing scores stay hidden, and incident subjects use the reporting period even when the rule requests a longer history. Leave template conditions to step 7 and shipped prose to step 8.

## Verification and replay

The built-in catalogue has two rules in `vox-agents/newspaper/triggers/cities.json` and no story templates. The controlled tests in `tests/mock/newspaper/editorial/rules/` use those shipped rules. Start a fresh replay output: publication state is schema 4 and the offline SQLite store is version 3. Older newspaper outputs remain unchanged; choose a different output path for new runs.

The Netherlands recording is `mcp-server/archive/self-play/0d749c4f-69a7-4682-81b3-8fa70f38c012_1794782175768.db`; the Dutch receiver is player 7. For a short [CLI replay](../../../developers/vox-agents/newspaper/replay.md#generate-examples-from-the-command-line), use `--player 7 --from 28 --to 30 --every 1` and a new output directory. On turn 28 Amsterdam's population had not fallen. On turn 29 it fell from five to four, trained a settler and had a food surplus of six. The audit records `lost: 1`, importance 40 and five source rows. Turn 30 records the existing match as a repeat. All three checks skip publication with the stock catalogue.

At turn 367, replay evaluated both rules for 74 visible cities. Mumbai changed from puppet to occupied, 20 tiles from the closest Dutch city. The built-in seven-tile neighbor limit stopped the rule at its first condition. An overlay setting `distances.neighboring` to 20 let it fire with importance 10 and five source rows.

GPT-6.2-Sol implemented the stage, OpenCode updated fixtures and author guides, and Claude Code Opus independently reviewed the changes. The Vox Agents build and all 384 newspaper tests across 43 files passed. An Inno Setup smoke build accepted an installation without a templates directory. Upgrades remove the 19 retired catalogue filenames and leave other JSON files in place.

The earlier stages established the QuickJS expression runner, MCP evidence and private map settings, city/player/event facts and the constants catalogue. Prior receiver checks on the same recording found that Germany could not see the Dutch Warrior trained in Amsterdam on turn 21. Raising the neighboring distance from seven to nine tiles brought Akkad and Bursa into range on turn 150. The [facts reference](../../../developers/vox-agents/newspaper/triggers/facts.md#evidence-the-facts-rely-on) describes recording limitations.

To repeat the automated check, build Vox Agents with `npm run build -w vox-agents`, then run `npm run test:mock -w vox-agents -- tests/mock/newspaper --maxWorkers=2`. Build MCP first if its compiled evidence contracts are missing.

After step 8, generate a fresh replay and read the resulting issues. Confirm each example has at least one audit showing a match or the condition that stopped it.
