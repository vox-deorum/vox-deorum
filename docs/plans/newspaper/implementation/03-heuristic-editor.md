# Plan 3: heuristic newspaper and publication state

**Status: draft.** For developers connecting Plan 2's evidence to Plan 1's reader. See the [roadmap](../implementation.md) for dependencies.

## Goal and success criteria

Generate useful issues without an LLM, with authored prose, continuing series, merged installments, short pieces, adaptive pages, and feedback that affects later coverage. A reader can advance a replay, vote, stop, and resume with the same published history and choices.

## Current state

The [specification](../spec.md) defines editorial behavior and the initial subject families. The renderer and evidence adapter are outputs of Plans 1 and 2. Existing `seedrandom`, Zod, and SQLite dependencies cover deterministic choices, configuration validation, and a local publication store. There is no existing newspaper editor to extend.

## Approach and contracts

Keep the editorial pipeline in proposed `vox-agents/src/newspaper/`, separate from rendering and transport. Store the built-in authored catalogue in a proposed `vox-agents/newspaper-catalogue/` directory, which the installer's existing `vox-agents` rule ships. `vox-agents/configs/` stays reserved for strategist run configurations. One bounded configuration vocabulary covers conditions and weights; trigger definitions choose supported detectors and numeric parameters. Additional detector behavior requires code, while normal threshold, prose, style, and selection tuning stays in JSON.

| Proposed contract | Contents |
| --- | --- |
| Editorial configuration | Version, publication interval/speed scaling, detectors, conditions, thresholds, templates and authored/composite variants, tags, pages, design/layout definitions, decay, vote effects, and selection limits. |
| Candidate | Supporting observation/trigger IDs, subject and series keys, contributing templates, importance, tags, eligible writing variants, novelty, and priority. |
| `PublicationState` | Last completed check, committed issues, series importance and evaluation turn, current votes, preferences, prior design choice, and stored decision records. |
| Check result | Either a published immutable `IssueDocument` plus state changes, or a skipped check with its reason and updated cursor/decay state. |
| Decision record | Configuration snapshot/hash, seed, selected variants/design/layouts, candidate scores, merge decisions, evidence references, and the feedback revision/corpus/coefficients used. |

Use canonical keys such as `civilization/{id}/culture`, `trade/{originId}/{partnerId}`, and `place/{foundingEpisode}/growth`, scoped by campaign and receiver. Templates name the series family and bind its IDs from evidence. A capture only preserves a place key when Plan 2 established continuity.

## Ordered implementation

1. **Validate configuration.** Add `config.ts`, `conditions.ts`, and `weights.ts`. Resolve a configured directory over built-in defaults, following the repository's configuration conventions. Use a finite set of condition operators, including all/any/not composition. Preserve unknown values through negation: a missing technology history does not satisfy either a researched or a not-yet-researched condition. An element is eligible only when its full condition evaluates true. A nonpositive final weight makes an otherwise eligible choice unavailable. Validate all template, page, asset, and renderer references together.

2. **Detect and match developments.** Add `triggers.ts` and `templates.ts`. Start with domestic city contrasts, own foreign-route gold concentration, known foreign cultural development, and war declared against the receiver. The war detector reads the recorded `DeclareWar` event and marks its candidate urgent. Derive trigger and candidate importance from measured changes on a configured bounded scale. Before heuristic scoring, exclude LLM-only templates and candidates without an eligible authored variant. Add a small number of supported diplomatic/recovery detectors only where selected evidence permits useful combinations. Track the difference between newly relevant developments and unchanged repeats; skipped editions discard their candidates while longer comparison history remains available.

3. **Select stories and maintain series.** Add `series.ts` and `heuristic-editor.ts`. Decay importance by elapsed turns exactly once, then score candidates using importance, series history, novelty, variety, and votes. Merge only authored combinations with compatible subjects/periods and an available composite variant. Use the maximum contributing candidate importance as the merged item's importance and the deduplicated union of their relevant tags. Otherwise resolve shared-series conflicts by selection weight. A multi-series item occupies every contributing series slot and adds its final importance once per series, even if displayed on several pages.

4. **Choose prose and presentation.** Use weighted random selection seeded by campaign, receiver, cutoff, and recorded configuration. Separate random streams for prose and presentation so a layout change does not accidentally alter all wording. Render authored placeholders into structured text and typed links. Select the design using eligibility and stickiness, then choose layouts and page membership. An issue covering a declaration of war against the receiver must lead with that threat and use an eligible breaking-news front-page layout; weights choose among suitable breaking layouts. Require every eligible design to support that arrangement. Threat priority, a mixed front page, section minimums, and one canonical item per series are validated before publication.

