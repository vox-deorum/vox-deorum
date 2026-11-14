# civ5-mod: in-game UI

Vox Deorum keeps its in-game UI thin. Most visible behavior reuses existing Civilization V surfaces, while a few custom contexts provide the interactive diplomacy and human-control flows.

This page is the map of those surfaces for anyone working on them: what is reused, what is custom, and the seat rules every diplomacy surface has to respect.

## Built-in surfaces

- The replay log records strategic action summaries and rationales.
- The active-player top panel follows the player whose rationale arrived most recently. `VD_TopPanelAutoSwitchedPlayer` forwards that change to the capture pipeline. See [Lua hooks](lua-hooks.md).

## Custom contexts

- [Diplomacy panel](diplomacy-panel.md): the conversation transcript, its phase indicator, and the proposal cards for the current counterpart.
- [Deal screen](deal-screen.md): a wrapper around the VP EUI trade editor that adds promise terms, validation feedback, and the propose/counter/accept/reject actions.
- The human decision panel (`UI/HumanControl/VoxDeorumHumanPanel.lua` and `.xml`) appears only in human-control mode. It renders the choices provided by `present-decision`, submits through `Game.BroadcastEvent("HumanDecision", ...)`, and owns no game logic. Its companion `UI/HumanControl/VoxDeorumHumanTrigger` is the small widget that reopens it. See the [human-control plans](../../plans/human-control/).

For how the diplomacy contexts fit into the wider agent round trip, see [diplomacy.md](../diplomacy.md).

## Seat resolution in human-strategist mode

Human-strategist mode runs the game under AI autoplay with the camera on an observer slot, pinned to the human's civ by `Game.SetObserverUIOverridePlayer`. Left alone, diplomacy UI reads `Game.GetActivePlayer()` as "us", and that slot owns no cities, is at war with nobody, and returns garbage from `GetApproachTowardsUsGuess`, so every leader renders neutral.

Two tiers resolve the seat:

- **Mod files** (`civ5-mod/UI/`) use `VoxDeorumSeat.EffectiveSeat()` and `VoxDeorumSeat.IsPureObserver()`.
- **Files in the `civ5-dll` submodule** also ship to plain VP and EUI users, so they cannot depend on the mod. They inline a file-local `GetUIActivePlayerID()` that checks `IsObserver()` plus `Game.GetObserverUIOverridePlayer()`, matching the idiom already used by EUI's `TopPanel.lua` and `CityBannerManager.lua`. Every divergence is marked `-- Vox Deorum:`.

**Civ identity follows the override; identity of other kinds does not.** Network identity (chat targets, the MP kick check, the turn-slice "local player" branch) and notification receivers stay on the real `Game.GetActivePlayer()`. The DLL files observer-mode notifications against the active player (`CvPlayer.cpp`) and the engine surfaces only that list, so a notice posted to the pinned civ would never be read.

The seat-aware surfaces are the EUI leader ribbon and its tooltips (`NotificationPanel.lua`), the mood and full civ tooltip (`EUI_tooltip_library.lua` and the separate global `GetMoodInfo` in `InfoTooltipInclude.lua`, which is what `DiploList` and `DiscussionDialog` call), the diplomacy corner's espionage and vassal state (`DiploCorner.lua`), `DiploList.lua`, and `LeaderHeadRoot.lua`'s mood line and war-score panel.

Native diplomacy stays **deliberately inert** for a human strategist, because those actions enact for `Game.GetActivePlayer()`, the observer. `LeaderHeadRoot`'s Discuss, Trade, Demand, and War buttons are disabled with `TXT_KEY_VD_ACTION_UNAVAILABLE_STRATEGIST_TT`, and the ribbon's ctrl+click war/peace path and `DiploList`'s war button are gated on the seat being the true active player. Converse remains the working path.

## Observer API

Observer addins listen for `LuaEvents.VoxDeorumPlayerInfo` and `LuaEvents.VoxDeorumAction`. They retain their own state and can use the event turn parameter to identify boundaries. `Lua/VoxDeorumTest.lua` is the small consumer example.

The full event contract is in `civ5-mod/docs/observer-api.md`. For C-level Lua debugging, see `civ5-mod/docs/lua-c-debug.md`.

The spokesperson experience is driven by vox-agents. This mod renders the in-game results and forwards strategic activity through the observer path. Player guidance is in the [playing guide](../../players/playing.md).
