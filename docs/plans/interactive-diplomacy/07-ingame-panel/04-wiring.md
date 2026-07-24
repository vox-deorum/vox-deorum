# Stage 7.04: Wire live chat, deals, and notifications

> Part of the stage-7 sub-plan ([specification](specs.md); [stage index](../07-ingame-panel.md)). Stages 7.01 and 7.02 delivered the panel and deal editor behind mock drivers. Stage 7.03 delivered the event transport, push functions, transcript paging, and bridge queues. This stage replaces the probes and mocks with the existing Web chat engine and real deal actions.

## Objective

Make the in-game diplomacy panel a second client of the Web conversation backend.

The player can open a shared transcript, send a message, watch the counterpart's assigned diplomat stream a reply, negotiate and enact deals, and resume the conversation through native notifications. The normal player, human strategist, and pure observer paths use the same bridge and thread factory. Their only differences are the effective seat carried by the event and observer presentation.

The implementation is complete when:

- both clients use the same deterministic diplomacy thread and durable transcript;
- `runChatTurn` owns every human message, proposal, and counter;
- accept, reject, and retract use shared backend actions;
- the panel receives authoritative transcript rows, not a second deal-state protocol;
- accepted deals still enact only through `enact-agent-deal`;
- promise terms that are already illegal are refused before a proposal is stored;
- a pure observer can open VP's native deal presentation, while native item legality and backend enactment continue to reject unsupported participants;
- successful replies and deal outcomes produce native notifications, including across turn boundaries.

## Starting point and constraints

The stage-03 bridge in `vox-agents/src/envoy/ingame-bridge.ts` already owns two independent per-pair queues:

- the action FIFO serializes mutating chat and deal events;
- the push FIFO orders Lua calls and atomic transcript reflushes without waiting for the action FIFO.

`DiplomacyChatMessage` still uses the temporary `appendProbe`, and `DiplomacyDealAction` still reports that deal actions are not wired. `civ5-mod/UI/VoxDeorumDiploTransport.lua` still contains probe listeners, and both UI contexts still finish with mock-driver includes.

The Web implementation already provides the reusable engine:

- `runChatTurn` in `vox-agents/src/web/chat/turn.ts`;
- `openDiplomacyChat` in `vox-agents/src/web/chat/factory.ts`;
- the thread lock in `utils/diplomacy/chat-turn-commit.ts`;
- proposal, rejection, and enactment helpers in `utils/diplomacy/deal.ts`;
- durable transcript utilities in `utils/diplomacy/transcript.ts`.

This stage may extend those interfaces, but it must not create a game-only chat engine or duplicate route logic.

## Technical decisions

1. **`runChatTurn` reports the durable rows it creates.** Streaming deltas are temporary presentation. The shared transcript writers expose each successful write to a turn-scoped collector, and `runChatTurn` forwards those exact rows through its sink in append order. This covers the caller row, final diplomat reply, deal-tool rows, and a possible `close` row without a second transcript read. The transcript remains authoritative, and the panel still deduplicates by transcript ID.

2. **Proposal state belongs to the backend.** The panel and Lua driver do not decide whether a rejection is redundant or stale. The authoritative transcript write handles it atomically: repeating the same rejection returns the existing result without appending another row, while rejecting an accepted, countered, or superseded proposal is a conflict.

3. **VP's observer deal presentation remains available.** VP can bind an observer slot as `g_iUs` and show the native trade screen. Vox Deorum removes its stricter presentation-only major-civilization checks. This does not make observer deal items legal: `CvDeal::IsPossibleToTradeItem`, `inspect-deal`, proposal validation, and enactment retain their existing participant limits.

4. **One game action may be pending per pair.** No request token is added. The bridge pushes the committed row associated with the action, and the transport driver resolves the mounted deal editor only when that row matches the pending action. Re-pushing an existing row for an idempotent rejection is valid: the panel deduplicates it, while the deal-screen resolver still receives the acknowledgement.

