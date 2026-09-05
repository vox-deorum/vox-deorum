# Overview

The `TerraformingPlot` event is triggered when individual plot properties are modified during gameplay. This comprehensive event covers various types of plot modifications including terrain changes, river modifications, feature updates, and ownership changes.

# Event Triggers

This event is triggered in multiple scenarios covering different aspects of plot modification:

- **Area Changes**: When a plot's area assignment is modified
- **Landmass Changes**: When a plot's landmass assignment is updated
- **River Changes**: When river segments are added or removed from plot edges
- **Plot Type Changes**: When a plot's basic type (land, water, mountain) is altered
- **Terrain Changes**: When a plot's terrain type is modified
- **Feature Changes**: When natural features are added or removed from plots
- **City Ownership**: When a plot's city ownership is established or changed
- **Continent Changes**: When a plot's continent assignment is modified

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `eventType` | `int` | The specific type of terraforming operation being performed |
| `x` | `int` | The X coordinate of the plot being modified |
| `y` | `int` | The Y coordinate of the plot being modified |
| `direction` | `int` | Direction parameter (used for river changes, 0 for others) |
| `newValue` | `int` | The new value being set (terrain type, feature type, etc.) |
| `oldValue` | `int` | The previous value being replaced |
| `additionalParam1` | `int` | Context-specific additional parameter |
| `additionalParam2` | `int` | Context-specific additional parameter |

# Event Details

The `TerraformingPlot` event is one of the most comprehensive events in the system, covering numerous types of plot modifications:

**TERRAFORMINGEVENT_AREA**: Tracks changes to plot area assignments, important for pathfinding and AI area control analysis.

**TERRAFORMINGEVENT_LANDMASS**: Monitors landmass reassignments, crucial for naval movement and continent-based game mechanics.

**TERRAFORMINGEVENT_RIVER**: Captures river segment changes in three directions (Northeast, West, Northwest), including flow direction data. Rivers affect movement, combat bonuses, and city placement.

**TERRAFORMINGEVENT_PLOT**: Records fundamental plot type changes (land/water/mountain conversions), which can dramatically alter strategic value.

**TERRAFORMINGEVENT_TERRAIN**: Tracks terrain type modifications (grassland, plains, desert, etc.), affecting tile yields and unit movement.

**TERRAFORMINGEVENT_FEATURE**: Monitors natural feature changes (forests, jungles, marshes, etc.), impacting resources and strategic options.

**TERRAFORMINGEVENT_CITY**: Captures city ownership changes for plots, critical for territory control and city working radius management.

**TERRAFORMINGEVENT_CONTINENT**: Records continent assignment changes, affecting continental bonuses and certain victory conditions.

Each event type provides different contextual information through the parameter set, enabling detailed tracking of plot modifications across all game systems.

# Technical Details

**Source Location:** `CvGameCoreDLL_Expansion2/CvPlot.cpp` (Multiple locations: lines 5660, 5689, 6221, 6269, 6317, 7107, 7357, 7449, 7952, 7995, 14264)

**Trigger Context:** The event is invoked within the `CvPlot` class across multiple methods that handle different aspects of plot modification:

- Area/landmass assignment methods
- River modification methods
- Plot type, terrain, and feature setters
- City ownership management methods
- Continent assignment methods

**Event Hook:** Uses the `GAMEEVENTINVOKE_HOOK` macro with event type `GAMEEVENT_TerraformingPlot`

**Event Type Constants:** Different terraforming operations use specific event type constants:

- `TERRAFORMINGEVENT_AREA` - Area changes
- `TERRAFORMINGEVENT_LANDMASS` - Landmass changes
- `TERRAFORMINGEVENT_RIVER` - River modifications
- `TERRAFORMINGEVENT_PLOT` - Plot type changes
- `TERRAFORMINGEVENT_TERRAIN` - Terrain changes
- `TERRAFORMINGEVENT_FEATURE` - Feature changes
- `TERRAFORMINGEVENT_CITY` - City ownership changes
- `TERRAFORMINGEVENT_CONTINENT` - Continent changes

**Code Examples:**

```cpp
// Area change
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TerraformingPlot, TERRAFORMINGEVENT_AREA, m_iX, m_iY, 0, iNewValue, m_iArea, -1, -1);

// River change
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TerraformingPlot, TERRAFORMINGEVENT_RIVER, m_iX, m_iY, DIRECTION_NORTHEAST, bNewValue, isNEOfRiver(), eRiverDir, getRiverSWFlowDirection());

// Feature change
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TerraformingPlot, TERRAFORMINGEVENT_FEATURE, m_iX, m_iY, 0, eNewValue, m_eFeatureType, -1, -1);
```

This event provides the most comprehensive coverage of plot-level changes in the game, making it essential for systems that need to track terrain modifications, strategic map changes, and environmental updates that affect gameplay mechanics.
