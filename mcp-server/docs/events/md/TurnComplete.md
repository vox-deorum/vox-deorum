# Overview

The TurnComplete event is triggered at various points during turn completion processing through the Lua scripting system. This is a Lua hook rather than a standard GameEvent, allowing scripts to respond to different stages of turn completion, particularly related to turn timer expiration and turn finalization.

# Event Triggers

This event is fired from multiple locations in `CvGame.cpp` when:

- Turn timer expires for the active player (`hasTurnTimerExpired()`)
- Turn completion processing occurs at various stages
- End-turn sequences are finalized
- The Lua script system is available and active

The hook fires from at least five different locations (lines 2057, 2127, 2230, 3631, 3670), indicating multiple stages of turn completion processing where scripts may need to respond.

# Parameters

The event provides one integer parameter:

1. **Active Player ID** (`getActivePlayer()`): The player who is currently the active player during turn completion

# Event Details

The turn completion system manages various aspects of turn transitions:

**Turn Timer Integration:**

- Events fire when turn timers expire in multiplayer or timed games
- Handles both sequential and simultaneous turn modes
- Manages turn completion for human and AI players differently
- Integrates with the game's pause and timing systems

**Turn Completion Stages:** The multiple firing locations suggest different stages:

- Pre-completion validation and processing
- Active turn completion and player switching
- Post-completion cleanup and finalization
- Achievement and statistics processing
- Network synchronization for multiplayer games

**Game State Management:** During turn completion, various systems are updated:

- Player statistics and achievements
- UI state updates and timer resets
- Network communication for multiplayer
- Save game state synchronization
- Game victory condition checks

**Sequential vs Simultaneous Turns:** The system handles different turn modes:

- Sequential human player turns with individual timers
- Simultaneous multiplayer processing
- AI turn processing and completion
- Hot-seat mode player switching

# Technical Details

**Source Locations**: Multiple locations in `CvGame.cpp` (lines 2057, 2127, 2230, 3631, 3670)  
**Hook Type**: Lua script hook (not GameEvent)  
**Triggering Functions**: Various turn completion and timer functions  
**Prerequisites**: Lua script system must be available

**Multiple Firing Points:** The event fires from multiple functions, likely including:

- `hasTurnTimerExpired()`: When turn timers reach completion
- Various turn completion and finalization routines
- Network synchronization and state update functions

**Turn Timer System Integration:**

- Handles `GAMEOPTION_END_TURN_TIMER_ENABLED` scenarios
- Manages sequential human player timing
- Coordinates with AI processing completion
- Updates UI elements and progress indicators

**Script Integration:** This hook enables Lua scripts to implement custom turn completion behaviors, such as:

- Custom notifications or UI updates during turn transitions
- Statistics collection and analysis for completed turns
- Integration with mod-specific turn-based mechanics
- Historical tracking of turn completion patterns
- Custom achievement or milestone systems

**Active Player Context:** The consistent use of `getActivePlayer()` as the parameter suggests the event provides context about whose turn is completing, allowing scripts to respond appropriately to different players' turn completion events.

The multiple firing locations indicate this is a comprehensive system for tracking various stages of turn completion, making it valuable for scripts that need detailed control over turn transition processing.
