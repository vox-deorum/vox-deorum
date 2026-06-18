# Stage 4 — Web UI: the deal screen (in-game trade-screen replica)

> **✅ Done** (preview mode). vox-agents 737 + ui 86 tests green, both type-checks clean. The live legality/value path needs a built/running game; accept-against-counter, LLM counters, and real enactment arrive in stages 5–6.
> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Recreate the game's diplomatic deal screen on the Web (specs §3, §9) — a **layout** replica of the in-game trade screen, driven entirely by stage-3 `inspect-deal`: both sides' item tables populated from the tradable range, the human building and modifying a deal with live per-term legality + value/agreeability feedback, and Accept / Counter / Reject controls. There is no separate mockup gate — the in-game screen is the reference.

At this stage the screen runs in **preview mode**: the live counterpart that produces counters arrives in stage 5 and real enactment in stage 6. So this stage verifies that the screen faithfully renders `inspect-deal` and round-trips deal messages through typed deal-action routes — not that items change hands. Every write stays **archival** (specs §6): `append-message` is the only store touch; route handlers separately drive UI refresh.

## What was built

### vox-agents backend — typed deal-action API

All under `/api/agents/chat/:chatId/deal/*` ([web/routes/agent.ts](../../../vox-agents/src/web/routes/agent.ts)), distinct from the plain-text `/api/agents/message` path. Closed-this-turn conversations reject deal writes with 409.

- `POST …/deal/inspect` — proxies the read-only `inspect-deal` (Web→vox-agents→mcp-server only); drives the tradable range, per-term legality/value, and live re-evaluation.
- `POST …/deal/propose` + `…/deal/counter` — archive `deal-proposal` / `deal-counter` through `append-message` carrying `Payload.Deal`; the route computes and attaches proposal-time `Payload.Value1` / `Value2` per-item snapshots from a fresh inspection (best-effort — archives without them if the game can't be inspected).
- `POST …/deal/reject` — archives `deal-reject` with `Payload.ProposalMessageID` (either endpoint may decline or retract).
- `POST …/deal/accept` — wired but **returns 501**: acceptance is recorded only by the enactment route (`enact-agent-deal`, stage 6), the sole writer of `deal-accept` / `deal-enacted` (pinned contract).
- `GET …/deals` — lists the conversation's deal messages in append order for client-side reduction.
- **[utils/diplomacy/deal.ts](../../../vox-agents/src/utils/diplomacy/deal.ts)** — the I/O wrappers (`inspectDeal`, `appendDealProposal`, `appendDealReject`, `readDealMessages`) + pure `computeValueMaps` (per-item value keyed by index from each ordered player's perspective), importing the pinned `deal-schema` contract from mcp-server. Request/response types live in `src/types/api.ts`.

### Web UI

A deal has **two surfaces**: the configuring dialog and inline thread cards.

- **[DealScreen.vue](../../../vox-agents/ui/src/components/deal/DealScreen.vue)** — the in-game trade-screen replica, shown as a **modal dialog** (opened by the conversation's "Propose deal" button): both sides' item tables from the tradable range (including third-party peace/war and explicit World Congress fields for vote commitments), a separate **Promises** section (nine promises, requiring a third-party target where applicable), per-term legality (with reason tooltip) and both-direction value, the **other-side value balance** summed live from `inspect-deal`'s per-item values (sentinel-aware), add/remove/modify terms with debounced latest-request-wins re-evaluation, and Accept / Counter / Reject / Propose actions against the current proposal.
- **[DealMessageCard.vue](../../../vox-agents/ui/src/components/deal/DealMessageCard.vue)** — each `deal-proposal` / `deal-counter` / `deal-reject` rendered as a card **inline in the conversation stream**, in append order, with a you-give/they-give term summary and the proposal-time value to you. Accept / Reject act inline; **Counter opens the dialog** (loading the active proposal). Outgoing offers show Counter / Retract, incoming offers show Accept / Counter / Reject; only the active (open) proposal offers actions.
- **[deal-thread.ts](../../../vox-agents/ui/src/components/deal/deal-thread.ts)** — pure UI-only merge interleaving deal-message cards with the text/close stream by timestamp (Unix-second → millisecond). Deal cards are **never** added to `thread.messages` (which feeds the diplomat's model context), so the second surface doesn't leak into the LLM transcript.
- **[deal-reduce.ts](../../../vox-agents/ui/src/components/deal/deal-reduce.ts)** — pure reduction of append-ordered deal messages into the latest active proposal + status (`open` / `rejected` / `accepted` / `enacted`), forward-compatible with stages 5–6.
- **[deal-helpers.ts](../../../vox-agents/ui/src/components/deal/deal-helpers.ts)** — pure display/value helpers (sentinel handling, item/promise labels, live and stored-snapshot side balance).
- **[ChatDetailView.vue](../../../vox-agents/ui/src/views/ChatDetailView.vue)** fetches the conversation's deal messages, interleaves the cards into the chat stream, and wires the card/dialog actions (reloading deal state after each write); `ui/src/api/client.ts` gained the typed deal-action calls.
- **Attached deal message** — `Payload.Deal` carries an optional one-sentence `message` and inward `rationale` (declared on `DealPayloadSchema`, [deal-schema.ts](../../../mcp-server/src/utils/deal-schema.ts), and ignored by `inspect-deal`). `DealScreen.vue` has a message input so the human sends a deal *and* its note in one action (stored on `Payload.Deal.message`), and `DealMessageCard.vue` surfaces `message` and `rationale` on proposal/counter cards (reject cards already show `Content`). The negotiator authors both fields in stage 5; the human attaches only `message`.

## Reuse

The existing Vue chat components and thread view (`ui/src/components/chat/*`, `ChatDetailView.vue`); `ui/src/api/client.ts`; PrimeVue widgets already used in the UI; stage-3 `inspect-deal` as the single data source (the screen holds no deal state of its own beyond the in-progress proposal).

## Verify

With a live session and a conversation open: the deal screen renders the full tradable range for the two players, mirroring the in-game layout. The human assembles a deal — each added term shows its legality and value/agreeability, an illegal term shows its reason — updating live as terms change. Proposing or countering posts a message carrying `Payload.Deal` that round-trips through the conversation as an inline card. Confirm the plain-text chat route is not required for structured deal actions. (Accept/reject against a negotiator counter, LLM counters, and real enactment are exercised in stages 5–6.)

## Done when

The Web deal screen faithfully replicates the in-game trade screen's layout and is fully driven by `inspect-deal` — browse the range, build/modify a deal, see per-term legality and estimates live, and round-trip proposal / counter messages through typed deal-action routes — all in preview mode, with the live negotiator and real enactment deferred to stages 5 and 6.
