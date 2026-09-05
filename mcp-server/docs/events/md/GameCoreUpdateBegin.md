# Overview

The `GameCoreUpdateBegin` event is triggered at the start of each game update cycle in Civilization V. This event provides a hook for Lua scripts and mods to execute logic at the beginning of the core game processing loop, before any standard game updates occur. It serves as an initialization point for custom systems that need to run at the start of each update cycle.

# Event Triggers

This event is triggered at the beginning of each game update cycle, as part of the core game loop.

**Specific trigger conditions:**

- **Game update cycle start**: The game is beginning its core update processing loop
- **Script system availability**: The Lua script system is available and active
- **Pre-processing hook**: Called before standard game update logic executes
- **Regular cycle**: Triggered consistently as part of the normal game update sequence

**Related mechanics that can trigger game updates:**

- Frame-by-frame game processing in the main game loop
- Turn-based processing cycles that require pre-update initialization
- Real-time game state updates that need custom script processing
- Multiplayer synchronization cycles that require custom setup

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| None | - | This event takes no parameters and provides a general hook for update initialization |

# Event Details

The GameCoreUpdateBegin event serves as an entry point for custom logic that needs to execute before standard game processing occurs each update cycle. This event is particularly useful for mods and scripts that need to perform setup, validation, or initialization tasks.

**Update cycle mechanics:**

- **Initialization point**: Perfect for setting up data structures or states needed during the update
- **Pre-processing validation**: Can verify game state consistency before main processing
- **Custom system updates**: Allows mods to run their own update logic in sync with the game
- **Performance monitoring**: Can be used to track update cycle timing and performance
- **State management**: Ideal for managing custom variables or flags per update cycle

**Common use cases:**

- **Mod system initialization**: Setting up custom mod data at the start of each update
- **State validation**: Checking for invalid game states before processing begins
- **Custom AI processing**: Running AI logic that needs to execute before standard AI updates
- **Performance tracking**: Measuring and logging performance metrics for debugging
- **Debug systems**: Enabling debug output or validation during development

**Update cycle integration:**

- **First in sequence**: Executes before any standard game update processing
- **Script coordination**: Multiple scripts can hook this event for coordinated initialization
- **Error handling**: Can set up error handling or recovery systems for the update cycle
- **Resource management**: Preparing or allocating resources needed during the update
- **Synchronization**: Ensuring multiplayer games maintain proper synchronization

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvGame.cpp`, line 1528

**Function Context**: Called at the beginning of the `CvGame::update()` function before main update processing

**Script System Integration**: Uses `LuaSupport::CallHook` with the script system to call "GameCoreUpdateBegin"

**Preconditions**:

- Script system (`pkScriptSystem`) must be available and not null
- Game is in a state where updates are being processed
- Update cycle has been initiated

**Event Flow**:

1. Game update cycle begins
2. Script system availability is verified
3. Lua args handle is created for the script call
4. `GameCoreUpdateBegin` hook is invoked with empty arguments
5. Custom scripts execute initialization or setup logic
6. Control returns to the game engine for standard update processing
7. Main game update logic proceeds (AI, diplomacy, cities, etc.)
8. Eventually culminates in `GameCoreUpdateEnd` event

**Related Events**:

- `GameCoreUpdateEnd`: Called at the conclusion of the update cycle
- `TurnComplete`: May be related to turn-based update cycles
- `PlayerDoTurn`: Individual player processing that occurs during updates

**Performance Considerations**:

- This event is called frequently during active gameplay
- Scripts should be optimized for repeated execution
- Heavy computations should be minimized to maintain game performance
- Consider caching expensive operations between update cycles
