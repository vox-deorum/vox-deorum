# Stage 4 — Web UI: the deal screen (in-game trade-screen replica)

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## ✅ DONE

Built as specified, in preview mode. What landed:

- **vox-agents backend — typed deal-action API** (`src/web/routes/agent.ts`, all under `/api/agents/chat/:chatId/deal/*`, distinct from the plain-text `/api/agents/message` path):
  - `POST …/deal/inspect` — proxies the read-only `inspect-deal` (Web→vox-agents→mcp-server only); drives the tradable range, per-term legality/value, and live re-evaluation.
  - `POST …/deal/propose` + `…/deal/counter` — archive `deal-proposal` / `deal-counter` through `append-message` carrying `Payload.Deal`; the route computes and attaches proposal-time `Payload.Value1` / `Payload.Value2` per-item value snapshots from a fresh inspection (best-effort — archives without them if the game can't be inspected).
  - `POST …/deal/reject` — archives `deal-reject` with `Payload.ProposalMessageID` (either endpoint may decline or retract).
  - `POST …/deal/accept` — **wired but deferred**: acceptance is recorded only by the enactment route (`enact-agent-deal`, stage 6), the sole writer of `deal-accept` / `deal-enacted` (pinned contract), so the stage-4 endpoint returns a clear 501 rather than writing through `append-message` (which rejects `deal-accept`). This reconciles work item 2 with the pinned writer-split.
  - `GET …/deals` — lists the conversation's deal messages in append order for client-side reduction.
  - All writes stay **archival** (specs §6): `append-message` is the only store touch; route handlers separately drive UI refresh. Closed-this-turn conversations reject deal writes with 409.
  - `src/utils/diplomacy/deal.ts` — the I/O wrappers (`inspectDeal`, `appendDealProposal`, `appendDealReject`, `readDealMessages`) + pure `computeValueMaps` (per-item value keyed by index from each ordered player's perspective), importing the pinned `deal-schema` contract from mcp-server.
  - `src/types/api.ts` — request/response types (`InspectDeal*`, `DealProposalRequest`, `DealRejectRequest`, `DealAcceptRequest`, `DealActionResponse`, `DealMessagesResponse`), re-exporting the deal-schema types.
- **Web UI** (`vox-agents/ui`) — a deal has **two surfaces**: the configuring dialog and inline thread cards.
  - `src/components/deal/DealScreen.vue` — the in-game trade-screen replica, shown as a **modal dialog** (its own close; opened by the conversation's "Propose deal" button): both sides' item tables from the tradable range (including third-party peace/war, with explicit World Congress fields for vote commitments), a separate **Promises** section (nine promises, requiring a third-party target where applicable), per-term legality (with reason tooltip) and both-direction value, the **other-side value balance** summed live from `inspect-deal`'s per-item values (sentinel-aware), add/remove/modify terms with debounced latest-request-wins re-evaluation, and **Accept / Counter / Reject / Propose** actions against the current proposal.
  - `src/components/deal/DealMessageCard.vue` — the **second surface**: each `deal-proposal` / `deal-counter` / `deal-reject` rendered as a card **inline in the conversation stream**, in append order, with a you-give/they-give term summary and the proposal-time value to you. Accept / Reject act inline; **Counter opens the dialog** (which loads the active proposal). Outgoing offers show Counter / Retract, incoming offers show Accept / Counter / Reject; only the active (open) proposal offers actions.
  - `src/components/deal/deal-thread.ts` — pure, UI-only merge that interleaves deal-message cards with the text/close stream by timestamp, converting the store's Unix-second timestamps to JavaScript milliseconds. Deal cards are **never** added to `thread.messages` (which feeds the diplomat's model context), so the second surface doesn't leak into the LLM transcript.
  - `src/components/deal/deal-reduce.ts` — pure reduction of append-ordered deal messages into the latest active proposal + status (`open` / `rejected` / `accepted` / `enacted`), forward-compatible with stages 5–6.
  - `src/components/deal/deal-helpers.ts` — pure display/value helpers (sentinel handling, item/promise labels, live side balance, stored-snapshot balance).
  - `ChatDetailView.vue` fetches the conversation's deal messages, interleaves the cards into `ChatMessages`, and wires the card/dialog actions (reloading deal state after each write); `ui/src/api/client.ts` gained the typed deal-action calls.
- **Tests (all green):** backend `tests/mock/diplomacy/deal-io.test.ts` (9) + deal-action route guards in `tests/mock/web/agent-routes.test.ts`; UI `deal-reduce` (6), `deal-helpers` (5), `deal-thread` (4), `DealScreen` (5), `DealMessageCard` (5). Full suites pass — vox-agents 737, ui 86 — with both type-checks clean.

**Verify** still requires a live session + a built/running game for the real legality/value path; the TypeScript and component layers are unit-tested. Accept against a negotiator counter, LLM counters, and real enactment arrive in stages 5–6.

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
