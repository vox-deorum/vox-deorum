# Stage 7.04 — vox-agents + civ5-mod: live conversation, streaming, deals, enactment

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). Connects the stage-01/02 UI to the stage-03 transport through the **existing Web chat engine** — `runChatTurn` and the deal helpers are reused; where logic today lives only in Express route bodies, it is extracted into shared action helpers, not duplicated.

## Objective

A human in-game converses with the LLM diplomat and negotiates real deals: messages run through `runChatTurn` with replies streamed into the panel, deal moves flow through the same validation the Web uses, accepted deals enact through `enact-agent-deal`, and replies landing while the panel is closed surface as native notifications — cross-turn.

## Work items

1. **Extract the deal route bodies into shared action helpers — `vox-agents/src/web/chat/deal.ts`.** The accept/reject Express handlers own real logic their leaf helpers lack: the diplomacy-thread guard (`resolveDealThread`), the closed-this-turn gate (`isDealLocked`), `withThreadLock` wrapping with `ThreadBusyError` mapping, the cache mirror (`mirrorDealRowsBestEffort`), and accept's conflict-vs-failure disambiguation. Extract them as transport-neutral `acceptDealAction(thread, proposalMessageID, accepterID)` and `rejectDealAction(thread, proposalMessageID, content?)`; rewrite the routes as thin wrappers over them (behavior-preserving — the Web keeps its exact status mapping); the ingame-bridge calls the same helpers. This is the "extend, don't fork" seam.