5. **Notifications report newly committed successful outcomes only.** A completed chat or deal turn and a state-changing accept, reject, or retract post a notification. An idempotent acknowledgement, validation conflict, transport failure, or pre-commit rejection does not post another one.

## Work items

### 1. Create a shared deal-action boundary

Refactor `vox-agents/src/web/chat/deal.ts` so Express routes contain only HTTP lookup, request parsing, and response mapping.

First, make the error vocabulary consistent:

- Change `requireCurrentOpenProposal` to throw `ProposalConflictError` for a missing, closed, superseded, malformed, or self-authored proposal instead of throwing bare `Error`.
- Add a shared live-turn and closed-this-turn guard used by `runChatTurn`, accept, and reject. It must preserve the stricter `runChatTurn` behavior: a live thread without a current turn is unavailable, not turn zero or the thread's cached metadata turn.
- Give the missing-live-turn and closed-this-turn cases distinct typed errors so both transports can map them without inspecting message text.
- Keep the shared thread-busy message in one constant.

Then add transport-neutral actions:

- `acceptDealAction(thread, proposalMessageID)`;
- `rejectDealAction(thread, proposalMessageID, content?)`.

Each action:

1. checks that the thread is a live diplomacy thread;
2. applies the shared live-turn and closed-this-turn guard;
3. derives the acting endpoint with `audienceID(thread)`;
4. runs under `withThreadLock`;
5. calls the authoritative deal helper;
6. hydrates the returned durable rows directly into the live cache;
7. returns the durable outcome row or rows needed by non-Web transports.

Keep thread lookup transport-specific. Express continues to resolve `chatId`; the in-game bridge passes an already opened `EnvoyThread`.

Move redundant-rejection handling into the mcp-server transcript write used by `appendDealReject`. The check and write must run in one store transaction:

- if the referenced proposal is the active open offer, append `deal-reject`;
- if that proposal already has a rejection by the same speaker, return the existing row with `AlreadyRejected: true` and do not write;
- if a different proposal is active or the proposal is accepted, enacted, or superseded, return a conflict;
- never append two terminal rejection rows for the same proposal.

Translate that backend conflict to `ProposalConflictError` at the vox-agents boundary. The Web mapper preserves its public status classes:

| Error | HTTP |
|---|---:|
| invalid request or `IllegalDealError` | 400 |
| busy, closed this turn, or proposal conflict | 409 |
| live turn unavailable | 503 |
| store, bridge, inspection, or enactment failure | 502 |

Delete accept's catch-time second call to `requireCurrentOpenProposal`. Typed failures and the backend transaction now distinguish conflict from infrastructure failure without a race-prone re-probe. Replace `mirrorDealRowsBestEffort` with a small direct hydrator for returned rows, and remove the full deal-transcript reread if it has no remaining caller.

Update the existing Web route tests, shared action tests, and transcript-write tests to cover typed errors, idempotent rejection, and stale rejection. The Web UI behavior remains unchanged except that a repeated reject no longer creates a redundant row.

### 2. Make `runChatTurn` report every durable row

Add a turn-scoped transcript-write collector in vox-agents. Use `AsyncLocalStorage`, following the existing `VoxContext` pattern, so writes made by nested diplomat and negotiator tools remain associated with the active `runChatTurn` without adding transport parameters to every tool call.

The collector:

- is installed before `beginChatTurn` and remains active through completion or terminal failure;
- accepts rows only for the active thread;
- records a row only after the backing store confirms that the current operation wrote it;
- deduplicates by transcript ID and exposes rows in ID order;
- is a no-op for writes outside a captured turn.

Make every relevant write-through helper return and record an exact `TranscriptPushMessage` projection:

