# Overview

The `PlayerDoneTurn` event is triggered when a player finishes their turn, specifically during the turn ending phase. This event occurs after the player has completed all their turn actions and the system is transitioning to process the end of the turn.

# Event Triggers

This event is triggered in the following scenario:

1. **Turn Ending Phase**: When the `CvPlayer::doTurn` method processes the turn ending phase (when `bDoTurn` is false)

The trigger occurs after visibility updates have been applied and before unit healing and movement point restoration takes place.

# Parameters

The event passes one parameter to event handlers:

| Parameter | Type | Description                                           |
| --------- | ---- | ----------------------------------------------------- |
| PlayerID  | int  | The ID of the player whose turn is ending (`GetID()`) |

# Event Details

The event provides information about the player completing their turn:

- **Player Identification**: The `PlayerID` parameter identifies which player has finished their turn
- **Turn Transition Context**: The event fires during the transition from active turn to turn completion
- **Pre-Processing Timing**: The event occurs before important end-of-turn processing such as unit healing and movement restoration

The event is part of the turn management system and helps track when players complete their turns in both single-player and multiplayer games.

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvPlayer.cpp`

**Trigger Location**: Line 32757 in the `CvPlayer::doTurn` method

**Event System**: Uses the game event hook system via `GAMEEVENTINVOKE_HOOK()`

**Conditional Compilation**: The event is only triggered when `MOD_EVENTS_PLAYER_TURN` is enabled

**Execution Context**: The event fires during the turn ending phase, specifically:

- After delayed visibility updates have been processed
- After `PlayerEndTurnInitiated` event (if RED_TURN mod is enabled)
- Before end-turn blocking is cleared
- Before unit healing and movement restoration (`DoUnitReset()`)

**Related Events**: This event is closely related to `PlayerEndTurnInitiated` and occurs in the same turn processing sequence.
