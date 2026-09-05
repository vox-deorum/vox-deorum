# Overview

The `UnitCreated` event is triggered when a new unit is successfully created in the game. This event fires immediately after a unit has been instantiated and placed on the map, providing information about the newly created unit and its initial location.

# Event Triggers

This event is triggered by the `CvUnit` class in the Community Patch DLL when:

- A new unit is created through any game mechanism (city production, purchase, spawning, etc.)
- The unit creation process completes successfully
- The unit is placed on the map at its starting location

The event occurs during unit initialization, after the unit has been assigned its basic properties and position.

# Parameters

The event passes the following parameters:

1. **Player ID** (`int`): The ID of the player who owns the newly created unit
2. **Unit ID** (`int`): The unique identifier assigned to the new unit
3. **Unit Type** (`int`): The type identifier of the unit that was created
4. **X Coordinate** (`int`): The X coordinate where the unit was created
5. **Y Coordinate** (`int`): The Y coordinate where the unit was created

# Event Details

The `UnitCreated` event provides information about all new unit creations in the game. This allows mods and scripts to:

- Track unit production and population growth for statistical analysis
- Implement custom effects when specific unit types are created
- Monitor military buildup and expansion activities
- Apply special bonuses or modifications to newly created units
- Coordinate with other systems that need to respond to new unit creation
- Track spawn patterns for AI analysis or balancing purposes

This event captures all forms of unit creation, whether through city production, instant spawning, purchases, or other game mechanics.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvUnit.cpp`  
**Line**: Around 1346

The event is triggered using the `GAMEEVENTINVOKE_HOOK` mechanism with the following parameters:

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_UnitCreated,
    getOwner(),     // Player ID of the unit owner
    GetID(),        // Unique unit ID
    getUnitType(),  // Unit type identifier
    getX(),         // X coordinate of creation
    getY()          // Y coordinate of creation
);
```

The event signature is defined as `"UnitCreated"` with parameter format `"iiiii"` (five integers). This event is fired during the unit initialization process, making it one of the first events associated with a new unit's lifecycle.
