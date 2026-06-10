# civ5-mod — Lua Hooks and Scripts

Almost all of the mod's runtime behavior is a single in-game Lua addin, `Lua/VoxDeorumTest.lua`, loaded as an `InGameUIAddin`. Despite the name, it is the real seam between the game's Lua world and the external Vox Deorum stack: it carries strategic decisions *into* the game's event system and carries render-time UI events *out* to the Bridge Service. This page explains both directions and the map script that rounds out the mod's scripting.

## The two directions of flow

The game's Lua runtime exposes `LuaEvents` — a publish/subscribe bus that any addin can fire on or listen to. The mod uses it as a junction between in-game observers and the world outside the game process.

### Inbound: strategic decisions become in-game events

When an agent decides something — a strategy shift, a research pick, a relationship change — that decision has to reach the game. It does so not by the mod reaching out, but by the [MCP server](../mcp-server/) pushing it *in* through the DLL's channel. The MCP server keeps two preregistered Lua functions on the [Bridge Service](../bridge-service/), `registerAction` and `setPlayerInfo`; calling them runs a tiny script inside the game that fires the corresponding `LuaEvent`:

- **`LuaEvents.VoxDeorumPlayerInfo(playerID, aiLabel)`** — announces which model and strategist a player is being run by, e.g. `"deepseek-r1 / simple-strategist"`.
- **`LuaEvents.VoxDeorumAction(playerID, turn, actionType, summary, rationale)`** — one strategic action, tagged with the turn it happened on and a category (`strategy`, `research`, `policy`, `relationship`, `persona`, `flavors`, `unset-flavors`, `status-quo`).

These two events are the **observer API**: any in-game mod can subscribe to them to watch the AI think. `VoxDeorumTest.lua` subscribes to both and prints them to `Lua.log` — it is deliberately a minimal reference listener, demonstrating the contract that richer observer mods build on. The same `registerAction` path can also write the summary and rationale into the game's replay log, so the decisions show up when reviewing a session. The exact event signatures, parameter ranges, action-type meanings, and a fuller example listener are documented in the mod's own reference, `../../../civ5-mod/docs/observer-api.md`.

### Outbound: in-game UI events become bridge events

The addin also listens for a pair of render-time events that the game's UI fires, and forwards each one back out to the bridge with `Game.BroadcastEvent`, which the DLL turns into a `game_event` message on the channel:

- **`VD_TopPanelAutoSwitchedPlayer(playerID, prevPlayerID)`** — fired when the top panel auto-switches to show a player because that player's rationale just arrived. The addin re-emits it as `Render:PlayerPanelSwitch`.
- **`VD_AnimationStarted(playerID, eventInfo)`** — fired (externally) when a player's turn animations are estimated to begin. The addin re-emits it as `Render:AnimationStarted`.

Both forwarded events are stamped with the current game turn and an epoch timestamp, and carry a flag for whether the player is a minor civ — barbarians are folded in with minor civs here, because downstream consumers ignore render events for those segments. The animation event's payload is normalized to a fixed shape (event type, plot coordinates, nearest city and distance, description) so that consumers receive a predictable record regardless of what the raw event supplied. These `Render:*` events feed the capture and media side of the stack, where they help line up generated video with what was happening on screen.

## The round trip

Put together, the addin sits in the middle of a loop that crosses every layer:

> agents decide → MCP server calls `registerAction` over the bridge → the DLL runs the preregistered Lua → `LuaEvents.VoxDeorumAction` fires → observer addins (including this one) react, and the replay log records the decision. Meanwhile, the game's own UI events (`VD_*`) are broadcast back out through the DLL and bridge to the capture pipeline.

This is why the mod is required even though it is small: it is the in-game end of the protocol, and the place where external decisions become events the game and its UI can see.

## The map script

`Mapscripts/Vox_Deorum.lua` is the mod's other entry point, but it is a different kind of script entirely: a **map generator**, not a runtime hook. It is a parameter-tuned copy of the community **Communitu_79a** script (Communitas lineage, adapted for Vox Populi) whose values are fixed for Vox Deorum research so that studies run on consistent terrain. It runs once, at world generation, and plays no part in the event flow above. Treat it as inherited, third-party map-generation code; it is included for reproducibility rather than as something the project actively develops.

## Reference

For the precise observer-event contract, see `../../../civ5-mod/docs/observer-api.md`. For low-level Lua debugging inside the gamecore (reading the Lua stack from a Windows debugger), the mod keeps `../../../civ5-mod/docs/lua_c_debug.md`.
