# Stage 7: In-game diplomacy panel: specification and pinned contracts

> Part of the interactive-diplomacy plan ([../README.md](../README.md), requirements in [../specs.md](../specs.md)). This folder is the staged sub-plan for the in-game panel; [../07-ingame-panel.md](../07-ingame-panel.md) is its index. Stage docs: [01-ui-groundwork.md](01-ui-groundwork.md) → [05-hardening.md](05-hardening.md).

## What this is

The in-game counterpart of the Web v1 diplomacy flow supports three active-player situations: a **normal human player** playing their own civilization, a **human strategist** observing with `Game.GetObserverUIOverridePlayer()` pinned to their civilization seat, and a **pure observer** with no override. The effective seat governs the conversation. Every flavor converses with the counterpart's assigned diplomat and has the same chat, streaming, notification, and deal surface; the observer flavors exist for debugging and receive no special backend treatment. `CvDeal` accepts only native major-civilization participants, so a pure observer whose concrete slot is outside that range simply fails its deal actions with a clean error at the existing native gates. A pure observer can never declare war. The surface includes a **Converse** entry on the leader discussion screen, a native-styled chat panel over the durable pair transcript with streamed replies, and the game's own trade screen with locally computed h2h legality plus promises presented as a native trade-screen category. The deal screen is a separate mod context that includes VP's (3a) `TradeLogic.lua`, into which nil-defaulted Vox seams are added in place; no fallback copy exists. Native notifications let a conversation stretch across turns ("mailing"). Deals enact through the same `enact-agent-deal` path as the Web.

Two principles govern every design choice here:

1. **The panel is a second client of the same backend.** It reuses the Web chat engine (`runChatTurn`), the same durable transcript, the same deal helpers, and the same client-side derivation model. Where the existing code is route-shaped rather than reusable, we **extract** it into transport-neutral helpers that both the Express routes and the in-game bridge call: we do not fork logic.
2. **The server pushes rows, not state.** Like the Web, the panel derives deal status by reducing transcript messages with `deriveActiveProposal` semantics. The server pushes only three facts that clients cannot derive: `hasEnvoy`, `busy`, and `hasMore`.

A third principle governs the game side: **the VP tree and the DLL are vendored in this repo and ship through the installer, so they are ours to modify** — under two pinned rules: every new argument, global, or hook defaults to vanilla behavior when nil or unset, so a stock game is behaviorally identical; and every change to a VP file — Lua, XML, or DLL source, including Vox-specific divergences inside copied VP files — carries an explicit `Vox Deorum:` comment (`-- Vox Deorum: …` / `<!-- Vox Deorum: … -->` / `// Vox Deorum: …`), so every deviation is findable by grep for reviews and future VP-upstream merges.

Out of scope (per parent specs §6): any real-time Web⇄game mirroring. The Web and the panel share storage and agents; each refreshes on open. A Web-side action becomes visible in-game on the next panel open, and vice versa.

## Architecture

```
 in-game (civ5-mod)                            server side
 ┌────────────────────────────────┐            ┌────────────────────────────────┐
 │ VoxDeorumConverse (01)         │  4 game    │ mcp-server (thin transport):   │
 │  button on the leader screen   │  events    │  event schemas + whitelist,    │
 │ VoxDeorumDiploPanel (01)       │ ─────────► │  call-lua-function tool        │
 │  chat panel; registers the     │            │ vox-agents (all logic):        │
 │  push functions; derives deal  │ ◄───────── │  ingame-bridge → runChatTurn / │
 │  state from rows (Lua port of  │  4 push    │  deal action helpers /         │
 │  deriveActiveProposal)         │  functions │  enact-agent-deal              │
 │ VoxDeorumDealScreen (02)       │            └────────────────────────────────┘
 │  native trade screen reused in │                     │
 │  place; local h2h legality     │   native            │
 └────────────────────────────────┘   notification ◄────┘
          ▲ click on notification ────┘   (01)
```

Game→server travels as `Game.BroadcastEvent` game events through the existing DLL→bridge→mcp-server→vox-agents notification pipeline (the `HumanDecision` pattern). Server→game travels as structured Lua calls through one new generic mcp tool, invoking functions **the mod itself registers**: the mod owns its presentation surface; mcp-server stays a transparent transport; all conversation logic lives in vox-agents.

## Pinned contracts

