# Overview

The `GatherPerTurnReplayStats` event is triggered during the per-turn statistics gathering process for replay functionality in Civilization V. This event provides a hook for Lua scripts and mods to contribute custom statistics and data to the game's replay system, allowing for enhanced replay analysis and custom metrics tracking during gameplay.

# Event Triggers

This event is triggered during the statistics recording phase for each player during turn processing, specifically for replay data collection.

**Specific trigger conditions:**

- **Turn-based statistics gathering**: The game is collecting per-turn statistics for replay functionality
- **Player statistics phase**: Individual player statistics are being recorded for the current turn
- **Script system availability**: The Lua script system is available and active
- **Replay recording active**: The replay system is enabled and recording game data

**Related mechanics that can trigger replay statistics:**

- End-of-turn processing when player statistics are compiled
- Turn completion cycles that include data recording for replay purposes
- Performance monitoring and statistics collection systems
- Replay file generation and data archiving processes

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player for whom statistics are being gathered (from `GetID()`) |

# Event Details

The GatherPerTurnReplayStats event serves as an extension point for the replay statistics system, allowing custom scripts and mods to contribute additional data points and metrics to the standard replay recording functionality. This enhances the replay system with custom analytics and tracking capabilities.

**Replay statistics mechanics:**

- **Custom metrics**: Allows mods to record custom statistics not captured by default systems
- **Player-specific data**: Statistics are gathered on a per-player basis for comprehensive tracking
- **Turn-based recording**: Data is collected each turn to provide detailed progression tracking
- **Performance monitoring**: Includes performance measurement capabilities for statistics gathering
- **Script integration**: Multiple mods can contribute different types of statistics

**Common use cases:**

- **Custom achievement tracking**: Recording progress toward mod-specific achievements or goals
- **Economic analysis**: Tracking detailed economic indicators not captured by standard systems
- **Military analytics**: Recording detailed military statistics, unit compositions, or battle outcomes
- **Diplomatic metrics**: Tracking relationship changes, deal success rates, or negotiation patterns
- **Technology progression**: Monitoring custom technology adoption rates or research patterns
- **City development**: Recording detailed city growth patterns, building construction, or population changes

**Replay integration:**

- **Data contribution**: Scripts can add custom data points to the standard replay statistics
- **Analysis enhancement**: Provides richer data for post-game analysis and replay viewing
- **Mod compatibility**: Allows multiple mods to contribute statistics without conflicts
- **Performance consideration**: Optimized with performance monitoring to avoid impacting gameplay
- **Historical tracking**: Enables long-term trend analysis across multiple games

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`, line 46699

**Function Context**: Called within the `CvPlayer::GatherPerTurnReplayStats(int iGameTurn)` function during per-turn statistics collection

**Script System Integration**: Uses `LuaSupport::CallHook` with the script system to call "GatherPerTurnReplayStats"

**Performance Monitoring**: Wrapped with `cvStopWatch` for "Replay Stat Recording" performance measurement

**Preconditions**:

- Script system (`pkScriptSystem`) must be available and not null
- Player statistics gathering is active
- Replay recording system is enabled
- Player ID must be valid

**Event Flow**:

1. Per-turn statistics gathering begins for the player
2. Performance monitoring starts with stop watch
3. Script system availability is verified
4. Lua args handle is created and player ID is pushed as argument
5. `GatherPerTurnReplayStats` hook is invoked with player ID parameter
6. Custom scripts execute statistics collection logic
7. Control returns to standard statistics gathering
8. Additional standard statistics are recorded (if player is alive)
9. Performance monitoring concludes and data is recorded

**Performance Considerations**:

- **Performance monitoring**: The function is wrapped with performance measurement tools
- **Efficiency important**: Called frequently during turn processing, so scripts should be optimized
- **Per-player execution**: Called for each player, so total performance impact scales with player count
- **Replay file size**: Custom statistics contribute to replay file size, so data should be meaningful

**Related Events**:

- `TurnComplete`: May trigger statistics gathering at turn boundaries
- `PlayerDoneTurn`: Individual player turn completion that may include statistics recording
- `GameCoreUpdateEnd`: End of update cycles that may include statistics compilation

**Standard Statistics Context**: After the script hook executes, the system continues to record standard replay statistics including:

- Player vitality and survival status
- Standard game metrics and progression indicators
- Built-in replay data points for standard game analysis
