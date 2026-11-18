# Plan 6: trigger rules

**Handoff: templates and presentation now use expressions.** Two overlay stories published on the Netherlands recording. The stock catalogue still has two city rules and no story templates. Step 8 adds the starting catalogue and requires owner confirmation. See [editorial authoring](../../../developers/vox-agents/newspaper/editorial.md#catalogue-and-eligibility) and the [roadmap](../implementation.md).

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
| 8. Starting catalogue | Add the triggers from the examples page with full templates. | Each starting trigger fires in a test with controlled evidence, and a fresh replay of the Netherlands recording publishes issues from the new catalogue. |
| 9. Reading | Read the replay with the owner and tune constants and importance. | The owner accepts the starting set as a base for writing more rules. |

## Inputs for step 8

1. Use the fourteen [worked triggers](../../../developers/vox-agents/newspaper/triggers/examples.md) as the checklist. Two city rules already ship; the vassal and stalled-war rules have been verified as overlays. Add the other twelve rules and write headlines and full newspaper copy for all fourteen. Group catalogue files by topic under `vox-agents/newspaper/triggers/` and `templates/`.
2. Write from what a reader in that world could know. Use a visible subject name, show what changed, and explain why it matters when the facts support it. A population point is not one individual. A grouped headline can use the group's key and count; a member's value belongs to that member. Keep rule diagnostics in the inspector.
3. Exercise each rule against controlled evidence, then run the Netherlands recording with a fresh output path. Check the text as well as the audits: placeholders must resolve, links must point to the intended subject, and incident alternatives must compete for one place. Stop for confirmation before the reading and tuning session in step 9.
4. Keep fact accessors in `editorial/facts/`, war and peace inference in `editorial/diplomacy/`, and rule evaluation in `editorial/rules/`. Tests mirror those folders. Preserve the DLL, recorder and event formats. Read city coordinates from existing database rows. Map dimensions and wrap flags remain private to replay and never enter LLM input, rule facts or audits.

## Template verification

The [settler example](../../../developers/vox-agents/newspaper/triggers/examples.md#a-city-shrinks-after-sending-settlers) gives a copyable overlay. The Stage 7 check used the Netherlands recording named below, player 7, `--every 1`, and two templates:

| Recorded turns | Result |
| --- | --- |
| 28 to 30 | Turn 29 published **Families leave Amsterdam for new lands**. The settlement variant required `lost >= 1`. A rival famine variant with `when: "false"` and a weight of one million stayed out. Turns 28 and 30 skipped publication. |
| 367 | With `distances.neighboring` raised to 20 for this test, **Mumbai loses its puppet government** printed from the other shipped rule. The story drew its city and owner names from visible facts. The stock limit remains seven tiles. |

The local overlay is in `.tmp/stage7-overlay/`. To repeat either check, pass that directory with CLI `--config` and use a fresh output directory. If the scratch files are gone, use the guide's settler example; for Mumbai, add a template naming `neighbor-puppet-annexed` and use the distance override above. Publication state is schema 6 and the offline SQLite store is version 5. Older outputs are refused without modification; the reader still uses IssueDocument schema 2.

The Vox Agents build passed, followed by all 422 newspaper tests across 47 files. On Windows, finish the build before running the browser tests, which read the built reader assets. The two recorded articles each retained five source rows and neither audit reported a choice error. No replay JSON contained map dimensions or wrap flags. Local reading copies are in `.tmp/stage7-final-settlers/` and `.tmp/stage7-final-mumbai/`.

GPT-6.2-Sol implemented the stage and addressed Opus's findings on grouped counts, interrupted weights and audit diagnostics. OpenCode migrated catalogue fixtures and updated the guides. Claude Code Opus reviewed the integrated changes and the final diagnostic fix, with no material findings left. Step 7 is complete.

## War and peace verification

The [vassal and stalled-war rules](../../../developers/vox-agents/newspaper/triggers/examples.md#vassals-follow-their-master-to-war) are exercised as overlays. In the Mongolia recording (`mcp-server/archive/self-play/f585b17d-4b95-4fd3-9ecc-f5f6fc9983c7_1794756822470.db`), use receiver 2, the Zulus:

| Cutoff | Observed result |
| --- | --- |
| 126, then 127 | The score against Mongolia stayed between 44 and 52 over turns 116 through 126 and ended at 48. The stalled-war rule fired at importance 50 on 126 and was quiet on 127. |
| 403 | The declaration on Brazil drew in the Iroquois as a Zulu vassal. The 60 declaration calls produced one match with importance 80. The rule marked it urgent for Brazil (receiver 4) and ordinary for the Zulus. |

Use the [CLI replay](../../../developers/vox-agents/newspaper/replay.md#generate-examples-from-the-command-line) with either turn range, `--player 2 --every 1`, a fresh output path and a `--config` overlay containing the two rule definitions from the examples. Without a template, read the matches in `audit-<turn>.json`. To exercise publication, the automated rule tests supply templates and independently check that two accounts of the same incident compete while unrelated declarations can both print.

Each completed check saves dated pair memory and the rule audit, including a skipped issue. History covers the configured long span and the longest enabled rule window. A fresh run starting late can only reconstruct older transitions from the permitted evidence it loads. To follow a war from its outset, start at or before the declaration.

GPT-6.2-Sol implemented step 6, OpenCode prepared the overlay and author guides, and Claude Code Opus independently reviewed the changes and the fixes. The Vox Agents build passed, and all 403 newspaper tests passed across 46 files. The Windows test run used `--maxWorkers=2 --hookTimeout=90000` so the installed browser could finish closing. The recorded checks also passed with the reviewed code; their audits contained no map dimensions or wrap flags.

## Earlier replay checks

The built-in catalogue has two rules in `vox-agents/newspaper/triggers/cities.json` and no story templates. The controlled tests in `tests/mock/newspaper/editorial/rules/` use those shipped rules.

The Netherlands recording is `mcp-server/archive/self-play/0d749c4f-69a7-4682-81b3-8fa70f38c012_1794782175768.db`; the Dutch receiver is player 7. For a short [CLI replay](../../../developers/vox-agents/newspaper/replay.md#generate-examples-from-the-command-line), use `--player 7 --from 28 --to 30 --every 1` and a new output directory. On turn 28 Amsterdam's population had not fallen. On turn 29 it fell from five to four, trained a settler and had a food surplus of six. The audit records `lost: 1`, importance 40 and five source rows. Turn 30 records the existing match as a repeat. All three checks skip publication with the stock catalogue.

At turn 367, replay evaluated both rules for 74 visible cities. Mumbai changed from puppet to occupied, 20 tiles from the closest Dutch city. The built-in seven-tile neighbor limit stopped the rule at its first condition. An overlay setting `distances.neighboring` to 20 let it fire with importance 10 and five source rows.

The step 5 Inno Setup smoke build accepted an installation without a templates directory. Upgrades remove the 19 retired catalogue filenames and leave other JSON files in place.

The earlier stages established the QuickJS expression runner, MCP evidence and private map settings, city/player/event facts and the constants catalogue. Prior receiver checks on the same recording found that Germany could not see the Dutch Warrior trained in Amsterdam on turn 21. Raising the neighboring distance from seven to nine tiles brought Akkad and Bursa into range on turn 150. The [facts reference](../../../developers/vox-agents/newspaper/triggers/facts.md#evidence-the-facts-rely-on) describes recording limitations.

To repeat the automated check, build Vox Agents with `npm run build -w vox-agents`, then run `npm run test:mock -w vox-agents -- tests/mock/newspaper --maxWorkers=2`. Build MCP first if its compiled evidence contracts are missing.

After step 8, generate a fresh replay and read the resulting issues. Confirm each example has at least one audit showing a match or the condition that stopped it.
