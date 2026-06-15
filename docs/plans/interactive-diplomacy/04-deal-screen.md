# Stage 4 — Web UI: the deal screen (in-game trade-screen replica)

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Recreate the game's diplomatic deal screen on the Web (specs §3, §9) — a **layout** replica of the in-game trade screen, not an aesthetic one. The screen is driven entirely by stage-3 `inspect-deal`: it shows both sides' item tables populated from the tradable range, lets the human **build and modify** a deal with live per-term legality + value/agreeability feedback, and presents **Accept / Counter / Reject** controls. There is **no separate mockup gate** — the in-game screen is the reference; build the Vue component directly.

At this stage the screen runs in **preview mode**: the live counterpart that produces counters arrives in stage 5, and real enactment in stage 6. So this stage verifies that the screen faithfully renders `inspect-deal` and round-trips deal messages through typed deal-action routes — not that items change hands.

## Work items

1. **A deal-screen Vue component** (new, under `vox-agents/ui/src/components/`, embedded in `ChatDetailView.vue` within the conversation thread) that:
   - renders **both sides' item tables** from the `inspect-deal` tradable range (gold, gold-per-turn, resources, cities, open borders, peace, third-party terms, votes, techs, … — the in-game item set), laid out like the in-game trade screen;
   - renders **promise terms** as a separate section (the eight standing promises + Coop War with its third-party target — specs §3);
   - shows, **per term**, structural legality (and the reason when illegal) and the **value estimate / agreeability factors** alongside (specs § Deal valuation);
   - shows the **other side's total value balance** (VP trade-screen convention), computed dynamically by summing `inspect-deal`'s per-item values and recomputed live as the deal is edited — there is no stored total and no new DLL helper;
   - lets the human **add/remove/modify** terms with **live re-evaluation** (re-querying `inspect-deal` as the proposed deal changes);
   - presents **Accept / Counter / Reject** actions against the currently selected proposal.
2. **Add typed deal-action APIs in vox-agents** and wire them through `ui/src/api/client.ts`: presenting a deal writes a `deal-proposal` message, countering writes a `deal-counter` message, and both carry the proposed terms in `Payload.Deal` plus optional `Payload.Value1` / `Payload.Value2` snapshots. Accept writes a `deal-accept` message and Reject writes a `deal-reject` message, each with `Payload.ProposalMessageID`. These are explicit structured endpoints or request modes, not the plain text `/api/agents/message` path. The reply/counter rendering is stubbed until stage 5 supplies the negotiator's moves; real enactment is not called until stage 6. Because an accept/reject must answer a proposal from the *opposite* endpoint (stage-1 §4), accept/reject are wired here but first exercised against the negotiator's counter in stage 5; stage-4 preview round-trips proposal/counter only.
3. **Keep append archival.** The deal-action routes call `append-message` only to archive transcript rows. The Web/vox-agents route handlers separately trigger UI refresh, negotiator orchestration, or later enactment; `append-message` itself does not stream, notify, run agents, or decide proposal state.
4. **Reduce transcript state client-side.** The UI derives the latest active proposal from append-ordered messages: proposal/counter messages replace the active deal, accept/reject messages reference the proposal they answer, `deal-enacted` marks successful orchestration for a proposal once stage 6 exists, and close messages affect only the conversation lifecycle. This keeps the Web state aligned with the append-only store and avoids a separate deal-status API.

## Reuse

The existing Vue chat components and thread view (`ui/src/components/chat/*`, `ui/src/views/ChatDetailView.vue`); `ui/src/api/client.ts` (existing chat calls plus new typed deal-action calls); PrimeVue widgets already used in the UI; stage-3 `inspect-deal` as the single data source (the screen holds no deal state of its own beyond the in-progress proposal).

## Verify

With a live session and a conversation open: the deal screen renders the full tradable range for the two players, mirroring the in-game trade-screen layout. The human assembles a deal — each added term shows its legality and value/agreeability, and an illegal term shows its reason — updating live as terms change. Presenting or countering through the typed deal-action API posts a proposal message carrying `Payload.Deal` that round-trips through the conversation. Confirm the plain text chat route is not required for structured deal actions. (Accept/reject against a negotiator counter, LLM counters, and real enactment are exercised in stages 5–6.)

## Done when

The Web deal screen faithfully replicates the in-game trade screen's layout and is fully driven by `inspect-deal` — browse the range, build/modify a deal, see per-term legality and estimates live, and round-trip proposal / counter messages through typed deal-action routes (accept/reject wired here, exercised against the negotiator in stage 5) — all in preview mode, with the live negotiator and real enactment deferred to stages 5 and 6.
