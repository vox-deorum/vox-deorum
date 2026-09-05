# Overview

The `PlayerGoldenAge` event is triggered when a player's Golden Age status changes. This event fires both when entering a Golden Age and when exiting one, allowing scripts to track the complete Golden Age lifecycle.

# Event Triggers

This event is triggered in two distinct scenarios:

1. **Golden Age Started**: When the `CvPlayer::changeGoldenAgeTurns` method causes a player to enter a Golden Age
2. **Golden Age Ended**: When the `CvPlayer::changeGoldenAgeTurns` method causes a player to exit a Golden Age

Both triggers occur when the Golden Age status actually changes (when `bOldGoldenAge != isGoldenAge()`), ensuring the event only fires on status transitions.

# Parameters

The event passes three parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| PlayerID | int | The ID of the player whose Golden Age status changed (`GetID()`) |
| IsStarting | bool | Whether the Golden Age is starting (true) or ending (false) |
| TurnChange | int | The number of turns being added/subtracted (0 when ending) |

# Event Details

The event provides comprehensive information about Golden Age transitions:

**Golden Age Starting:**

- `PlayerID`: The player entering the Golden Age
- `IsStarting`: Set to `true`
- `TurnChange`: The number of turns being added (`iChange` parameter)

**Golden Age Ending:**

- `PlayerID`: The player exiting the Golden Age
- `IsStarting`: Set to `false`
- `TurnChange`: Always `0` when ending

The event occurs immediately after the Golden Age status change is detected but before city yield updates and notifications are processed.

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvPlayer.cpp`

**Trigger Locations**:

- Line 24265: Golden Age ending in `CvPlayer::changeGoldenAgeTurns`
- Line 24376: Golden Age starting in `CvPlayer::changeGoldenAgeTurns`

**Event System**: Uses the game event hook system via `GAMEEVENTINVOKE_HOOK()`

**Conditional Compilation**: The event is only triggered when `MOD_EVENTS_GOLDEN_AGE` is enabled

**Execution Context**: The event fires during Golden Age status transitions, specifically:

- After the golden age turn count has been modified
- After the status change has been detected (`bOldGoldenAge != isGoldenAge()`)
- After map yield updates have been triggered
- Before city happiness and yield recalculations
- Alongside gameplay notifications (`GameplayGoldenAgeStarted()` or `GameplayGoldenAgeEnded()`)

**Status Detection**: The event only triggers when there is an actual status change, not on every turn modification, making it reliable for tracking Golden Age state transitions.
