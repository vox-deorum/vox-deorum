# civ5-mod: in-game UI

Vox Deorum keeps its in-game UI thin. Most visible behavior uses existing Civilization V surfaces, while the custom panels provide the interactive diplomacy and human-control flows.

## Built-in surfaces

- The replay log records strategic action summaries and rationales.
- The active-player top panel follows the player whose rationale arrived most recently. `VD_TopPanelAutoSwitchedPlayer` forwards that change to the capture pipeline. See [Lua hooks](lua-hooks.md).

## Custom panels

- [Diplomacy panel](diplomacy-panel.md): the conversation transcript and stage-scoped mock controls.
- [Deal screen](deal-screen.md): the VP EUI trade editor wrapper, promise controls, and FireTuner mock scenarios.
- The human decision panel (`UI/VoxDeorumHumanPanel.lua` and `.xml`) appears only in human-control mode. It renders the choices provided by `present-decision`, submits through `Game.BroadcastEvent("HumanDecision", ...)`, and does not own game logic. See the [human-control plans](../../plans/human-control/).

## Observer API

Observer addins listen for `LuaEvents.VoxDeorumPlayerInfo` and `LuaEvents.VoxDeorumAction`. They retain their own state and can use the event turn parameter to identify boundaries. `Lua/VoxDeorumTest.lua` is the small consumer example.

The full event contract is in `civ5-mod/docs/observer-api.md`. For C-level Lua debugging, see `civ5-mod/docs/lua-c-debug.md`.

The spokesperson experience is driven by vox-agents. This mod renders the in-game results and forwards strategic activity through the observer path. Player guidance is in the [playing guide](../../players/playing.md).
