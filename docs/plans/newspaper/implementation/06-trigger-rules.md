# Plan 6: trigger rules

**Handoff: war and peace facts now reach ordinary newspaper rules.** Two diplomacy overlays have fired on a recorded game. The stock catalogue still has two city rules and no story templates. Step 7 moves template and presentation conditions to expressions and starts after owner confirmation. See the [trigger overview](../../../developers/vox-agents/newspaper/triggers/overview.md) and [roadmap](../implementation.md).

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
| 7. Templates and other conditions | Move template, variant, weight, page and design conditions to expressions. Templates name `triggers`, read rule `values`, and gain subject names, IDs and period placeholders from visible facts. Remove `shared/conditions.ts` and `compositeOf`. | The example templates publish, and a variant with a false `when` is never chosen. |
| 8. Starting catalogue | Add the triggers from the examples page with full templates. | Each starting trigger fires in a test with controlled evidence, and a fresh replay of the Netherlands recording publishes issues from the new catalogue. |
| 9. Reading | Read the replay with the owner and tune constants and importance. | The owner accepts the starting set as a base for writing more rules. |

## Inputs for step 7

- Start in `editorial/config/` for catalogue validation and compilation, `editorial/selection/` for template eligibility, and `editorial/presentation/` for variants, designs, pages and layouts. Extend the existing QuickJS runner. Keep fact accessors under `editorial/facts/`, diplomacy inference under `editorial/diplomacy/`, and rule evaluation under `editorial/rules/`. Mirror these folders in tests.
- Replace the finite conditions in `editorial/shared/conditions.ts` and the old `triggerIds` and `compositeOf` catalogue fields. Migrate the shipped page and design choices and the controlled test overlays together. Preserve an unconditional front page and usable fallback layouts. Old catalogue formats and checkpoints need no migration.
- Give templates the rule's visible subject, names, IDs, period and scalar values. For a group, preserve the distinction between its key/count and the values belonging to each contributing subject. Keep cause diagnostics and raw evidence out of player-facing prose.
- Demonstrate with an overlay that an example produces an in-game story and a variant with a false condition cannot print. Keep one selected account per diplomatic incident. The 14 shipped stories and replay reading are steps 8 and 9.
- Preserve the existing DLL, recorder and event formats. City coordinates come from existing database rows. Map dimensions and wrap flags remain private to replay and never enter LLM input, rule facts or audits.

## War and peace verification

The [vassal and stalled-war rules](../../../developers/vox-agents/newspaper/triggers/examples.md#vassals-follow-their-master-to-war) are exercised as overlays. In the Mongolia recording (`mcp-server/archive/self-play/f585b17d-4b95-4fd3-9ecc-f5f6fc9983c7_1794756822470.db`), use receiver 2, the Zulus:

| Cutoff | Observed result |
| --- | --- |
| 126, then 127 | The score against Mongolia stayed between 44 and 52 over turns 116 through 126 and ended at 48. The stalled-war rule fired at importance 50 on 126 and was quiet on 127. |
| 403 | The declaration on Brazil drew in the Iroquois as a Zulu vassal. The 60 declaration calls produced one match with importance 80. The rule marked it urgent for Brazil (receiver 4) and ordinary for the Zulus. |

Use the [CLI replay](../../../developers/vox-agents/newspaper/replay.md#generate-examples-from-the-command-line) with either turn range, `--player 2 --every 1`, a fresh output path and a `--config` overlay containing the two rule definitions from the examples. Without a template, read the matches in `audit-<turn>.json`. To exercise publication, the automated rule tests supply templates and independently check that two accounts of the same incident compete while unrelated declarations can both print.

Each completed check saves dated pair memory and the rule audit, including a skipped issue. History covers the configured long span and the longest enabled rule window. A fresh run starting late can only reconstruct older transitions from the permitted evidence it loads. To follow a war from its outset, start at or before the declaration. Use new outputs: publication state is schema 5 and the offline SQLite store is version 4.

GPT-6.2-Sol implemented step 6, OpenCode prepared the overlay and author guides, and Claude Code Opus independently reviewed the changes and the fixes. The Vox Agents build passed, and all 403 newspaper tests passed across 46 files. The Windows test run used `--maxWorkers=2 --hookTimeout=90000` so the installed browser could finish closing. The recorded checks also passed with the reviewed code; their audits contained no map dimensions or wrap flags.

## Earlier replay checks

The built-in catalogue has two rules in `vox-agents/newspaper/triggers/cities.json` and no story templates. The controlled tests in `tests/mock/newspaper/editorial/rules/` use those shipped rules.

The Netherlands recording is `mcp-server/archive/self-play/0d749c4f-69a7-4682-81b3-8fa70f38c012_1794782175768.db`; the Dutch receiver is player 7. For a short [CLI replay](../../../developers/vox-agents/newspaper/replay.md#generate-examples-from-the-command-line), use `--player 7 --from 28 --to 30 --every 1` and a new output directory. On turn 28 Amsterdam's population had not fallen. On turn 29 it fell from five to four, trained a settler and had a food surplus of six. The audit records `lost: 1`, importance 40 and five source rows. Turn 30 records the existing match as a repeat. All three checks skip publication with the stock catalogue.

At turn 367, replay evaluated both rules for 74 visible cities. Mumbai changed from puppet to occupied, 20 tiles from the closest Dutch city. The built-in seven-tile neighbor limit stopped the rule at its first condition. An overlay setting `distances.neighboring` to 20 let it fire with importance 10 and five source rows.

The step 5 Inno Setup smoke build accepted an installation without a templates directory. Upgrades remove the 19 retired catalogue filenames and leave other JSON files in place.

The earlier stages established the QuickJS expression runner, MCP evidence and private map settings, city/player/event facts and the constants catalogue. Prior receiver checks on the same recording found that Germany could not see the Dutch Warrior trained in Amsterdam on turn 21. Raising the neighboring distance from seven to nine tiles brought Akkad and Bursa into range on turn 150. The [facts reference](../../../developers/vox-agents/newspaper/triggers/facts.md#evidence-the-facts-rely-on) describes recording limitations.

To repeat the automated check, build Vox Agents with `npm run build -w vox-agents`, then run `npm run test:mock -w vox-agents -- tests/mock/newspaper --maxWorkers=2`. Build MCP first if its compiled evidence contracts are missing.

After step 8, generate a fresh replay and read the resulting issues. Confirm each example has at least one audit showing a match or the condition that stopped it.