5. **Add a usable initial catalogue.** Provide authored variants and a composite for each selected example, short pieces, and at least one broadly eligible design for incomplete unlock histories and early eras. JSON designs select supported renderer families, font/asset references, visual tokens, and layout arrangements. Start with the two proof designs plus a simple early account; Plan 4 broadens civilization/era coverage. A missing eligible variant drops that candidate; an empty selection skips publication.

6. **Persist checks and feedback.** Add `store.ts` using a versioned SQLite database separate from recordings. This store owns offline runs only. Expose load-state, commit-check, set-vote, and list/get-issue operations so Plan 5 can use the same editorial pipeline with the game-owned checkpoint and MCP mirror. Commit each offline check's issue or skip, cursor, series state, and decisions atomically. Make the check identity unique within a replay branch so rerunning a completed cutoff cannot publish twice. Store article evidence summaries, sources, and contributing templates alongside the immutable article content.

7. **Connect read, vote, continue, and resume.** Extend `http.ts` and the browser host with issue listing, retrieval, current vote assignment, and advancing one replay check. Scope all operations by run/receiver. Setting the same vote twice has no extra effect; changing or clearing it replaces its contribution. Apply the feedback rule below and store the resolved preferences with each check. A page duplicate must not multiply either feedback or history.

## Feedback and preferences

An item's current vote is -1, 0, or +1. Feedback is recomputed from current votes at each check, so replacing or clearing a vote removes its earlier contribution exactly. Votes are not multiplied by article importance.

| Adjustment | Rule |
| --- | --- |
| Series | Sum the current votes on all unique items carrying the key, then multiply by the stronger configured series coefficient. Series votes do not expire; the series' own importance already fades, and the player can change or clear a vote. Plan 4 tuning revisits this choice. |
| Tag window | The most recent configured number of unique published items in this receiver's campaign branch, including unrated items. Start with 50. |
| Tag distinctiveness | If the window holds N items and a tag appears on df of them, its distinctiveness is `1 + ln((N + 1) / (df + 1))`. |
| Tag bonus | For each window item carrying the tag, take its vote divided by its number of distinct tags. Sum these values, then multiply by the tag's distinctiveness and the weaker configured tag coefficient. |
| Candidate tag adjustment | The mean of the bonuses for the candidate's tags. |
| Combined | Bound the series and tag adjustments together through configuration. Urgent priority applies independently. |

Each decision record stores the window's item IDs, current vote values, tag counts and coefficients, and resulting adjustments. This makes a changed selection explainable without reconstructing old feedback from today's state.

**Campaign preferences** contain publication frequency in Standard-equivalent turns and whether LLM use is enabled. Defaults are five turns with LLM use disabled until configured. Built-in defaults are overridden by configured defaults, which are overridden by saved receiver preferences.

- Game-speed factors resolve frequency to an integer interval of at least one turn.
- A frequency change schedules the next check from the last completed check and leaves previous issues unchanged.
- Starting a comparison with different editor modes creates explicit run branches. Changing editor mode during an existing run updates that run's preferences and keeps its history.
- When a live campaign loads, its saved preferences apply again.

## Editorial rules to preserve

The reporting period begins after the previous completed check, including a skipped check. Series memory spans periods. Reopening an issue never regenerates its prose or reruns selection. Changing a vote affects future checks, while earlier issues and choices remain intact.

Issue pages refer to shared item records. A story on the front page and an economics page has one vote and one series contribution. A fresh urgent threat receives priority even if its tags have low reader weights. Selection still keeps a mix of subjects and useful short pieces.

## Verification

Use controlled evidence fixtures to check multi-trigger matching, composite importance/tag aggregation, series conflicts, elapsed-turn decay, return after a quiet interval, urgent war prominence and breaking layout, page duplication, negation of unknown conditions, pre-Writing eligibility, design stickiness, skipped periods, idempotent publication, and vote replacement/clearing. Check that rare tags move more than common tags under controlled votes, and that LLM-only templates never reach heuristic selection. Tests should check decisions and data flow rather than exact authored sentences.

Run focused newspaper Vitest tests, `npm run type-check -w vox-agents`, and the reader type check/build. Exercise a recorded replay end to end, stop between checks, resume, and inspect saved decisions. Verify the database transaction cannot leave an issue committed without its series/cursor update. Run root build/test commands before handing this stage to offline evaluation.

## Risks and open questions

Thresholds, decay, novelty penalties, tag-window length, vote strength, and content minimums are tuning values. Start from explicit JSON defaults and revise them through Plan 4. A structurally correct issue can still read poorly; useful coverage needs human reading alongside automated checks.

## Out of scope

Runtime LLM writing, a complete template catalogue, live generation, game-save storage, and richer media.