### Observer flavors and the effective seat

The active-player situations share one seat rule. In Lua, the **effective seat** is the observer UI override when the active player is an observer and the override is non-negative. Otherwise it is `Game.GetActivePlayer()`. A **pure observer** is an observer whose override is negative. A pinned observer is called a **human strategist** and acts as the pinned civilization for diplomacy.

This gate requires no DLL change. `CvTeam::isHasMet` in `civ5-dll/CvGameCoreDLL_Expansion2/CvTeam.cpp` already delegates an observer team's met check to the override player's team, or reports all teams met for a pure observer. `canConverse` in `civ5-mod/UI/VoxDeorumConverse.lua` can therefore use the effective seat and only needs to exclude the pinned seat itself.

**Capability rule:** there is no per-flavor capability gating. Every caller gets the full chat and deal surface; an unsupported participant (an observer slot outside `0 <= playerID < GameDefines.MAX_MAJOR_CIVS`, TradeLogic's shipped pre-mutation `VoxDeorumOpenDeal` range gate) fails its deal actions at the existing native gates — the range gate, `inspect-deal`, the proposal legality guard, enactment — with a clean error and no partial writes. That failure is the intended debug-grade behavior, not a gap to close. Declare War remains a separate seat authority and is never available to a pure observer.

| Capability | Normal human | Human strategist | Pure observer |
|---|---|---|---|
| Converse, transcript paging, streaming, and notifications | Yes | Yes | Yes |
| Agent voice | Assigned diplomat | Assigned diplomat of the counterpart (same as normal play) | Assigned diplomat of the counterpart |
| Durable thread | Effective-seat pair | Same effective-seat pair as normal play and the Web | Observer's real slot ID paired with the counterpart |
| Deal cards and deal actions | Full interaction | Full interaction on behalf of the pinned civilization | Same surface; unsupported slots fail with a clean error (debug aid) |
| Declare War | Present | Present | Absent |
| Declare War transport | `Network.SendChangeWar` | `Teams[pinnedTeam]:DeclareWar(counterpartTeam, false, pinnedSeatID)` | Unavailable |
| Agent-side close | Diplomat may close | Diplomat may close | Diplomat may close |

A human strategist's event and thread identity is deliberately indistinguishable from normal play. It uses the pinned civilization's seat, identity, role, assigned voice, and deterministic `dipl:${gameID}:${min}:${max}` thread, so the panel, normal play, and Web share one conversation. A pure observer uses the same durable diplomacy-thread machinery, keyed by the observer's real slot ID rather than the Web's `-1` sentinel, and passes `callerRole: 'Observer'` for display; the observer slot has no civilization identity, which the existing factory already tolerates.

**Caller trust:** events originate from our own mod over the local pipe, so the bridge trusts the event-carried effective seat like it trusts every other game event (the `HumanDecision` precedent). Validation is a cheap shape check — schema-valid payload, `PlayerID ≠ CounterpartID`, counterpart seat context live — identical for every flavor. There is no seat-state attestation query and no `canActOnDeals` derivation; display identities are cosmetic and authority questions reduce to what the native game accepts when an action executes.

### Game → server: four broadcast events

All emitted as `Game.BroadcastEvent(name, payload, true)`. `generateId = true` is mandatory (an id-less event crashes the mcp-server handler); the generated id doubles as the bridge-side duplicate-delivery key. Common fields: `PlayerID` is the effective seat (numeric, required, and may be an observer slot outside the major-civilization range), `CounterpartID` is the LLM civilization, `Turn` is `Game.GetGameTurn()` (validation only: execution always uses the live session turn), and optional `AsObserver` is the literal value `true` only for a pure observer. Normal humans and human strategists omit `AsObserver`, so a pinned observer's event has exactly the normal seated contract.

`AsObserver` is display-only: when present, the bridge passes `callerRole: 'Observer'` (and no civilization identity) so transcripts label the caller sensibly. It never changes the voice, the thread machinery, or any capability — the counterpart's assigned diplomat answers every flavor. The bridge always passes the event `PlayerID` explicitly as `callerPlayerID` because `resolveHumanSeat` cannot infer a seat in observer or autoplay sessions.

| Event | Payload beyond common fields | Meaning |
|---|---|---|
| `DiplomacyPanelOpened` | none | Panel opened for a pair; requests a conversation reflush (read-only). |
| `DiplomacyChatMessage` | `Text` (≤ 2000 chars, delimiter-sanitized) | Human sent a message; runs the diplomat. |
| `DiplomacyDealAction` | `Action ∈ propose\|counter\|accept\|reject`, `Deal?` (DealPayload v1), `ProposalMessageID?`, `Text?` | Deal move. `Deal` is required for propose and counter. `ProposalMessageID` is required for counter, accept, and reject; for counter it becomes `expectedProposalID`, the Web's stale-submission guard. |
| `DiplomacyTranscriptRequest` | `BeforeID` | Page older history (`ID < BeforeID`, read-only). |

There is no close event: the panel offers no close affordance (Goodbye merely hides it). Conversation closure is the diplomat's move (its `close-conversation` tool) or the Web's; the panel derives the closed state from the transcript's `close` row.

Each event needs a zod schema in `mcp-server/src/knowledge/schema/events/` (modeled on `HumanDecision.ts`), registration in the events index, and an entry in `eventsForNotification` in `mcp-server/src/server.ts`: otherwise it is dropped at the store gate or never forwarded to vox-agents.

### Server → game: four push functions

Transport is **one thin generic mcp tool `call-lua-function` `{ Name, Args[] }`** wrapping `bridgeManager.callLuaFunction(name, args)`: the structured-args path where the bridge JSON-serializes the args and the DLL's `ConvertJsonToLuaValue` rebuilds them as native Lua tables (the same mechanism `presentHumanDecision` uses; no JSON parsing in Lua).

Registration is **game-side**: the transport include `VoxDeorumDiploTransport.lua` (created in stage 03, grown into the driver in stage 04) registers each function via `Game.RegisterFunction(name, fn)` **lazily on first need**, never at context load: a context-load call would reach `CvConnectionService` before `Setup()` and crash, the same hazard that made `post-notification` a server tool. Each body just fires the same-named `LuaEvents` and returns `true`. Registrations survive bridge/pipe reconnects because the DLL-side registry (`m_registeredFunctions`) is only cleared at `Shutdown()`; stage 03 confirms this live.

| Function | Args | Meaning |
|---|---|---|
| `VoxDeorumDiploBegin` | `playerID, counterpartID, turn, meta` | Starts a reflush: the panel clears the pair's log and applies `meta = { hasEnvoy, busy, hasMore }`. |
| `VoxDeorumDiploMessages` | `playerID, counterpartID, batch` | `batch = { mode: "append"\|"prepend", messages[], hasMore? }`. Rows are the `TranscriptMessage` projection `{ ID, SpeakerID, MessageType, Content, Payload?, Turn }`. Serves the initial fill (ordered `append` batches after `Begin`), paging (`prepend` + `hasMore`), and live increments (single-row `append`). The panel dedupes rows by `ID` and re-runs its reducer; a final reply row replaces any streaming draft. |
| `VoxDeorumDiploStatus` | `playerID, counterpartID, status` | Live agent activity: `{ state: "composing"\|"reasoning"\|"tool"\|"error", detail? }`, produced through a strict allowlist. Reasoning/tool **content** never crosses into the game: only the state (details remain revealable in the Web UI, which already renders them collapsed). |
| `VoxDeorumDiploDelta` | `playerID, counterpartID, text` | The **accumulated** partial reply text so far (idempotent re-render), throttled to ~1/s. Stale deltas arriving after the final row are ignored. |

There is no separate deal-state push. Reflushes and increments carry transcript rows, and the panel derives state from them. For example, Reject follows this path: the player opens the active proposal in its incoming or own editable mount and selects Reject or Retract → the card shows an animated rejecting row → the panel emits `DiplomacyDealAction{reject, ProposalMessageID}` → the bridge runs the shared reject action with the thread lock and open-proposal guard → the bridge appends and pushes the `deal-reject` row → the panel adds the row, reruns the reducer, returns the proposal to a settled non-clickable card, and clears the pending state. This matches the Web client receiving a new message.

The panel renderer is append-only during normal operation. Each visible append builds one new message instance, existing proposal cards refresh in place, and dot animation only changes pooled tail labels. The scroll follows new content only when it was already at the bottom. Open, reset, and user-requested prepends may rebuild the transcript; prepends restore the prior visible position approximately.

The durable transcript stores raw markdown so the Web can continue rendering it with `marked`. At the game boundary, pushed transcript `Content` passes through `markdownToCiv5`, while notification summaries and messages pass through `markdownToPlain`. Raw Civ 5 markup tags embedded in content pass through the game conversion unchanged.

### Client-side derivation (the panel mirrors the Web client)

The Web runs these on the browser side; the panel ports them to Lua (small, accepted duplications with cross-reference comments both ways: the same pattern as the `inspect-deal.lua` helper ports):

- **`deriveActiveProposal`** (`vox-agents/src/utils/diplomacy/deal-reduce.ts`, ~40 lines; re-exported to the browser via `ui/src/utils/deal/deal-reduce.ts`): the latest `deal-proposal`/`deal-counter` is the active proposal; later `deal-accept`/`deal-reject`/`deal-enacted` referencing its `Payload.ProposalMessageID` set its status (acceptance sticky, enacted terminal); earlier proposals are superseded history. The panel uses that result to make only the active open proposal card clickable. Settled and superseded proposal cards remain fully readable but are non-clickable.
- **`isClosedThisTurn`** (`transcript-utils.ts`): derived from the last `close` row's `Turn` vs the current turn; locks input and deal actions until a later turn. The server still enforces this on every action: the derivation is display-only.
- **Special-row filtering**: rows whose `Content` is a `{{{token}}}` trigger (e.g. `{{{Greeting}}}`) are hidden from display, as `visibleMessages` does on the Web.
- **Notification tracking**: the panel tracks notification IDs in both directions. `Events.NotificationRemoved` prunes IDs after right-click dismissal or any native removal, and activation validates the counterpart before consuming pair notifications.

### Pending resolution (no tokens)

One in-flight action per pair is a **UI invariant**: Send and deal buttons disable while an action is pending. Correlation therefore needs no token (the Web needs none either: its correlation is the HTTP stream): an optimistic "sending…" row clears when the human's own committed row arrives; a pending deal badge clears when the matching `deal-*` row arrives. Two-tier timeouts back this up: **~10 s transport-ack** (nothing arrived at all → "not delivered: Retry") and **~90 s reply silence** (no `Status`/`Delta`/`Messages` → "The envoy seems unavailable: Retry / Goodbye").

### UI responsiveness rules (every screen)

The player must never wonder whether the panel froze:

- Immediate optimistic feedback for every action: Send → greyed "sending…" row; a deal action submitted from the deal screen → the proposal bubble greys with an animated "accepting ⋯ / rejecting ⋯ / proposing ⋯" status row (bubble unclickable while pending); panel open → "loading conversation…" until `Begin`; "Load earlier…" → inline loading row.
- Animated in-progress indicators (a dot-cycling label driven by `ContextPtr:SetUpdate`: Civ V has no native spinner) for pending sends, in-flight deal actions, agent activity ("Envoy is thinking…", "Envoy is consulting advisors…" from `Status`), and the streaming draft.
- `Begin.busy` = a turn is in flight for this pair; the panel shows "envoy is composing…" immediately on a reopen-during-run. (No draft replay: the Web loses in-flight streams on reload too; the final rows arrive as increments.)
- Input is never hard-blocked without a visible, animated reason.

### Notification channel

`NOTIFICATION_VOX_DEORUM_DIPLOMACY` is a data-driven row in the `Notifications` XML table. The XML must write the `NotificationType` column, not `Type`. The DLL populates `NotificationTypes` from that column at load, so **no DLL change creates the type**. EUI renders the new type with its generic notification instance and uses the summary and message as tooltip text.

`CvNotifications::Add` in `civ5-dll/CvGameCoreDLL_Expansion2/CvNotifications.cpp` only displays a newly posted notification when its recipient is the active player. A human strategist's backend recipient is the pinned effective seat, while the active player is the observer slot. The notification transport must account for that display gate.

- **Posting**: the general `post-notification` mcp-server tool calls `Players[playerID]:AddNotificationName` with the Vox Deorum type, message, summary, and counterpart (`iGameDataIndex` carries the counterpart for click routing). Its `PlayerID` schema must admit observer slot IDs rather than stopping at `MaxMajorCivs - 1`. In `mcp-server/lua/post-notification.lua`, a guarded branch redirects the recipient to `Game.GetActivePlayer()` when the active player is an observer whose UI override equals the requested `playerID`. This mirrors the observer goody-hut notification pattern in `civ5-dll/CvGameCoreDLL_Expansion2/CvPlayer.cpp`. Normal seats and pure-observer slot IDs keep their requested recipient. Counterpart is optional: a valid `CounterpartID` opens the conversation on click; `-1` shows `Message` in a `BUTTONPOPUP_TEXT` dialog and dismisses itself, so the channel serves any LLM-to-human message. It is a server tool, not a UI-registered function. The stage-01 smoke test posts directly via the mock's `AddNotificationName`.
- **Click dispatch**: there is no `Events.NotificationActivated` anywhere in Civ V, and the DLL's default `Activate` branch is a no-op. Add a small guarded branch to `GenericLeftClick` in the owned NotificationPanel.lua copies. It fires `LuaEvents.VoxDeorumDiplomacyNotificationActivated(Id, counterpartID, extra)` for this type and returns. The nil guard keeps installations without the mod unchanged.
- **Cross-turn persistence**: `CvNotifications::IsNotificationTypeEndOfTurnExpired` defaults to `true` for unknown types, which dismisses them at the turn boundary. Add one early return of `false` for the hashed Vox Deorum type. `Notification::Serialize` already provides save persistence.
- **Policy**: the bridge **always posts** on a reply or deal outcome; an open panel dismisses its own pair's notifications locally (`UI.RemoveNotification`).

### In-game LuaEvents vocabulary (mod-internal)

`VoxDeorumDiploOpen(counterpartID)` (Converse to panel) · the four push events above · `VoxDeorumOpenDealScreen({ counterpartID, mode, deal?, proposalMessageID? })` (panel to deal screen, where `mode` is `author`, `incoming`, or `own`) · `VoxDeorumDiplomacyNotificationActivated(notificationID, counterpartID, extra)` (notification click to panel) · the vox-gated TradeLogic refresh hooks `VoxDeorumTradeLogic{ResetDisplay,ClearTable,DisplayDeal,UpdateButtons}` (modified (3a) TradeLogic to the deal-screen wrapper; never fired outside Vox mode).

The deal screen also exposes the context-global `VoxDeorumDealUI` interface. Its driver receives one normalized action, and `resolve(result)` completes the single pending action. Because Lua contexts do not share globals, the wrapper also listens for `VoxDeorumDealActionResolved(result)` and delegates it to the context-local resolver. Stage 7.02 supplies the delayed mock driver. Stage 7.04 replaces the driver and raises the result event only after the matching durable row arrives; an error restores the mounted draft.

### Size and text rules

- **Server→game** lua-call args pass through a DLL-side ArduinoJson document whose capacity is a **node pool, not a byte count**: nested rows cost pool overhead well beyond their wire bytes. Stage 03 bumps the pool (64 KB → 256 KB) and makes overflow an explicit failure (never invoke Lua with silently dropped members), and the bridge packs `Messages` batches to a conservative **~32 KB wire budget**, sending multiple ordered batches when a window doesn't fit. **No content truncation.** A single row exceeding the budget is the one unsplittable edge (watch-item; LLM replies are practically bounded far below it).
- **Game→server** `Game.BroadcastEvent` currently serializes into a **2 KB** document (silent member-dropping on overflow): stage 03 bumps it to 64 KB. The deal screen keeps a coarse Lua-side length check so an oversized send fails loudly with an on-screen reason.
- **Text**: chat input ≤ 2000 chars (the `relay-message` precedent). The IPC frame delimiter `!@#$%^!` is stripped from all human/LLM text at both edges (panel input before broadcast; bridge-pushed `Content` before the Lua call): raw delimiter framing is otherwise content-sensitive. Recorded as accepted infra debt; a framing rework is out of scope here.

## Reuse and extension map

Verified against the code; this is the contract between this plan and the existing Web backend.

**Reused as-is (in-process calls from the ingame-bridge):**

- `runChatTurn(body, sink)` in `vox-agents/src/web/chat/turn.ts`: the entire chat engine: validation, thread lookup, closed-this-turn 409, per-thread lock, durable commit (`beginChatTurn`), agent run, streaming, mid-run deal-row reconciliation, cleanup. The Express `/api/agents/message` route adds nothing but SSE wire format, so calling `runChatTurn` with a game-facing sink loses no domain logic. Both text moves (`{kind:'text', chatId, message}`) and deal proposal/counter moves (`{kind:'deal', chatId, deal, expectedProposalID?}`) go through it. Its `connected` event carries the authoritative committed proposal row for a deal turn; `done.deals` carries mid-run deal rows with durable IDs.
- `openDiplomacyChat(request)` in `vox-agents/src/web/chat/factory.ts`: deterministic thread per pair (`dipl:${gameID}:${min}:${max}`), diplomat resolution from `assignments[target].diplomat`, and identity handling — the same resolution for every seat flavor, no observer-specific branch. The bridge always supplies the event `PlayerID` as `callerPlayerID` (plus `callerRole: 'Observer'` for display when `AsObserver` is true) and never hand-builds a thread ID. The bridge uses the factory before mutating actions, never read-only reflushes, because it compacts and rehydrates the live cache. Stage 04 moves the reopen-while-busy guard into the factory: when the existing thread is busy, `openDiplomacyChat` updates nothing and returns it as-is, protecting both the bridge and the Web from a reopen re-syncing the cache under a streaming turn.
- `readTranscript(a, b)` in `vox-agents/src/utils/diplomacy/transcript.ts`: returns exactly the `TranscriptMessage` projection the push functions carry; the read-only reflush path is built on it, untouched by thread state. It and `sendNotification` already accept observer slot IDs.
- `withThreadLock` / `ThreadBusyError` in `chat-turn-commit.ts`, `requireCurrentOpenProposal`, `appendDealReject`, `enactAgentDeal`, `mirrorDealRowsBestEffort`, `currentTurnOf`, `audienceID`, `isClosedThisTurn`: the same primitives the deal routes compose.
- `deriveActiveProposal` (`deal-reduce.ts`): semantics ported to the panel's Lua reducer.
- The `{{{Greeting}}}` trigger convention stays **Web-only**. The panel never requests an LLM greeting turn; it shows a panel-local, display-only greeting row built from the counterpart leaderhead's standard localized discussion greeting (stage 04 item 6). The special-row filter still hides any `{{{token}}}` rows that arrive from Web-seeded history.

**Extended in small shared seams, not bridge-private forks:**

- **Consolidate deal-action errors, then extract the route bodies into transport-neutral action helpers.** Unlike the message route, the accept/reject route handlers own real logic the leaf helpers lack: the diplomacy-thread guard (`resolveDealThread`), the closed-this-turn gate (`isDealLocked`), the `withThreadLock` wrapping, the cache mirror (`mirrorDealRowsBestEffort`), and accept's conflict-versus-failure disambiguation in `web/chat/deal.ts`. Stage 04 first unifies the error vocabulary (`requireCurrentOpenProposal` throws `ProposalConflictError`, deleting accept's catch-time re-probe; one shared closed-this-turn guard replaces the two divergent copies in `runChatTurn` and the routes), then extracts `acceptDealAction` / `rejectDealAction` (accepter derived via `audienceID(thread)`) into that file. The actions throw typed errors; the Express routes and the ingame-bridge each map them through one small transport-specific mapper, preserving the Web's exact status codes.
- **Paginated transcript read.** No pagination exists anywhere (the Web loads full history). Add optional `BeforeID` / `Limit` to the `read-transcript` tool + `getDiplomaticMessages` getter (mcp-server) and a `readTranscriptPage` wrapper in `transcript.ts`, returning the newest `Limit` rows (below `BeforeID` when paging) plus `hasMore`.
- **A queryable busy flag.** The in-flight set is private to `chat-turn-commit.ts`; export `isThreadBusy(threadId)` so `Begin.busy` doesn't have to probe by acquiring the lock.
- **A game `ChatStreamSink`.** The only existing sink is the SSE one. Stage 04 adds the in-game adapter with delta throttling, a status allowlist, and a separate per-pair push FIFO.
- **Observer-capable notification targeting.** Widen the `PlayerID` schema in `mcp-server/src/tools/actions/post-notification.ts` to admit observer slots, and add the guarded pinned-seat redirect in `mcp-server/lua/post-notification.lua` described in the notification contract.
- **Observer-slot transcript admission.** No seat-state query and no attestation (see caller trust above). The only extension is storage tolerance: `append-message` / `read-transcript` must accept an out-of-range observer slot as one endpoint of the ordered pair, with role `Observer`, paired with a valid major civilization. Deal inspection and enactment keep their native participant limits untouched — an out-of-range slot's deal actions fail there naturally. Keep the Web's `-1` sentinel behavior unchanged, including its existing transcript-only semantics. Visibility remains limited to real major-civilization columns; the observer slot is part of the ordered pair but does not create a visibility column.

