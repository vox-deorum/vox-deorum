# Plan 3: heuristic newspaper and publication state

**Status: publication, voting and resume are complete and verified. Archive navigation in the browser remains.** The [editorial guide](../../../developers/vox-agents/newspaper/editorial.md) and [replay guide](../../../developers/vox-agents/newspaper/replay.md) describe publication, voting, and resume. [Plan 6](06-trigger-rules.md) replaced the initial catalogue and closed with the owner's acceptance of the stock news mechanics.

## Remaining work: archive navigation

Finish bounded archive filters for date, page, civilization, and city, and make series links open the archived page at the linked report. Extend the replay store and browser shell with the shared archive contracts in `mcp-server/src/newspaper/protocol.ts` and Vox Agents' `contracts/archive.ts`. Keep the archive and evidence inspector outside the publication, and preserve shared votes across page appearances.

Verify in the browser reader: each filter narrows the issue list, a series link lands on the earlier report, and a vote made from the archive shows on every page where the article appears. Run `npm run build -w vox-agents` and `npm run test:mock -w vox-agents -- tests/mock/newspaper`.

## Proposed: design names and selection

Give every stock design a name that tells readers what it looks like. Give each publication a masthead that sounds like it belongs to that format and civilization. A player should recognize the same paper for several issues and see another one when several designs fit the era. For example, **Victorian Broadsheet** may print *The Morning Ledger* for a run of issues, then give way to **Telegram Form**, which prints *By Cable*.

### Current behavior

Under `vox-agents/newspaper/src/app/`, `mockups.ts` and `appearance.ts` use the design's `title` as the menu label. The editor in `vox-agents/src/newspaper/editorial/presentation/` also uses it as the fallback printed title. A winning masthead rule always replaces the fallback. Rule choices are stable per campaign, player, and design, so a broad rule can print the same name on several formats for an entire era. `chooseDesign` in `issue.ts` keeps the previous design whenever its weight is at least 60% of the strongest choice. Once a design clears that threshold, there is no draw.

A Netherlands replay published 44 issues through turn 249 before running out of memory. The notice board ran for 24 consecutive issues. Later the court dispatch, stitched chronicle, and town book all printed *The Dutch Register*; 10 port issues in a row printed *The Dutch Courant*. This partial baseline shows both the design lock and masthead reuse across different formats.

### Name the complete catalogue

Add an optional `label` to built-in design documents. Read it in `newspaper/src/preview/issue.ts` and use it in both design menus, falling back to `title` for older documents. Strip `label` with other browser metadata in `editorial/config/load.ts` after merging designs and before strict catalogue validation. Retain design and rule IDs so overlays, fixtures, CSS, and assets keep working. A blank masthead cell means the existing base title can stay.

| Design ID | Design menu label | Proposed base masthead |
| --- | --- | --- |
| `oral-accounts` | Cast Notice Board | The Public Board |
| `shang` | Shang Oracle Shell | |
| `clay-chronicle` | Clay Tablet | The Palace Tablets |
| `egypt` | Painted Papyrus | |
| `heian` | Heian Court Letters | |
| `palm-leaf-register` | Bound Palm Leaves | The Book of Leaves |
| `folded-chronicle` | Painted Maya Foldout | The Painted Annals |
| `cord-register` | Knotted Inca Cords | The Keeper’s Account |
| `port-register` | Port Ledger | The Shipping List |
| `victorian` | Victorian Broadsheet | The Morning Ledger |
| `city-extra` | Evening Extra | |
| `street-gazette` | Letterpress Street Sheet | News from the Square |
| `town-book` | Illuminated Town Book | |
| `stitched-chronicle` | Embroidered Frieze | The Hall Frieze |
| `printer-dispatch` | Woodcut News Sheet | The Printer’s Mercury |
| `secession-review` | Secession Magazine | |
| `national-review` | Photo Weekly | The National Pictorial |
| `cable-desk` | Telegram Form | By Cable |
| `teletext-bulletin` | Teletext Screen | |
| `contact-sheet` | Darkroom Contact Sheet | |
| `paste-up` | Photocopied Fanzine | |
| `civic-index` | Swiss Grid | The Daily Index |
| `court-dispatch` | Court Dispatch Slips | The Palace Post |
| `sunday-colour` | Sunday Comic Supplement | |
| `civic-survey` | Isotype Bulletin | The Common Measure |
| `wire` | Social News Feed | Public Signal |

