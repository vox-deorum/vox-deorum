# Overview

The `TileImprovementChanged` event is triggered when a tile's improvement is built, destroyed, changed, or has its pillage state modified. This event tracks all modifications to human-made improvements on tiles, including farms, mines, trading posts, and other constructed enhancements.

# Event Triggers

This event is triggered in the following scenarios:

- When a new improvement is constructed on a tile
- When an existing improvement is replaced with a different one
- When an improvement is destroyed or removed
- When an improvement's pillage state changes (pillaged or repaired)

The event fires in two primary contexts:

1. **Improvement Type Changes**: When the actual improvement type is modified
2. **Pillage State Changes**: When an improvement is pillaged or repaired without changing its type

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `x` | `int` | The X coordinate of the tile where the improvement changed |
| `y` | `int` | The Y coordinate of the tile where the improvement changed |
| `owner` | `int` | The player ID of the tile's current owner (if any) |
| `oldImprovement` | `int` | The type/ID of the previous improvement (NO_IMPROVEMENT if none) |
| `newImprovement` | `int` | The type/ID of the new improvement (NO_IMPROVEMENT if removed) |
| `isPillaged` | `bool` | Whether the improvement is currently in a pillaged state |

# Event Details

The `TileImprovementChanged` event provides comprehensive tracking of improvement modifications, which are fundamental to economic development in Civilization V:

**Economic Impact:**

- **Tile Yields**: Improvements directly modify tile production, food, and gold output
- **Resource Access**: Many improvements are required to access strategic and luxury resources
- **Specialization**: Different improvements optimize tiles for specific types of output
- **Infrastructure Development**: Improvements represent a civilization's territorial investment

**Strategic Significance:**

- **Territory Control**: Improvements indicate active use and control of territory
- **Economic Strategy**: Improvement patterns reveal economic priorities and strategies
- **Vulnerability**: Improved tiles become targets for enemy pillaging
- **Development Progress**: Improvement density indicates civilization development level

**Common Improvement Changes:**

- **Worker Construction**: Building farms, mines, plantations, and other basic improvements
- **Unique Improvements**: Civilization-specific improvements with special benefits
- **Replacement Upgrades**: Replacing basic improvements with more advanced versions
- **Pillaging Actions**: Military units destroying enemy improvements
- **Repair Operations**: Workers repairing pillaged improvements

**Pillage State Tracking:** The event specifically tracks pillage states, which is crucial for:

- **Damage Assessment**: Understanding the impact of military campaigns
- **Repair Planning**: Identifying improvements that need restoration
- **Economic Disruption**: Measuring the economic cost of warfare

# Technical Details

**Source Locations:**

- `CvGameCoreDLL_Expansion2/CvPlot.cpp:8860` (Improvement type changes)
- `CvGameCoreDLL_Expansion2/CvPlot.cpp:9099` (Pillage state changes)

**Trigger Contexts:**

1. **Type Changes**: Fired when the improvement type is actually modified
2. **Pillage Changes**: Fired when only the pillage state changes without type modification

**Event Hook:** Uses the `GAMEEVENTINVOKE_HOOK` macro with event type `GAMEEVENT_TileImprovementChanged`

**Code References:**

```cpp
// Improvement type change
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TileImprovementChanged, getX(), getY(), getOwner(), eOldImprovement, eNewValue, IsImprovementPillaged());

// Pillage state change
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TileImprovementChanged, getX(), getY(), getOwner(), getImprovementType(), getImprovementType(), IsImprovementPillaged());
```

**Parameter Interpretation:**

- **Type Changes**: `oldImprovement` and `newImprovement` differ, showing the transition
- **Pillage Changes**: Both improvement parameters are the same (current type), but `isPillaged` indicates the state change
- **NO_IMPROVEMENT**: Used when no improvement is present (before construction or after destruction)

**Improvement System Integration:** This event integrates with the worker action system, military pillaging mechanics, and the broader economic infrastructure of the game.

**Ownership Context:** The event includes owner information, enabling analysis of:

- Which civilizations are developing their territory
- Economic competition between neighboring civilizations
- The impact of territorial conquest on improvement patterns

This event provides essential data for economic analysis, territorial development tracking, and understanding the strategic use of improvements across different civilizations and game phases.