2. **Replace the stage-03 probe: `DiplomacyChatMessage` → the real chat turn.** On the pair FIFO: ensure the thread via `openDiplomacyChat` (deterministic id `dipl:${gameID}:${min}:${max}`; caller = event `PlayerID`, target = `CounterpartID`; identities resolved server-side; skipped when the thread exists and `isThreadBusy` — never compact a live thread), capture the baseline transcript `ID`, then `runChatTurn({kind:'text', chatId, message}, gameSink)` — **no pre-append** (`runChatTurn` commits internally). On completion, re-read the durable transcript above the baseline (`readTranscriptPage`) and push the authoritative new rows as `Messages{append}` — the human's committed row is what clears the panel's optimistic "sending…" row, and the reply row is **never synthesized from streamed text** (the sink's `done` carries only counts for text turns). A `ChatTurnRejection` or archival failure pushes `Status{error}`. **Greeting parity**: on `DiplomacyPanelOpened`, when the transcript is empty or last touched a prior turn, run a `{{{Greeting}}}` turn exactly as the Web client does (`shouldRequestGreeting` rule).

3. **The game `ChatStreamSink` — `vox-agents/src/envoy/ingame-bridge.ts`.** The in-game counterpart of the SSE sink, with a strict allowlist: `text-delta` accumulates → `VoxDeorumDiploDelta` throttled ~1/s; the `progress` sentinel and reasoning/tool chunks → `VoxDeorumDiploStatus` state only (never content — details stay revealable on the Web, which renders them collapsed); `connected.deal` (the authoritative committed proposal row on a deal turn) → immediate `Messages{append}`; `done.deals` (mid-run deal rows with durable IDs) → `Messages{append}`; `error` → `Status{error}`. All pushes ride the pair FIFO; final reconciliation awaits its drain. `Begin.busy` (via `isThreadBusy`) covers reopen-during-run.

4. **`DiplomacyDealAction` handling.** On the pair FIFO: `propose`/`counter` → `runChatTurn({kind:'deal', chatId, deal, expectedProposalID: ProposalMessageID?}, gameSink)` — the Web-identical path (value snapshots, legality guard, stale-proposal 409 via `expectedProposalID`; an `IllegalDealError` surfaces as `Status{error}`); `accept` → `acceptDealAction` (→ `requireCurrentOpenProposal` + `enactAgentDeal`, the stage-6 idempotent entrypoint); `reject` → `rejectDealAction`. After the blocking actions, push the new rows (re-read above baseline) — the panel's reducer re-badges the cards; no state channel exists or is needed.

5. **Notifications.** After any completed reply or deal outcome, post via `call-lua-function` → `VoxDeorumPostNotification(playerID, counterpartID, summary, message)` — summary from the counterpart leader name, message from a trimmed first line. Per the pinned policy: **always post**; the open panel dismisses its own pair's notifications. This is what carries a reply that lands after the player left the panel — or turns later.

6. **Panel + deal screen wiring — `civ5-mod/UI/VoxDeorumDiploPanel.lua`, `VoxDeorumDealScreen.lua`/`VoxDeorumTradeLogic.lua`.** Remove the mocks: panel open fires `DiplomacyPanelOpened` and renders from `Begin`/`Messages`; Send fires `DiplomacyChatMessage`; "Load earlier…" fires `DiplomacyTranscriptRequest`; clicking a deal card raises `VoxDeorumOpenDealScreen` (populated from its `Payload.Deal` + proposal id — the active open proposal opens in respond mode, settled/superseded ones view-only); the deal screen's stubbed emits become real `DiplomacyDealAction` broadcasts (`propose`/`counter` with the serialized deal; `accept`/`reject` — including Retract — with the proposal id), and the originating card badges pending until the matching row returns. Pending resolution and the two-tier timeouts run exactly per the specs UI rules.

7. **Direction gating — `vox-agents/src/types/config.ts` (+ session wiring).** A minimal flag enabling the human→LLM in-game direction (default on in interactive mode), consumed by the bridge before handling mutating events — the parent plan's stage 8 owns the full per-direction matrix (parent specs §5); this stage just avoids hard-wiring.

## Reuse

`runChatTurn` + `ChatStreamSink` (`web/chat/turn.ts`, `types/web-chat.ts`) — the entire engine, unmodified; `openDiplomacyChat` (`web/chat/factory.ts`); `enactAgentDeal`, `appendDealReject`, `requireCurrentOpenProposal`, `withThreadLock`, `mirrorDealRowsBestEffort` (`web/chat/deal.ts`, now composed inside the extracted actions); `readTranscriptPage`/transcript utils (stage 03); `isThreadBusy` (stage 03); the `{{{Greeting}}}` convention; stage-6 `enact-agent-deal` idempotency (unchanged — double-accept is already refused at the transcript level).

## Verify

Full loop in a live interactive game (all services up), against a pair that also has Web history:

1. Open the panel from Converse: the shared transcript renders (Web rows included); an empty pair auto-greets like the Web.
2. Send a message: optimistic row → status line ("Envoy is thinking…" / tool status) → streamed partial text → final reply row that **matches the durable transcript row** (check IDs via the Web view, where reasoning/tool details are revealable — none of that content reached the game).
3. Leave the panel mid-run: a native notification arrives on completion; click it turns later — the conversation opens with the finished reply (cross-turn correspondence).
4. Reopen mid-run: `Begin.busy` shows "envoy is composing…" immediately; the final rows arrive without a reflush.
5. Deals: propose with a promise from the vendored screen → the committed card appears from `connected.deal`; the negotiator counters → the counter card arrives; accept in-game → items change hands, `deal-accept` + `deal-enacted` rows arrive, the card re-badges Enacted; a second accept is refused (existing idempotency). Reject re-badges the card via the panel reducer. A stale counter (server-side proposal changed) surfaces the 409 as an error status with the draft preserved.
6. The Web routes still pass their existing behavior after the extraction refactor (accept/reject/close from the Web UI unchanged, including status codes).

## Done when

The stage-7 objective holds end to end — converse, streamed replies, notification-carried cross-turn correspondence, native-looking deal negotiation with promises, real enactment through `enact-agent-deal` — with the in-game path running through the same engine, helpers, and transcript as the Web.
