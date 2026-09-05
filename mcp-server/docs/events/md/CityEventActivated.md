# Overview

The `CityEventActivated` event is triggered when a city event begins in Civilization V. City events are special occurrences that can happen to individual cities, providing various effects, choices, or consequences that affect city development and gameplay. This event marks the moment when a specific city event becomes active and starts affecting the city.

# Event Triggers

This event is triggered when the `DoStartEvent()` function is called on a city with a valid city event type.

**Specific trigger conditions:**

- **Event selection**: A city event has been chosen to start (either through random selection or forced activation)
- **Valid event info**: The chosen event has valid configuration data in the game's event database
- **Event activation**: The event is marked as active (unless it's an espionage setup event)
- **One-shot tracking**: If the event is marked as one-shot, it's flagged as fired to prevent future occurrences

**Related mechanics that can trigger city events:**

- Random event selection during city turn processing via `DoEvents()`
- Forced event activation through modding or scripting
- Event chain progression where one event triggers another
- Special circumstances or triggers defined in event configuration

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city where the event is activated (from `getOwner()`, returns `PlayerTypes` enum cast to int) |
| `cityID` | integer | The unique identifier of the city where the event is activated (from `GetID()`) |
| `eventID` | integer | The identifier of the specific city event type being activated (`eChosenEvent`, `CityEventTypes` enum cast to int) |

# Event Details

City events are a dynamic gameplay mechanic that introduces variability and decision-making opportunities for individual cities. When an event activates, it typically provides the player with narrative context and may offer choices that lead to different outcomes affecting the city's development, resources, or population.

**City event mechanics:**

- **Event duration**: Many events have cooldown periods that prevent immediate reactivation
- **Event choices**: After activation, events may present multiple choice options to the player
- **One-shot events**: Some events can only occur once per city and are permanently marked as fired
- **Espionage events**: Special events related to espionage mechanics may have different activation rules
- **Event chains**: Some events may trigger additional events or choices in sequence

**Event lifecycle:**

- **CityEventActivated**: Fired when an event initially starts and becomes active
- **CityEventChoiceActivated**: Fired when the player is presented with choices for the event
- **CityEventChoiceEnded**: Fired when the player selects a choice and the event concludes

**Event effects:**

- Events can modify city yields, population, buildings, or other city properties
- Events may provide temporary or permanent bonuses and penalties
- Events can unlock special buildings, units, or other game content
- Events may affect diplomatic relationships or trigger other game systems

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 3525

**Function Context**: Called within `CvCity::DoStartEvent(CityEventTypes eChosenEvent, bool bSendMsg)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityEventActivated`

**Preconditions**:

- `eChosenEvent` parameter must not be `NO_EVENT_CITY`
- City event info must exist and be valid (`pkEventInfo != NULL`)
- City must have a valid owner and ID

**Event Flow**:

1. `DoStartEvent` is called with a valid city event type
2. Event info is retrieved from the game database
3. Event is marked as active (unless it's an espionage setup event)
4. One-shot events are flagged as fired to prevent re-occurrence
5. `GAMEEVENT_CityEventActivated` hook is invoked with player ID, city ID, and event ID
6. Event cooldown is calculated and applied based on game speed
7. Event choices are processed and made available to the player
8. Logging occurs if enabled for debugging purposes

**Related Events**:

- `CityEventChoiceActivated`: When the player is presented with event choice options
- `CityEventChoiceEnded`: When the player makes a choice and the event concludes
- `EventActivated`: The general (non-city-specific) version of event activation
