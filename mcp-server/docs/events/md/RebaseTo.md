# Overview

The `RebaseTo` event is triggered when an air unit successfully executes a rebase operation, moving from its current location to a new base of operations (typically a city, carrier, or airbase improvement). This event is fired after the rebase validation passes but before the unit is physically moved to the new location.

# Event Triggers

This event is triggered by the `CvUnit::rebase()` function in the Community Patch DLL when:

- An air unit with rebase capabilities successfully performs a rebase operation
- The rebase operation passes all validation checks (range, capacity, friendly territory, etc.)
- The target location has appropriate facilities to host the unit (city, carrier, or airbase)

The event occurs after validation but before the unit is moved via `setXY()`.

# Parameters

The event passes the following parameters:

1. **Player ID** (`int`): The ID of the player who owns the unit performing the rebase
2. **Unit ID** (`int`): The unique identifier of the unit that is rebasing
3. **Target X** (`int`): The X coordinate of the destination tile for the rebase
4. **Target Y** (`int`): The Y coordinate of the destination tile for the rebase

# Event Details

The `RebaseTo` event provides information about a successful rebase operation before the unit is moved. This allows mods and scripts to:

- Track air unit repositioning and strategic movements
- Implement custom effects or restrictions based on rebase destinations
- Monitor changes in air unit deployment patterns
- Apply location-specific modifiers when units rebase to certain areas
- Coordinate with other systems that need to know about unit repositioning

The event is particularly useful for military strategy mods, base management systems, and tactical analysis tools that need to track air unit movements.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvUnit.cpp`  
**Function**: `CvUnit::rebase(int iX, int iY, bool bForced)`  
**Line**: Around 10281

The event is triggered using the `LuaSupport::CallHook` mechanism when the `MOD_EVENTS_REBASE` custom mod option is disabled, or via `GAMEEVENTINVOKE_HOOK` when the option is enabled. The parameters are pushed to the Lua argument stack in the following order:

```cpp
args->Push(getOwner());    // Player ID
args->Push(GetID());       // Unit ID
args->Push(iX);            // Target X coordinate
args->Push(iY);            // Target Y coordinate
```

The event signature is defined as `"RebaseTo"` with parameter format `"iiii"` (four integers). The event occurs within the rebase function after validation checks but before the actual unit movement via `setXY()`.
