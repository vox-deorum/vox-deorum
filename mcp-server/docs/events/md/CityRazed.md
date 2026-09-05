# Overview

The `CityRazed` event is triggered when a city is completely destroyed (disbanded) in Civilization V. City razing represents the ultimate act of urban destruction, where a city is completely eliminated from the game world, its population dispersed, buildings demolished, and the land returned to an empty state. This irreversible action removes the city permanently from the game.

# Event Triggers

This event is triggered when the `disband()` function is called on a player with a city that is being completely destroyed.

**Specific trigger conditions:**

- **City destruction**: A city is being completely removed from the game through the disband process
- **Final razing**: The razing process has completed and the city is about to be permanently eliminated
- **Administrative destruction**: Either through player choice, razing countdown completion, or forced removal
- **Plot validation**: The city's plot location is valid and accessible for destruction processing

**Related mechanics that can trigger city razing:**

- Razing countdown reaching zero after a city has been marked for razing over multiple turns
- Player decision to immediately raze a captured city rather than puppet or annex it
- Administrative actions that force city destruction through modding or special events
- Barbarian city destruction when barbarian camps or cities are eliminated
- Natural or scripted events that require city removal from the game world
- Victory condition outcomes that may require city destruction

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city being razed (from `GetID()`) |
| `cityX` | integer | The X coordinate of the city plot being razed (from `pPlot->getX()`) |
| `cityY` | integer | The Y coordinate of the city plot being razed (from `pPlot->getY()`) |

# Event Details

City razing represents the complete and irreversible destruction of urban settlements, removing all traces of civilization from the target location. This extreme action eliminates not just the city's population and buildings, but all associated infrastructure, culture, and strategic value, returning the land to its natural state.

**Destruction process components:**

- **Population elimination**: All citizens in the city are permanently removed
- **Building destruction**: Every building, wonder, and improvement in the city is demolished
- **Infrastructure removal**: All city-specific infrastructure and improvements are eliminated
- **Cultural erasure**: City's cultural influence and territorial control is removed
- **Economic impact**: All economic output and trade connections are severed
- **Strategic consequences**: Military units stationed in the city must find new locations

**Wonder and building destruction:**

- **Wonder removal**: World Wonders and National Wonders in the city are permanently destroyed
- **Construction cancellation**: Partially completed wonders and buildings are cancelled
- **Visual updates**: Wonder displays and city interface elements are updated to reflect destruction
- **Global effects**: Wonder benefits that affected other cities or the empire are removed
- **Historical tracking**: Destroyed wonder information is preserved for game records

**Razing vs. other city fates:**

- **Annexation**: Full integration with complete player control and responsibility
- **Puppeting**: Limited control with reduced penalties but continued existence
- **Occupation**: Temporary status pending permanent decision
- **Razing**: Complete and permanent elimination of the city

**Strategic implications of razing:**

- **Territorial denial**: Prevents enemies from benefiting from the city's location and resources
- **Resource elimination**: Removes access to strategic or luxury resources in the city's territory
- **Diplomatic consequences**: May affect relationships with other civilizations
- **Population impact**: Removes potential population centers from the game world
- **Wonder destruction**: Eliminates unique buildings that cannot be rebuilt elsewhere

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`, line 11599

**Function Context**: Called within `CvPlayer::disband(CvCity* pCity)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityRazed`

**Preconditions**:

- `pCity` must be a valid city pointer belonging to the player
- City's plot location must be valid and accessible
- City must not be protected from razing by game rules or special conditions

**Event Flow**:

1. `disband` function is called with the target city
2. City's plot location is retrieved and validated
3. Barbarian status is checked for special handling
4. `GAMEEVENT_CityRazed` hook is invoked immediately with player ID and coordinates
5. City name is added to the global destroyed cities list for historical tracking
6. Building destruction process begins by iterating through all building types
7. Existing buildings are identified and marked for removal
8. World Wonders and National Wonders receive special destruction handling
9. Partially completed wonders are cancelled and removed from construction queues
10. Wonder display interface is updated to reflect destroyed wonders
11. City damage visualization is reset and city destruction graphics are triggered
12. `pCity->kill()` is called to perform final city elimination
13. Player proximity calculations are updated to reflect the eliminated city
14. Special barbarian handling occurs if the razed city was barbarian-owned

**Building and Wonder Destruction Process**:

- System iterates through all building types in the game
- For each building type, checks if the city has completed or partially completed versions
- Completed buildings are marked for destruction and removed from the city
- World Wonders receive special treatment with interface updates
- Partially completed wonders in production are cancelled and removed
- Wonder display commands are queued to update the visual interface

**Interface and Visual Updates**:

- `WONDER_REMOVED` commands are sent to update wonder displays
- City damage visualization is reset to show complete destruction
- `GameplayCityDestroyed` is called to trigger destruction animations
- City interface elements are marked as dirty and updated

**Historical and Game State Updates**:

- Destroyed city names are preserved in the game's historical record
- Player proximity calculations are recalculated without the destroyed city
- Trade route connections through the city are automatically cancelled
- Territory ownership reverts to neutral or previous owners as appropriate

**Related Events**:

- Territory and plot ownership events as land reverts to neutral control
- Trade route disruption events as commercial connections are severed
- Diplomatic events that may result from the act of city destruction
- Wonder destruction events that may have empire-wide implications
