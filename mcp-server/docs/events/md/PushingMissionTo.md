# Overview

The `PushingMissionTo` event is triggered when a player assigns a mission to a selected unit that targets a specific plot. This event is part of the RED (Real Estate Disinvestment) combat event system and fires before the mission is actually executed, providing an opportunity to intercept or modify mission assignments.

# Event Triggers

This event is triggered in the `CvGame` class when:

- A player selects a unit and assigns it a mission targeting a specific plot
- The mission assignment is processed through the game's command system
- The `MOD_EVENTS_RED_COMBAT_MISSION` custom mod option is enabled
- The mission involves movement or actions directed at a specific tile

The event occurs before the actual mission execution via `gDLL->sendPushMission()`.

# Parameters

The event passes the following parameters:

1. **Player ID** (`int`): The ID of the player who owns the unit receiving the mission
2. **Unit ID** (`int`): The unique identifier of the selected unit being given the mission
3. **Target X** (`int`): The X coordinate of the plot that is the target of the mission
4. **Target Y** (`int`): The Y coordinate of the plot that is the target of the mission
5. **Mission Data** (`int`): Additional mission-specific data (corresponds to `iData2` parameter)

# Event Details

The `PushingMissionTo` event provides information about unit mission assignments before they are executed. This allows mods and scripts to:

- Monitor and track unit movement commands before they occur
- Implement custom pre-mission validation or restrictions
- Modify unit behavior based on mission targets
- Track strategic unit positioning and movement patterns
- Intercept and potentially cancel or redirect missions

This event is particularly useful for AI enhancement mods, tactical analysis systems, and custom mission validation logic.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvGame.cpp`  
**Function**: `CvGame` message processing (around line 2724)  
**Condition**: Requires `MOD_EVENTS_RED_COMBAT_MISSION` to be enabled

The event is triggered using the `LuaSupport::CallHook` mechanism when processing unit commands. The parameters are pushed to the Lua argument stack in the following order:

```cpp
args->Push(pkSelectedUnit->getOwner());  // Player ID
args->Push(pkSelectedUnit->GetID());     // Unit ID
args->Push(pPlot->getX());               // Target X coordinate
args->Push(pPlot->getY());               // Target Y coordinate
args->Push(iData2);                      // Mission data
```

This event is part of the RED combat system integration and only fires when the corresponding custom mod option is enabled. It provides a hook point for intercepting unit mission assignments before they are sent to the network layer.
