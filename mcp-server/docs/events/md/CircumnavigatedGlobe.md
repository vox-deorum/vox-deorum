# Overview

The `CircumnavigatedGlobe` event is triggered when a team successfully circumnavigates the globe in Civilization V. This historic achievement occurs when a team reveals at least one plot in every column (if map wraps X) or row (if map wraps Y) of the map, marking a significant exploration milestone.

# Event Triggers

This event is triggered during the `testCircumnavigated()` function execution, which is called during team turn processing. The circumnavigation test evaluates whether a team has discovered sufficient plots across the wrapping axis to qualify for this achievement.

**Specific trigger conditions:**

- **Map wrapping**: The map must wrap on at least one axis (X or Y direction)
- **Plot revelation**: A team must have at least one revealed plot in every column/row along the wrapping axis
- **Land coverage**: The map must have less than 2/3 land plots (more ocean than land)
- **First achievement**: Only the first team to circumnavigate triggers this event
- **Turn processing**: Checked automatically during each team's turn processing phase
- **No technology prerequisite**: Unlike common belief, there is no hardcoded astronomy requirement

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `teamID` | integer | The ID of the team that successfully circumnavigated the globe |

# Event Details

The circumnavigation system tracks global exploration progress and awards this achievement to the first team to complete the feat. The event is part of the exploration victory conditions and provides both mechanical and narrative significance.

**Achievement mechanics:**

- Grants additional free movement points to naval units (configurable via `CIRCUMNAVIGATE_FREE_MOVES`)
- Marks the world as circumnavigated, preventing other teams from achieving the same feat
- Triggers notification messages to all players about the achievement
- Unlocks achievement for human players in single-player games
- Updates minor civilization quest states related to circumnavigation

**Implementation details:**

- The event can be triggered through either the legacy Lua hook system or the newer GAMEEVENT system
- Legacy path uses `LuaSupport::CallHook` for backward compatibility
- Modern path uses `GAMEEVENTINVOKE_HOOK` when `MOD_EVENTS_CIRCUMNAVIGATION` is enabled
- Global game state tracks both circumnavigation status and the achieving team
- Only triggered for the active player, not all players in the game

**Related quest mechanics:**

- Minor civilization circumnavigation quests are automatically completed/failed
- Quest rewards are distributed to the achieving team
- Other teams' circumnavigation quests become obsolete

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvTeam.cpp`, line 7704 (legacy path) and line 7690 (modern path)

**Function Context**: Called within `CvTeam::testCircumnavigated()` during `CvTeam::doTurn()` processing

**Script System Integration**:

- **Legacy**: Uses `LuaSupport::CallHook` to notify registered Lua event listeners
- **Modern**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CircumnavigatedGlobe`

**Preconditions**:

- Game must not already be marked as circumnavigated (`isCircumnavigated() == false`)
- Map must wrap on at least one axis (`kMap.isWrapX()` or `kMap.isWrapY()`)
- Map must be mostly ocean (land plots ≤ 2/3 of total plots)
- Team must not be barbarian
- Team must have revealed at least one plot in every column/row of the wrapping axis
- Script system must be initialized and available

**Event Flow**:

1. `CvTeam::doTurn()` calls `testCircumnavigated()` for exploration check
2. Function checks if circumnavigation is available (`circumnavigationAvailable()`)
3. Function evaluates revealed plots across the wrapping axis (X or Y)
4. If all columns/rows have at least one revealed plot, circumnavigation achieved
5. `makeCircumnavigated()` sets global flag preventing future circumnavigation
6. Team ID is stored via `SetTeamThatCircumnavigated()`
7. Free naval movement bonus applied (if `CIRCUMNAVIGATE_FREE_MOVES` > 0)
8. Achievement unlocked for human players in single-player
9. Event notification sent through appropriate hook system (only for active player)
10. UI messages distributed to all players
11. Replay message added for the achievement