**New (no Web counterpart exists):**

- The four game-event schemas and whitelist entries; the `call-lua-function` mcp tool; the ingame-bridge module with separate per-pair action and push FIFOs; the notification posting path; everything under `civ5-mod/UI/`.

## Design decisions and non-goals

- **Mocks are seat-agnostic.** The stage-01/02 mocks exist to make UI testing easy. They always simulate a normal seated conversation, whatever seat they run under. Their deal controls are a normal-seat simulation, not evidence that a live pure-observer slot can use native deal actions. Observer presentation (the Observer speaker title and hidden war button) is live-state-driven and shows up automatically when the mock runs in an observer game.
- **No new durable idempotency machinery.** The existing transcript-level `deal-enacted` key prevents double enactment. A rare duplicated text row is cosmetic. Deduplicate overlapping pipe and SSE delivery by generated event ID.
- **No flush or stream generation counters.** A single human drives one panel. Each complete reflush is one atomic push-FIFO task, so its read, `Begin`, and message batches cannot interleave with live pushes. `Begin` resets the pair log, and the panel deduplicates rows by ID. The action FIFO never blocks a reopen behind a live turn.
- **No live Web⇄game sync** (parent specs §6): shared storage, not mirroring. Each surface refreshes on open. Notably the Web has no server-push into an open chat either: its open view updates only through the user's own streaming request.
- **Direction gating belongs to stage 8.** Stage 7 ships the in-game human→LLM path enabled for all three supported seat flavors. It does not add a direction flag or a disabled or read-only panel mode; stage 8 introduces the shared direction-config surface for every client.
- **Separate queues have separate owners.** MCP notification dispatch is fire-and-forget. An action FIFO serializes mutating chat and deal tasks. A push FIFO orders Lua calls and owns atomic read-only reflush tasks. It continues running while an action is active, so a reopen can report `Begin.busy` and stream deltas can arrive before `runChatTurn` completes. The panel still permits only one in-flight user action per pair. Residual `ThreadBusyError` cases surface as error status.
- **Editable proposal mounts, local editing, and server enactment.** Every mode mounts the native editor. Incoming and own proposals retain their immutable source, then group-aware filtering projects only legal ordinary terms and promises into the scratch draft. Symmetric terms and Coop War twins are atomic. Removed groups produce a short notice and Counter state, while untouched filtered proposals retain Reject or Retract until a manual edit exposes Reset. Aggregate-only legality failure keeps every term visible in normal colors and disables Accept or Counter. Reset refilters the immutable proposal, while scratch-clobber recovery refilters the current visible draft. Pre-submit projection stops a click when newly unavailable groups must be reviewed. The scratch deal validates ordinary items through native code and presents every mounted draft. `draftItems` is a passive decode of the scratch after native editing refreshes; `draftPromises` never enters the scratch; serialization builds from the draft plus promises plus the outgoing message. Counter submits that filtered or edited draft with `expectedProposalID`. Enactment and every transcript write stay server-side.
- **Declare War is a separate panel-local native authority.** The button exists only for a normal human or human strategist, never for a pure observer. Gate it while the teams are at peace and declaration is legal. Normal play keeps its existing `CanDeclareWar(counterpartTeam)` check and `Network.SendChangeWar(counterpartTeam, true)` transport. That message reaches `CvDllNetMessageHandler::ResponseChangeWar` in `civ5-dll/CvGameCoreDLL_Expansion2/CvDllNetMessageHandler.cpp`, which declares war from the active player's team and is therefore wrong for an observer pinned to another seat. The human-strategist branch gates with `Teams[pinnedTeam]:CanDeclareWar(counterpartTeam, pinnedSeatID)`, then calls `Teams[pinnedTeam]:DeclareWar(counterpartTeam, false, pinnedSeatID)`, passing all three declaration arguments explicitly. The Lua bindings in `civ5-dll/CvGameCoreDLL_Expansion2/Lua/CvLuaTeam.cpp` reach the same `CvTeam` core calls with the correct originating player for passive-mode, event-hook, originator, and warmonger handling. Declare War never touches the bridge or transcript because agents already observe live war state through existing knowledge tools.

