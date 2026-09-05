# Overview

The `PlayerEndTurnInitiated` event is triggered when a player begins the turn ending phase. This event occurs early in the turn ending sequence, after visibility updates but before the main turn completion processing.

# Event Triggers

This event is triggered in the following scenario:

1. **Turn Ending Phase Start**: When the `CvPlayer::doTurn` method enters the turn ending phase (when `bDoTurn` is false)

The trigger occurs after delayed visibility processing but before the `PlayerDoneTurn` event and other end-turn mechanics.

# Parameters

The event passes one parameter to event handlers:

| Parameter | Type | Description                                           |
| --------- | ---- | ----------------------------------------------------- |
| PlayerID  | int  | The ID of the player whose turn is ending (`GetID()`) |

# Event Details

The event provides information about the turn ending initiation:

- **Player Identification**: The `PlayerID` parameter identifies which player is beginning their turn end sequence
- **Early End-Turn Context**: The event fires early in the turn ending process, allowing scripts to prepare for turn completion
- **Pre-Processing Timing**: The event occurs before most end-turn processing, making it suitable for setup operations

This event is one of the first notifications that a player's turn is ending, preceding most other end-turn events.

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvPlayer.cpp`

**Trigger Location**: Line 32751 in the `CvPlayer::doTurn` method

**Event System**: Uses the Lua scripting hook system via `LuaSupport::CallHook()`

**Conditional Compilation**: The event is only triggered when `MOD_EVENTS_RED_TURN` is enabled

**Execution Context**: The event fires early in the turn ending phase, specifically:

- After delayed visibility updates (`flipVisibility`) have been processed
- Before the `PlayerDoneTurn` event
- Before end-turn blocking is cleared
- Before unit healing and movement restoration
- Before AI repositioning of invalid units

**Turn Sequence**: This is one of the earliest events in the turn ending sequence, occurring before most turn completion processing, making it ideal for initialization or preparation operations that need to happen at the start of turn ending.