- `beginChatTurn` exposes the committed caller row for ordinary text, proposal, and counter requests, and uses that row's ID and turn in the live cache. A triple-brace trigger has no durable caller row.
- `ChatTurn.complete` returns and records the archived diplomat reply row when there is one, and uses that exact row when normalizing the cached reply.
- `appendDealProposal` continues to return its exact proposal or counter row and also records it.
- `appendDealReject` returns the exact new or existing rejection row and records it only when the current call created it.
- `appendCloseMessage` returns its close row as well as the stamped turn. `closeConversation` returns the ordered rejection and close rows it created.
- `enact-agent-deal` adds full `deal-accept` and `deal-enacted` row projections while retaining its current ID and status fields. Its idempotent path returns the existing enacted row. Pass the active thread into `enactAgentDeal` from the shared action and negotiator so it can record only rows created by the current call for the captured thread.

Widen the transport-neutral sink events:

- `connected.rows` contains the durable caller row committed before the model run;
- `done.rows` contains rows committed after `connected`, including terminal tool rows and the final archived reply;
- `error.rows` contains any rows committed after `connected` but before a post-commit failure.

Keep the existing `connected.deal` and `done.deals` fields as Web compatibility projections during this stage, but derive them from the same captured rows. Do not reread deal messages at the end of the turn.

Every committed turn emits exactly one terminal sink event. Each terminal path snapshots the collector once, then sends either `done` or `error`.

`runChatTurn` uses the captured deal rows to update `thread.messages` at the existing reply boundary before emitting `done`. This preserves the current cache ordering without the `knownDealIDs` scan and `readDealMessages` reconciliation.

Stop treating final reply archival as best-effort. If the store refuses that append, `ChatTurn.complete` throws, `runChatTurn` emits `error` with any rows already committed after `connected`, and no `done` event is sent. A streamed draft therefore cannot be mistaken for a durable completed reply.

Add focused tests for:

- caller text, proposal, and counter rows in `connected.rows`;
- final reply, proposal, rejection, enactment, and close rows in `done.rows`;
- nested negotiator writes remaining inside the correct turn capture;
- ID ordering and duplicate suppression;
- rows committed before a post-commit failure appearing in `error.rows`;
- final reply archival failure producing `error`, not `done`;
- unchanged Web event payloads derived from the new row lists.

### 3. Make thread reopening safe during a live turn

Move the reopen-while-busy guard into `openDiplomacyChat`.

When the deterministic pair thread already exists and `isThreadBusy(thread.id)` is true, return it without changing:

- participant metadata;
- agent or context assignment;
- title or timestamps;
- `thread.messages`;
- compaction state.

This protects both clients. A Web reopen can no longer compact and replace `thread.messages` after `beginChatTurn` captured its reply index. The in-game bridge also gets the existing thread so `Begin.busy` and `ThreadBusyError` describe the same live state.

Add a factory test that opens a thread during an in-flight turn and proves that no dependency mutation or compaction occurs.

### 4. Reject dead-on-arrival promises before archival

`appendDealProposal` already rejects illegal ordinary trade items after a fresh `inspect-deal`, but promises currently receive only advisory agreeability factors. A schema-valid promise can therefore become the active durable offer even when enactment would reject it immediately.

Close the gap at the shared proposal chokepoint:

1. Widen `InspectedPromiseSchema` in `mcp-server/src/tools/knowledge/inspect-deal.ts` with `legality` and `reasons`, matching the existing inspected-item vocabulary. Keep `agreeabilityFactors` unchanged and advisory.
2. Pass proposed promises into the read-only `inspect-deal.lua` invocation.
3. In `mcp-server/lua/inspect-deal.lua`, extract enact mode's promise checks into one read-only validator used by both inspection and enactment. It covers:
   - two distinct live endpoints and correct pair direction;
   - duplicate logical commitments;
   - a valid third-party Coop War target;
   - both-direction Coop War eligibility;
   - an already-preparing Coop War;
   - existing `MILITARY`, `EXPANSION`, and `BORDER` promises.
4. Return one legality result per input promise, aligned by index.
5. Extend `appendDealProposal`'s existing `IllegalDealError` guard to include illegal promises and their per-term reasons. Broaden its structured detail type from trade items to deal terms so negotiator feedback does not parse display strings.

