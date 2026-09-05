# Overview

The `EventUnitCreated` event is triggered when a unit is created as a result of an event choice in Civilization V. This event occurs when players make event choices that result in the creation of military units, civilian units, or special units. The event tracks unit creation specifically through the event system, distinguishing it from normal unit production through cities or other game mechanics.

# Event Triggers

This event is triggered when unit creation occurs as a consequence of event choice resolution in both city-level and player-level events.

**Specific trigger conditions:**

- **Event choice execution**: An event choice that includes unit creation as an effect is being processed
- **Valid unit creation**: The event choice specifies a valid unit type that can be created
- **Successful unit spawning**: The unit has been successfully created and added to the game
- **Event system integration**: The unit creation is happening through the event choice system rather than normal production

**Multiple trigger locations:**

- **City events** (lines 7109, 7139 in `CvCity.cpp`): When city event choices create units
- **Player events** (lines 8341, 8383 in `CvPlayer.cpp`): When player event choices create units

**Related mechanics that can trigger event unit creation:**

- City event choices that reward units for specific decisions
- Player event choices that provide military reinforcements or special units
- Event chain progression where unit rewards are granted
- Scripted events that create units based on player choices or conditions

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who will receive the created unit (from `getOwner()` or `GetID()`) |
| `eventChoiceID` | integer | The identifier of the event choice that triggered the unit creation (`eEventChoice`) |
| `unitPointer` | integer | Pointer to the created unit object cast as integer (`pUnit`) |

# Event Details

Event unit creation represents a reward or consequence mechanism within the event system, providing players with military assets, civilian units, or unique units based on their event choices. These units are typically granted as immediate benefits for making specific decisions during events.

**Event unit creation mechanics:**

- **Unit type variety**: Events can create any type of unit defined in the game database
- **Free units**: Event-created units typically don't cost production or resources
- **Immediate availability**: Units are created instantly when the event choice is processed
- **Location placement**: Units are typically placed in cities or near the player's territory
- **Special units**: Some events may create unique or otherwise unavailable units

**Common event unit rewards:**

- **Military reinforcements**: Combat units to bolster defense or enable expansion
- **Specialist civilians**: Workers, settlers, or other civilian units to aid development
- **Unique units**: Special or promoted units not normally available through production
- **Emergency forces**: Units granted during crisis events or defensive scenarios
- **Exploration units**: Scouts or naval units to aid in discovery and expansion

**Event unit creation contexts:**

- **City events**: Local events may provide units specific to city needs or circumstances
- **Player events**: Civilization-wide events may grant units for strategic purposes
- **Crisis response**: Emergency events may provide military units for immediate threats
- **Achievement rewards**: Events may grant special units for reaching milestones
- **Diplomatic gifts**: Events involving other civilizations may result in unit exchanges

# Technical Details

**Source Locations**:

- `CvGameCoreDLL_Expansion2/CvCity.cpp`, lines 7109, 7139
- `CvGameCoreDLL_Expansion2/CvPlayer.cpp`, lines 8341, 8383

**Function Context**: Called within `CvCity::DoEventChoice` and `CvPlayer::DoEventChoice` functions when unit creation is specified as an effect

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_EventUnitCreated`

**Preconditions**:

- `eEventChoice` parameter must be a valid event choice type that includes unit creation
- Unit type specified in the event choice must be valid and available
- Player must have sufficient space or valid location for unit placement
- `pUnit` pointer must reference a successfully created unit object

**Event Flow**:

1. Event choice processing determines that unit creation is required
2. Unit type and attributes are retrieved from event choice configuration
3. Unit creation process is initiated through the game's unit spawning system
4. Unit is successfully created and placed in the game world
5. `GAMEEVENT_EventUnitCreated` hook is invoked with player ID, event choice ID, and unit pointer
6. Unit is made available to the player for immediate use
7. Event processing continues with any additional effects or consequences

**Related Events**:

- `EventChoiceActivated`: The choice selection that may lead to unit creation
- `EventChoiceEnded`: The choice resolution that triggers unit creation
- `UnitCreated`: The general unit creation event for non-event unit spawning
- `CityEventChoiceActivated`: City-specific event choices that may create units
