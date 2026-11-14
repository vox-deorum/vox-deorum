# Diplomacy panel

The diplomacy panel is where a player holds a conversation with one AI civilization: a scrolling transcript, an input box, and cards for any deal proposal currently on the table. It is the in-game half of interactive diplomacy.

This page is for anyone working on that panel: where it opens from, how it is put together, and what to touch when you change it. For the full round trip from an agent's decision through the MCP tools and bridge back to this screen, see [diplomacy.md](../diplomacy.md).

## When the player sees it

Two entry points open the panel, both against a met, living, major civilization:

- **The Converse button** on the leader screen. `UI/Diplomacy/VoxDeorumConverse.lua` is included by the mod's `UI/LeaderHeadRoot.lua` override, so it runs inside that context and drives the Converse button sitting beside Discuss, Trade, and War.
- **A diplomacy notification.** Activating a `NOTIFICATION_VOX_DEORUM_DIPLOMACY` notification opens the conversation for that pair and dismisses the pair's other notifications. A notification with no valid counterpart falls back to showing its cached message in a plain popup.

The panel then presents itself in one of three states, tracked in `m_presentation`:

| State | What it looks like |
| --- | --- |
| `leader` | Queued as a popup at `PopupPriority.LeaderTrade`, so the band renders over the live animated leaderhead scene. |
| `static` | The dimmed full-screen fallback, used for pure observers, the mock sandbox, and when no leader scene is up. |
| `pending` | A transient state after a notification open. The panel asks the engine to raise the leaderhead (`DoBeginDiploWithHuman`) and waits a few seconds for the matching `AILeaderMessage`, falling back to `static` on failure or timeout. |

The panel steps aside politely: it demotes to `static` if a different leader takes the scene, and again when the deal screen mounts over it.

## Files

| File | Role |
| --- | --- |
| `UI/Diplomacy/VoxDeorumDiploPanel.lua` | Presentation, transcript state, and the `VoxDeorumDiploUI` surface every driver talks to. |
| `UI/Diplomacy/VoxDeorumDiploPanel.xml` | Layout: the row instances and the docked band. |
| `UI/Diplomacy/VoxDeorumDiploTransport.lua` | The live driver. Carries real traffic to and from the bridge. |
| `UI/Diplomacy/VoxDeorumDiploPanelMock.lua` | The offline sandbox driver. |
| `UI/Diplomacy/VoxDeorumConverse.lua` | The leader-screen launcher, included by the `LeaderHeadRoot` override. |
| `UI/Shared/VoxDeorumSeat.lua`, `UI/Shared/VoxDeorumDealUtils.lua` | Shared helpers, described below and in [deal-screen.md](deal-screen.md). |

## The driver seam

The panel never talks to the bridge itself. It exposes `VoxDeorumDiploUI`, the table of presentation calls a driver uses to update the screen: `reset`, `appendRow`, `prependRows`, `setPhase`, `setStreamingText`, `setHasMore`, `setCurrentTurn`, and `setInlineError`. Anything that leaves the context goes out through one installed **driver**: `onOpen`, `onSend`, `onRetry`, `onLoadEarlier`, `onUpdate`, `onHide`, and `setActive`.

Both the transport and the mock register themselves by name (`real` and `mock`) with `VoxDeorumDiploUI.registerDriver`. The panel, not include order, decides which one is active, and `LuaEvents.VoxDeorumUseMockDrivers` switches between them. The switch closes the panel and clears the transcript in either direction, so mock rows can never be mistaken for durable ones. The deal screen listens to the same toggle, so both contexts move together.

## The data model

**Transcript rows.** `m_rows` is the append-ordered list of durable rows, deduplicated by `ID` through `m_rowByID`. Each row carries at least `ID`, `Turn`, `SpeakerID`, `MessageType`, `Content`, and an optional `Payload`. `buildRowInstance` builds one bubble per row plus a turn separator when the turn changes, and skips two kinds of row entirely: hidden trigger tokens (content wrapped in triple braces) and deal outcome rows, which belong inside the card they answer.

**Proposal cards.** `deriveActiveProposal` and `deriveProposalOutcomes` port the reducers used by the Web transcript viewer. Every `deal-proposal` and `deal-counter` row keeps its own outcome, derived from the `deal-accept`, `deal-reject`, and `deal-enacted` rows that name it, so a proposal that was accepted still says so after a later proposal supersedes it. The card shows a status line (open, accepted, rejected, enacted, superseded), two columns of terms built by `dealColumns`, and the answering side's own words folded in as an outcome line. A card is clickable only when it is the newest unanswered proposal, nothing is pending on it, the seat still matches, and input is not locked. Clicking one opens the [deal screen](deal-screen.md) in `incoming` or `own` mode.

**Conversation phase.** `m_phase` is a single string driving both the transcript tail and the input row: `loading`, `no-envoy`, `normal`, `sending`, `thinking`, `streaming`, `deal-pending`, `ack-timeout`, and `reply-timeout`. A separate derivation, `isClosedThisTurn`, locks input after a `close` row for the current turn. When a phase blocks input, `refreshInput` swaps the box and Send button for an explanatory reason row, and the two timeout phases add a Retry button. Three pooled tail instances render the optimistic outgoing bubble, the streaming reply, and a status line.

