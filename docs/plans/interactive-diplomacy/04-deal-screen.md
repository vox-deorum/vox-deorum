# Stage 4 — Web UI: the deal screen (in-game trade-screen replica)

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Recreate the game's diplomatic deal screen on the Web (specs §3, §9) — a **layout** replica of the in-game trade screen, not an aesthetic one. The screen is driven entirely by stage-3 `inspect-deal`: it shows both sides' item tables populated from the tradable range, lets the human **build and modify** a deal with live per-term legality + value/agreeability feedback, and presents **Accept / Counter / Reject** controls. There is **no separate mockup gate** — the in-game screen is the reference; build the Vue component directly.

At this stage the screen runs in **preview mode**: the live counterpart that produces counters arrives in stage 5, and real enactment in stage 6. So this stage verifies that the screen faithfully renders `inspect-deal` and round-trips deal messages through the chat flow — not that items change hands.

## Work items

1. **A deal-screen Vue component** (new, under `vox-agents/ui/src/components/`, embedded in `ChatDetailView.vue` within the conversation thread) that:
   - renders **both sides' item tables** from the `inspect-deal` tradable range (gold, gold-per-turn, resources, cities, open borders, peace, third-party terms, votes, techs, … — the in-game item set), laid out like the in-game trade screen;
   - renders **promise terms** as a separate section (the eight standing promises + Coop War with its third-party target — specs §3);
   - shows, **per term**, structural legality (and the reason when illegal) and the **value estimate / agreeability factors** alongside (specs § Deal valuation);
   - lets the human **add/remove/modify** terms with **live re-evaluation** (re-querying `inspect-deal` as the proposed deal changes);
   - presents **Accept / Counter / Reject** actions against the currently selected proposal.
2. **Wire the actions to the chat/deal flow** through `ui/src/api/client.ts` and the stage-2 routes: presenting a deal writes a `deal-proposal` message, countering writes a `deal-counter` message, and both carry the proposed terms in `Payload.Deal` plus optional `Payload.Value1` / `Payload.Value2` snapshots. Accept writes a `deal-accept` message and Reject writes a `deal-reject` message, each with `Payload.ProposalMessageID`. The reply/counter rendering is stubbed until stage 5 supplies the negotiator's moves; real enactment is not called until stage 6.
3. **Reduce transcript state client-side.** The UI derives the latest active proposal from ordered messages: proposal/counter messages replace the active deal, accept/reject messages reference the proposal they answer, and close messages affect only the conversation lifecycle. This keeps the Web state aligned with the append-only store and avoids a separate deal-status API.

## Reuse

The existing Vue chat components and thread view (`ui/src/components/chat/*`, `ui/src/views/ChatDetailView.vue`); `ui/src/api/client.ts` (`createAgentChat` / `getAgentChat` / `sendChatMessage`); PrimeVue widgets already used in the UI; stage-3 `inspect-deal` as the single data source (the screen holds no deal state of its own beyond the in-progress proposal).

## Verify

With a live session and a conversation open: the deal screen renders the full tradable range for the two players, mirroring the in-game trade-screen layout. The human assembles a deal — each added term shows its legality and value/agreeability, and an illegal term shows its reason — updating live as terms change. Presenting or countering posts a proposal message carrying `Payload.Deal` that round-trips through the conversation. Accepting or rejecting posts a response message that references the proposal. (LLM counters and real enactment are exercised in stages 5–6.)

## Done when

The Web deal screen faithfully replicates the in-game trade screen's layout and is fully driven by `inspect-deal` — browse the range, build/modify a deal, see per-term legality and estimates live, and round-trip proposal / counter / accept / reject messages via the conversation — all in preview mode, with the live negotiator and real enactment deferred to stages 5 and 6.
