# Overview

The `TileRevealed` event is triggered when a tile is revealed to a team for the first time through exploration, vision, or other game mechanics. This event captures the discovery of new territories and tracks which civilizations are expanding their knowledge of the world.

# Event Triggers

This event is triggered in the following scenarios:

- When a unit moves to reveal previously unexplored tiles
- When a unit's vision radius reveals new territory
- When cities or other structures provide vision of surrounding areas
- When special abilities or technologies reveal distant territories
- When diplomatic actions grant vision of other civilizations' territories

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `x` | `int` | The X coordinate of the tile being revealed |
| `y` | `int` | The Y coordinate of the tile being revealed |
| `revealedToTeam` | `int` | The team ID that is gaining vision of the tile |
| `revealedByTeam` | `int` | The team ID responsible for the revelation (if applicable) |
| `isFirstMajorCiv` | `bool` | Whether this is the first major civilization to discover this tile |
| `unitOwner` | `int` | The player ID of the unit owner causing the revelation (NO_PLAYER if not unit-based) |
| `unitId` | `int` | The ID of the specific unit revealing the tile (-1 if not unit-based) |

# Event Details

The `TileRevealed` event tracks one of the core gameplay mechanics of Civilization V - exploration and map discovery. This event provides comprehensive information about how the world map becomes known to different civilizations:

**Exploration Mechanics:**

- **Unit-Based Discovery**: Most common form through unit movement and vision
- **Structural Vision**: Cities, citadels, and other structures revealing surrounding areas
- **Technological Revelation**: Advanced technologies that provide map knowledge
- **Diplomatic Vision**: Shared vision through diplomatic agreements or espionage
- **Special Abilities**: Unique civilization traits that enhance exploration

**Strategic Importance:**

- **Resource Discovery**: Revealed tiles may contain strategic or luxury resources
- **Terrain Analysis**: Understanding terrain types for movement and city planning
- **Strategic Positioning**: Identifying chokepoints, defensive positions, and expansion opportunities
- **Natural Wonders**: Discovery of unique terrain features with special bonuses
- **Civilization Contact**: Revealing tiles may lead to meeting other civilizations

**Information Tracking:** The event captures multiple levels of context:

- **Spatial Context**: Exact location being revealed
- **Team Dynamics**: Which teams are involved in the revelation process
- **Discovery Priority**: Whether this is a first discovery by a major civilization
- **Unit Attribution**: Specific unit and player responsible for the discovery

**First Discovery Significance:** The `isFirstMajorCiv` parameter is particularly important because:

- First discoveries often provide bonuses or achievements
- They indicate exploration leadership and territorial advantages
- They affect diplomatic relationships and competitive positioning
- They influence strategic resource distribution knowledge

# Technical Details

**Source Location:** `CvGameCoreDLL_Expansion2/CvPlot.cpp:12327`

**Trigger Context:** The event is invoked within the `CvPlot` class during the tile revelation process, specifically when a team gains vision of a previously unknown tile.

**Event Hook:** Uses the `GAMEEVENTINVOKE_HOOK` macro with event type `GAMEEVENT_TileRevealed`

**Vision System Integration:** This event integrates with the game's line-of-sight and exploration systems, firing whenever the visibility state of a tile changes for a team.

**Code Reference:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TileRevealed, getX(), getY(), eTeam, eFromTeam,
                     (kTeam.isMajorCiv() && iRevealedMajors == 0),
                     (pUnit ? pUnit->getOwner() : NO_PLAYER),
                     (pUnit ? pUnit->GetID() : -1));
```

**Major Civilization Logic:** The first discovery logic specifically checks:

- Whether the revealing team is a major civilization (not a minor civilization or barbarian)
- Whether this is the first major civilization to reveal this tile
- This distinction affects bonuses, achievements, and historical significance

**Unit Context Handling:**

- **Unit-Based Revelations**: Include specific unit and owner information
- **Non-Unit Revelations**: Use NO_PLAYER and -1 for unit parameters
- **Multiple Sources**: Same tile can be revealed through different mechanisms

**Team Relationships:** The event tracks both the team gaining vision and the team responsible for the revelation, which can differ in cases of:

- Shared vision agreements
- Captured units revealing territory
- Diplomatic or espionage actions

**Integration Points:** This event works with multiple game systems:

- **Movement and pathfinding systems**
- **Diplomacy and shared vision mechanics**
- **Achievement and bonus systems**
- **AI exploration and strategic planning**

The event provides essential data for understanding exploration patterns, strategic map knowledge distribution, and the competitive aspects of world discovery in Civilization V.
