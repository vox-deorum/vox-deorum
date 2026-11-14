# Newspaper research: UI and runtime images

Part one of [the newspaper research](research.md), based on [the feature specification](../spec.md). Repository paths below are relative to the repository root. The [renderer plan](../implementation/01-renderer.md) uses HTML/CSS image export for publication layout and native controls for game interaction.

## What the existing UI can do

The newspaper fits the existing VP + EUI Lua/XML interface. Vox Deorum already has custom panels with dynamically populated text, repeated rows, scrolling, callbacks, and asynchronous backend responses. These primitives can host rendered publication images and action overlays, the surrounding archive, and a basic text view when cached images are unavailable.

`civ5-mod/VoxDeorum.modinfo` registers XML-backed screens as `InGameUIAddin` entry points and imports their Lua/XML into the VFS. A dedicated newspaper context can follow that pattern. Use existing game fonts and EUI styles for the first layout; runtime font loading is not established by this research.

| Requirement | Existing evidence | Implication |
| --- | --- | --- |
| Articles and archive lists | `civ5-mod/UI/VoxDeorumDiploPanel.xml` and `.lua` define repeated message instances, text sizing, scrolling, and older-history loading. `VoxDeorumHumanPanel.xml` and `.lua` build dynamic lists and detail panels. | Reuse these control patterns for headlines, bodies, series links, filters, and evidence expansion. The newspaper needs its own layout. |
| Changing article length | The diplomacy panel measures populated controls and recalculates stacks and the scroll area. | Size rows after setting text. Check long names and localized text in the actual game fonts. |
| Voting | Existing panels use button callbacks and outbound game events. | Upvote, downvote, and clear can use native controls associated with an article ID. A backend acknowledgement confirms synchronization of a vote; durability depends on the chosen save-backed state and remains unverified. |
| Discreet entry point | EUI's `LUA/DiploCorner.lua`, under `civ5-dll/(3a) VP - EUI Compatibility Files/`, exposes `AdditionalInformationDropdownGatherEntries`. `VoxDeorumHumanTrigger.lua` provides a custom on-screen trigger. | A menu entry is an existing extension point. An unread badge needs a persisted read position and refresh behavior. |
| Screen navigation | `VoxDeorumHumanPanel.lua` uses `Events.SearchForPediaEntry`; EUI panels provide game-popup and city-navigation examples. | Store typed targets with evidence, then resolve them when clicked. A historical city may have changed owner or disappeared. |
| Simple charts | `civ5-dll/(1) Community Patch/Core Files/Overrides/ReplayViewer.xml` defines a `GraphLineInstance`; `ReplayViewer.lua` creates line segments and changes endpoints and colors. | Trends can use native line controls. Generated bitmaps are optional for basic evidence charts. |

Columns, page breaks, expansion, archive pagination, and small-screen behavior still need a layout exercise. Keep the spec's 200 to 400 word overview and longer evidence panels as separate sizing cases.

`VoxDeorumHumanPanel.lua` deliberately shows and hides its context directly: its `queueDialog()` comment records that a hidden queued context can block native Tech, Policy, or Demographics popups. The diplomacy panels use `UIManager:QueuePopup()` to layer over leader scenes. A passive newspaper window should investigate the human panel's approach and verify native popup interaction. The dialogue archive patterns rebuild live row instances; they do not establish that an entire campaign archive can be mounted at once. Page or bound the displayed history.

## Can we dynamically render a new image inside the game?

**Yes. In the tested VP + EUI DX11 session, a DDS generated after startup loaded by absolute path, including from outside the mod folder.** The file needed no manifest entry or restart. The [runtime texture findings](../../../developers/civ5-mod/runtime-texture-experiment.md) record the observed behavior, implementation implications, and untested cases.

`civ5-mod/UI/LeaderHeadRoot.lua` sets its background with `Controls.BackupTexture:SetTexture()` or `SetTextureAndResize()`, and calls `UnloadTexture()` when leaving the screen. `VoxDeorumHumanPanel.lua` calls `SetTexture()` and sets texture offsets. EUI's `EUI_core_library.lua` uses these operations for atlases.

The experiment used a temporary Lua/XML panel driven through Lua events from the bridge. An external process wrote 256 by 256 opaque DXT1 DDS files during play. The user identified changed pixels by distinct checks and stripe patterns beside an unchanged reference. The probe and its assets have been removed; the findings remain as the implementation reference.

| Delivery approach | Research result |
| --- | --- |
| Choose among textures shipped with the mod | Supported by existing Lua. Suitable for era backgrounds, section art, and reusable illustrations. |
| Draw with text, boxes, and line controls | Supported by existing UI examples. Suitable for small comparisons and trends. |
| Generate a DDS before activation and register it as an asset | Worked as the experiment's reference and initial candidate. |
| Overwrite a registered DDS during play, then call `SetTexture()` alone | Retained the old pixels for the previously displayed texture. |
| Unload that control's texture, then set the registered name again | Displayed the replacement pixels. A separate registered file replaced before first use also displayed its new pixels. |
| Create a new file after activation and pass its bare filename | Produced a Texture Load Error dialog. The file existed but was absent from the manifest. |
| Pass a new file's absolute path | Displayed the new pixels, both inside the installed mod folder and outside it. The external file worked on its first request. These calls used unload followed by set. |
| Pass a mod-relative path, URL, encoded image, or pixel buffer | Not tested. The demonstrated route uses an absolute filesystem path. |

