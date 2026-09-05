# Overview

The `PlayerAnarchy` event is triggered when a player's civilization enters or exits an anarchy state. Anarchy represents a period of governmental instability where normal civic functions are disrupted, typically occurring during government transitions or periods of political upheaval.

# Event Triggers

This event is triggered from two distinct scenarios within the anarchy management system:

1. **Entering Anarchy**: When a player's civilization begins a period of anarchy, often due to government changes or political instability
2. **Exiting Anarchy**: When a player's civilization recovers from anarchy and returns to normal governmental function

Both triggers occur within the `CvPlayer` class during anarchy state transitions, ensuring that periods of political instability are properly tracked and communicated to game systems.

# Parameters

The event passes three parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| PlayerID | PlayerTypes | The ID of the player whose anarchy state changed |
| IsEntering | bool | Whether the player is entering anarchy (true) or exiting (false) |
| Duration | int | The duration of anarchy in turns (when entering), or 0 (when exiting) |

# Event Details

The event provides comprehensive information about anarchy transitions:

- **State Transition Tracking**: The boolean parameter clearly indicates whether anarchy is beginning or ending
- **Player Context**: The player ID identifies which civilization is experiencing the political upheaval
- **Duration Information**: For anarchy entry, the duration parameter indicates how long the instability will last
- **Political Implications**: Anarchy typically disrupts normal civilization functions like production, research, or growth
- **Recovery Tracking**: The exit event signals when normal governmental function resumes

Anarchy periods are typically temporary but can significantly impact a civilization's development and strategic capabilities during the affected turns.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`

**Trigger Locations**:

- Line 23600: Entering anarchy state (IsEntering = true, Duration = iValue)
- Line 23602: Exiting anarchy state (IsEntering = false, Duration = 0)

**Event System**: Uses the game event system via `GAMEEVENTINVOKE_HOOK(GAMEEVENT_PlayerAnarchy)`

**Anarchy Context**: Anarchy in the game typically:

- Occurs during government transitions or major political changes
- Temporarily reduces or eliminates various civilization bonuses
- May affect production, research, growth, or other key metrics
- Represents periods of political instability and governmental reorganization
- Usually has a predetermined duration after which normal function resumes

**Dual State Pattern**: The paired event calls allow game systems to respond appropriately to both the onset of political crisis and the restoration of governmental stability, ensuring proper handling of this disruptive but temporary state.
