# Overview

The `UnitSetXY` event is triggered when a unit's position is changed to new coordinates on the map. This event captures all forms of unit movement and positioning changes, providing information about where units are being placed or moved.

# Event Triggers

This event is triggered by the `CvUnit::setXY()` function in the Community Patch DLL when:

- A unit is moved to a new position on the map
- A unit is initially placed at coordinates during creation
- Any game mechanism changes a unit's map location

The event occurs during the position-setting process, capturing both initial placement and subsequent movement operations.

# Parameters

The event passes the following parameters:

1. **Player ID** (`int`): The ID of the player who owns the unit being positioned
2. **Unit ID** (`int`): The unique identifier of the unit whose position is being set
3. **X Coordinate** (`int`): The new X coordinate where the unit is being placed
4. **Y Coordinate** (`int`): The new Y coordinate where the unit is being placed

# Event Details

The `UnitSetXY` event provides information about unit positioning and movement operations. This allows mods and scripts to:

- Track all unit movement and positioning for strategic analysis
- Implement location-based effects when units enter specific areas
- Monitor territorial control and unit deployment patterns
- Apply movement penalties or bonuses based on destination terrain
- Coordinate with other systems that need to respond to unit movement
- Validate or restrict unit placement in certain locations
- Record movement history for replay or analysis purposes

This event captures both voluntary movement (player orders) and involuntary positioning (teleportation, displacement effects, etc.), providing comprehensive coverage of unit position changes.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvUnit.cpp`  
**Line**: Around 20899

The event is triggered using the `LuaSupport::CallHook` mechanism with the following parameters:

```cpp
CvLuaArgsHandle args;
args->Push(getOwner());  // Player ID
args->Push(GetID());     // Unit ID
args->Push(getX());      // New X coordinate
args->Push(getY());      // New Y coordinate

bool bResult = false;
LuaSupport::CallHook(pkScriptSystem, "UnitSetXY", args.get(), bResult);
```

This event is part of the core unit positioning system and provides a fundamental hook for monitoring and responding to all unit location changes in the game.
