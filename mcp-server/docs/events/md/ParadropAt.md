# Overview

The `ParadropAt` event is triggered when a military unit successfully executes a paradrop operation, moving from one tile to another tile at a distance. This event is fired after the unit has completed the paradrop action and has been repositioned at its destination.

# Event Triggers

This event is triggered by the `CvUnit::paradrop()` function in the Community Patch DLL when:

- A unit with paradrop capabilities successfully performs a paradrop operation
- The unit is moved from its current position to the target destination
- The paradrop action passes all validation checks (range, terrain, visibility, etc.)

The event occurs after the unit has been repositioned but is part of the paradrop completion process.

# Parameters

The event passes the following parameters:

1. **Player ID** (`int`): The ID of the player who owns the unit performing the paradrop
2. **Unit ID** (`int`): The unique identifier of the unit that performed the paradrop
3. **From X** (`int`): The X coordinate of the tile where the unit started the paradrop
4. **From Y** (`int`): The Y coordinate of the tile where the unit started the paradrop
5. **To X** (`int`): The X coordinate of the destination tile where the unit landed
6. **To Y** (`int`): The Y coordinate of the destination tile where the unit landed

# Event Details

The `ParadropAt` event provides information about a completed paradrop operation, including both the origin and destination coordinates. This allows mods and scripts to:

- Track unit movements via paradrop operations
- Implement custom logic or effects when units paradrop to specific locations
- Monitor strategic repositioning of airborne units
- Apply location-specific modifiers or restrictions after paradrop completion

The event is fired as part of the paradrop execution sequence, after the unit has been moved to its new position but before other post-movement processing occurs.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvUnit.cpp`  
**Function**: `CvUnit::paradrop(int iX, int iY, bool& bAnimationShown)`  
**Line**: Around 8915

The event is triggered using the `LuaSupport::CallHook` mechanism when the `MOD_EVENTS_PARADROPS` custom mod option is disabled, or via `GAMEEVENTINVOKE_HOOK` when the option is enabled. The parameters are pushed to the Lua argument stack in the following order:

```cpp
args->Push(((int)getOwner()));      // Player ID
args->Push(GetID());                // Unit ID
args->Push(fromPlot->getX());       // Origin X coordinate
args->Push(fromPlot->getY());       // Origin Y coordinate
args->Push(pPlot->getX());          // Destination X coordinate
args->Push(pPlot->getY());          // Destination Y coordinate
```

The event signature is defined as `"ParadropAt"` with parameter format `"iiiiii"` (six integers).
