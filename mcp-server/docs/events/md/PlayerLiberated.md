# Overview

The `PlayerLiberated` event is triggered when a player liberates a city that belongs to a previously conquered civilization, potentially restoring that civilization to life. This event occurs during the liberation process after diplomatic relationships have been updated but before embassy transfers.

# Event Triggers

This event is triggered in the following scenario:

1. **Player Liberation**: When the `CvPlayer::DoLiberatePlayer` method completes the liberation of a city to restore a previously conquered player

The trigger occurs after all diplomatic relationship updates and quest completions have been processed, but before embassy transfers and other cleanup operations.

# Parameters

The event passes three parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| LiberatingPlayer | int | The ID of the player performing the liberation (`GetID()`) |
| LiberatedPlayer | int | The ID of the player being liberated (`ePlayer`) |
| CityID | int | The ID of the newly liberated city (`pNewCity->GetID()`) |

# Event Details

The event provides comprehensive information about the liberation:

- **Liberating Player Context**: The `LiberatingPlayer` parameter identifies who is performing the liberation
- **Liberated Player Context**: The `LiberatedPlayer` parameter identifies the civilization being restored/liberated
- **City Information**: The `CityID` parameter identifies the specific city that was liberated
- **Diplomatic Context**: The event occurs after diplomatic relationship updates have been processed

The liberation process can either restore a completely defeated civilization back to life or return a city to an already-living civilization that previously owned it.

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvPlayer.cpp`

**Trigger Location**: Line 9028 in the `CvPlayer::DoLiberatePlayer` method

**Event System**: Uses the game event hook system via `GAMEEVENTINVOKE_HOOK()`

**Conditional Compilation**: The event is only triggered when `MOD_EVENTS_LIBERATION` is enabled

**Execution Context**: The event fires during the liberation process, specifically:

- After the city has been transferred to the liberated player
- After diplomatic relationships have been re-evaluated
- After minor civilization quest checks have been completed
- After proximity calculations have been updated
- Before embassy transfers and other cleanup operations

**Liberation Process**: The liberation can involve either returning a city to its original owner or restoring a completely defeated civilization. The event provides information about both the liberating player and the beneficiary of the liberation, along with the specific city involved in the transaction.
