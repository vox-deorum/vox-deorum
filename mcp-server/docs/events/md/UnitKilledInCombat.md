# Overview

The `UnitKilledInCombat` event is triggered when a unit is killed during combat operations. This event provides information about the combat casualty, including the killed unit and the unit responsible for the kill, allowing for tracking of combat statistics and implementing combat-related effects.

# Event Triggers

This event is triggered by the `CvPlayer` class in the Community Patch DLL when:

- A unit is killed during combat (direct combat, ranged attacks, etc.)
- The killing occurs through combat mechanics rather than other causes
- The system needs to record and process combat casualties

The event occurs during combat resolution when a unit's health reaches zero or is otherwise eliminated through combat actions.

# Parameters

The event passes the following parameters:

1. **Killer Player ID** (`int`): The ID of the player who owns the unit that made the kill
2. **Killed Player ID** (`int`): The ID of the player who owned the unit that was killed
3. **Killed Unit Type** (`int`): The type identifier of the unit that was killed
4. **Killing Unit ID** (`int`): The ID of the unit that made the kill (-1 if no specific killing unit)

# Event Details

The `UnitKilledInCombat` event provides information about combat casualties in the game. This allows mods and scripts to:

- Track combat statistics and kill counts for players and units
- Implement experience rewards or penalties based on combat results
- Apply special effects when certain unit types are killed in combat
- Monitor military effectiveness and combat performance
- Record historical combat data for analysis or achievement systems
- Trigger special abilities or bonuses based on combat kills

The event distinguishes between the player who made the kill and the player who lost the unit, allowing for proper attribution of combat results. The killing unit ID may be -1 in cases where the kill cannot be attributed to a specific unit.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`  
**Line**: Around 25021

The event is triggered using the `LuaSupport::CallHook` mechanism with the following parameters:

```cpp
CvLuaArgsHandle args;
args->Push(GetID());                                    // Killer player ID
args->Push(eKilledPlayer);                             // Killed player ID
args->Push(eUnitType);                                 // Killed unit type
args->Push(pKillingUnit ? pKillingUnit->GetID() : -1); // Killing unit ID

bool bResult = false;
LuaSupport::CallHook(pkScriptSystem, "UnitKilledInCombat", args.get(), bResult);
```

The event captures combat casualties and provides context about both the victim and the perpetrator of the combat kill, enabling comprehensive combat tracking and related game mechanics.
