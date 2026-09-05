# Overview

The `PlayerDoTurn` event is triggered during the post-diplomacy phase of a player's turn processing. This event occurs after most AI systems have completed their turn logic but before military rating decay and final cleanup operations.

# Event Triggers

This event is triggered in the following scenario:

1. **Post-Diplomacy Turn Processing**: When the `CvPlayer::doTurnPostDiplomacy` method executes the main turn logic after diplomacy processing

The trigger occurs after AI turn processing (`AI_doTurnPost()`) has completed and just before military rating decay calculations.

# Parameters

The event passes one parameter to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| PlayerID | int | The ID of the player whose turn is being processed (`GetID()`) |

# Event Details

The event provides information about the player during turn processing:

- **Player Identification**: The `PlayerID` parameter identifies which player is being processed
- **Turn Processing Context**: The event fires during the main turn processing phase, after most game systems have updated
- **Pre-Cleanup Timing**: The event occurs before final cleanup operations like military rating decay

The event is part of the core turn processing system and allows scripts to hook into the player's turn after major systems have been updated.

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvPlayer.cpp`

**Trigger Location**: Line 10484 in the `CvPlayer::doTurnPostDiplomacy` method

**Event System**: Uses the Lua scripting hook system via `LuaSupport::CallHook()`

**Execution Context**: The event fires during post-diplomacy turn processing, specifically:

- After AI systems (Economic, Military, Religion, Espionage, Trade, League, Minor Civ AI) have completed their turn processing
- After temporary bonus turns have been decremented
- After instant great person progress notifications have been displayed
- After the main AI turn post-processing (`AI_doTurnPost()`)
- Before military rating decay calculations for major civilizations

**Processing Note**: As noted in the source code comment, this isn't actually the end of the turn - `AI_unitUpdate` is called later in the turn sequence.
