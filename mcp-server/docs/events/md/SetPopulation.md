# Overview

The SetPopulation event is triggered when a city's population changes through the Lua scripting system. This is a Lua hook rather than a standard GameEvent, allowing scripts and mods to respond to population changes in cities after all internal game mechanics have been applied.

# Event Triggers

This event is fired from `CvCity::setPopulation()` when:

- A city's population is changed through the `setPopulation()` method
- The population value actually differs from the current population
- The Lua script system is available and active
- Called at the end of the population setting process, after all game mechanics have been updated

The hook fires after all population-related calculations, yield updates, happiness recalculation, and UI updates have been completed.

# Parameters

The event provides four integer parameters:

1. **City X Coordinate** (`getX()`): The X coordinate of the city whose population changed
2. **City Y Coordinate** (`getY()`): The Y coordinate of the city whose population changed
3. **Old Population** (`iOldPopulation`): The previous population value
4. **New Population** (`iNewValue`): The current population value after the change

# Event Details

The population system affects numerous game mechanics that are processed before this hook:

**Game Systems Updated Before Hook:**

- Global, team, and player total population tracking
- Area population tracking (including adjacent water areas for coastal cities)
- Player highest population records
- Yield calculations (including science per population bonuses)
- Religious majority updates based on new population
- City defense strength recalculation
- Unit production maintenance cost adjustments
- Happiness recalculation for city and empire
- Citizen work assignment (if enabled)

**Population Change Sources:**

- City growth through food surplus
- Population loss through starvation or damage
- Manual population adjustments through events or cheats
- Scripted population changes through Lua or mods
- Annexation or liberation effects

**Coordinate-Based Identification:** The event uses city coordinates rather than player/city IDs, allowing scripts to identify the specific city location and cross-reference with map data or other coordinate-based systems.

# Technical Details

**Source Location**: `CvCity.cpp` line 16906  
**Hook Type**: Lua script hook (not GameEvent)  
**Triggering Function**: `setPopulation()`  
**Prerequisites**: Lua script system must be available

**Population Effects Applied Before Hook:**

- `changeTotalPopulation()`: Updates empire-wide population tracking
- Plot yield updates from population changes
- `UpdateReligion()`: Adjusts religious influence based on new population
- `ChangeBaseYieldRateFromMisc()`: Applies science-per-population bonuses
- UI dirty bit setting for visual updates
- Citizen reassignment (if requested)

**Script Integration:** This hook enables Lua scripts to implement custom behaviors when population changes, such as:

- Population milestone celebrations or penalties
- Custom notification systems for major population changes
- Integration with mod-specific mechanics tied to city size
- Historical tracking of population growth patterns

The coordinate-based parameters make this particularly useful for map-based or location-specific scripted events that need to respond to demographic changes.
