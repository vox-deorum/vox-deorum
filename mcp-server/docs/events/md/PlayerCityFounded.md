# Overview

The `PlayerCityFounded` event is triggered when a player successfully establishes a new city. This event is fired after all city initialization procedures are completed, including setting up initial buildings, choosing production, and displaying messages to the player.

# Event Triggers

This event is triggered in the following scenario:

1. **City Foundation Completion**: When the `CvPlayer::initCity` method completes the full city initialization process

The trigger occurs after the city has been fully set up with initial buildings, AI strategies have been applied, and the player has been prompted for production choices (for human players).

# Parameters

The event passes three parameters to event handlers:

| Parameter | Type | Description                                               |
| --------- | ---- | --------------------------------------------------------- |
| PlayerID  | int  | The ID of the player who founded the city (`GetID()`)     |
| X         | int  | The X coordinate of the city's location (`pCity->getX()`) |
| Y         | int  | The Y coordinate of the city's location (`pCity->getY()`) |

# Event Details

The event provides essential information about the newly founded city:

- **Player Context**: The `PlayerID` parameter identifies which player founded the city
- **Location Information**: The X and Y coordinates specify the exact map position of the new city
- **Post-Initialization Timing**: The event fires after all city initialization is complete, ensuring the city is fully functional when handlers execute

The event occurs regardless of whether the player is human or AI, and after appropriate UI interactions (production choices, tech selection) have been handled for human players.

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvPlayer.cpp`

**Trigger Location**: Line 13478 in the `CvPlayer::initCity` method

**Event System**: Uses the Lua scripting hook system via `LuaSupport::CallHook()`

**Execution Context**: The event fires at the very end of the city initialization process, after:

- Initial buildings have been granted
- AI strategies have been set for the city
- Human players have been prompted for production and tech choices
- City foundation messages have been displayed

**Usage Example**: The Community Patch includes Lua handlers such as the Inca civilization's special ability to automatically place Machu Picchu improvements on mountain tiles when founding cities.
