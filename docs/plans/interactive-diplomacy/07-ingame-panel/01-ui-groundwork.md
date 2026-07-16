# Stage 7.01 — civ5-mod + civ5-dll: Converse button, notification channel, chat panel (all mock-driven)

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). UI comes first: everything in this stage runs against mock data inside a live game, with zero server involvement — the risky Civ-UI work is validated before any transport or agent code exists.

## Objective

Deliver the three in-game surfaces of the conversation flow — the **Converse** entry on the leader screen, the **native notification** channel, and the **chat panel** — fully rendered and interactive against built-in mock data. The stage's smoke test ties them together: clicking Converse posts one native notification; clicking that notification opens the chat panel for the right counterpart.

## Work items

1. **`civ5-mod/VoxDeorum.modinfo` + `civ5-mod/Text/VoxDeorum_Text.xml` — registration.** Add files `UI/VoxDeorumConverse.lua/.xml`, `UI/VoxDeorumDiploPanel.lua/.xml` (`.lua` `import="1"`, context `.xml` `import="0"`), `XML/VoxDeorum_Notifications.xml`; add a `<EntryPoint type="DiplomacyUIAddin">` for the Converse context and an `<EntryPoint type="InGameUIAddin">` for the panel; add an `UpdateDatabase` action for the notifications XML; add TXT keys (`TXT_KEY_VD_CONVERSE`, panel strings). Run `civ5-mod/update_md5.py`. Rationale: both active LeaderHeadRoot variants load `DiplomacyUIAddin` contexts *inside* the leader screen (`civ5-dll/(3a) VP - EUI Compatibility Files/LUA/LeaderHeadRoot.lua:627`, `UI_bc1/LeaderHead/LeaderHeadRoot.lua:947`) — a supported, non-destructive hook; no base-screen fork, no runtime injection from outside.

2. **`civ5-mod/UI/VoxDeorumConverse.lua/.xml` — the Converse button.** A tiny context loaded inside LeaderHeadRoot. Track the on-screen leader via `Events.AILeaderMessage` (arg 1 is `diploPlayerID`). On first show, embed the button into the leader screen's action stack: `local discuss = ContextPtr:LookUpControl("../DiscussButton"); Controls.ConverseButton:ChangeParent(discuss:GetParent())`, then `CalculateSize()`/`ReprocessAnchoring()` — retry-until-resolves, the `VoxDeorumHumanTrigger.lua` embed idiom. (`GetParent()` because the (3a) stack is unnamed; it also works on UI_bc1's named stack.) **Only add — never touch existing buttons.** Click: leave the leader scene cleanly (`UI.SetLeaderHeadRootUp(false); UI.RequestLeaveLeader()` — the (3a) `OnClose` sequence) and fire `LuaEvents.VoxDeorumDiploOpen(m_diploPlayerID)`. Show for met, alive majors.

3. **Notification channel.**
   - `civ5-mod/XML/VoxDeorum_Notifications.xml` — one row: `<Notifications><Row><Type>NOTIFICATION_VOX_DEORUM_DIPLOMACY</Type></Row></Notifications>`. `NotificationTypes` is data-driven, so this alone makes the type exist engine-wide; EUI's NotificationPanel renders unknown types with its `Generic` instance.
   - `civ5-mod/UI/VoxDeorumDiploPanel.lua` — register `VoxDeorumPostNotification(playerID, counterpartID, summary, message)` via `Game.RegisterFunction`, body per specs (calls `Players[playerID]:AddNotificationName(...)`, binding at `civ5-dll/CvGameCoreDLL_Expansion2/Lua/CvLuaPlayer.cpp:12234`). Registered here (rather than a separate context) because the panel is the consumer of the click event and tracker of the pair's notification ids (via `Events.NotificationAdded`).
   - Click dispatch — guarded ~6-line branch in `civ5-dll/(3a) VP - EUI Compatibility Files/LUA/NotificationPanel.lua` **and** `civ5-dll/UI_bc1/NotificationPanel/NotificationPanel.lua`, in `GenericLeftClick`: if the entry's type equals `NotificationTypes.NOTIFICATION_VOX_DEORUM_DIPLOMACY` (nil-guarded so installs without the mod are inert), fire `LuaEvents.VoxDeorumDiplomacyNotificationActivated(Id, counterpartID, extra)` and return instead of `UI.ActivateNotification`. (Verified: no `Events.NotificationActivated` exists anywhere; the DLL `Activate` default is a no-op.)
   - `civ5-dll/CvGameCoreDLL_Expansion2/CvNotifications.cpp` — additive early-out in `IsNotificationTypeEndOfTurnExpired` returning `false` for our hashed type (the unknown-type default `true` would auto-dismiss it at the turn boundary, killing cross-turn correspondence). Save persistence needs nothing (`Notification::Serialize` already covers type/strings/data). DLL rebuild; no save-format change.

