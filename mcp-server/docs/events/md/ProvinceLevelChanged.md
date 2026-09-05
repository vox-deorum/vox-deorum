# Overview

The ProvinceLevelChanged event is triggered when a city's province level changes in the Community Balance Patch system. Province level represents a city's administrative or development tier within an empire, affecting various gameplay mechanics and city capabilities.

# Event Triggers

This event is fired from `CvCity::SetProvinceLevel()` when:

- The province level of a city is explicitly changed through the `SetProvinceLevel()` method
- The new province level value differs from the current province level
- Called from Lua scripts or other game systems that modify city province levels

The event is only triggered when there is an actual change in the province level value, preventing duplicate notifications for identical values.

# Parameters

The event provides four integer parameters (`"iiii"` signature):

1. **Player ID** (`getOwner()`): The player who owns the city
2. **City ID** (`GetID()`): The unique identifier of the city whose province level changed
3. **Old Province Level** (`iOldLevel`): The previous province level value
4. **New Province Level** (`iValue`): The current province level value

# Event Details

The province level system works as follows:

**Province Level Management:**

- Province levels are integer values starting from 0
- Higher levels typically represent more developed or important cities
- Province level changes can be triggered by various game events and mechanics
- Changes may affect city yields, building availability, or administrative costs

**Gameplay Implications:**

- Different province levels may unlock different capabilities
- Province levels could affect maintenance costs or administrative efficiency
- May influence available buildings, units, or other city options
- Can impact diplomatic or strategic value of cities

The province level system is part of the Community Balance Patch's enhanced city management mechanics, providing additional depth to city specialization and development paths.

# Technical Details

**Source Location**: `CvCity.cpp` line 34680  
**Event Definition**: `GAMEEVENT_ProvinceLevelChanged` with signature `"iiii"`  
**Storage Field**: `m_iProvinceLevel` (integer member variable)  
**Access Methods**:

- `GetProvinceLevel()`: Returns current province level
- `SetProvinceLevel(int)`: Sets province level and triggers event if changed
- `HasProvinceLevel(int)`: Checks if city has specific province level

**Compilation Requirements**: Enabled under `MOD_BALANCE_CORE` compilation flag

The province level is persisted in save games and synchronized in multiplayer through the `SYNC_ARCHIVE_VAR` system. The system is accessible through Lua scripting interfaces for mod developers to create custom province level mechanics and interactions.
