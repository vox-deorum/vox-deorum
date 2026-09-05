# Overview

The `PlayerEndTurnCompleted` event is triggered at the very end of a player's turn processing, after all turn mechanics have been completed. This event serves as a notification that the player's turn has fully concluded and the game is ready to move to the next phase.

# Event Triggers

This event is triggered in the following scenario:

1. **Turn Completion Finalization**: When the `CvPlayer::doTurn` method completes all turn processing and is about to publish the turn end status to the UI

The trigger occurs at the absolute end of turn processing, after all game mechanics, unit updates, and system processing have been completed.

# Parameters

The event passes one parameter to event handlers:

| Parameter | Type | Description                                               |
| --------- | ---- | --------------------------------------------------------- |
| PlayerID  | int  | The ID of the player whose turn has completed (`GetID()`) |

# Event Details

The event provides information about the completed turn:

- **Player Identification**: The `PlayerID` parameter identifies which player has completed their turn
- **Finalization Context**: The event fires after all turn processing is complete, making it ideal for end-of-turn cleanup or summary operations
- **UI Notification Timing**: The event occurs just before the UI is notified of the turn end status

This event is the final hook in the turn processing sequence, occurring after all other player turn events.

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvPlayer.cpp`

**Trigger Location**: Line 32810 in the `CvPlayer::doTurn` method

**Event System**: Uses the Lua scripting hook system via `LuaSupport::CallHook()`

**Conditional Compilation**: The event is only triggered when `MOD_EVENTS_RED_TURN` is enabled

**Execution Context**: The event fires at the very end of turn processing, specifically:

- After all turn mechanics have been completed
- After `PlayerDoneTurn` event has been triggered
- After unit healing and movement restoration
- After all AI and game system updates
- Just before UI turn status notification (`DLLUI->PublishPlayerTurnStatus(DLLUIClass::TURN_END, GetID())`)

**Turn Sequence**: This is the final event in the player turn processing sequence, making it ideal for operations that need to occur after everything else is complete.
