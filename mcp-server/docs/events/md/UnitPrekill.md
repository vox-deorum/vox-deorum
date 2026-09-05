# Overview

The `UnitPrekill` event is triggered just before a unit is about to be killed or removed from the game. This event provides an opportunity to intercept the kill operation, perform cleanup actions, or apply final effects before the unit is actually destroyed.

# Event Triggers

This event is triggered by the `CvUnit` class in the Community Patch DLL when:

- A unit is about to be killed through any game mechanism
- The kill operation is initiated but has not yet been completed
- The system needs to notify other components before the unit is removed

The event occurs before the actual unit destruction, allowing for intervention or final processing.

# Parameters

The event passes the following parameters:

1. **Owner Player ID** (`int`): The ID of the player who owns the unit about to be killed
2. **Unit ID** (`int`): The unique identifier of the unit about to be killed
3. **Unit Type** (`int`): The type identifier of the unit about to be killed
4. **X Coordinate** (`int`): The X coordinate of the unit's current location
5. **Y Coordinate** (`int`): The Y coordinate of the unit's current location
6. **Delay Kill** (`bool`): Whether the kill operation should be delayed
7. **Attacking Player ID** (`int`): The ID of the player responsible for the kill (if applicable)

# Event Details

The `UnitPrekill` event provides a final opportunity to interact with a unit before it is destroyed. This allows mods and scripts to:

- Implement "last stand" abilities or death-triggered effects
- Save unit statistics or state before destruction
- Transfer resources or bonuses from the dying unit
- Create replacement units or spawn effects upon death
- Cancel or delay the kill under certain conditions
- Apply area effects or notifications based on unit death
- Record historical data about unit losses

The event provides complete information about the unit being killed, its location, and the circumstances of its death, enabling comprehensive death-related mechanics.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvUnit.cpp`  
**Line**: Around 2655

The event is triggered using the `LuaSupport::CallHook` mechanism with the following parameters:

```cpp
CvLuaArgsHandle args;
args->Push(((int)eUnitOwner));  // Owner player ID
args->Push(GetID());            // Unit ID
args->Push(getUnitType());      // Unit type
args->Push(getX());             // X coordinate
args->Push(getY());             // Y coordinate
args->Push(bDelay);             // Delay kill flag
args->Push(ePlayer);            // Attacking player ID

bool bResult = false;
LuaSupport::CallHook(pkScriptSystem, "UnitPrekill", args.get(), bResult);
```

This event occurs in the kill preparation phase and can potentially influence whether and how the unit is actually destroyed, making it a crucial point for implementing unit death mechanics.