The demonstrated route needs no new DLL texture API. The external process creates a DDS file and sends its absolute path to the UI; the image control loads it. `UnloadTexture()` refreshed the tested control, but the experiment does not establish global cache invalidation or VFS rescanning. The unresolved basename also opened a modal error dialog that blocked the bridge call until dismissed.

### Implications and remaining checks

Generated illustrations have a demonstrated delivery path. A prototype can retain a distinct DDS per illustration and resolve its absolute path on the local machine. Keep the file available when revisiting an issue, and check file availability before requesting a texture so a missing image can use a packaged fallback.

Before treating this as a supported newspaper feature, test reopening old illustrations, save reloads, game restarts, missing-file fallback, image volume and memory use, other dimensions and encodings, and other supported renderers. Save portability needs a way to retain or restore image files on another machine. The exact VP build was not recorded for this DX11 experiment.

The proposed reader uses this file-loading route for the publication's rendered text and art. The first implementation stage must verify larger textures, small-text quality, scrolling, and interaction alignment. Native text provides a missing-cache view. Charts and generated illustrations remain later extensions.

## Communication with the background service

`civ5-mod/UI/VoxDeorumDiploTransport.lua` is the closest existing model:

- UI actions call `Game.BroadcastEvent()` with generated event IDs.
- Backend-callable functions register through `Game.RegisterFunction()` and translate incoming pushes to local `LuaEvents`.
- Registration waits until panel presentation because registration during context loading can reach the connection service before setup.
- Replies carry player and counterpart IDs; the panel handles acknowledgement and response timeouts.

A newspaper transport could use this route to fetch issues, browse history, and record votes. It needs campaign, receiving-seat, issue, and request identity so that late replies cannot populate another campaign or seat. Fetching an old issue should render its saved text and evidence without running the editor again.

Two transport details matter for a prototype. The diplomacy panel pumps `Game.ProcessConnectionMessages()` during updates because the normal game tick stops in the leader scene. Verify delivery while the newspaper is open in any such scene. Also, `CvConnectionService::BroadcastEventFromLua()` builds outbound events in a 65,536-byte JSON memory pool and rejects overflow. This is a memory-pool limit with object overhead, not a guaranteed 64 KB article-text allowance or a universal limit on all transport directions. Keep UI requests and votes small, and verify backend issue/history batch limits separately. The existing synchronous `Game.CallExternal()` path waits up to one second; asynchronous requests are the better starting point for background generation.

This transport does not satisfy offline reading by itself. The spec requires the in-game reader to obtain published editions from save-backed state while MCP is unavailable. MCP's copy supports generation and queries.

## Save-backed archive primitives

| Primitive | What the source establishes | What remains to test |
| --- | --- | --- |
| `Modding.OpenSaveData()` | `mcp-server/lua/game-identity.lua` stores game identity and last-sync time in a `Deorum` table. | Publication transactions, archive volume, autosave timing, and restoration from different saves of one campaign. |
| Player script data | `CvLuaPlayer.cpp` exposes `GetScriptData()` and `SetScriptData()`. `CvPlayer.cpp` serializes `m_strScriptData` through its save visitor. | A namespaced representation, coexistence with other mods using the shared string, size and performance, and multiplayer behavior. |

The script-data path confirms that a per-player string participates in serialization. Both candidates still need newspaper save/load verification. Save an issue, an edited vote, and the receiving civilization's publication frequency and LLM-use preferences. Change the vote and preferences, publish another issue, then reload the earlier save. Verify that its history and preferences return, including the original visual design, layout variants, and page order of each saved issue, with the later issue absent.

External artwork also needs retention and a missing-image fallback. Saving article text will not copy generated files when a save moves to another machine.

## Seats and later checks

Use `VoxDeorumSeat.EffectiveSeat()` for the publication's civilization. A pure observer has no receiving civilization until the product defines a selection. Native notification delivery follows the real active player, including when an observer is viewing another seat; `civ5-mod/AGENTS.md` documents this distinction. Votes, campaign preferences, and publication history follow the receiving civilization.

Provide controls for publication frequency and LLM use, and restore those preferences for the receiving civilization when loading a campaign.

Tech milestones can change layout and weights using packaged assets. Preserve each published issue's visual design, selected layout variants, and page order so reopening it restores the original presentation without rerunning the editor. [The data research](research-data.md) records the checked-in identifiers and historical-unlock gaps.

Later checks should cover text wrapping, scrolling, old installments, archive filters for date, civilization, city, and tag, editable votes, seat switches while a request is pending, service loss, and archive restoration. These require an implemented prototype; this documentation task requires no mod deployment.