Update the names a real seat will see in `civilizationTitles`. For the Maya foldout use *The Painted Annals of the Maya*. For the port ledger use *The English Shipping List*, *The Dutch Shipping List*, *The Portuguese Shipping List*, and *The Venetian Shipping List*. For the notice board, broadsheet, and court slips replace the wildcard with *Public Notices of {{terms.civilization}}*, *The Morning Ledger of {{terms.civilization}}*, and *The Palace Post of {{terms.civilization}}*, with exact exceptions such as *The Dutch Morning Ledger* where they read better. Use *{{terms.civilization}} Signal* for the feed. Keep the literal base titles so an unknown civilization and the browser sample both print.

Revise stock rules in all five `mastheads/` groups alongside these fallbacks. Give each general era or ideology title one home among designs that coexist, and add scoped variants where a theme belongs on more than one format. For example, keep the Medieval *Dutch Register* on the town book and free the court slips and frieze to print their own mastheads. Keep the Industrial daily on the city extra so the broadsheet can print *The Dutch Morning Ledger* and the telegram can print *By Cable*. Preserve distinctive local titles such as *The Dutch Courant* on one suitable design. Give the broadsheet *The Workers’ Herald* and the feed *Workers’ Signal*, with their existing political conditions and evidence. Check civilization, policy, and combined rules for the same overlap. Keep the stable masthead draw and the ability to write broad custom rules; overlays can replace an inherited design scope by listing their own design IDs.

### Rotate among designs that fit

Keep a design for three published issues while it fits, then give the other designs a chance at each issue. After six, switch if there is a credible alternative. This gives a strong cultural choice more room than a strict rotation would. Tuning the current threshold still lets the strongest design stay indefinitely, and redrawing every issue makes the paper hard to recognize.

1. Add optional `defaults.designSelection: 'legacy' | 'pressRun'` in `editorial/config/schema.ts`; set `pressRun` in stock `defaults.json`. Keep the current path and `designStickiness` for saved catalogues without the field and for overlays that select `legacy`. On the new path, evaluate the same facts and require the same positive weights, printable fallback, and valid layouts. A design is competitive at half the highest eligible weight. Start with fixed limits of three and six issues to keep the policy easy to compare in replay.
2. Add optional `designId` to `PublishedIssueRecord` in `contracts/publication.ts` and write it on publish in `editorial/check.ts`. Count trailing issues with the incumbent's ID, reading at most six records. A missing ID ends the count; use `previousDesignId` on the legacy path. Skips never spend a slot. The existing checkpoint persists the history with the issue; old checkpoints and issue documents need no migration.
3. In `editorial/presentation/issue.ts`, keep a competitive incumbent for the first three issues. Once three have published, draw among all competitive designs in proportion to their weights. If the draw keeps the incumbent, its run continues. After six, exclude it for the draw if another competitive design is available. Immediately redraw if the incumbent is ineligible or weak, and open a first issue from the competitive pool. Use a design draw keyed by check identity and a stable ID order, with separate layout draws keyed by check identity, design ID, and page ID. Leave the legacy stream intact in `editorial/shared/determinism.ts`. Names and masthead copy should have no effect on the new draws. Page layout eligibility and weights stay in place; a breaking story still leads a breaking page.
4. Add optional `designSelection` details to the decision in `contracts/publication.ts`: previous ID, prior run length capped at six, selection reason, and positive printable candidates with raw and draw weights. Set draw weights to zero when there was no draw. The reader's existing JSON view will show these details alongside the existing `mastheadRuleId`. Keep the browser appearance override and archived issue rendering independent of these choices.

### Balance the stock weights across eras

