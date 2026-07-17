# Stage 7: In-game diplomacy panel: specification and pinned contracts

> Part of the interactive-diplomacy plan ([../README.md](../README.md), requirements in [../specs.md](../specs.md)). This folder is the staged sub-plan for the in-game panel; [../07-ingame-panel.md](../07-ingame-panel.md) is its index. Stage docs: [01-ui-groundwork.md](01-ui-groundwork.md) → [05-hardening.md](05-hardening.md).

## What this is

The in-game counterpart of the Web v1 diplomacy flow, for a **normal human player actively playing their own civ** against LLM-driven civs (interactive mode, `!config.autoPlay`): a **Converse** entry on the leader discussion screen, a native-styled chat panel over the durable pair transcript with streamed replies, a vendored copy of the game's own trade screen with locally computed legality/values plus the promises category, and async reply delivery through the game's **native notification system** so a conversation can stretch across turns ("mailing"). Deals enact through the same `enact-agent-deal` path as the Web.

Two principles govern every design choice here:

1. **The panel is a second client of the same backend.** It reuses the Web chat engine (`runChatTurn`), the same durable transcript, the same deal helpers, and the same client-side derivation model. Where the existing code is route-shaped rather than reusable, we **extract** it into transport-neutral helpers that both the Express routes and the in-game bridge call: we do not fork logic.
2. **The server pushes rows, not state.** Like the Web, the panel derives deal status by reducing transcript messages with `deriveActiveProposal` semantics. The server pushes only three facts that clients cannot derive: `hasEnvoy`, `busy`, and `hasMore`.

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
 │  vendored trade screen, local  │                     │
 │  legality/values               │   native            │
 └────────────────────────────────┘   notification ◄────┘
          ▲ click on notification ────┘   (01)