4. **`civ5-mod/UI/VoxDeorumDiploPanel.lua/.xml` — the chat panel, mock-driven.** A dormant `InGameUIAddin` in the `VoxDeorumHumanPanel` idiom for its lifecycle (`ContextPtr:SetHide(true)` at load, explicit show/hide instead of the popup stack, Esc handled locally), drawn **full-screen over the native diplomacy backdrop** — reuse the background/frame treatment of the in-game deal screen (`DiploTrade.xml` assets) so the panel reads as part of the diplomacy scene. The message display adapts the **diplomacy-message-log bubble design by @schnetziomi5** (reference `MessageInstance` XML below — **credit them in a comment in the shipped XML/Lua**): a dark `GridBlackIndent8` bubble with a gold `Grid9Frame` border, the speaker's 64px leader portrait (`LeaderPortraits512.dds` in an `IconFrame64.dds` frame, civ-icon badge overlaid) hanging off the bubble's top corner, leader name as the `TITLE` line, wrapped `TEXT` body, and a centered turn pill (`T60 ~ 1600 BC` style) — used here as a **turn separator** whenever the turn changes between rows. Counterpart bubbles sit left with the portrait on the left; the player's own bubbles sit right with the portrait on the right (mirroring the log's layout). A matching centered header pill shows `T143 ~ 1250 AD`. Remaining layout: a "Load earlier…" row, the `DealCard` instance — **the same bubble design as text messages** (proposer's portrait on the bubble corner, leader-name title line), body = the proposal's outward `message` text followed by a **two-column They give | You give term list with promises folded in as ordinary entries**; the **entire bubble is clickable** and opens the deal screen (stubbed this stage) — the active open proposal in respond mode, settled/superseded ones view-only, per the reducer — input row (`EditBox` capped 2000 chars + Send), and a footer with **Propose Deal** (stub), **Declare War**, and **Goodbye**. Goodbye (and the header X) only hides the panel; conversation closure is the diplomat's or the Web's move, and the panel derives the closed state from the transcript's `close` row. This stage ships:
   - A **built-in mock transcript** exercising every render path: text rows both directions, a `{{{Greeting}}}` row (must be hidden), a turn boundary (separator pill), and a proposal chain covering open / rejected / accepted / enacted / superseded deal cards.
   - **Declare War** — fully functional already (purely native, no bridge): shown only when the teams are not at war and `g_activeTeam:CanDeclareWar(counterpartTeam)` (the LeaderHeadRoot gating idiom, `UI_bc1/LeaderHead/LeaderHeadRoot.lua:279`); a confirmation prompt, then `Network.SendChangeWar(counterpartTeam, true)` (the `CityStateDiploPopup.lua:1146` idiom); the button disappears once at war.
   - The **Lua port of `deriveActiveProposal`** (from `vox-agents/src/utils/diplomacy/deal-reduce.ts`, semantics pinned in specs) plus `isClosedThisTurn` derivation, driving card badges and clickability from the mock rows — the reducer is proven against mocks before any server exists. Cross-reference comments both ways.
   - Every **in-progress state** from the specs UI rules, cycling visibly on mock timers: "loading conversation…", optimistic "sending…" row on Send, "envoy is thinking…" status row, a streaming-draft row, pending deal badges, and the two timeout states with their Retry affordances.
   - Delimiter stripping (`!@#$%^!`) on input; opening from both `LuaEvents.VoxDeorumDiploOpen` and `LuaEvents.VoxDeorumDiplomacyNotificationActivated` (the latter also removes the pair's tracked notifications).
   - For the smoke test only: Converse-open posts one mock notification through `VoxDeorumPostNotification` locally.

### Panel layout (text mockup)

Full-screen, drawn over the **native diplomacy backdrop** — the same background/frame assets as the in-game deal screen (`DiploTrade.xml` treatment), so it reads as part of the diplomacy scene. Messages use the @schnetziomi5 bubble design: dark bubbles with the speaker's portrait hanging off the top corner — counterpart on the left, the player mirrored on the right — and centered turn pills as separators.

```
╔══════════════════════════════════════════════════════════════════════╗
║ ░░ native diplomacy-screen background (DiploTrade assets) ░░          ║
║                    ⟨ T143 ~ 1250 AD ⟩                          [X]    ║  ← header pill: turn ~ date;
╠══════════════════════════════════════════════════════════════════════╣    X hides the panel (Goodbye).
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
║              │    The settlements are on land we claimed     │ ★  │   ║    on the right — mirrored
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
║      │    No spying (promise)  │                        │              ║    proposal (per the reducer)
║      ╰──────────────────────────┴───────────────────────╯              ║    → deal screen respond mode;
║                                                                       ║    settled/superseded → view-only
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

1. The leader screen shows **Converse** alongside Discuss/Trade/Demand/War, all natives still functional; clicking it leaves the leader scene, posts **one native notification**, and opens the panel on the mock conversation for that leader.
2. Clicking the **notification** re-opens the panel for the right counterpart and removes the notification. It survives end-turn ×2 and a save/load; right-click dismiss still works; a game without the mod is unaffected (guarded branch inert).
3. Mock rows render correctly in the @schnetziomi5 bubble design: `{{{Greeting}}}` hidden; counterpart bubbles left / own bubbles right, each with the speaker's leader portrait and civ badge on the bubble corner and the "Leader of Civ" title line; a turn pill separates rows from different turns; the header pill shows turn ~ date; deal rows render as the same bubbles carrying the deal message plus the two-column They give | You give list (promises folded in, no balance), each fully clickable — the mock chain proves the reducer picks exactly one active open proposal (respond mode) with all earlier ones view-only; closed-this-turn mock locks input with an explanatory row.
4. Every pending/streaming/timeout state animates visibly — at no point does a static screen suggest a hang.
5. **Declare War** appears only while at peace with the counterpart and war is declarable; confirming it actually declares war (native, no bridge), after which the button disappears.
6. No errors in `Lua.log`; a print probe confirms which NotificationPanel/LeaderHeadRoot copies actually loaded ((3a) vs UI_bc1).

## Done when

A player in a live game can walk the whole conversation surface — leader screen → Converse → notification → panel with correctly derived deal cards and visibly alive progress states — with everything behind it still mock data.