## Cross-cutting watch-items

- The 2 KB broadcast document until stage 03 lands (silent member-dropping: don't ship panel sends before the DLL bump).
- ArduinoJson pool overhead vs wire bytes (~32 KB budget; the single over-budget row is the unsplittable edge).
- The shared scratch deal: `UI.GetScratchDeal()` is one global object. A server-side `inspect-deal` or enact call can replace it between editor interactions. Every mounted mode decodes its draft after native refreshes, detects clobber through a participant-aware signature, and restores it through the same group-aware filtering path used at mount and before submission.
- VFS rename discipline: any copied file must be renamed (`import="1"` same-name files silently override VP's originals for all native consumers). Stage 02 avoids the hazard entirely for the trade logic by modifying (3a) `TradeLogic.lua` in place instead of copying it; the rule still binds its XML copy and any future copied file.
- Turn-boundary drift: submission runs an advisory local legality check against current game state. Enactment repeats the check authoritatively because the conversation and queued action may outlive the turn (parent specs §8).
- Delta throttle (~1/s) keeps the push stream far from the bridge's ≥25-pending auto-pause threshold.
- Append-only instance building on huge reflushes: batches arrive as separate Lua calls and build each visible row once. Lazy-render older pages if profiling ever shows a frame hitch.
- Accepted Lua ports of shared logic (`deriveActiveProposal`, `inspect-deal.lua` helpers): cross-reference comments on both sides so drift is caught in review.
- Delimiter sanitization is accepted infra debt (the framing itself is content-sensitive).

## Open risks (with resolution paths)

- **Leader-ribbon input during the human-control freeze**: `civ5-mod/UI/VoxDeorumHumanTrigger.lua` proves that `DoBeginDiploWithHuman()` and `Events.AILeaderMessage` open the leader screen while the active player is an observer. Stage 01 must probe whether the EUI leader-ribbon click remains live during the freeze. If not, place Converse on the human-control screen strip or rely on the diplomacy notification click.
- **Observer-slot cosmetics on shared surfaces**: the in-game panel and Web transcript must render a pure observer's real slot without assuming a civilization identity. Use the fixed Observer speaker title and identity wherever the slot has no civilization metadata.
- **Live deal actor computation**: stage 02 legality, values, scratch-deal participants, and the human-side `DealPayload` actor use the pinned civilization for a human strategist. A pure observer rides the same path; an out-of-range slot fails at TradeLogic's shipped range gate or the server-side legality checks with a clean error. The seat enters TradeLogic as call arguments to the parameterized `VoxDeorumOpenDeal` entry, is assigned to native `g_iUs`, and supplies `DisplayDeal` classification while Vox mode is active; no `Game` override or duplicate Vox seat variable exists.
- **LeaderHeadRoot hierarchy used by Converse**: both variants register the diplomacy add-in, but their named paths to `DiscussButton` differ. Stage 01 resolves this with its ordered candidate-path probe and logs the successful path once. If unnamed wrappers block every ID path, it logs the limitation and uses the explicitly anchored `RootOptions` fallback.
- **Which NotificationPanel copy the VFS loads** ((3a) vs UI_bc1): both are edited; confirm this separately with a print probe during stage 01.
- **Include-time control completeness for the copied trade-screen XML**: an audit confirmed every control and instance template TradeLogic touches at include time is defined inside `DiploTrade.xml`, so a full copy is include-safe. Stage 7.02 carries the audited list as its drift checklist and adds wrapper-owned Promises category controls, inline Coop War target stacks, and table-row stacks without names that native TradeLogic touches.
- **Popup layering for the standalone deal screen**: resolved — the screen uses plain `SetHide(false)` over the demoted panel; the popup queue is not used.
- **`GetTradeItemValue` per-edit cost**: retired — stage 02 keeps the native `PeaceDeal` value bar and its `GetTotalValueToMeNormal` computation instead of adding per-item valuation, so no per-edit valuation cost exists.
- **`currentTurnOf` availability in interactive mode**: execution uses the live session turn; if it proves unpopulated for live threads, fix that seam bridge-side (the event-carried `Turn` stays validation-only).