```

Game→server travels as `Game.BroadcastEvent` game events through the existing DLL→bridge→mcp-server→vox-agents notification pipeline (the `HumanDecision` pattern). Server→game travels as structured Lua calls through one new generic mcp tool, invoking functions **the mod itself registers**: the mod owns its presentation surface; mcp-server stays a transparent transport; all conversation logic lives in vox-agents.

## Pinned contracts

### Game → server: four broadcast events

All emitted as `Game.BroadcastEvent(name, payload, true)`. `generateId = true` is mandatory (an id-less event crashes the mcp-server handler); the generated id doubles as the bridge-side duplicate-delivery key. Common fields: `PlayerID` = `Game.GetActivePlayer()` (numeric, required: it routes mcp-server's `sendNotification`), `CounterpartID` (the LLM civ), `Turn` = `Game.GetGameTurn()` (validation only: execution always uses the live session turn).

| Event | Payload beyond common fields | Meaning |
|---|---|---|
| `DiplomacyPanelOpened` | none | Panel opened for a pair; requests a conversation reflush (read-only). |
| `DiplomacyChatMessage` | `Text` (≤ 2000 chars, delimiter-sanitized) | Human sent a message; runs the diplomat. |
| `DiplomacyDealAction` | `Action ∈ propose\|counter\|accept\|reject`, `Deal?` (DealPayload v1), `ProposalMessageID?`, `Text?` | Deal move. `Deal` required for propose/counter; `ProposalMessageID` required for counter/accept/reject (for counter it becomes `expectedProposalID`, the Web's stale-submission guard). |
| `DiplomacyTranscriptRequest` | `BeforeID` | Page older history (`ID < BeforeID`, read-only). |

There is no close event: the panel offers no close affordance (Goodbye merely hides it). Conversation closure is the diplomat's move (its `close-conversation` tool) or the Web's; the panel derives the closed state from the transcript's `close` row.

Each event needs a zod schema in `mcp-server/src/knowledge/schema/events/` (modeled on `HumanDecision.ts`), registration in the events index, and an entry in `eventsForNotification` (`mcp-server/src/server.ts:203`): otherwise it is dropped at the store gate or never forwarded to vox-agents.

### Server → game: four push functions

Transport is **one thin generic mcp tool `call-lua-function` `{ Name, Args[] }`** wrapping `bridgeManager.callLuaFunction(name, args)`: the structured-args path where the bridge JSON-serializes the args and the DLL's `ConvertJsonToLuaValue` rebuilds them as native Lua tables (the same mechanism `presentHumanDecision` uses; no JSON parsing in Lua).

Registration is **game-side**: `VoxDeorumDiploPanel.lua` registers each function at load via `Game.RegisterFunction(name, fn)`; each body just fires the same-named `LuaEvents` and returns `true`. (Behavior across bridge/pipe reconnects is a stage-03 verify item; fallback is re-registration on a reconnect-signaling game event.)

| Function | Args | Meaning |
|---|---|---|
| `VoxDeorumDiploBegin` | `playerID, counterpartID, turn, meta` | Starts a reflush: the panel clears the pair's log and applies `meta = { hasEnvoy, busy, hasMore }`. |
| `VoxDeorumDiploMessages` | `playerID, counterpartID, batch` | `batch = { mode: "append"\|"prepend", messages[], hasMore? }`. Rows are the `TranscriptMessage` projection `{ ID, SpeakerID, MessageType, Content, Payload?, Turn }`. Serves the initial fill (ordered `append` batches after `Begin`), paging (`prepend` + `hasMore`), and live increments (single-row `append`). The panel dedupes rows by `ID` and re-runs its reducer; a final reply row replaces any streaming draft. |
| `VoxDeorumDiploStatus` | `playerID, counterpartID, status` | Live agent activity: `{ state: "composing"\|"reasoning"\|"tool"\|"error", detail? }`, produced through a strict allowlist. Reasoning/tool **content** never crosses into the game: only the state (details remain revealable in the Web UI, which already renders them collapsed). |
| `VoxDeorumDiploDelta` | `playerID, counterpartID, text` | The **accumulated** partial reply text so far (idempotent re-render), throttled to ~1/s. Stale deltas arriving after the final row are ignored. |

There is no separate deal-state push. Reflushes and increments carry transcript rows, and the panel derives state from them. For example, Reject follows this path: the player opens the active proposal in respond mode and selects Reject → the card shows an animated rejecting row → the panel emits `DiplomacyDealAction{reject, ProposalMessageID}` → the bridge runs the shared reject action with the thread lock and open-proposal guard → the bridge appends and pushes the `deal-reject` row → the panel adds the row, reruns the reducer, returns the proposal to view-only, and clears the pending state. This matches the Web client receiving a new message.

The panel renderer is append-only during normal operation. Each visible append builds one new message instance, existing proposal cards refresh in place, and dot animation only changes pooled tail labels. The scroll follows new content only when it was already at the bottom. Open, reset, and user-requested prepends may rebuild the transcript; prepends restore the prior visible position approximately.

The durable transcript stores raw markdown so the Web can continue rendering it with `marked`. At the game boundary, pushed transcript `Content` passes through `markdownToCiv5`, while notification summaries and messages pass through `markdownToPlain`. Raw Civ 5 markup tags embedded in content pass through the game conversion unchanged.

### Client-side derivation (the panel mirrors the Web client)

The Web runs these on the browser side; the panel ports them to Lua (small, accepted duplications with cross-reference comments both ways: the same pattern as the `inspect-deal.lua` helper ports):

- **`deriveActiveProposal`** (`vox-agents/src/utils/diplomacy/deal-reduce.ts`, ~40 lines; re-exported to the browser via `ui/src/utils/deal/deal-reduce.ts`): the latest `deal-proposal`/`deal-counter` is the active proposal; later `deal-accept`/`deal-reject`/`deal-enacted` referencing its `Payload.ProposalMessageID` set its status (acceptance sticky, enacted terminal); earlier proposals are superseded history. In the panel a proposal/counter row renders as the same message bubble as text (proposer's portrait and title line), carrying the deal's outward `message` and a two-column term list; the **entire bubble is clickable**: the active open proposal opens the deal screen in respond mode, where the actions live: incoming: Accept / Counter / Reject; your own: Counter / Retract (retract emits `Action="reject"`, matching the Web); settled or superseded proposals open view-only. Accept/reject/enacted rows render as ordinary bubbles, so outcomes read as part of the conversation.
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

- **Posting**: the general `post-notification` mcp-server tool → `Players[playerID]:AddNotificationName("NOTIFICATION_VOX_DEORUM_DIPLOMACY", message, summary, -1, -1, counterpartID, counterpartID)` (`iGameDataIndex` carries the counterpart for click routing). Counterpart is optional: a valid `CounterpartID` opens the conversation on click; `-1` shows `Message` in a `BUTTONPOPUP_TEXT` dialog and dismisses itself, so the channel serves any LLM→human message. It is a server tool, not a UI-registered function. The stage-01 smoke test posts directly via the mock's `AddNotificationName`.
- **Click dispatch**: there is no `Events.NotificationActivated` anywhere in Civ V, and the DLL's default `Activate` branch is a no-op. Add a small guarded branch to `GenericLeftClick` in the owned NotificationPanel.lua copies. It fires `LuaEvents.VoxDeorumDiplomacyNotificationActivated(Id, counterpartID, extra)` for this type and returns. The nil guard keeps installations without the mod unchanged.
- **Cross-turn persistence**: `CvNotifications::IsNotificationTypeEndOfTurnExpired` defaults to `true` for unknown types, which dismisses them at the turn boundary. Add one early return of `false` for the hashed Vox Deorum type. `Notification::Serialize` already provides save persistence.
- **Policy**: the bridge **always posts** on a reply or deal outcome; an open panel dismisses its own pair's notifications locally (`UI.RemoveNotification`).

### In-game LuaEvents vocabulary (mod-internal)

`VoxDeorumDiploOpen(counterpartID)` (Converse → panel) · the four push events above · `VoxDeorumOpenDealScreen(counterpartID, incomingDeal?, proposalMessageID?)` (panel → deal screen) · `VoxDeorumDiplomacyNotificationActivated(notificationID, counterpartID, extra)` (notification click → panel).

### Size and text rules

- **Server→game** lua-call args pass through a DLL-side ArduinoJson document whose capacity is a **node pool, not a byte count**: nested rows cost pool overhead well beyond their wire bytes. Stage 03 bumps the pool (64 KB → 256 KB), adds an explicit `overflowed()` failure (never invoke Lua with silently dropped members), and the bridge packs `Messages` batches to a conservative **~32 KB wire budget**, sending multiple ordered batches when a window doesn't fit. **No content truncation.** A single row exceeding the budget is the one unsplittable edge (watch-item; LLM replies are practically bounded far below it).
- **Game→server** `Game.BroadcastEvent` currently serializes into a **2 KB** document (silent member-dropping on overflow): stage 03 bumps it to 64 KB. The deal screen keeps a coarse Lua-side length check so an oversized send fails loudly with an on-screen reason.
- **Text**: chat input ≤ 2000 chars (the `relay-message` precedent). The IPC frame delimiter `!@#$%^!` is stripped from all human/LLM text at both edges (panel input before broadcast; bridge-pushed `Content` before the Lua call): raw delimiter framing is otherwise content-sensitive. Recorded as accepted infra debt; a framing rework is out of scope here.

