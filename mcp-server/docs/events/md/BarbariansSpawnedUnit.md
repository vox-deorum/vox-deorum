# Overview

The **BarbariansSpawnedUnit** event is triggered whenever the barbarian civilization successfully spawns a new unit in the game. This event provides critical information about new barbarian threats appearing on the map, allowing AI systems to react appropriately to emerging dangers.

This event is part of the Community Patch's barbarian system and fires only when the `MOD_EVENTS_BARBARIANS` configuration is enabled. It captures all barbarian unit spawning scenarios, from routine camp spawning to special circumstances like uprisings and revolts.

# Event Triggers

The **BarbariansSpawnedUnit** event is triggered in the following scenarios:

## Primary Spawn Locations

- **Barbarian Camp Spawning**: Units spawned from existing barbarian encampments during regular game progression
- **New Camp Establishment**: Initial units created when new barbarian camps are founded
- **City-Based Spawning**: Units spawned from captured cities or city-state captures
- **Naval Spawning**: Barbarian boats and naval units spawned from coastal camps and cities

## Special Circumstances

- **Uprisings and Revolts**: Rebel units spawned during civil unrest events in player cities
- **Partisan Activity**: Units created as a result of partisan movements in occupied territories
- **Trade Route Disruption**: Barbarian units spawned when trade routes are plundered
- **Quest-Related Spawning**: Units spawned as part of city-state quest objectives (horde quests)
- **Event-Based Spawning**: Units created through various game events and special circumstances

The event fires immediately after a barbarian unit is successfully created and placed on the map, but before the unit's movement is processed for that turn.

# Parameters

The **BarbariansSpawnedUnit** event passes three integer parameters:

| Parameter | Type | Description |
| --- | --- | --- |
| **X Coordinate** | `int` | The X coordinate of the plot where the barbarian unit was spawned |
| **Y Coordinate** | `int` | The Y coordinate of the plot where the barbarian unit was spawned |
| **Unit Type** | `int` | The internal unit type ID (`UnitTypes` enum) of the spawned barbarian unit |

## Parameter Details

- **Coordinates**: The X and Y coordinates correspond to the exact map location where the unit appears. These coordinates can be used to:
  - Identify proximity to player cities and units
  - Determine strategic importance of the spawn location
  - Calculate potential threat levels based on terrain and accessibility

- **Unit Type**: The unit type ID allows systems to:
  - Determine the combat strength and capabilities of the spawned unit
  - Identify whether it's a melee, ranged, naval, or special unit
  - Assess the specific threat level based on unit characteristics
  - Plan appropriate counter-strategies based on unit strengths and weaknesses

# Event Details

## Spawn Context and Reasoning

The barbarian spawning system considers multiple factors when creating new units:

### Unit Selection Logic

- **Terrain Appropriateness**: Units are selected based on the terrain type of the spawn location
- **Strategic Role**: The system prefers ranged units for defensive positions (camps, cities) and melee units for general spawning
- **Resource Availability**: Available strategic resources influence which unit types can be spawned
- **Game Progression**: Later game turns allow for more advanced unit types, including naval units after turn 20-30

### Spawn Timing and Frequency

- **Regular Camp Spawning**: Occurs based on game turn intervals and camp population limits
- **Event-Driven Spawning**: Immediate spawning triggered by specific game events
- **Rebellion Intervals**: Revolt-related spawning follows defined turn intervals (typically every 4 turns)

## Geographic and Strategic Considerations

### Location Priority

The spawning system evaluates multiple potential spawn locations and selects based on:

- **Proximity to Player Activity**: Areas with recent player presence are prioritized
- **Strategic Value**: Locations that can threaten trade routes, cities, or important resources
- **Accessibility**: Plots that allow the spawned unit to move and engage effectively
- **Safety**: Locations that provide some protection for the newly spawned unit

### Notification System

For certain spawn types (particularly uprisings), the game automatically notifies affected players through the notification system, alerting them to new rebel activity in their territory.

# Technical Details

## Source Code Implementation

The event is implemented in the Community Patch DLL within the `CvBarbarians.cpp` file. The specific trigger points are:

### Primary Spawn Location (Line 1202)

```cpp
if (MOD_EVENTS_BARBARIANS)
    GAMEEVENTINVOKE_HOOK(GAMEEVENT_BarbariansSpawnedUnit, pPlot->getX(), pPlot->getY(), eUnit);
```

### Secondary Spawn Location (Line 1330)

```cpp
if (MOD_EVENTS_BARBARIANS)
    GAMEEVENTINVOKE_HOOK(GAMEEVENT_BarbariansSpawnedUnit, pSpawnPlot->getX(), pSpawnPlot->getY(), eUnit);
```

## Event Definition

The event is defined in `CustomMods.h` as:

```cpp
#define GAMEEVENT_BarbariansSpawnedUnit "BarbariansSpawnedUnit", "iii"
```

The `"iii"` parameter string indicates three integer parameters are passed to event handlers.

## Integration Requirements

### Prerequisites

- `MOD_EVENTS_BARBARIANS` must be enabled in the game configuration
- The barbarian player must be active in the game
- Valid spawn plots must be available for unit placement

### Event Processing

- Event fires synchronously during the barbarian spawning process
- All three parameters are guaranteed to be valid when the event triggers
- The spawned unit is fully initialized and placed on the map before the event fires

## Performance Considerations

The **BarbariansSpawnedUnit** event is designed for efficient processing:

- Minimal computational overhead during spawning
- Direct parameter passing without complex data structures
- Immediate firing to ensure real-time responsiveness

This event is essential for AI systems that need to track barbarian threats and adjust their strategies accordingly.
