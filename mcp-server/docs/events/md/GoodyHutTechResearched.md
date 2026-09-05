# Overview

The `GoodyHutTechResearched` event is triggered when a player discovers a technology through a goody hut exploration. This event provides information about which player received the technology and what specific technology was discovered.

# Event Triggers

This event is triggered in the following scenario:

- When a unit explores a goody hut and receives a technology as a reward
- The event fires through the Lua scripting system before the technology is officially granted
- The technology discovery is processed as part of the goody hut reward mechanism

# Parameters

| Parameter  | Type  | Description                                       |
| ---------- | ----- | ------------------------------------------------- |
| `playerId` | `int` | The ID of the player who received the technology  |
| `techType` | `int` | The type/ID of the technology that was discovered |

# Event Details

The `GoodyHutTechResearched` event is specifically focused on technology discoveries from goody huts. This represents one of the most valuable types of goody hut rewards in the game, as free technologies can significantly accelerate a civilization's development.

The event captures:

- Which player benefited from the technology discovery
- The specific technology that was unlocked
- Timing information for strategic analysis

This event is particularly important for:

- Tracking technological advantages gained through exploration
- Understanding the impact of early game exploration on civilizations
- AI systems that need to assess the relative technological positions of players

# Technical Details

**Source Location:** `CvGameCoreDLL_Expansion2/CvPlayer.cpp:12853`

**Trigger Context:** The event is invoked within the `CvPlayer::receiveGoody` function during goody hut processing, specifically when a technology reward is being processed. The event uses Lua scripting system integration.

**Event Hook:** Uses `LuaSupport::CallHook` to trigger the Lua-based event system with the event name "GoodyHutTechResearched"

**Script System Integration:** This event integrates with the game's Lua scripting system (`ICvEngineScriptSystem1`) for mod and scenario customization.

**Conditional Behavior:** If `MOD_EVENTS_GOODY_TECH` is enabled, the system uses `GAMEEVENTINVOKE_HOOK` instead of the Lua script system.

**Code Reference:**

```cpp
CvLuaArgsHandle args;
args->Push(GetID());
args->Push(eBestTech);
bool bScriptResult = false;
LuaSupport::CallHook(pkScriptSystem, "GoodyHutTechResearched", args.get(), bScriptResult);
```

**Processing Flow:** The event fires before the technology is officially granted via `GET_TEAM(getTeam()).setHasTech()`, allowing for potential intervention or additional processing through the script system.

The event provides crucial insight into one of the most impactful random rewards in Civilization V, enabling detailed tracking of how exploration-based technology discoveries affect game balance and player progression.