`NO_DIGGING` remains always legal at inspection because the game exposes no made-state query and reapplying it at enactment is harmless. Enactment still repeats every check against current game state. Proposal-time inspection prevents only offers that are already impossible.

Add mcp-server and vox-agents tests for each promise rule, including Web-authored and negotiator-authored proposals. Verify that an illegal promise writes no proposal row.

### 5. Replace the chat probe with `runChatTurn`

Widen the bridge's internal event parser so it retains the full canonical deal-action shape as well as chat text:

- `Action`;
- `Deal`;
- `ProposalMessageID`;
- `Text`.

For `DiplomacyChatMessage`, keep the existing admission rule: valid event shape, different player and counterpart IDs, and a live counterpart context. Do not add seat attestation or flavor-specific capability logic.

On the action FIFO:

1. Open the pair with `openDiplomacyChat`, always passing the event `PlayerID` as `callerPlayerID`.
2. Pass `callerRole: "Observer"` and no caller identity only when `AsObserver` is true.
3. Call `runChatTurn({ kind: "text", chatId: thread.id, message: event.Text }, gameSink)`.
4. Let the game sink push `connected.rows`, streaming deltas, and the terminal `done.rows` or `error.rows`.
5. Await the push work queued by the sink.
6. Post the successful-outcome notification from item 7 only when the sink reached `done`.

Delete `appendProbe`. `runChatTurn` commits the caller row itself, so a pre-append would duplicate the message.

A pre-stream `ChatTurnRejection` becomes `Status{error}`. A post-commit failure comes through `sink.error`, including any durable rows written before the failure. The streamed draft remains temporary and is replaced only when the durable final reply arrives in `done.rows`.

### 6. Add the game stream sink and real deal handler

Implement a `ChatStreamSink` adapter inside `vox-agents/src/envoy/ingame-bridge.ts`.

#### Stream mapping

The sink uses an explicit chunk allowlist:

- `text-delta` with `id === "progress"` becomes a generic composing or tool status, never spoken text;
- ordinary `text-delta` chunks append to one accumulated spoken reply;
- about once per second, convert the accumulated reply with `markdownToCiv5` and enqueue `VoxDeorumDiploDelta`;
- recognized reasoning and non-message tool chunks become generic `reasoning` or `tool` states without their content;
- an unknown chunk is dropped, or produces at most one generic status;
- `onDisconnect` is a no-op because there is no browser socket to cancel the game run.

Sink callbacks never await the action FIFO. They only append work to the independent push FIFO.

Push every row from `connected.rows`, `done.rows`, and `error.rows` through the existing `Messages{append}` path. The game sink also retains those rows as the outcome of the current action for pending-action resolution and notification text. At completion, snapshot and await the current per-pair push tail. Extend the queue helper so this tail can be observed without awaiting it from inside one of its own workers.

#### Deal actions

Handle `DiplomacyDealAction` on the action FIFO:

- **Propose:** call `runChatTurn({ kind: "deal", chatId, deal }, gameSink)`.
- **Counter:** call `runChatTurn({ kind: "deal", chatId, deal, expectedProposalID: ProposalMessageID }, gameSink)`.
- **Accept:** call `acceptDealAction(thread, ProposalMessageID)`.
- **Reject or retract:** call `rejectDealAction(thread, ProposalMessageID, Text)`. The game event uses canonical `reject`; retract remains a local driver intent.

Propose and Counter receive their rows from the `runChatTurn` sink. Accept queues the exact rows returned by `acceptDealAction`; Reject and Retract queue the exact row returned by `rejectDealAction`. There is no post-action transcript query. Typed failures use one bridge mapper and become `Status{error}`.

The game-side pending resolver uses durable rows:

- proposal and counter resolve from the exact caller row in `connected.rows`;
- accept resolves when the matching `deal-accept` and `deal-enacted` result rows arrive;
- reject and retract resolve from the matching `deal-reject`, including an existing row returned by the backend's idempotent path;
- an error raises `LuaEvents.VoxDeorumDealActionResolved({ success = false, reason = ... })`.