## Reuse and extension map

Verified against the code; this is the contract between this plan and the existing Web backend.

**Reused as-is (in-process calls from the ingame-bridge):**

- `runChatTurn(body, sink)` (`vox-agents/src/web/chat/turn.ts:144`): the entire chat engine: validation, thread lookup, closed-this-turn 409, per-thread lock, durable commit (`beginChatTurn`), agent run, streaming, mid-run deal-row reconciliation, cleanup. The Express `/api/agents/message` route adds nothing but SSE wire format, so calling `runChatTurn` with a game-facing sink loses no domain logic. Both text moves (`{kind:'text', chatId, message}`) and deal proposal/counter moves (`{kind:'deal', chatId, deal, expectedProposalID?}`) go through it. Its `connected` event carries the authoritative committed proposal row for a deal turn; `done.deals` carries mid-run deal rows with durable IDs.
- `openDiplomacyChat(request)` (`web/chat/factory.ts`): deterministic thread per pair (`dipl:${gameID}:${min}:${max}`), diplomat resolution from `assignments[target].diplomat`, and identity handling. The bridge uses it before mutating actions, never read-only reflushes, because it compacts and rehydrates the live cache.
- `readTranscript(a, b)` (`src/utils/diplomacy/transcript.ts:40`): returns exactly the `TranscriptMessage` projection the push functions carry; the read-only reflush path is built on it, untouched by thread state.
- `withThreadLock` / `ThreadBusyError` (`chat-turn-commit.ts:210`), `requireCurrentOpenProposal`, `appendDealReject`, `enactAgentDeal`, `mirrorDealRowsBestEffort`, `currentTurnOf`, `audienceID`, `isClosedThisTurn`: the same primitives the deal routes compose.
- `deriveActiveProposal` (`deal-reduce.ts`): semantics ported to the panel's Lua reducer.
- The `{{{Greeting}}}` trigger convention: the bridge auto-greets an empty/stale conversation exactly as the Web client does (`shouldRequestGreeting`).

