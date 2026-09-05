# Overview

The `TileOwnershipChanged` event is triggered when a tile's ownership changes from one player to another. This event captures all territorial changes including city founding, border expansion, conquest, and other mechanisms that transfer tile ownership between civilizations.

# Event Triggers

This event is triggered in the following scenarios:

- When a tile is claimed by a civilization for the first time (initial border expansion)
- When a tile changes ownership due to city conquest
- When borders shift due to cultural pressure or other game mechanics
- When tiles are acquired through diplomatic means or special abilities
- When tiles lose ownership (though this is rare in standard gameplay)

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `x` | `int` | The X coordinate of the tile that changed ownership |
| `y` | `int` | The Y coordinate of the tile that changed ownership |
| `newOwner` | `int` | The player ID of the new owner (NO_PLAYER if becoming neutral) |
| `oldOwner` | `int` | The player ID of the previous owner (NO_PLAYER if was neutral) |

# Event Details

The `TileOwnershipChanged` event tracks one of the most fundamental aspects of Civilization V gameplay - territorial control. Tile ownership determines:

**Strategic Control:**

- **Resource Access**: Only owned tiles can be worked or have resources extracted
- **Territorial Defense**: Owned territory provides defensive advantages and movement benefits
- **City Working Radius**: Cities can only work tiles within their cultural borders
- **Strategic Positioning**: Territorial control affects unit deployment and strategic options

**Economic Impact:**

- **Yield Generation**: Only owned tiles contribute to civilization's economy
- **Improvement Development**: Improvements can typically only be built on owned territory
- **Trade Route Security**: Territorial control affects trade route safety and efficiency
- **Resource Monopolies**: Ownership of unique resources affects diplomatic leverage

**Diplomatic Consequences:**

- **Border Tensions**: Territorial changes can affect diplomatic relationships
- **Cultural Victory**: Cultural borders are crucial for cultural victory conditions
- **Territorial Disputes**: Overlapping claims can lead to conflicts between civilizations
- **City-State Influence**: Territorial control near city-states affects influence

**Common Ownership Changes:**

- **City Founding**: New cities immediately claim surrounding tiles
- **Cultural Expansion**: Cities naturally expand borders over time through culture
- **City Conquest**: Conquered cities transfer all their territory to the conqueror
- **Great Artist Bomb**: Using Great Artists to instantly claim foreign territory
- **Peace Treaties**: Diplomatic agreements that transfer territorial control

# Technical Details

**Source Location:** `CvGameCoreDLL_Expansion2/CvPlot.cpp:6737`

**Trigger Context:** The event is invoked within the `CvPlot` class during ownership modification operations, typically when the plot's owner property is being updated.

**Event Hook:** Uses the `GAMEEVENTINVOKE_HOOK` macro with event type `GAMEEVENT_TileOwnershipChanged`

**Ownership System Integration:** This event integrates with the game's territorial control system, firing whenever plot ownership is transferred between players.

**Code Reference:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TileOwnershipChanged, getX(), getY(), getOwner(), eOldOwner);
```

**Player ID Handling:**

- **Valid Player IDs**: Represent active civilizations in the game
- **NO_PLAYER**: Used when tiles have no owner (neutral territory)
- **Ownership Transitions**: Can occur between any combination of player and neutral states

**Timing Considerations:** The event fires after the ownership change has been processed, ensuring that `getOwner()` returns the new owner and `eOldOwner` preserves the previous state.

**System Dependencies:** This event interacts with multiple game systems:

- **City borders and cultural expansion**
- **Combat and conquest mechanics**
- **Diplomatic territory transfer systems**
- **Special abilities that affect territorial control**

**Territorial Analysis:** The event provides complete information for territorial analysis:

- **Expansion Patterns**: Tracking how civilizations grow their territory
- **Conquest Impact**: Measuring the territorial gains from military campaigns
- **Cultural Pressure**: Understanding border shifts due to cultural influence
- **Strategic Resources**: Monitoring control changes of valuable resource tiles

This event is fundamental for understanding the shifting balance of power and territorial control throughout a Civilization V game, making it essential for strategic analysis and AI decision-making systems.
