# Overview

The `PlayerBuilding` event is triggered when a unit begins or continues work on a terrain improvement or construction project. This event tracks the building process itself rather than completion, providing insights into active construction activities and unit work assignments across a player's civilization.

# Event Triggers

This event is triggered when a unit is actively engaged in building or improving terrain through the build system. The trigger occurs within the `CvUnit` class during build action processing, capturing both the initiation of new construction projects and the continuation of ongoing work.

The event fires during build operations when:

1. **New Construction**: A unit begins work on a new terrain improvement or project
2. **Continued Work**: A unit continues construction on a partially completed project
3. **Build Validation**: The game processes and validates the unit's building action

# Parameters

The event passes six parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| OwnerID | PlayerTypes | The ID of the player who owns the building unit |
| UnitID | int | The unique identifier of the unit performing the construction |
| X | int | The X coordinate of the tile being improved |
| Y | int | The Y coordinate of the tile being improved |
| BuildType | BuildTypes | The type of improvement or construction being performed |
| IsFirstTime | bool | Whether this is the first time work has begun on this project |

# Event Details

The event provides comprehensive information about active construction:

- **Unit Activity Tracking**: Identifies which specific unit is performing the construction work
- **Location Context**: The X and Y coordinates specify exactly where the work is occurring
- **Construction Type**: The build type parameter identifies what is being constructed or improved
- **Progress Indication**: The first-time flag distinguishes between new projects and continued work
- **Player Context**: The owner ID connects the construction activity to the controlling civilization
- **Tile-Level Detail**: Provides precise location information for terrain improvement tracking

This event is particularly useful for monitoring worker unit activities and understanding how players are developing their territory through improvements.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvUnit.cpp`

**Trigger Location**: Line 13415 within the unit's build action processing system

**Event System**: Uses the game event system via `GAMEEVENTINVOKE_HOOK(GAMEEVENT_PlayerBuilding)`

**Build Context**: The building system typically involves:

- Worker units or other construction-capable units
- Terrain improvements like farms, mines, roads, and special facilities
- Multi-turn construction projects that may require several actions to complete
- Tile-specific improvements that enhance resource production or provide strategic benefits

**Progress Tracking**: The `iStartedYet == 0` condition for the IsFirstTime parameter allows event handlers to distinguish between:

- Initial construction starts (potentially for UI updates, sound effects, or strategic analysis)
- Ongoing construction progress (for tracking work continuation and efficiency)

**Coordinate System**: The X and Y parameters use the game's hex-based coordinate system to pinpoint the exact tile location of the construction activity.