The panel keeps the proposal card pending, and the deal screen keeps its mounted editor, until this resolution. On error, the existing screen resolver restores the same terms, promises, and public message.

### 7. Post native notifications for successful outcomes

Add one notification helper in vox-agents that:

- accepts the caller, counterpart, and durable outcome rows;
- uses the counterpart leader name as `Summary`;
- selects the first non-empty line of the final counterpart reply or deal outcome as `Message`;
- converts both fields through `markdownToPlain`;
- strips the pipe delimiter and trims to the tool's schema limits;
- calls `post-notification` with `PlayerID` and `CounterpartID`.

Call it after:

- a successfully completed text or deal turn;
- a successful accept;
- a newly written reject or retract.

Do not call it for an idempotent rejection acknowledgement, validation error, conflict, unavailable turn, or transport failure.

Observer notification delivery requires two mcp-server changes:

1. Add a shared `MaxPlayers` bound beside `MaxMajorCivs`, and widen `post-notification`'s `PlayerID` to the full game-player range. `CounterpartID` remains a major civilization.
2. In `mcp-server/lua/post-notification.lua`, redirect a notification addressed to a pinned seat to `Game.GetActivePlayer()` when the active player is an observer whose UI override equals that requested seat. A pure observer keeps its real observer slot, and normal play remains unchanged.

The bridge always posts after a successful outcome. In `VoxDeorumDiploPanel.lua`, if a notification for the currently open pair is added, remove it immediately. Opening or clicking a conversation continues to dismiss all previously tracked notifications for that pair.

### 8. Replace the Lua mocks with transport drivers

Grow `civ5-mod/UI/VoxDeorumDiploTransport.lua` from the stage-03 probe into the real panel driver:

- remove the `Lua.log` probe listeners;
- keep lazy `Game.RegisterFunction` registration;
- implement `onOpen`, `onSend`, `onLoadEarlier`, retry, and push-event handlers;
- compute the effective seat once per outbound event with `VoxDeorumSeat`;
- include `AsObserver = true` only for a pure observer;
- emit `DiplomacyPanelOpened`, `DiplomacyChatMessage`, and `DiplomacyTranscriptRequest`;
- translate `Begin`, `Messages`, `Status`, and `Delta` into the existing `VoxDeorumDiploUI` methods;
- retain the panel's transport acknowledgement and reply-silence timeout tiers.

Keep the existing `VoxDeorumDiploTransport` include and remove the following `VoxDeorumDiploPanelMock` include.

Create `civ5-mod/UI/VoxDeorumDealTransport.lua` as the real `VoxDeorumDealUI.driver`, then include it from `VoxDeorumDealScreen.lua` in place of `VoxDeorumDealScreenMock`. The deal screen is a separate Lua context, so this driver registers its own functions and listens to the global diplomacy `Messages` and `Status` events instead of depending on the panel context's globals.

The deal driver:

- Propose and Counter serialize the edited deal;
- Counter includes the mounted `proposalMessageID`;
- Accept, Reject, and Retract include the proposal ID;
- Retract maps deliberately to canonical `Action = "reject"`;
- Reset and Cancel remain local and emit no event;
- the event's `PlayerID` is the effective seat;
- each item's and promise's human-side endpoint is that same effective seat;
- the mounted screen stays pending until `VoxDeorumDealActionResolved`.

Track the pending pair, action, and proposal ID in the deal context. Match incoming durable rows to that state before raising `VoxDeorumDealActionResolved`. Update `VoxDeorum.modinfo` to import the new transport file, refresh changed file hashes, and remove the unused mock-driver entries when the mock files are deleted.

#### Preserve VP observer presentation

Remove Vox Deorum's presentation-only major-civilization admission checks:

