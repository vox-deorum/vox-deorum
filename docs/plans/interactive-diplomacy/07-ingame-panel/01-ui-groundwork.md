# Stage 7.01: civ5-mod + civ5-dll: Converse button, notification channel, chat panel (all mock-driven, plus observer retrofit)

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). This UI-first stage uses mock data in a live game with no server involvement. It resolves the risky Civ UI questions before transport or agent work begins.

## Objective

Render the **Converse** entry, **native notification** channel, and **chat panel** against built-in mock data. The smoke test connects them: clicking Converse posts one native notification, and clicking that notification opens the correct conversation. Retrofit the shipped stage so the same entry and panel also support human strategists and pure observers under the effective-seat contract in [specs.md](specs.md).

## Work items

1. **`civ5-mod/VoxDeorum.modinfo` + `civ5-mod/Text/VoxDeorum_Text.xml`: registration.** Add `UI/VoxDeorumConverse.lua/.xml`, `UI/VoxDeorumDiploPanel.lua/.xml` (`.lua` `import="1"`, context `.xml` `import="0"`), `UI/VoxDeorumDiploPanelMock.lua` (`import="1"`, included by the panel with no entry point), and `XML/VoxDeorum_Notifications.xml`. Register the Converse context as `DiplomacyUIAddin`, the panel as `InGameUIAddin`, and the notifications XML through `UpdateDatabase`. Add `TXT_KEY_VD_CONVERSE` and the panel strings, then run `civ5-mod/update_md5.py`. Both active LeaderHeadRoot variants load `DiplomacyUIAddin` contexts through their `Modding.GetActivatedModEntryPoints("DiplomacyUIAddin")` loops, so no base-screen fork or runtime injection is needed.

2. **`civ5-mod/UI/VoxDeorumConverse.lua/.xml`: the Converse button and shipped embedding retrofit.** Track the on-screen leader through `Events.AILeaderMessage`; argument 1 is `diploPlayerID`. Registration and eligibility are not the current visibility failure: both LeaderHeadRoot variants load the `DiplomacyUIAddin`, and `canConverse` passes for a normal human player. The shipped `ContextPtr:LookUpControl("../DiscussButton")` lookup is the failing gate because `DiscussButton` sits below the named `RootOptions` container in both control trees.

   On every `AILeaderMessage` until embedding succeeds, probe a deterministic candidate list and use the first control found: the legacy `../DiscussButton` as a cheap compatibility probe, `../RootOptions/DiscussButton` for the (3a) hierarchy when its unnamed stack is path-transparent, then `../RootOptions/PrimaryStack/ButtonStack/DiscussButton` for UI_bc1. Reparent beside the resolved control with `ChangeParent(discuss:GetParent())`, `CalculateSize()`, and `ReprocessAnchoring()`. Print the successful path once to `Lua.log`; that identifies the active LeaderHeadRoot hierarchy while proving how the button was embedded. Remove the `ContextPtr:SetUpdate` retry because this context starts hidden and cannot be relied on to tick. The `AILeaderMessage` re-attempt is the only retry path.

   If none of the ID paths reaches `DiscussButton`, look up `RootOptions`, reparent the button there, and anchor it explicitly beside the action controls. Log once that the unnamed wrapper prevented action-stack discovery and record the resulting layout limitation. Add the button without changing native buttons. On click, keep the leader scene up: seed the speech balloon with `TXT_KEY_DIPLOMACY_ANYTHING_ELSE` (the `OnTrade` idiom), leave root-up true and the button visible, and fire `LuaEvents.VoxDeorumDiploOpen(m_diploPlayerID)`. The panel overlays the scene as a higher-priority popup, and the root options (including Converse) return automatically when it dequeues. Show it only for living major civilizations eligible under the normal-player and observer rules in [specs.md](specs.md).

