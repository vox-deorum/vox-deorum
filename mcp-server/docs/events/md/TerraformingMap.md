# Overview

The `TerraformingMap` event is triggered during map loading and initialization processes. This event signals major terraforming operations that affect the entire map structure, typically occurring during game setup or when loading saved games.

# Event Triggers

This event is triggered in the following scenarios:

- During initial game loading when the map structure is being established
- When loading saved games and reconstructing the map state
- During map initialization phases that require terraforming operations

The event occurs in two primary contexts:

1. **Game-level initialization** - When the core game systems are setting up the map
2. **Map-level initialization** - When the map object itself is being initialized or loaded

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `eventType` | `int` | The type of terraforming event (TERRAFORMINGEVENT_LOAD) |
| `phase` | `int` | The initialization phase (0 for game-level, 1 for map-level) |

# Event Details

The `TerraformingMap` event represents system-level map operations that occur during game initialization and loading processes. Unlike plot-specific terraforming events, this event signals broad map-level changes or preparations.

**Event Phases:**

- **Phase 0 (Game-level)**: Triggered during core game initialization, indicating that the game systems are preparing for map terraforming operations
- **Phase 1 (Map-level)**: Triggered during map object initialization, indicating that the map structure itself is being configured or loaded

**Key Functions:**

- **System Coordination**: Ensures proper sequencing of map initialization operations
- **Load State Management**: Coordinates map reconstruction during save game loading
- **Terraforming Pipeline**: Signals the beginning of terraforming operations that may affect multiple systems

**Integration Points:**

- Coordinates with save/load systems during game restoration
- Integrates with map generation and world builder systems
- Provides hooks for mods that need to execute during map initialization

The event serves as a critical coordination point for systems that need to respond to major map-level changes or initialization phases.

# Technical Details

**Source Locations:**

- `CvGameCoreDLL_Expansion2/CvGame.cpp:430` (Phase 0)
- `CvGameCoreDLL_Expansion2/CvMap.cpp:1830` (Phase 1)

**Trigger Context:** The event is invoked in two different contexts:

1. Within the `CvGame` class during game initialization processes
2. Within the `CvMap` class during map-specific initialization

**Event Hook:** Uses the `GAMEEVENTINVOKE_HOOK` macro with event type `GAMEEVENT_TerraformingMap`

**Event Type:** Both occurrences use `TERRAFORMINGEVENT_LOAD` as the event type, indicating these are loading/initialization related terraforming events.

**Code References:**

```cpp
// Game-level initialization (Phase 0)
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TerraformingMap, TERRAFORMINGEVENT_LOAD, 0);

// Map-level initialization (Phase 1)
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TerraformingMap, TERRAFORMINGEVENT_LOAD, 1);
```

**System Integration:** This event coordinates between the game engine's core systems and the map management systems, ensuring that terraforming operations occur in the correct sequence during initialization processes.

**Load Process Coordination:** The two-phase approach ensures that both game-level and map-level systems have the opportunity to prepare for or respond to major terraforming operations during the loading process.

The event provides essential coordination for systems that need to synchronize with major map initialization or terraforming operations, particularly during game loading and world generation processes.
