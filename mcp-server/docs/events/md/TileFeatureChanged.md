# Overview

The `TileFeatureChanged` event is triggered when a natural feature on a tile is added, removed, or modified. This event tracks changes to terrain features such as forests, jungles, marshes, oases, and other natural formations that affect gameplay.

# Event Triggers

This event is triggered in the following scenario:

- When a tile's natural feature is changed through any game mechanism
- The event fires during feature modification operations, typically when workers clear features or through other game systems
- Captures both the removal of existing features and the addition of new ones

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `x` | `int` | The X coordinate of the tile where the feature changed |
| `y` | `int` | The Y coordinate of the tile where the feature changed |
| `owner` | `int` | The player ID of the tile's current owner (if any) |
| `oldFeature` | `int` | The type/ID of the previous feature (NO_FEATURE if none) |
| `newFeature` | `int` | The type/ID of the new feature (NO_FEATURE if removed) |

# Event Details

The `TileFeatureChanged` event provides comprehensive tracking of natural feature modifications across the map. Natural features play crucial roles in Civilization V:

**Strategic Importance:**

- **Resource Access**: Features can hide or reveal strategic/luxury resources
- **Movement**: Different features affect unit movement costs and restrictions
- **Combat**: Features provide combat bonuses and defensive advantages
- **Tile Yields**: Features modify base terrain yields (food, production, gold)

**Common Feature Changes:**

- **Worker Actions**: Clearing forests, jungles, or marshes for improvements
- **Natural Growth**: Some mods allow features to spread or regenerate
- **Terraforming**: Advanced civilizations or abilities modifying terrain
- **Environmental Events**: Random events that add or remove features

**Gameplay Impact:**

- **City Planning**: Feature changes affect optimal city placement and growth
- **Improvement Planning**: Different features allow different improvements
- **Strategic Resources**: Clearing features may reveal hidden resources
- **Visual Changes**: Feature modifications alter the map's appearance and strategic layout

The event captures both the spatial context and ownership information, enabling analysis of how different civilizations modify their territories and the broader environmental changes occurring across the world.

# Technical Details

**Source Location:** `CvGameCoreDLL_Expansion2/CvPlot.cpp:7570`

**Trigger Context:** The event is invoked within the `CvPlot` class during feature modification operations, specifically within methods that handle feature changes on individual plots.

**Event Hook:** Uses the `GAMEEVENTINVOKE_HOOK` macro with event type `GAMEEVENT_TileFeatureChanged`

**Feature System Integration:** This event integrates with the game's terrain and feature management systems, firing whenever the feature state of a plot changes.

**Code Reference:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TileFeatureChanged, getX(), getY(), getOwner(), eOldFeature, eNewValue);
```

**Feature Type Handling:**

- `eOldFeature`: Represents the previous feature type, using game-defined feature constants
- `eNewValue`: Represents the new feature type being set
- Both parameters use `NO_FEATURE` constant when no feature is present

**Ownership Context:** The event includes the current tile owner information, which is important for:

- Tracking which civilizations are modifying their territory
- Understanding the strategic decisions behind feature changes
- Analyzing territorial development patterns

**Integration Points:** This event works in conjunction with improvement and terraforming systems, providing a comprehensive view of how the natural landscape evolves during gameplay.

The event serves as a critical tracking mechanism for environmental changes that can significantly impact strategic planning, resource availability, and territorial development in Civilization V.