3. **Notification channel.**
   - `civ5-mod/XML/VoxDeorum_Notifications.xml`: add one row using the table's real column name: `<Notifications><Row><NotificationType>NOTIFICATION_VOX_DEORUM_DIPLOMACY</NotificationType></Row></Notifications>`. The DLL builds `NotificationTypes` from `NotificationType`, so this row creates `NotificationTypes.NOTIFICATION_VOX_DEORUM_DIPLOMACY`. EUI renders the new type with its generic notification instance.
   - Posting is the general `post-notification` mcp-server tool, not a panel `Game.RegisterFunction`: a UI add-in calling into `CvConnectionService` at context-load time runs before `CvConnectionService::Setup()` and crashes the game. The panel stays the consumer of the click event and tracker of the pair's notification ids (via `Events.NotificationAdded`), caching each message there for the counterpart-less click-to-show path.
   - Click dispatch: guarded ~6-line branch in `civ5-dll/(3a) VP - EUI Compatibility Files/LUA/NotificationPanel.lua` **and** `civ5-dll/UI_bc1/NotificationPanel/NotificationPanel.lua`, in `GenericLeftClick`: if the entry's type equals `NotificationTypes.NOTIFICATION_VOX_DEORUM_DIPLOMACY` (nil-guarded so installs without the mod are inert), fire `LuaEvents.VoxDeorumDiplomacyNotificationActivated(Id, counterpartID, extra)` and return instead of `UI.ActivateNotification`. The panel handler opens the conversation for a valid counterpart, or shows the cached message in a `BUTTONPOPUP_TEXT` dialog when there is none. (Verified: no `Events.NotificationActivated` exists anywhere; the DLL `Activate` default is a no-op.)
   - `civ5-dll/CvGameCoreDLL_Expansion2/CvNotifications.cpp`: additive early-out in `IsNotificationTypeEndOfTurnExpired` returning `false` for our hashed type (the unknown-type default `true` would auto-dismiss it at the turn boundary, killing cross-turn correspondence). Save persistence needs nothing (`Notification::Serialize` already covers type/strings/data). DLL rebuild; no save-format change.

