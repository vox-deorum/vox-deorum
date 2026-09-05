# Overview

The `PlayerBuilt` event is triggered when a unit successfully completes construction of a terrain improvement or building project. This event captures the completion of construction work, providing confirmation that an improvement has been finished and is now active on the game map.

# Event Triggers

This event is triggered when a unit finalizes construction of a terrain improvement through the build system. The trigger occurs within the `CvUnit` class after the building process has been completed and the improvement has been successfully placed on the target tile.

The completion event fires when:

1. **Construction Finalization**: All required work on the improvement has been completed
2. **Improvement Activation**: The terrain improvement becomes active and functional
3. **Build System Validation**: The game confirms successful completion of the construction project

# Parameters

The event passes five parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| OwnerID | PlayerTypes | The ID of the player who owns the unit that completed construction |
| UnitID | int | The unique identifier of the unit that finished the building work |
| X | int | The X coordinate of the tile where construction was completed |
| Y | int | The Y coordinate of the tile where construction was completed |
| BuildType | BuildTypes | The type of improvement or construction that was completed |

# Event Details

The event provides essential information about completed construction:

- **Completion Confirmation**: Signals that a construction project has been successfully finished
- **Unit Achievement**: Identifies which specific unit accomplished the construction work
- **Location Specification**: The X and Y coordinates pinpoint where the improvement was completed
- **Improvement Type**: The build type parameter specifies exactly what was constructed
- **Player Context**: The owner ID connects the completed work to the controlling civilization
- **Functional Activation**: The improvement is now active and providing its intended benefits

This event serves as the definitive confirmation that terrain improvements are operational and contributing to the civilization's development and strategic capabilities.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvUnit.cpp`

**Trigger Location**: Line 13580 within the unit's build completion processing system

**Event System**: Uses the game event system via `GAMEEVENTINVOKE_HOOK(GAMEEVENT_PlayerBuilt)`

**Build Completion Context**: Completed improvements typically:

- Provide immediate benefits such as increased resource yields or strategic advantages
- Become permanent features of the terrain (unless later destroyed or replaced)
- May unlock additional construction options or strategic possibilities
- Contribute to overall civilization infrastructure and territorial development

**Relationship to PlayerBuilding**: This event serves as the completion counterpart to the `PlayerBuilding` event:

- `PlayerBuilding` tracks active construction work in progress
- `PlayerBuilt` confirms successful completion and activation
- Together, they provide complete visibility into the construction lifecycle

**Strategic Significance**: Completed improvements often represent:

- Enhanced resource production (farms, mines, plantations)
- Strategic infrastructure (roads, railroads, forts)
- Specialized facilities (trading posts, academies, customs houses)
- Defensive installations or economic improvements
