# Newspaper research: UI and runtime images

Part one of [the newspaper research](research.md), based on [the feature specification](spec.md). Repository paths below are relative to the repository root.

## What the existing UI can do

The newspaper fits the existing VP + EUI Lua/XML interface. Vox Deorum already has custom panels with dynamically populated text, repeated rows, scrolling, callbacks, and asynchronous backend responses. An issue can use a native text layout with optional illustrations and evidence charts.

`civ5-mod/VoxDeorum.modinfo` registers XML-backed screens as `InGameUIAddin` entry points and imports their Lua/XML into the VFS. A dedicated newspaper context can follow that pattern. Use existing game fonts and EUI styles for the first layout; runtime font loading is not established by this research.

| Requirement | Existing evidence | Implication |
| --- | --- | --- |
| Articles and archive lists | `civ5-mod/UI/VoxDeorumDiploPanel.xml` and `.lua` define repeated message instances, text sizing, scrolling, and older-history loading. `VoxDeorumHumanPanel.xml` and `.lua` build dynamic lists and detail panels. | Reuse these control patterns for headlines, bodies, series links, filters, and evidence expansion. The newspaper needs its own layout. |
| Changing article length | The diplomacy panel measures populated controls and recalculates stacks and the scroll area. | Size rows after setting text. Check long names and localized text in the actual game fonts. |
| Voting | Existing panels use button callbacks and outbound game events. | Upvote, downvote, and clear can use native controls associated with an article ID. The backend must acknowledge a saved vote before it becomes durable editorial state. |
| Discreet entry point | EUI's `LUA/DiploCorner.lua`, under `civ5-dll/(3a) VP - EUI Compatibility Files/`, exposes `AdditionalInformationDropdownGatherEntries`. `VoxDeorumHumanTrigger.lua` provides a custom on-screen trigger. | A menu entry is an existing extension point. An unread badge needs a persisted read position and refresh behavior. |
| Screen navigation | `VoxDeorumHumanPanel.lua` uses `Events.SearchForPediaEntry`; EUI panels provide game-popup and city-navigation examples. | Store typed targets with evidence, then resolve them when clicked. A historical city may have changed owner or disappeared. |
| Simple charts | `civ5-dll/(1) Community Patch/Core Files/Overrides/ReplayViewer.xml` defines a `GraphLineInstance`; `ReplayViewer.lua` creates line segments and changes endpoints and colors. | Trends can use native line controls. Generated bitmaps are optional for basic evidence charts. |

Columns, page breaks, expansion, archive pagination, and small-screen behavior still need a layout exercise. Keep the spec's 200 to 400 word overview and longer evidence panels as separate sizing cases.

`VoxDeorumHumanPanel.lua` deliberately shows and hides its context directly: its `queueDialog()` comment records that a hidden queued context can block native Tech, Policy, or Demographics popups. The diplomacy panels use `UIManager:QueuePopup()` to layer over leader scenes. A passive newspaper window should investigate the human panel's approach and verify native popup interaction. The dialogue archive patterns rebuild live row instances; they do not establish that an entire campaign archive can be mounted at once. Page or bound the displayed history.

## Can we dynamically render a new image inside the game?

**We can change an image control to another available texture during play. Whether an external service can create a brand-new file and display it immediately is still unverified.** The repository provides no demonstrated end-to-end path for the latter.

`civ5-mod/UI/LeaderHeadRoot.lua` sets its background with `Controls.BackupTexture:SetTexture()` or `SetTextureAndResize()`, and calls `UnloadTexture()` when leaving the screen. `VoxDeorumHumanPanel.lua` calls `SetTexture()` and sets texture offsets. EUI's `EUI_core_library.lua` uses these operations for atlases.

Those examples establish image selection, resizing, atlas regions, and releasing a control's texture. Their filenames refer to resources already available to the engine. They do not demonstrate URLs, base64 data, in-memory pixel buffers, or files introduced after mod activation.