4. **`civ5-mod/UI/VoxDeorumDiploPanel.lua/.xml`: the mock-driven chat panel.** Hide the `InGameUIAddin` at load and handle Esc locally. Over a live leader scene the panel follows the trade screen's example: it queues itself at `PopupPriority.LeaderTrade` above LeaderHeadRoot and draws as a full-width translucent band docked to the bottom (~half the screen height), so the engine-rendered animated leaderhead stays visible above it. Root-up is never cleared, so Goodbye/Esc dequeues straight back to the native root options via LeaderHeadRoot's `OnShowHide`. Declaring war over the scene closes the panel and leaves the audience, because our declare path bypasses `FROM_UI_DIPLO_EVENT_HUMAN_DECLARES_WAR` and the leaderhead's mood would go stale. A static fallback — the same bottom band shown over the map outside the popup stack via plain `SetHide(false)` — serves mocks, pure observers, failed pokes, and demotions when the engine tears the scene down or a different audience arrives mid-conversation.

   Opening from a notification with no scene up first pokes `Players[id]:DoBeginDiploWithHuman()` (pcall-wrapped, the `VoxDeorumHumanTrigger` idiom) and opens over the leader when the matching `AILeaderMessage` arrives. The pending wait ticks on a visible-but-empty context (a hidden context cannot rely on `SetUpdate`) with a ~3 s timeout to the static fallback; a poke failure, a mismatched `AILeaderMessage`, or a pure-observer seat also falls back statically.

   Adapt the diplomacy-message-log bubble design by @schnetziomi5 and credit them in a shipped XML or Lua comment. Use a dark `GridBlackIndent8` bubble with a gold `Grid9Frame` border, a 64px leader portrait and civilization badge on the speaker's corner, the leader name as `TITLE`, and wrapped text. Counterpart messages sit left; player messages mirror them on the right. Use centered turn pills between rows. The transcript carries the chronology, so the panel has no duplicate header turn pill.

   Add Load earlier, deal cards, a framed 2000-character input and Send row, plus Propose Deal, Declare War, and Goodbye in the footer. A deal card uses the same message-bubble design, followed by a two-column They give and You give list that includes promises. Only the active open proposal is clickable, using `incoming` or `own` mode according to its speaker. Historical, settled, and superseded proposal cards remain fully readable but non-clickable. Goodbye hides the panel. The transcript's `close` row controls conversation closure. Rows render incrementally: an append builds one new message instance, refreshes proposal controls in place, and keeps the scroll at the bottom only when the player was already there. Open, reset, and user-requested prepends are the only full rebuild paths. A prebuilt tail pool owns optimistic, streaming, activity, timeout, and closed states so dot animation only changes label text.

   The panel exposes the context-global `VoxDeorumDiploUI` interface for transcript, phase, stream, paging, and turn updates. Its nil-guarded driver callbacks own open, send, retry, paging, update, and hide actions. This stage includes `VoxDeorumDiploPanelMock.lua` as the final line of the panel file; the mock assigns that driver and auto-plays the demo on every open. Stage 04 replaces only that include with the transport driver. This stage ships:
   - A **mock transcript in `VoxDeorumDiploPanelMock.lua`** exercising every render path: text rows both directions, a `{{{Greeting}}}` row (must be hidden), a turn boundary (separator pill), Civ 5 markup, and a proposal chain covering open / rejected / accepted / enacted / superseded deal cards.
   - **Declare War**: fully functional already with no bridge. Follow the separate war-authority rule in [specs.md](specs.md), then gate against peace and declaration legality on the effective seat's team. Normal play keeps `CanDeclareWar(counterpartTeam)` and `Network.SendChangeWar(counterpartTeam, true)`. A human strategist gates with `Teams[pinnedTeam]:CanDeclareWar(counterpartTeam, pinnedSeatID)`, then uses `Teams[pinnedTeam]:DeclareWar(counterpartTeam, false, pinnedSeatID)`, with all three declaration arguments explicit, so passive-mode and event-hook checks, the attacker team, and originator and warmonger attribution all use the pinned seat. A pure observer has no Declare War button even though it can act on deals. The button disappears once at war.
   - The **Lua port of `deriveActiveProposal`** (from `vox-agents/src/utils/diplomacy/deal-reduce.ts`, semantics pinned in specs) plus `isClosedThisTurn` derivation, driving card badges and clickability from the mock rows: the reducer is proven against mocks before any server exists. Cross-reference comments both ways.
   - Every **in-progress state** from the specs UI rules, cycling visibly on mock timers: "loading conversation…", optimistic "sending…" row on Send, "envoy is thinking…" status row, a streaming-draft row, pending deal badges, and the two timeout states with their Retry affordances.
   - Delimiter stripping (`!@#$%^!`) on input; opening from both `LuaEvents.VoxDeorumDiploOpen` and `LuaEvents.VoxDeorumDiplomacyNotificationActivated` (the latter also removes the pair's tracked notifications).
   - For the smoke test only: Converse-open posts one mock notification by calling `player:AddNotificationName` directly in the mock (no registered function).

5. **Observer retrofit for the shipped stage.** Treat this as retrofit work on the already implemented stage rather than a new UI surface. Use the observer flavors, effective-seat definition, thread identities, identity convention, and button-existence rule pinned in [specs.md](specs.md).
   - Add an imported `civ5-mod/UI/VoxDeorumSeat.lua` include and register it with `import="1"` in `civ5-mod/VoxDeorum.modinfo`. It exposes `EffectiveSeat()` and `IsPureObserver()` as the shared Lua source of truth. Refresh the mod manifest with `civ5-mod/update_md5.py`.
   - Update `VoxDeorumConverse.lua` so its self-exclusion compares the counterpart with the effective seat, not the active observer slot. Keep the met check through the effective team. `CvTeam::isHasMet` in `civ5-dll/CvGameCoreDLL_Expansion2/CvTeam.cpp` already redirects an observer team's check to the override player's team and reports all teams met for a pure observer, so this gating needs no DLL change.
   - Bind `VoxDeorumDiploPanel.lua` own-side rows, portraits, deal columns, driver calls, and effective-team legality to the effective seat. Render the human side as **Observer** for a pure observer instead of attempting to derive leader or civilization cosmetics from the observer slot.
   - Apply the capability matrix from [specs.md](specs.md): Propose Deal and active proposal cards are interactive for a pure observer, including accept, counter, reject, and retract. Keep Declare War hidden through its separate authority gate. For a human strategist, compute war availability with `Teams[pinnedTeam]:CanDeclareWar(counterpartTeam, pinnedSeatID)` and use the pinned-seat `Teams[pinnedTeam]:DeclareWar(counterpartTeam, false, pinnedSeatID)` branch described above. Normal play retains its existing gate and `Network.SendChangeWar` path.
   - Keep `VoxDeorumDiploPanelMock.lua` seat-agnostic per the mock rule in [specs.md](specs.md): it always plays the normal seated demo, with no observer scenario. Observer presentation comes from live seat state, so running the same demo in an observer game is the observer check.

### Panel layout (text mockup)

The panel is a bottom-docked translucent band with the animated leaderhead visible above it (the static fallback shows the same band over the map), leaving the conversation bubbles and footer controls visually dominant. Messages use @schnetziomi5's dark bubble design, with the speaker portrait on the outside corner. Counterpart messages sit left, player messages sit right, and centered turn pills separate turns.

```
╔══════════════════════════════════════════════════════════════════════╗
║ ░░ native diplomacy-screen background (DiploTrade assets) ░░          ║
║                          [ Load earlier… ]                            ║    Load earlier: hidden when
║                                                                       ║    hasMore = false
║  ╭────╮________________________________________________               ║
║  │ ◉◉ │ Napoleon of France                             │              ║  ← counterpart bubble, LEFT:
║  │  ⚜ │ Your borders creep ever closer to mine.        │              ║    GridBlackIndent8 + gold
║  ╰────╯ Explain yourself.                               │              ║    Grid9Frame border; 64px
║      ╰──────────────────────────────────────────────────╯              ║    leader portrait + civ badge
║                                                                       ║    hanging off the top corner
║              ________________________________________________╭────╮   ║
║              │                       Washington of America   │ ◉◉ │   ║  ← own bubble, RIGHT, portrait
║              │    The settlements are on land we claimed     │ ★  │   ║    on the right: mirrored
║              │    fairly. But I am open to discussing it.    ╰────╯   ║    layout of the counterpart's
║              ╰────────────────────────────────────────────────╯       ║
║                                                                       ║
║                          ⟨ T144 ~ 1255 AD ⟩                           ║  ← centered turn pill whenever
║                                                                       ║    the turn changes between rows
║  ╭────╮________________________________________________               ║
║  │ ◉◉ │ Napoleon of France                             │              ║  ← DealCard: the SAME bubble
║  │  ⚜ │ A fair exchange to steady our border.          │              ║    design; body = the deal's
║  ╰────╯                                                 │              ║    outward message + two-column
║      │    THEY GIVE             │  YOU GIVE             │              ║    term list (promises folded
║      │    6 Wine               │   Open Borders (45t)   │              ║    in). The ENTIRE bubble is
║      │    120 Gold             │   4 Iron               │              ║    clickable: the active open
║      │    Won't attack (promise)│                       │              ║    proposal (per the reducer)
║      ╰──────────────────────────┴───────────────────────╯              ║    → deal screen incoming/own;
║                                                                       ║    settled/superseded → readable, non-clickable
║  ╭────╮________________________________________________               ║
║  │ ◉◉ │ Napoleon of France                             │              ║
║  │  ⚜ │ Consider it carefully. My patience has         │              ║  ← streaming draft bubble
║  ╰────╯ limits▌⋯                                       │              ║    (Delta), replaced by the
║      ╰──────────────────────────────────────────────────╯              ║    final row
║  ✦ Envoy is thinking ⋯                                                ║  ← status row (Status push);
║ ──────────────────────────────────────────────────────────────────── ║    dot-cycle via SetUpdate
║  ┌──────────────────────────────────────────────────────┐             ║
║  │ Type your message…                                    │  [ Send ]  ║  ← EditBox (2000 cap); Send
║  └──────────────────────────────────────────────────────┘             ║    disabled while a turn runs
║                                                                       ║
║      [ Propose Deal ]        [ Declare War! ]        [ Goodbye ]      ║  ← Declare War only when not at
╚══════════════════════════════════════════════════════════════════════╝    war & CanDeclareWar; confirm →
                                                                             Network.SendChangeWar (native).
                                                                             Goodbye hides the panel
```

State variants the mock data must drive (all in this stage, on timers):

```
loading:    ║  ✦ Loading conversation ⋯                       ║   (until Begin)
sending:    ║   _____________________________________╭────╮   ║   greyed optimistic own bubble
            ║   │ Washington of America (sending ⋯)  │ ◉◉ │   ║
            ║   │ We accept your terms.               ╰────╯   ║
            ║   ╰─────────────────────────────────────╯        ║
deal busy:  ║  (deal bubble greyed)   ✦ Accepting ⋯           ║   pending status row; bubble
            ║                                                  ║   unclickable until resolved
timeout 1:  ║  ⚠ Not delivered.                  [ Retry ]     ║   ~10 s transport-ack
timeout 2:  ║  ⚠ The envoy seems unavailable.    [ Retry ]     ║   ~90 s reply silence
closed:     ║  ── Conversation closed this turn. ──            ║   input greyed until a later turn
no envoy:   ║  This leader has no envoy available.             ║   hasEnvoy = false body
```

### Message-instance reference (adapt; credit @schnetziomi5 in the shipped code)

The bubble design comes from a diplomacy-message-log modmod by **@schnetziomi5** (not vendored in this repo). Carry this instance as the starting point for the `ChatMessage` instance, and keep an attribution comment in the shipped XML/Lua:

```xml
<Instance Name="MessageInstance"><Container ID="MESSAGE" Size="550,94">
    <Grid Size="120,24" Anchor="C,T" Style="GridBlackIndent8" ID="TURNPANEL">
        <Grid Anchor="C,C" Size="124,28" Style="Grid9Frame" ID="TURN_BORDER" />
        <Label Anchor="C,C" String="T1000 - 1000000 AD" ID="TURN" />
    </Grid>
    <Grid Size="520,94" Anchor="L,T" Offset="0,0" Style="GridBlackIndent8" ID="PAN">
        <Grid Anchor="C,C" Offset="0,0" Size="524,98" Padding="0,0" Style="Grid9Frame" Hidden="0" ID="BORDER"/>
        <Label Anchor="L,T" Offset="32,12" String="headline" Font="TwCenMT22" ID="TITLE" />
        <Label Anchor="L,T" Offset="32,32" WrapWidth="470" LeadingOffset="-8" Font="TwCenMT20" String="Message" ID="TEXT" />
        <Image Anchor="L,T" Offset="-32,-24" Texture="IconFrame64.dds" Size="64.64" ID="HEADFRAME">
            <Image ID="HEAD" Offset="0,0" Anchor="C,C" Size="64.64" Texture="LeaderPortraits512.dds">
                <Image ID="CivIconBG" Size="32.32" Anchor="C,C" Offset="0,18" TextureOffset="32,0" Texture="CivIconBGSizes.dds">
                    <Image ID="CivIconShadow" Size="24.24" Anchor="C,C" Offset="1,1" Texture="CivSymbolAtlas16.dds" Color="Black.128" />
                    <Image ID="CivIcon" Size="24.24" Anchor="C,C" Texture="CivSymbolsColor256.dds" />
                </Image>
            </Image>
        </Image>
    </Grid>
    <Image Anchor="C,B" Offset="0,2" TextureOffset="0.0" Texture="bar300x2.dds" Size="320,2" ID="SEP" />
</Container></Instance>
```

Adaptations for our panel: two mirrored variants (or one instance flipped at bind time) for the left/counterpart and right/player alignments, with `HEADFRAME` on the matching side; `TITLE` carries "Leader of Civ"; the `TURNPANEL` pill becomes a standalone turn-separator row shown only when the turn changes between messages; the fixed `94` heights become autosized so `TEXT` can wrap freely.

## Reuse

`VoxDeorumHumanPanel.lua/.xml` (dormant-addin idiom, dialog plumbing, `SetUpdate` animation precedent, icon/tooltip includes); `VoxDeorumHumanTrigger.lua` (embed-with-retry idiom); the `DiplomacyUIAddin` loader in LeaderHeadRoot; the message-bubble instance design from **@schnetziomi5**'s diplomacy-message-log modmod (adapted with attribution); the native war-declaration flow (`CanDeclareWar` gating, `Network.SendChangeWar`); `deriveActiveProposal` / `isClosedThisTurn` semantics from `vox-agents/src/utils/diplomacy/`; the `Notifications` XML table mechanism and EUI NotificationPanel `Generic` fallback.

## Verify

In a live VP+EUI game with the mod deployed (`deploy.bat`, MD5s refreshed):

1. For a normal human player, the leader screen shows **Converse** alongside Discuss/Trade/Demand/War, all natives still functional. Clicking it overlays the panel as a bottom band on the **still-animated** leader scene, posts **one native notification**, and opens the mock conversation for that leader; Goodbye/Esc returns to the root options with Converse still present. This confirms that add-in registration and `canConverse` were already working and that the embedding retrofit fixed the visibility gate.
2. Clicking the **notification** re-opens the panel for the right counterpart and removes the notification. It survives end-turn ×2 and a save/load; right-click dismiss prunes both notification tracking maps through `NotificationRemoved`; a game without the mod is unaffected (guarded branch inert). If the counterpart becomes invalid before activation, the click does not open the panel or consume the notification.
3. Mock rows render correctly in the @schnetziomi5 bubble design: `{{{Greeting}}}` is hidden; counterpart bubbles sit left and player bubbles sit right; each bubble shows the speaker's leader portrait, civilization badge, and "Leader of Civ" title; turn pills separate turns without a duplicate header date. Deal rows use the same bubble with the message and two-column They give and You give list, including promises and no balance. Only the active open proposal card is clickable. The mock chain proves that the reducer assigns `incoming` or `own` from that proposal's speaker, keeps earlier proposals readable but inert, and locks input with an explanatory row when the conversation is closed this turn.
4. Every pending/streaming/timeout state animates visibly: at no point does a static screen suggest a hang. A build counter confirms that open builds each visible row once, every visible append builds exactly one message instance, dot ticks build none, and loading or no-envoy transitions destroy none.
5. Appends and streaming preserve a mid-transcript scroll position. When the player is already at the bottom, new content remains pinned there. Loading an earlier page restores approximately the same visible position after the rebuild.
6. In a pinned-observer game, Converse appears for every eligible counterpart except the pinned seat itself. Propose Deal and Declare War match normal play. Confirming war declares on behalf of the pinned team with the pinned seat as originator, then hides the button.
7. In a pure-observer game, the unchanged mock demo plays exactly as in normal play: Converse and chat are available, Propose Deal and the active proposal actions are interactive, and settled cards remain readable but non-clickable. The own speaker renders as Observer and Declare War is absent.
8. Probe a leader-ribbon click while the human-control freeze is active and record whether it opens the leader screen. If EUI suppresses that input, use the fallback entry named in [specs.md](specs.md): a Converse control on the human-control screen strip or a notification click.
9. No errors in `Lua.log`. The Converse embed prints exactly one resolved candidate path, identifying the active LeaderHeadRoot hierarchy. If it uses the `RootOptions` fallback instead, the log records the unnamed-wrapper limitation and the button remains explicitly anchored near the action controls. A separate print probe confirms which NotificationPanel copy loaded ((3a) vs UI_bc1), and a mock include probe confirms the driver loaded from the mod VFS.

## Done when

Any player can walk the whole mock-backed conversation surface in a live game: leader screen → Converse → notification → panel with correctly derived deal cards and visible progress states. The one seat-driven difference is that a pure observer renders as Observer and never sees Declare War.
