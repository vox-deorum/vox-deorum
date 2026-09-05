# Overview

The `GameCoreTestVictory` event is triggered during the game's victory condition testing phase in Civilization V. This event provides a hook for Lua scripts and mods to implement custom victory conditions or modify the standard victory testing logic. It occurs as part of the core game loop when the engine evaluates whether any player has achieved a victory condition.

# Event Triggers

This event is triggered during the game's victory testing sequence, typically called each turn to check for victory conditions.

**Specific trigger conditions:**

- **Victory testing phase**: The game is performing its regular check for victory conditions
- **Pre-victory validation**: Called before standard victory condition checks are performed
- **Script system availability**: The Lua script system is available and active
- **Game state evaluation**: The game is in a state where victory testing is appropriate

**Related mechanics that can trigger victory testing:**

- End-of-turn processing where victory conditions are evaluated
- Specific game events that might trigger immediate victory checks
- Turn completion cycles that include victory condition assessment
- Major game state changes that could affect victory status

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| None | - | This event takes no parameters and provides a general hook for victory testing |

# Event Details

The GameCoreTestVictory event serves as an extension point for the victory condition system, allowing scripts and mods to implement custom victory logic or modify existing victory conditions. This event is called before the standard built-in victory checks are performed.

**Victory testing mechanics:**

- **Custom victory conditions**: Mods can implement entirely new ways to win the game
- **Victory condition modification**: Scripts can alter the requirements for existing victories
- **Dynamic victory rules**: Victory conditions can change based on game state or player actions
- **Script-driven results**: The event can set victory states that override default logic
- **Extension point**: Provides flexibility for total conversion mods and rule variants

**Victory testing integration:**

- **Pre-standard checks**: Called before built-in victory condition evaluation
- **Script result handling**: Scripts can return results that influence victory determination
- **Override capability**: Custom scripts can potentially override default victory logic
- **Mod compatibility**: Allows multiple mods to implement victory condition changes
- **Performance consideration**: Called regularly, so scripts should be efficient

**Common use cases:**

- **Total conversion mods**: Implementing completely different victory conditions
- **Balance modifications**: Adjusting requirements for existing victory types
- **Scenario-specific victories**: Creating custom win conditions for special scenarios
- **Dynamic objectives**: Victory conditions that change based on game events or player actions
- **Achievement systems**: Implementing complex achievement-based victory requirements

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvGame.cpp`, line 9731

**Function Context**: Called within the `CvGame::testVictory()` function before standard victory checks are performed

**Script System Integration**: Uses `LuaSupport::CallHook` with the script system to call "GameCoreTestVictory"

**Preconditions**:

- Script system (`pkScriptSystem`) must be available and not null
- Game must be in a state where victory testing is appropriate
- Victory testing sequence has been initiated

**Event Flow**:

1. Victory testing phase begins in the core game loop
2. Script system availability is verified
3. Lua args handle is created for the script call
4. `GameCoreTestVictory` hook is invoked with empty arguments
5. Scripts can execute custom victory condition logic and set victory state directly
6. Script results are collected but the primary mechanism is for scripts to call game methods directly
7. Standard built-in victory condition testing proceeds after script execution
8. Victory state is updated if any conditions are met

**Related Events**:

- `TurnComplete`: Often triggers victory testing at the end of turns
- `PlayerDoneTurn`: May be part of the sequence that leads to victory testing
- Various achievement or milestone events that could affect custom victory conditions

**Performance Notes**:

- This event is called frequently during victory testing cycles
- Scripts should be optimized for repeated execution
- Heavy computations should be cached or minimized to maintain game performance
