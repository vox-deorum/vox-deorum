# Plan 6: trigger rules

**Handoff: the stock catalogue publishes all 14 starting stories.** Step 9 is a reading session with the owner. Wait for confirmation before tuning. The [author examples](../../../developers/vox-agents/newspaper/triggers/examples.md) show how local and national happiness give the same news a different voice.

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

## Step 8: starting catalogue

The city, national and foreign desks each have a rule file in `vox-agents/newspaper/triggers/` and a matching story file in `templates/`. Rules decide what happened. Template variants choose what the paper says about it. A damaged city running short of food gets a report on its stores; the rule alone cannot tell the editor who damaged it. Tests in `tests/mock/newspaper/editorial/rules/*-desk.test.ts` exercise all 14 stories with controlled evidence.

The [settler example](../../../developers/vox-agents/newspaper/triggers/examples.md#a-city-shrinks-after-sending-settlers) reads the reporting city's current net happiness. A negative city balance gives a critical local account, a positive balance a hopeful one, and zero or missing detail a straight report. The [wartime Golden Age example](../../../developers/vox-agents/newspaper/triggers/examples.md#national-affairs) reads the receiving nation's happiness: below 35% the editorial questions the government's case for celebration; above 50% it gives the government credit. The middle band and missing data get straight news. Changing the tone leaves the underlying story and its importance intact.

## Reading copies for step 9

Use the [replay CLI](../../../developers/vox-agents/newspaper/replay.md#generate-examples-from-the-command-line) with the Netherlands recording, `mcp-server/archive/self-play/0d749c4f-69a7-4682-81b3-8fa70f38c012_1794782175768.db`. Omit `--config` to use the stock catalogue. Supply a new `--output` directory. These runs can be regenerated after compaction:

| Receiver and turns | What to read |
| --- | --- |
| Netherlands (7), `--from 24 --to 99 --every 5 --render-turns 29` | Seven editions, ten articles and nine quiet checks. Amsterdam sends settlers at turn 29 with local happiness +10. Rotterdam outgrows Amsterdam at 69. At turn 59 several nations draw level in research; read the headlines together when judging repetition. |
| Netherlands (7), turn 112; Austria (4), turn 125 | The settler story runs straight in Utrecht at zero local happiness. It questions expansion in Salzburg at -5. For a single edition, set both `--from` and `--to` to the turn and use `--every 1`. |
| Netherlands (7), turns 308 and 417, separately | Wartime Golden Age coverage runs straight at 47% national happiness and supports the government at 100%. The tests cover the critical national voice as well. |

The reading copies are in `.tmp/stage8-reading/{early,utrecht,salzburg,middle,high}/`. Open each directory's `index.html`. The five stock runs produced 11 issues and 18 articles in 20 checks. Every rule appeared in the audits. The issue text contained no unresolved placeholders, the decisions contained no choice errors, and the JSON exposed no map dimensions or wrap flags. An Inno Setup smoke build packaged the three rule files and three template files.

GPT-6.2-Sol implemented the catalogue and revisions. OpenCode updated existing fixtures and guides. Claude Code Opus independently reviewed the integrated change and found no material defects. The Vox Agents build and all 456 newspaper tests passed. The five happiness readings above were checked against the recorded city or player summaries; the issue audits show the selected variants.

## Next stage and guardrails

Read the editions with the owner. Start with the three research headlines at turn 59 and the list of 13 wartime opponents at turn 308. Ask which details deserve space and whether the voices fit the newspaper. Adjust constants and importance with that feedback. Acceptance is the owner's judgment that these stories are a base for writing more. Use GPT-6.2-Sol for implementation, OpenCode for batch work and fresh Claude Code Opus for review; document the result and pause. Never stage changes.

Keep fact accessors in `editorial/facts/`, diplomatic inference in `editorial/diplomacy/`, and rule evaluation in `editorial/rules/`. Preserve the DLL, recorder and event formats. City positions come from existing database rows. Map dimensions and wrap flags stay private to replay. Publication state is schema 6, the offline store is version 5 and IssueDocument is version 2.

## Earlier verification

- **Rules and visibility:** At Dutch turn 29 Amsterdam fell from five to four population, trained a settler and had a food surplus of six. A German reader could not see the Dutch Warrior trained there on turn 21. At turn 367 Mumbai was 20 tiles from the nearest Dutch city, outside the stock seven-tile neighboring radius.
- **Diplomatic history:** In the Mongolia recording (`mcp-server/archive/self-play/f585b17d-4b95-4fd3-9ecc-f5f6fc9983c7_1794756822470.db`), the Zulu stalled-war story qualified at turn 126. At turn 403 sixty declarations against Brazil made one incident involving an Iroquois vassal. Only the targeted receiver got an urgent alert.
- **Selection:** Step 7's trial settler story published at turn 29 even against a famine variant with a weight of one million: the famine condition was false. An annexation overlay with the wider radius published Mumbai's story at 367. Neither overlay is needed for the stock reading runs above.

Build Vox Agents with `npm run build -w vox-agents`, then run `npm run test:mock -w vox-agents -- tests/mock/newspaper --maxWorkers=2 --hookTimeout=90000`. Finish building before running browser tests, which read the compiled assets.
