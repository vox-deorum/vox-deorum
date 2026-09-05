# Overview

The `EventActivated` event is triggered when a player-level event begins in Civilization V. Player events are special occurrences that affect an entire civilization, providing various effects, choices, or consequences that can influence gameplay strategy, resources, and diplomatic relationships. This event marks the moment when a specific player event becomes active and starts affecting the player.

# Event Triggers

This event is triggered when the `DoStartEvent()` function is called on a player with a valid event type.

**Specific trigger conditions:**

- **Event selection**: A player event has been chosen to start (either through random selection or forced activation)
- **Valid event info**: The chosen event has valid configuration data in the game's event database
- **Event activation**: The event is marked as active and begins its effect duration
- **One-shot tracking**: If the event is marked as one-shot, it's flagged as fired to prevent future occurrences

**Related mechanics that can trigger player events:**

- Random event selection during player turn processing
- Forced event activation through modding or scripting
- Event chain progression where one event triggers another
- Special circumstances or triggers defined in event configuration
- Technology discoveries, policy adoptions, or other game milestones

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player for whom the event is activated (from `GetID()`) |
| `eventID` | integer | The identifier of the specific player event being activated (`eChosenEvent`) |

# Event Details

Player events are a dynamic gameplay mechanic that introduces variability and strategic decision-making opportunities for civilizations. When an event activates, it typically provides the player with narrative context and may offer choices that lead to different outcomes affecting the civilization's development, resources, military, or diplomatic standing.

**Player event mechanics:**

- **Event duration**: Events have cooldown periods calculated based on game speed that prevent immediate reactivation
- **Event choices**: After activation, events may present multiple choice options to the player
- **One-shot events**: Some events can only occur once per player and are permanently marked as fired
- **Event chains**: Some events may trigger additional events or choices in sequence
- **Global effects**: Player events typically affect the entire civilization rather than individual cities

**Event lifecycle:**

- **EventActivated**: Fired when an event initially starts and becomes active
- **EventChoiceActivated**: Fired when the player is presented with choices for the event
- **EventChoiceEnded**: Fired when the player selects a choice and the event concludes

**Event effects:**

- Events can modify civilization-wide yields, policies, or other player properties
- Events may provide temporary or permanent bonuses and penalties
- Events can unlock special units, buildings, technologies, or other game content
- Events may affect diplomatic relationships or trigger other game systems
- Events can influence military capabilities, economic development, or cultural progress

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`, line 6674

**Function Context**: Called within `CvPlayer::DoStartEvent(EventTypes eChosenEvent)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_EventActivated`

**Preconditions**:

- `eChosenEvent` parameter must be a valid event type
- Player event info must exist and be valid in the game database
- Player must have a valid ID

**Event Flow**:

1. `DoStartEvent` is called with a valid player event type
2. Event info is retrieved from the game database
3. Event is marked as fired to track occurrence
4. `GAMEEVENT_EventActivated` hook is invoked with player ID and event ID
5. Event cooldown is calculated based on game speed and applied
6. Event choices are processed and made available to the player
7. Event effects begin to take place according to the event configuration

**Related Events**:

- `EventChoiceActivated`: When the player is presented with event choice options
- `EventChoiceEnded`: When the player makes a choice and the event concludes
- `CityEventActivated`: The city-specific version of event activation
