# Stage 7.04: vox-agents + civ5-mod: live conversation, streaming, deals, enactment

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). Connects the stage-01/02 UI to the stage-03 transport through the **existing Web chat engine**: `runChatTurn` and the deal helpers are reused; where logic today lives only in Express route bodies, it is extracted into shared action helpers, not duplicated.

## Objective

A human in-game converses with the LLM diplomat and negotiates real deals: messages run through `runChatTurn` with replies streamed into the panel, deal moves flow through the same validation the Web uses, accepted deals enact through `enact-agent-deal`, and replies landing while the panel is closed surface as native notifications: cross-turn.

## Work items

1. **Extract the deal route bodies into shared action helpers: `vox-agents/src/web/chat/deal.ts`.** The accept/reject Express handlers own real logic their leaf helpers lack: the diplomacy-thread guard (`resolveDealThread`), the closed-this-turn gate (`isDealLocked`), `withThreadLock` wrapping with `ThreadBusyError` mapping, the cache mirror (`mirrorDealRowsBestEffort`), and accept's conflict-vs-failure disambiguation. Extract them as transport-neutral `acceptDealAction(thread, proposalMessageID, accepterID)` and `rejectDealAction(thread, proposalMessageID, content?)`; rewrite the routes as thin wrappers over them (behavior-preserving: the Web keeps its exact status mapping); the ingame-bridge calls the same helpers. This is the "extend, don't fork" seam.

2. **Replace the stage-03 chat probe.** Run `DiplomacyChatMessage` on the action FIFO. Ensure the thread through `openDiplomacyChat`, using deterministic ID `dipl:${gameID}:${min}:${max}`, event `PlayerID` as caller, and `CounterpartID` as target. If the thread exists and `isThreadBusy`, do not reopen or compact it. Capture the baseline transcript ID, then call `runChatTurn({kind:'text', chatId, message}, gameSink)` without a pre-append because `runChatTurn` commits the message. After completion, read rows above the baseline and queue them through the push FIFO as `Messages{append}`. The committed human row clears the optimistic sending row. The final reply must come from the durable transcript, never from accumulated deltas. Queue `Status{error}` for a `ChatTurnRejection` or archival failure. For greeting parity, a `DiplomacyPanelOpened` refresh first sends the current transcript, then enqueues a `{{{Greeting}}}` action when `shouldRequestGreeting` says the transcript is empty or stale.

3. **Add the game `ChatStreamSink` in `vox-agents/src/envoy/ingame-bridge.ts`.** Keep a strict allowlist. Accumulate `text-delta` chunks and queue `VoxDeorumDiploDelta` about once per second. Convert the progress sentinel and reasoning or tool chunks into `VoxDeorumDiploStatus` states only; never send their content. Queue `connected.deal` as the authoritative committed proposal row and `done.deals` as durable mid-run rows. Queue errors as `Status{error}`. Every callback appends work to the independent push FIFO, which runs while the action FIFO is busy. At turn completion, capture and await the current push tail before final reconciliation. Do not await the action FIFO from one of its own handlers. `Begin.busy`, read through `isThreadBusy`, covers reopen-during-run.

4. **Handle `DiplomacyDealAction` on the action FIFO.** Propose and Counter call `runChatTurn({kind:'deal', chatId, deal, expectedProposalID: ProposalMessageID?}, gameSink)`, preserving the Web path for value snapshots, legality, and stale-proposal conflicts. Surface `IllegalDealError` as `Status{error}`. Accept calls `acceptDealAction`, which uses `requireCurrentOpenProposal` and the stage-6 `enactAgentDeal` entrypoint. Reject calls `rejectDealAction`. After each action, read rows above the baseline and queue them through the push FIFO. The panel reducer then updates card badges without a separate state channel.

5. **Notifications.** After any completed reply or deal outcome, post via `call-lua-function` → `VoxDeorumPostNotification(playerID, counterpartID, summary, message)`: summary from the counterpart leader name, message from a trimmed first line. Per the pinned policy: **always post**; the open panel dismisses its own pair's notifications. This is what carries a reply that lands after the player left the panel: or turns later.

6. **Wire the panel and deal screen in `civ5-mod/UI/VoxDeorumDiploPanel.lua`, `VoxDeorumDealScreen.lua`, and `VoxDeorumTradeLogic.lua`.** Remove the mocks. Panel open fires `DiplomacyPanelOpened` and renders `Begin` and `Messages`. Send fires `DiplomacyChatMessage`, and Load earlier fires `DiplomacyTranscriptRequest`. Clicking a deal card raises `VoxDeorumOpenDealScreen` with `Payload.Deal` and the proposal ID. The active open proposal uses respond mode; settled and superseded proposals are view-only. Replace stubbed deal emits with `DiplomacyDealAction`: Propose and Counter carry the serialized deal, while Accept, Reject, and Retract carry the proposal ID. Retract uses the Reject action. Keep the originating card pending until its matching row returns, and retain the two timeout tiers from the UI rules.

7. **Direction gating: `vox-agents/src/types/config.ts` (+ session wiring).** A minimal flag enabling the human→LLM in-game direction (default on in interactive mode), consumed by the bridge before handling mutating events: the parent plan's stage 8 owns the full per-direction matrix (parent specs §5); this stage just avoids hard-wiring.

## Reuse

`runChatTurn` + `ChatStreamSink` (`web/chat/turn.ts`, `types/web-chat.ts`): the entire engine, unmodified; `openDiplomacyChat` (`web/chat/factory.ts`); `enactAgentDeal`, `appendDealReject`, `requireCurrentOpenProposal`, `withThreadLock`, `mirrorDealRowsBestEffort` (`web/chat/deal.ts`, now composed inside the extracted actions); `readTranscriptPage`/transcript utils (stage 03); `isThreadBusy` (stage 03); the `{{{Greeting}}}` convention; stage-6 `enact-agent-deal` idempotency (unchanged: double-accept is already refused at the transcript level).

## Verify

Full loop in a live interactive game (all services up), against a pair that also has Web history:

1. Open the panel from Converse: the shared transcript renders (Web rows included); an empty pair auto-greets like the Web.
2. Send a message: optimistic row → status line ("Envoy is thinking…" / tool status) → streamed partial text → final reply row that **matches the durable transcript row**. Check IDs in the Web view. Reasoning and tool details remain revealable there, but their content never reaches the game.
3. Leave the panel mid-run: a native notification arrives on completion; click it turns later: the conversation opens with the finished reply (cross-turn correspondence).
4. Reopen mid-run: `Begin.busy` shows "envoy is composing…" before the turn completes; final rows arrive as ordered increments without another reflush.
5. Deals: propose with a promise from the vendored screen → the committed card appears from `connected.deal`; the negotiator counters → the counter card arrives; accept in-game → items change hands, `deal-accept` + `deal-enacted` rows arrive, the card re-badges Enacted; a second accept is refused (existing idempotency). Reject re-badges the card via the panel reducer. A stale counter (server-side proposal changed) surfaces the 409 as an error status with the draft preserved.
6. The Web routes still pass their existing behavior after the extraction refactor (accept/reject/close from the Web UI unchanged, including status codes).

## Done when

The stage-7 objective holds end to end: converse, streamed replies, notification-carried cross-turn correspondence, native-looking deal negotiation with promises, real enactment through `enact-agent-deal`: with the in-game path running through the same engine, helpers, and transcript as the Web.