- `VoxDeorumDealScreen.open` and `mount` accept the real effective seat when it is an addressable Civ player slot with `Players` and `Teams` entries, even when it is an observer;
- `VoxDeorumOpenDeal` and `VoxDeorumResumeHumanToHumanEditor` accept distinct player slots below `MAX_CIV_PLAYERS`, matching VP's native `OnOpenPlayerDealScreen`;
- keep the counterpart requirement as a living major civilization;
- bind the observer slot directly as `g_iUs`; do not substitute a major seat and do not override `Game.GetActivePlayer()`.

Keep native legality checks where they belong. Promise choice checks, ordinary item construction, `inspect-deal`, proposal archival, and enactment may report that an observer participant is unsupported. Those failures must restore the mounted editor and must not produce a partial transcript or game write.

Remove the final `VoxDeorumDealScreenMock` include once the real driver is active.

## Verification

### Automated checks

Run the repository build and test commands from the root:

- `npm run build:all`;
- `npm run test:all`.

The focused coverage must include:

- unchanged Web status classes for chat, accept, reject, and close;
- typed proposal, closed-turn, missing-turn, and busy failures;
- atomic idempotent rejection and stale rejection conflict;
- no accept catch-time re-probe;
- turn-scoped row capture across nested transcript writers;
- `connected.rows`, `done.rows`, and `error.rows` ordering and compatibility projections;
- final reply archival failure producing an error without a false completion;
- exact accept and idempotent-reject rows returned without a transcript reread;
- reopening a busy thread without mutation or compaction;
- game-sink chunk allowlisting, progress-sentinel handling, delta throttling, and default drop;
- push-tail ordering for captured durable rows;
- every promise legality rule and no-write failures;
- notification targeting and pinned-observer redirect;
- full parsing of `DiplomacyDealAction`.

### Live game checks

With Civ V, bridge-service, mcp-server, and an interactive vox-agents session running:

1. Open a pair that already has Web history. Confirm the full shared transcript renders and triple-brace control rows remain hidden.
2. Send a message. Confirm the sequence is sending, composing or tool status, streamed draft, then the exact durable final row. The Web view must show the same transcript IDs and raw markdown.
3. Leave during generation. Confirm a native notification arrives after the durable result, survives a turn boundary, and opens the correct pair.
4. Keep the panel open through a reply. Confirm the notification is posted and immediately removed for the open pair.
5. Reopen during generation. Confirm `Begin.busy`, ordered increments, and no cache resynchronization under the active turn.
6. Propose and counter from the native editor. Confirm the exact committed card arrives in `connected.rows`, the edited counter carries `expectedProposalID`, and Reset remains local.
7. Accept a proposal. Confirm `deal-accept` and `deal-enacted` arrive, game state changes, and a second accept is refused.
8. Reject and retract. Retry the same action once and confirm the backend returns the existing outcome without appending a duplicate row. Attempt a stale rejection after a counter and confirm a clean conflict with the draft preserved.
9. Submit an already-made standing promise, an ineligible Coop War, and a malformed promise direction through both Web and game paths. Confirm each is rejected before a proposal row is stored.
10. Repeat as a human strategist. Confirm the pinned civilization's thread, diplomat, deal endpoints, enactment, notification redirect, and Web history all match normal play.
11. Repeat as a pure observer. Confirm VP's native deal presentation opens with the real observer slot as `g_iUs`. Unsupported item or enactment actions must fail cleanly with no partial transcript or game-state write.

## Out of scope

- live mirroring into an already open Web chat;
- a new deal-state push channel;
- forward transcript cursors or post-action transcript reconciliation;
- request tokens or stream generations;
- widening native deal-item legality to make observer slots valid major-civilization participants;
- changing the stage-8 direction configuration;
- changing the Declare War path delivered by stage 7.01.

## Done when

The in-game panel and Web are two clients of the same conversation system. They share the diplomat, thread, transcript, proposal validation, deal actions, and enactment path. Streaming remains responsive, final UI state comes from durable rows, notifications carry successful outcomes across turns, and every supported seat can open the same presentation without bypassing native authority.