**Extended in small shared seams, not bridge-private forks:**

- **Extract the deal route bodies into transport-neutral action helpers.** Unlike the message route, the accept/reject route handlers own real logic the leaf helpers lack: the diplomacy-thread guard (`resolveDealThread`), the closed-this-turn gate (`isDealLocked`), the `withThreadLock` wrapping with `ThreadBusyError` mapping, the cache mirror (`mirrorDealRowsBestEffort`), and accept's conflict-vs-failure disambiguation (`web/chat/deal.ts:144,180`). Stage 04 extracts these into `acceptDealAction` / `rejectDealAction` in `web/chat/deal.ts`; the Express routes and the ingame-bridge both call them.
- **Paginated transcript read.** No pagination exists anywhere (the Web loads full history). Add optional `BeforeID` / `Limit` to the `read-transcript` tool + `getDiplomaticMessages` getter (mcp-server) and a `readTranscriptPage` wrapper in `transcript.ts`, returning the newest `Limit` rows (below `BeforeID` when paging) plus `hasMore`.
- **A queryable busy flag.** The in-flight set is private to `chat-turn-commit.ts`; export `isThreadBusy(threadId)` so `Begin.busy` doesn't have to probe by acquiring the lock.
- **A game `ChatStreamSink`.** The only existing sink is the SSE one. Stage 04 adds the in-game adapter with delta throttling, a status allowlist, and a separate per-pair push FIFO.

**New (no Web counterpart exists):**

- The four game-event schemas and whitelist entries; the `call-lua-function` mcp tool; the ingame-bridge module with separate per-pair action and push FIFOs; the notification posting path; everything under `civ5-mod/UI/`.

## Design decisions and non-goals