**Counterpart and seat.** `m_counterpartID` is the other civ; `m_activePlayerID` is `VoxDeorumSeat.EffectiveSeat()` captured at open, and `isBoundActorCurrent()` re-checks that the seat has not moved before offering any action. A pure observer sees its own side labelled as the observer and drawn with barbarian artwork, since it has no civ of its own.

**Other surfaces.** The panel also tracks diplomacy notifications in both directions so it can dismiss a pair's notifications when that conversation opens, and offers a War button that mirrors `LeaderHeadRoot`'s own gating. Declaring war hands off to the native `BUTTONPOPUP_DECLAREWARMOVE` popup, which carries the consequence dossier an inline confirmation could not. The outcome comes back through `Events.WarStateChanged`.

All display text passes through `sanitizeText`, which strips the named-pipe delimiter and folds punctuation the Civ 5 font cannot draw. Both of those helpers live in `VoxDeorumDealUtils`.

## The transport

`UI/Diplomacy/VoxDeorumDiploTransport.lua` owns both directions of the panel's wire contract.

**Inbound**, it registers four DLL-callable push functions with `Game.RegisterFunction`: `VoxDeorumDiploBegin`, `VoxDeorumDiploMessages`, `VoxDeorumDiploStatus`, and `VoxDeorumDiploDelta`. Registration happens on the first valid presentation, never at context load, because reaching `CvConnectionService` before its `Setup` crashes the game. Each registration becomes a `lua_register` notification on the [connection service](../civ5-dll/connection.md), and the bridge invokes them with `lua_call`. Every push is re-fired as a `LuaEvent` before it is applied, so other contexts (notably the deal transport) can observe the same traffic.

**Outbound**, it broadcasts three game events with `Game.BroadcastEvent`, always with a generated event id: `DiplomacyPanelOpened` for a full reflush, `DiplomacyChatMessage` for a player message, and `DiplomacyTranscriptRequest` for an older page. The DLL turns each into a `game_event` message on the pipe.

**Responsiveness** rests on two timers. An acknowledgement timer covers "nothing arrived at all" and a much longer silence timer covers "acknowledged, then nothing further". They differ in what Retry does: an acknowledgement failure means nothing was delivered, so it repeats the original request, while a reply-silence failure only re-requests the read-only reflush, because a committed message must never be sent twice.

Because the engine stops ticking the game core while the leaderhead scene is up, the panel's per-frame update calls `Game.ProcessConnectionMessages` before anything else. Without that pump, no push would ever be routed and every request would reach its timeout. [connection.md](../civ5-dll/connection.md) explains that drain and its constraints.

## The XML side

`VoxDeorumDiploPanel.xml` holds three reusable instances and the docked band itself:

- `TurnInstance`, the turn and year separator pill.
- `MessageInstance`, one bubble: left and right text labels, the two head frames and civ icons, the deal-card labels (`TheyHeader`, `YouHeader`, `TheyGive`, `YouGive`, `DealDivider`), an `Outcome` line, and a `Pending` line.
- `StatusInstance`, the single-line tail status row.
- `MainGrid` and `ContentColumn`, containing the header bar with both speakers and the Load Earlier button, the `TranscriptScroll` holding `TranscriptStack` and `TailStack`, the input frame with its Send button, the alternate `InputStatusSlot` with its reason label and Retry button, and the right-hand `ActionStack` with Goodbye, Propose Deal, War, and the six hidden mock buttons.

To add a field, touch both files:

1. Declare the control in the XML with an `ID`, inside the instance or the band where it belongs.
2. Bind it in the Lua. Row content belongs in `bindStaticRow` for anything static and `refreshDealRow` for anything that depends on later rows. Gating and visibility belong in `refreshInput` or `refreshState`.
3. Give it a size. The panel recomputes almost every dimension at runtime from the screen size in `layoutPanel`, and bubble heights are summed by hand in `sizeBubble` and `resizeDealBubble`, so a new control that adds height needs a line there or it will overlap its neighbour.
4. Put user-facing text in `Text/VoxDeorum_Text.xml` under a `TXT_KEY_VD_DIPLO_*` key rather than inline English.

## The mock driver

`UI/Diplomacy/VoxDeorumDiploPanelMock.lua` is an offline sandbox retained from the panel's first build stage. It is dormant until `LuaEvents.VoxDeorumUseMockDrivers(true)` selects it, which the leader screen's debug Converse button does. It cycles the panel through every phase on a timer with scripted rows, a word-by-word streamed reply, and a smoke notification, so the presentation can be exercised with no backend at all.

While the mock owns the panel, six otherwise hidden buttons appear in the action stack: Author, Incoming, Own, Unavailable, Coop War, and Error. Each opens the deal screen's mock scenario of that name for the panel's current counterpart. These controls are mock-only and never appear in a live conversation.