Build an era × civilization matrix from `evaluatePresentation` before editing individual files. Save the before and after tables in `.tmp/newspaper-design-weights.md` with each positive weight and the resulting competitive pool. Use roughly 45 to 60 for a general lead choice, 30 to 45 for a plausible alternative, and 65 to 85 for a strong cultural match. At 80, an alternative needs at least 40 to join the rotation. Decide explicitly whether to raise or narrow each low stock weight. For example, Contact Sheet at 16 needs more weight to compete in its eras, and Heian Court Letters at 4 to 6 for China or Korea need either a credible weight there or a narrower civilization gate. Use hard `when` conditions for designs out of place in a context.

| Era | Starting balance to check in replay |
| --- | --- |
| Ancient and Classical | Keep the notice board as a fallback; preserve strong Chinese, Egyptian, Nubian, Babylonian, Assyrian, Mayan, and Inca fits where their rules allow. Give Knotted Inca Cords a cultural gate instead of weight 1 for unrelated seats. Accept a single design where the catalogue has only one plausible option. |
| Medieval | Make Town Book and Embroidered Frieze compete, with Court Dispatch Slips and civilization-specific formats where they fit. Reduce Victorian Broadsheet's early footprint. |
| Renaissance | Lead with Woodcut News Sheet and Court Dispatch Slips; give Port Ledger strong weight for maritime civilizations and preserve specialist formats. |
| Industrial and Modern | Give the broadsheet, evening extra, street sheet, telegram, color supplement and illustrated magazine room where each fits; keep maritime and civilization preferences strong. Move the Social News Feed out of this period. |
| Atomic | Let Photo Weekly, Isotype Bulletin, Swiss Grid, Teletext Screen, Darkroom Contact Sheet, and Photocopied Fanzine compete. |
| Information and Future | Make Social News Feed and Swiss Grid credible rivals; retain Teletext Screen, Darkroom Contact Sheet, and Photocopied Fanzine in Information where they fit. |

For example, the Future era currently gives the feed 100 and the Swiss grid 50. The feed can stay indefinitely. Try 55 and 45 for a slight preference for the feed while both appear. For a maritime Industrial seat, try 65 for Port Ledger, 60 for Victorian Broadsheet, and 35 to 45 for credible alternatives, compared with today's 40, 60, and mostly sub-30 alternatives. Preserve a fallback for an unknown recorded era. A single competitive format will repeat. If the generic early game still feels too uniform, plan a second period-appropriate format, such as a wax tablet, separately from the weight changes.

### Verify before shipping

- Test a stable opening run, weighted continuation, a forced switch, a singleton, an ineligible or weak incumbent, skipped checks, and deterministic draws. Check the stock catalogue has a printable design for every normal era and a fallback when the era or civilization is missing. Resume a new run and compare its next decisions with an uninterrupted run; also resume a saved catalogue without `designSelection`. Verify archive appearance overrides keep recorded mastheads.
- Run `npm run test:mock -w vox-agents -- tests/mock/newspaper` and `npm run type-check:newspaper -w vox-agents`. Sample long mastheads in dark and light designs, at narrow and wide widths, and in browser export. Check both menus display the format name and Mockups still prints a publication name.
- Replay the same recording, seats, intervals, and turn ranges with the old and proposed catalogues. Use the documented Netherlands recording for a maritime seat and other recorded seats for an early specialist and a late ideology. Use matched shorter windows if needed to stay within memory limits, and compare identical start points because each window starts without history. Compare eligible designs by era, longest and typical runs, distinct design and masthead counts, and named `design → masthead` transitions. With unchanged eligibility and several competitive options, no design should hold a seventh issue. Require distinct mastheads across the competing Dutch Medieval designs and one late ideology set; list and review any title collisions in the replay sample. Check that issue counts, selected articles, and urgent layout variants agree with baseline.
- Update the design, editorial and replay guides together after implementation. Story scoring, prose selection, renderer redesigns, new artwork, and changes to stored issues are outside this plan.

## Where the rest went

Story types, styles and wording belong to Plans [4a](04a-styles.md), [4b](04b-story-mining.md) and [4c](04c-variant-drafting.md). The broader checks for generated issues in the game remain in [Plan 1](01-renderer.md). [Plan 7](07-llm-editors.md) adds model editing and comparisons.

## Live persistence boundary

The versioned SQLite store and publication contracts serve offline runs. [Plan 5](05-live-integration.md) reuses the editor during play and keeps the latest issue in memory.