- **No new durable idempotency machinery.** The existing transcript-level `deal-enacted` key prevents double enactment. A rare duplicated text row is cosmetic. Deduplicate overlapping pipe and SSE delivery by generated event ID.
- **No flush or stream generation counters.** A single human drives one panel. Each complete reflush is one atomic push-FIFO task, so its read, `Begin`, and message batches cannot interleave with live pushes. `Begin` resets the pair log, and the panel deduplicates rows by ID. The action FIFO never blocks a reopen behind a live turn.
- **No live Web⇄game sync** (parent specs §6): shared storage, not mirroring. Each surface refreshes on open. Notably the Web has no server-push into an open chat either: its open view updates only through the user's own streaming request.
- **Separate queues have separate owners.** MCP notification dispatch is fire-and-forget. An action FIFO serializes mutating chat, deal, and conditional greeting tasks. A push FIFO orders Lua calls and owns atomic read-only reflush tasks. It continues running while an action is active, so a reopen can report `Begin.busy` and stream deltas can arrive before `runChatTurn` completes. A conditional greeting rereads the transcript inside the action FIFO before applying `shouldRequestGreeting`, preventing duplicate greetings from rapid opens. The panel still permits only one in-flight user action per pair. Residual `ThreadBusyError` cases surface as error status.
- **Local draft and legality, server enactment.** Plain Lua `draftItems` and `draftPromises` own the open edit. The screen rebuilds `UI.GetScratchDeal()` from that model before local legality, valuation, rendering, and submission, then runs an explicit final legality pass before broadcasting. Server-side tools may reuse the scratch deal without destroying the draft. A pending Propose or Counter keeps the editor mounted; an error restores controls without reinitializing the draft. Enactment and every transcript write stay server-side. The mod never writes transcript rows; `deal-accept` and `deal-enacted` still come only from `enact-agent-deal`.
- **Declare War is a panel-local native action.** Offer it only while the teams are at peace and `CanDeclareWar` holds. After confirmation, call `Network.SendChangeWar(counterpartTeam, true)`, matching the native flow. It never touches the bridge or transcript because agents already observe live war state through existing knowledge tools.

## Cross-cutting watch-items

- The 2 KB broadcast document until stage 03 lands (silent member-dropping: don't ship panel sends before the DLL bump).
- ArduinoJson pool overhead vs wire bytes (~32 KB budget; the single over-budget row is the unsplittable edge).
- Mod-registered Lua functions across pipe/bridge reconnects (stage-03 verify; fallback re-registration hook).
- The shared scratch deal: `UI.GetScratchDeal()` is one global object. A server-side `inspect-deal` or enact call can replace it between UI interactions. Keep the independent draft model authoritative and rebuild the scratch deal before every operation that reads it.
- VFS rename discipline: every vendored file must be renamed (`import="1"` same-name files silently override VP's originals for all native consumers).
- Turn-boundary drift: submission runs an advisory local legality check against current game state. Enactment repeats the check authoritatively because the conversation and queued action may outlive the turn (parent specs §8).
- Delta throttle (~1/s) keeps the push stream far from the bridge's ≥25-pending auto-pause threshold.
- Append-only instance building on huge reflushes: batches arrive as separate Lua calls and build each visible row once. Lazy-render older pages if profiling ever shows a frame hitch.
- Accepted Lua ports of shared logic (`deriveActiveProposal`, `inspect-deal.lua` helpers): cross-reference comments on both sides so drift is caught in review.
- Delimiter sanitization is accepted infra debt (the framing itself is content-sensitive).

## Open risks (with resolution paths)

- **Mod-registered functions across reconnects**: does the bridge's function registry re-sync DLL-owned registrations after a pipe drop? Stage-03 verify item; fallback: re-register from Lua on a reconnect-signaling game event.
- **Which NotificationPanel/LeaderHeadRoot copy the VFS loads** ((3a) vs UI_bc1): both are edited/used; confirm with a print probe during stage 01.
- **Instance definitions for the vendored trade screen**: under EUI they live in LeaderHeadRoot.xml, not DiploTrade.xml; the vendored XML carries its own copies regardless, proven by stage 02's mock milestone.
- **Popup layering for the standalone deal screen**: `UIManager:QueuePopup` vs plain `SetHide(false)` (the HumanPanel deliberately avoids the popup stack); resolved cheaply in stage 02.
- **`GetTradeItemValue` per-edit cost**: surfaced in stage 02; debounce recomputes to table-change events if laggy (the Web debounces its inspect calls at 250 ms for the same reason).
- **`currentTurnOf` availability in interactive mode**: execution uses the live session turn; if it proves unpopulated for live threads, fix that seam bridge-side (the event-carried `Turn` stays validation-only).
