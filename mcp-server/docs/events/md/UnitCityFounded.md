# Overview

The `UnitCityFounded` event is triggered when a unit (typically a Settler) successfully founds a new city. This event is fired after the city founding process completes, providing information about the unit that established the city and its location.

# Event Triggers

This event is triggered by the `CvUnit` class in the Community Patch DLL when:

- A unit with city founding capabilities (such as a Settler) successfully founds a new city
- The city founding operation completes successfully
- The event occurs after the city has been established

The event requires the appropriate game event system to be enabled to fire.

# Parameters

The event passes the following parameters:

1. **Player ID** (`int`): The ID of the player who owns the unit that founded the city
2. **Unit ID** (`int`): The unique identifier of the unit that founded the city
3. **Unit Type** (`int`): The type identifier of the unit that founded the city
4. **X Coordinate** (`int`): The X coordinate where the city was founded
5. **Y Coordinate** (`int`): The Y coordinate where the city was founded

# Event Details

The `UnitCityFounded` event provides information about successful city founding operations. This allows mods and scripts to:

- Track city founding activities for scoring or achievement systems
- Implement custom effects when cities are founded in specific locations
- Monitor expansion patterns and territorial control
- Apply special bonuses or penalties based on the founding unit type
- Coordinate with other systems that need to know about new city establishment
- Track settlement patterns for AI analysis or historical recording

The event provides both the unit information (who founded it and what type of unit) and the location information (where the city was established).

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvUnit.cpp`  
**Line**: Around 10898

The event is triggered using the `GAMEEVENTINVOKE_HOOK` mechanism with the following parameters:

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_UnitCityFounded,
    getOwner(),      // Player ID who owns the founding unit
    GetID(),         // Unit ID of the founding unit
    getUnitType(),   // Type of the founding unit
    getX(),          // X coordinate of the new city
    getY()           // Y coordinate of the new city
);
```

The event signature is defined as `"UnitCityFounded"` with parameter format `"iiiii"` (five integers). This event is fired as part of the city founding process, after the city has been successfully established on the map.