DDS is the established packaged-artwork workflow. The modder's [DDS Converter documentation](https://www.picknmixmods.com/utilities/ddsconverter/util.html) describes PNG/JPEG conversion, sizing, and compression. The author's [texture troubleshooting guidance](https://forums.civfanatics.com/threads/exporting-to-dds.486808/) requires texture files to be imported into the VFS, matching the repository's asset declarations. These sources establish preparation and registration, without proving that live additions or replacements work.

| Delivery approach | Research result |
| --- | --- |
| Choose among textures shipped with the mod | Supported by existing Lua. Suitable for era backgrounds, section art, and reusable illustrations. |
| Draw with text, boxes, and line controls | Supported by existing UI examples. Suitable for small comparisons and trends. |
| Generate a DDS before activation and register it as an asset | Uses the established packaged-asset route. Live generation remains a separate question. |
| Overwrite a registered placeholder DDS during play, then unload and set it again | A plausible experiment. VFS behavior and file/texture caches are unverified. |
| Create a new DDS filename after activation and pass it to `SetTexture()` | Unverified. File discovery and VFS registration are separate from assigning a texture name. |
| Pass an absolute filename, URL, or encoded image | No working precedent found in the inspected code. Do not make this an implementation assumption. |
| Add support through the DLL | Requires a demonstrated engine-facing texture or resource-loading interface. `CvConnectionService` transports Lua calls and events; this alone provides no texture uploader. |

The gameplay wrappers in `civ5-dll/CvGameCoreDLL_Expansion2/Lua/` do not implement the engine's image controls. Their absence there cannot prove that a feature is impossible. Equally, `UnloadTexture()` does not establish global cache invalidation or VFS rescanning.

### Experiment needed

Use two unmistakably different DDS files with matching dimensions and known-good encoding. Keep a packaged illustration as a working control.

1. Register a placeholder before activation and confirm that `SetTexture()` renders it.
2. Replace the file from the external process after startup. Test before its first use, then after displaying and unloading it. Record whether the old or new pixels appear.
3. Create a second file under a new filename after activation. Separately test its resource name, a mod-relative path, and an absolute path. A silent Lua call does not demonstrate successful rendering.
4. Repeat after reopening the panel, loading a save, and restarting. Check supported graphics modes before treating a result as a feature guarantee.
5. Open several issues, revisit older ones, and check missing-file fallback. Reusing a placeholder can show the wrong historical artwork after its contents change.

Success means a file created after startup becomes visibly distinguishable in the running game and old issues still resolve the correct artwork. No such experiment was run for this research. If only registered replacements work, bounded texture slots could be investigated, including slot reuse and archive retention.

The initial reader can proceed with native text and packaged art. Native charts are a feasible later extension; the spec defers graph rendering. Live-generated illustrations also remain a later capability investigation.

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

The script-data path confirms that a per-player string participates in serialization. `OpenSaveData()` is already used here, but its current use does not validate newspaper commit-and-load behavior. Compare the candidates by saving an issue and an edited vote, loading an earlier save, and verifying that only that save's history returns.

External artwork also needs retention and a missing-image fallback. Saving article text will not copy generated files when a save moves to another machine.

## Seats and later checks

Use `VoxDeorumSeat.EffectiveSeat()` for the publication's civilization. A pure observer has no receiving civilization until the product defines a selection. Native notification delivery follows the real active player, including when an observer is viewing another seat; `civ5-mod/AGENTS.md` documents this distinction. Votes and publication history follow the receiving civilization.

Tech milestones can change layout and weights using packaged assets. Retain the chosen presentation identifier with each published issue so the archive can reproduce its historical medium. [The data research](research-data.md) records the checked-in identifiers and historical-unlock gaps.

Later checks should cover text wrapping, scrolling, old installments, tag filters, editable votes, seat switches while a request is pending, service loss, and archive restoration. These require an implemented prototype; this documentation task requires no mod deployment.
