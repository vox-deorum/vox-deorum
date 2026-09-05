# Overview

The `GameCoreUpdateEnd` event is triggered at the conclusion of each game update cycle in Civilization V. This event provides a hook for Lua scripts and mods to execute logic after all standard game processing has completed, serving as a cleanup and finalization point for custom systems that need to run at the end of each update cycle.

# Event Triggers

This event is triggered at the end of each game update cycle, after all standard game processing has completed.

**Specific trigger conditions:**

- **Game update cycle completion**: All standard game update processing has finished
- **Script system availability**: The Lua script system is available and active
- **Post-processing hook**: Called after standard game update logic has executed
- **Regular cycle**: Triggered consistently as part of the normal game update sequence

**Related mechanics that complete before this event:**

- AI processing and decision making
- Diplomacy updates and relationship calculations
- City growth, production, and yield processing
- Unit movement and combat resolution
- Technology research and policy adoption
- Victory condition testing and game state evaluation

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| None | - | This event takes no parameters and provides a general hook for update finalization |

# Event Details

The GameCoreUpdateEnd event serves as a finalization point for custom logic that needs to execute after all standard game processing has completed each update cycle. This event is particularly useful for mods and scripts that need to perform cleanup, validation, or post-processing tasks.

**Update cycle mechanics:**

- **Finalization point**: Perfect for cleaning up data structures or states used during the update
- **Post-processing validation**: Can verify game state consistency after main processing
- **Custom system cleanup**: Allows mods to finalize their own update logic after game processing
- **Performance monitoring**: Can be used to conclude update cycle timing and performance tracking
- **State persistence**: Ideal for saving or persisting custom variables or flags after processing

**Common use cases:**

- **Mod system cleanup**: Finalizing custom mod data after game updates complete
- **State synchronization**: Ensuring custom states are properly synchronized after processing
- **Custom AI finalization**: Completing AI logic that depends on standard game updates
- **Performance analysis**: Concluding performance measurements and generating reports
- **Debug output**: Producing debug information after all processing is complete
- **Save data preparation**: Preparing custom data for game saves after update completion

**Update cycle integration:**

- **Last in sequence**: Executes after all standard game update processing is complete
- **Script coordination**: Multiple scripts can hook this event for coordinated cleanup
- **Error handling**: Can perform error checking or recovery after update completion
- **Resource cleanup**: Cleaning up or deallocating resources used during the update
- **Synchronization**: Final synchronization point for multiplayer games

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvGame.cpp`, line 1619

**Function Context**: Called at the very end of the `CvGame::update()` function after all update processing is complete

**Script System Integration**: Uses `LuaSupport::CallHook` with the script system to call "GameCoreUpdateEnd"

**Preconditions**:

- Script system (`pkScriptSystem`) must be available and not null
- Game update processing has completed successfully
- All standard game systems have finished their update cycles

**Event Flow**:

1. Standard game update processing completes (AI, cities, units, diplomacy, etc.)
2. Victory testing and game state evaluation finish
3. Script system availability is verified
4. Lua args handle is created for the script call
5. `GameCoreUpdateEnd` hook is invoked with empty arguments
6. Custom scripts execute cleanup and finalization logic
7. Update cycle concludes and control returns to the main game loop
8. Next update cycle may begin with `GameCoreUpdateBegin`

**Related Events**:

- `GameCoreUpdateBegin`: Called at the beginning of the update cycle
- `GameCoreTestVictory`: Called during the update cycle for victory condition testing
- `TurnComplete`: May be related to turn-based processing cycles
- `PlayerDoneTurn`: Individual player processing that may conclude during updates

**Performance Considerations**:

- This event is called frequently during active gameplay
- Scripts should be optimized for repeated execution
- Heavy computations should be minimized to maintain game performance
- This is the last chance to perform operations before the next update cycle begins
