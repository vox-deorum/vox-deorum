# Overview

The `GameSave` event is triggered when the game is being saved to disk in Civilization V. This event provides a hook for Lua scripts and mods to execute logic during the save process, allowing custom systems to persist data, perform cleanup, or execute pre-save operations. The event occurs before the main game database serialization takes place.

# Event Triggers

This event is triggered during the game save process, specifically within the game's serialization system.

**Specific trigger conditions:**

- **Game save initiated**: The player has initiated a save operation or an autosave is occurring
- **Save validation**: The game has validated that saving is appropriate and allowed
- **Not first save**: The event is skipped on the initial save to prevent game hangs
- **Pre-serialization**: Called before the main game database is serialized to the save file

**Related mechanics that can trigger game saves:**

- Manual save operations initiated by the player through the game menu
- Autosave functionality that triggers at regular intervals or game milestones
- Quick save operations using keyboard shortcuts
- Exit save operations when the player quits the game
- Multiplayer synchronization saves
- Scenario or mod-specific save triggers

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| None | - | This event takes no parameters and provides a general hook for save processing |

# Event Details

The GameSave event serves as a synchronization point for custom systems that need to prepare data for persistence or execute operations during the save process. This event is particularly important for mods that maintain custom data structures or states that need to be preserved across game sessions.

**Save process mechanics:**

- **Pre-serialization hook**: Executes before main game data is written to the save file
- **Data preparation**: Allows scripts to prepare or organize data for persistence
- **State validation**: Can verify that custom game states are valid before saving
- **Resource cleanup**: Opportunity to clean up temporary data before save completion
- **Custom serialization**: Mods can implement their own data persistence mechanisms

**Common use cases:**

- **Custom data persistence**: Saving mod-specific variables, settings, or game states
- **Data validation**: Ensuring custom data structures are in a consistent state before saving
- **Temporary cleanup**: Removing temporary or cache data that shouldn't be persisted
- **Performance optimization**: Compacting or optimizing data structures before serialization
- **Debug logging**: Recording save events for debugging or analysis purposes
- **Backup operations**: Creating additional backup copies of critical custom data

**Save integration:**

- **Conditional execution**: Skips the first save to prevent initialization issues
- **Script coordination**: Multiple mods can hook this event to coordinate save operations
- **Error prevention**: Helps prevent save corruption by allowing data validation
- **Performance consideration**: Should be efficient to avoid delaying the save process
- **Cross-session continuity**: Ensures custom systems maintain state across game sessions

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvGame.cpp`, line 11132

**Function Context**: Called within `CvGame::Write(FDataStream& kStream)` during game serialization

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_GameSave`

**Conditional Compilation**: Protected by `EA_EVENT_GAME_SAVE` preprocessor directive

**Preconditions**:

- `EA_EVENT_GAME_SAVE` must be defined and enabled
- Game must not be on its first save (`m_bSavedOnce` must be true)
- Save operation must be in progress
- Game serialization system must be active

**Event Flow**:

1. Game save operation is initiated by player or system
2. Save validation and preparation occurs
3. `CvGame::Write()` function is called for serialization
4. First save check is performed to avoid initialization issues
5. `GAMEEVENT_GameSave` hook is invoked (if conditions are met)
6. Custom scripts execute save preparation logic
7. Main game database serialization proceeds
8. Save file is written to disk with all game data

**Special Considerations**:

- **First save skip**: The event is intentionally skipped on the first save to prevent game hangs caused by script system initialization issues
- **Compilation flag**: The event is only available when `EA_EVENT_GAME_SAVE` is defined during compilation
- **Performance impact**: Should execute quickly to avoid delaying the save process
- **Error handling**: Scripts should handle errors gracefully to prevent save corruption

**Related Events**:

- Game load events (when implementing complementary load-time logic)
- Turn completion events that might trigger autosaves
- Exit game events that trigger final saves
