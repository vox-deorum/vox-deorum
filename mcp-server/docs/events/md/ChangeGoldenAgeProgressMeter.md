# Overview

The `ChangeGoldenAgeProgressMeter` event is triggered when a player's progress towards their next Golden Age is modified in Civilization V. This event captures changes to the Golden Age progress meter, which accumulates Golden Age points that eventually lead to the start of a Golden Age period.

# Event Triggers

This event is triggered when the `ChangeGoldenAgeProgressMeter` function is called on a player object in the following scenarios:

- **Production conversion to Golden Age points**: When cities convert production to Golden Age points through specific mechanics (found in `CvCity.cpp`)
- **Religion compensation**: When faith is converted to Golden Age points during religion founding (found in `CvReligionClasses.cpp`)
- **World Congress rewards**: When voting resolutions provide Golden Age point benefits (found in `CvVotingClasses.cpp`)
- **Happiness accumulation**: During turn processing when excess happiness generates Golden Age points (found in `CvPlayer.cpp`)
- **Empire-wide bonuses**: When empire-wide effects contribute Golden Age points through `GetGoldenAgePointsFromEmpireTimes100()` (found in `CvPlayer.cpp`)

Note: The event is only fired when the `MOD_ISKA_GOLDENAGEPOINTS_TO_PRESTIGE` mod flag is enabled and the change value is positive.

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player whose Golden Age progress meter is being changed |
| `iChange` | integer | The amount by which the Golden Age progress meter is being modified (must be positive) |

# Event Details

The event is fired through the Lua script system whenever the internal `ChangeGoldenAgeProgressMeter` function is executed. The function internally calls `ChangeGoldenAgeProgressMeterTimes100`, which handles the precise calculation including fractional Golden Age points.

**Key behaviors:**

- The event is only triggered when the `GAMEOPTION_NO_HAPPINESS` game option is not enabled
- The event is only triggered when the `MOD_ISKA_GOLDENAGEPOINTS_TO_PRESTIGE` mod flag is enabled
- The event is only triggered for positive changes (iChange > 0)
- The meter progress contributes to triggering Golden Age periods when thresholds are reached
- The event provides visibility into Golden Age point accumulation across all game mechanics

**Related game mechanics:**

- Golden Age point generation from excess happiness
- Faith-to-Golden Age point conversion during religion founding
- Production-to-Golden Age point conversion in cities
- Historic event rewards and difficulty bonuses
- World Congress resolution benefits

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`, line 24171

**Function Context**: Called within `CvPlayer::ChangeGoldenAgeProgressMeter(int iChange)` and `CvPlayer::ChangeGoldenAgeProgressMeterTimes100(int iChange)`

**Script System Integration**: Uses `LuaSupport::CallHook` to notify registered Lua event listeners

**Preconditions**:

- Game option `GAMEOPTION_NO_HAPPINESS` must not be enabled
- Mod flag `MOD_ISKA_GOLDENAGEPOINTS_TO_PRESTIGE` must be enabled
- Change value (`iChange`) must be positive (> 0)
- Script system must be initialized and available
- Player must not be in a Golden Age if `MOD_BALANCE_NO_GAP_DURING_GA` is enabled

**Event Flow**:

1. Game logic calls `ChangeGoldenAgeProgressMeter` or `ChangeGoldenAgeProgressMeterTimes100`
2. Function checks for `GAMEOPTION_NO_HAPPINESS` game option (returns early if enabled)
3. Function checks for `MOD_BALANCE_NO_GAP_DURING_GA` flag and current Golden Age status (returns early if in Golden Age)
4. Golden Age progress meter is updated internally
5. If `MOD_ISKA_GOLDENAGEPOINTS_TO_PRESTIGE` is enabled and `iChange` is positive, the Lua script system is invoked
6. Event arguments (player ID and change amount) are pushed to Lua stack
7. Registered event listeners are notified through the hook system
