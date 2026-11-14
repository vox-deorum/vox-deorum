# Plan 4: offline reader, LLM editor, and evaluation

**Status: draft.** For developers completing the offline experience after Plans 1 to 3. This is the editorial quality gate in the [roadmap](../implementation.md).

## Goal and success criteria

Both editors produce useful issues from the same permitted evidence. The browser reader supports an archive, series navigation, reversible votes, and resuming replay. Demonstrate a series starting, continuing, fading, and returning; a merged installment; useful short pieces; and continuity across editor-mode changes.

## Current state

Plan 3 supplies the heuristic editor, state store, and initial catalogue. `vox-agents/src/infra/vox-agent.ts` and `utils/models/models.ts` establish agent/model conventions; `utils/prompts/prompt-files.ts` supplies Mustache prompts. The newspaper must consume prepared evidence without obtaining unrestricted live knowledge through the normal strategist tool set.

The [design principles](../design-principles.md) and local prototypes cover five visual directions. [Recorded-data research](../research/research-data.md) lists demonstrations that remain unverified in actual recordings.

## Approach

Add an LLM editor behind the same editorial input/output boundary as the heuristic editor. The model proposes selection, merges, prose, and ad hoc angles; deterministic validation enforces issue contracts, permitted subjects, evidence references, and series rules before publication. Retain authored fallback at item level and whole-editor failure boundaries.

Use the existing provider selection, cancellation, token accounting, and prompt-file conventions. A newspaper evaluation context should have only its explicit input and constrained completion/output mechanism. Obtain that input through MCP during VD use or Plan 2's direct database queries for standalone evaluation. Verify the chosen invocation path supports standalone use before wiring it into the evaluation runner.

## Ordered implementation

1. **Implement constrained editorial proposals.** Add `llm-editor.ts` and `prompts/newspaper-editor.md`. Supply projected evidence, eligible templates/variants, candidate weights, shared series grammar, prior published installments, feedback, and eligible presentation choices. Bound history by relevant series and the configured context budget. Give each proposal its supporting trigger/evidence IDs and typed subject links. Allow ad hoc items only from supplied evidence and recognized subject identities. Existing candidates retain their computed importance; merged items use Plan 3's maximum rule. Clamp an ad hoc proposal to the configured importance range and the highest importance of its supporting triggers. Validate tags against the shared vocabulary and cited subjects/angles.

2. **Validate and fall back.** Add `validate-issue.ts` shared by both editors. Check references, required fields, allowed pages/designs/layouts, one item per series, canonical keys, shared-item identity, and reading-length limits. Validate reported structured quantities against supplied measures. These checks establish traceability, not proof that every natural-language claim is entailed; use claim inspection during evaluation. For invalid or failed items, use eligible authored variants where possible, otherwise drop them. If the editor call fails entirely, run the heuristic editor on the same pre-check state. Commit only the final accepted issue or skip.

3. **Finish archive and reader navigation.** Extend `store.ts`, `http.ts`, and the browser host with bounded archive queries by date, page, civilization, and city. Open past items at their saved page and scroll target. Show series history through descriptive article links. Keep replay controls, evidence inspection, and the archive outside the publication design. An item displayed on multiple pages retains its shared vote.

4. **Broaden visual and authored coverage.** Promote the remaining selected prototype identities with their font licenses and bounded assets. Add ordinary, breaking, and analysis layouts where missing, and enough era variants to demonstrate early/late voices and gradual design transitions. Cover the pre-Writing oral stage plus the seven named research milestones in the spec; Telecommunications needs no separate publication stage. Reuse suitable design families and assets across stages. Functional coverage takes priority over distinct new artwork: reduce optional assets to stay within the proposed installation budget, and present measured alternatives before proposing a budget increase.

5. **Add comparison runs.** Implement `evaluation.ts` and console commands to fork the same evidence sequence, initial publication state, configuration, and scheduled feedback into isolated heuristic and LLM runs. Persist model/configuration, inputs, proposals, validated outputs, choices, token cost, latency, and failures. Later series history may diverge naturally between runs. A separate single-run scenario switches editor modes to test continuity rather than resetting history.

6. **Evaluate and tune.** Inspect the selected recorded segments and labelled synthetic edge cases. Tune JSON thresholds, variants, merge rules, page minimums, design weights, and feedback effects. Summarize findings beside replay output, including missing demonstrations. Lock a small set of representative evaluation fixtures and the accepted configuration for the live-integration handoff.

## Verification

Use a controlled model adapter to return valid proposals, unsupported subjects, future/unavailable evidence IDs, inflated importance, malformed output, duplicate series, and interrupted generation. Verify fallback preserves the publication state. Start an ad hoc series in LLM mode, continue it through an authored template in heuristic mode, then return to LLM mode; the same key, prior articles, votes, and accumulated importance must survive. Assert structured outcomes rather than prompt wording.

Run focused Vitest tests and workspace type checks/builds. Use a real configured provider for the reading evaluation, recording cost and results separately from repeatable tests. Browser checks cover archive filters, earlier-article links, shared votes, long names, font loading, and both ordinary and texture-preview rendering. Run `npm run build:all` and `npm run test:all` at the handoff.

The human review uses the spec's evaluation checklist: usefulness, factual support, story mix, continuity, reading length, era/identity, feedback, and fallback. The stage remains incomplete if only synthetic fixtures demonstrate the central reading experience.

## Risks and open questions

An LLM can attach a valid evidence ID to an unsupported interpretation. Keep factual comparison computation outside the model, preserve inputs for inspection, and distinguish interpretation in prose. Browser-dependent pixel differences do not establish editorial differences. Full design coverage must fit the asset budget agreed after Plan 1's measurements.

## Out of scope

Live game scheduling, save-backed archives, new foreign-reporting collection, graphs, generated art, audio, and special editions.
