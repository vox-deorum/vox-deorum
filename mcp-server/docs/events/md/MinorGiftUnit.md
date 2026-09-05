# Overview

The MinorGiftUnit event is triggered when a militaristic city-state spawns and gifts a unit to a major civilization. This event captures the regular unit gifting system that militaristic city-states use to provide military units to their allied major civilizations over time.

# Event Triggers

This event is fired from `CvMinorCivAI::DoUnitSpawnTurn()` when:

- A militaristic city-state's unit spawn counter reaches zero
- Unit spawning is allowed for the target major civilization
- A unit is successfully spawned through `DoSpawnUnit()`
- The game option `MOD_EVENTS_MINORS_GIFTS` is enabled
- The spawned unit is not NULL (successfully created and placed)

This is a recurring event that can occur multiple times throughout the game based on the city-state's unit spawning schedule.

# Parameters

The event provides three integer parameters (`"iii"` signature):

1. **Minor Civ Player ID** (`GetPlayer()->GetID()`): The militaristic city-state gifting the unit
2. **Major Civ Player ID** (`eMajor`): The major civilization receiving the unit
3. **Unit Type** (`pSpawnUnit->getUnitType()`): The type identifier of the spawned unit

# Event Details

The unit gifting system works as follows:

**Prerequisites for Unit Spawning:**

- City-state must be militaristic trait
- Target major civilization must be alive and valid
- Unit spawning must be allowed (`IsUnitSpawningAllowed()`)
- Unit spawn counter must reach zero (countdown completed)

**Unit Selection and Spawning:**

- Units are selected based on era and military technology
- Units spawn near the city-state's territory
- If no valid spawn location exists, the unit is killed and no event fires
- Successfully spawned units are immediately gifted to the major civilization

**Timing and Frequency:**

- Each major civilization has its own spawn counter
- Counter decreases each turn when spawning is allowed
- Base spawn timing varies by game settings and difficulty
- Counter resets after successful unit spawning

The unit type parameter allows AI systems to track what military units are being provided and plan accordingly for military strategies.

# Technical Details

**Source Location**: `CvMinorCivAI.cpp` line 15429  
**Event Definition**: `GAMEEVENT_MinorGiftUnit` with signature `"iii"`  
**Triggering Function**: `DoUnitSpawnTurn()`  
**Prerequisites**: `MOD_EVENTS_MINORS_GIFTS` must be enabled

**Related Systems:**

- `GetUnitSpawnCounter()`: Tracks turns until next unit spawn
- `ChangeUnitSpawnCounter()`: Modifies spawn timing
- `DoSpawnUnit()`: Handles actual unit creation and placement
- `IsUnitSpawningAllowed()`: Validates spawning prerequisites

This event fires during the city-state's turn processing and is part of the broader militaristic city-state benefit system, complementing other diplomatic and economic benefits provided by different city-state types.
