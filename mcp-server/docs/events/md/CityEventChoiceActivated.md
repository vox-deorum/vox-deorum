# Overview

The `CityEventChoiceActivated` event is triggered when a player makes a specific choice in response to a city event in Civilization V. This event occurs after a city event has been activated and the player (or AI) selects one of the available response options, committing to a particular course of action that will determine the event's outcome and effects.

# Event Triggers

This event is triggered when the `DoEventChoice()` function is called on a city with a valid city event choice type.

**Specific trigger conditions:**

- **Choice selection**: A player has selected a specific choice for an active city event
- **Valid choice info**: The chosen event choice has valid configuration data in the game's event database
- **Event resolution**: The choice is being processed and its effects are about to be applied
- **One-shot tracking**: If the choice is marked as one-shot, it's flagged as fired to prevent future selection

**Related mechanics that can trigger event choice activation:**

- Player selecting a choice from the city event UI dialog
- AI decision-making systems automatically choosing event responses
- Espionage events where spy actions trigger specific choices
- Scripted or modded event progressions that force specific choices
- Network multiplayer synchronization of event choice decisions

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city making the event choice (from `getOwner()`) |
| `cityID` | integer | The unique identifier of the city where the event choice is being made (from `GetID()`) |
| `choiceID` | integer | The identifier of the specific event choice being activated (`eEventChoice`) |

# Event Details

City event choices represent the player's decision-making opportunities in response to dynamic events that occur in their cities. Once a city event is activated, players are typically presented with multiple response options, each with different potential outcomes, costs, and benefits. This event marks the moment when a player commits to a specific choice path.

**Event choice mechanics:**

- **Choice effects**: Each choice can provide different yields, population changes, building effects, or other gameplay impacts
- **Duration tracking**: Some choices have duration effects that persist for a specified number of turns
- **One-shot choices**: Certain choices can only be selected once and are permanently marked as used
- **Cost requirements**: Choices may require specific resources, gold, or other prerequisites to be selected
- **Espionage integration**: Some event choices can trigger additional effects for spies or their owners

**Choice resolution process:**

- **Choice validation**: The system verifies the choice is valid and available
- **Parent event deactivation**: The originating city event is marked as inactive once a choice is made
- **Effect application**: The chosen option's effects are applied to the city and/or player
- **Cooldown setting**: If the choice has a duration, appropriate cooldowns are applied
- **Logging**: Event choice selection is logged for debugging and analysis purposes

**Related event flow:**

- **CityEventActivated**: The initial event that presents choices to the player
- **CityEventChoiceActivated**: This event when a choice is selected (current)
- **CityEventChoiceEnded**: When the effects of the choice conclude or expire

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 6442

**Function Context**: Called within `CvCity::DoEventChoice(CityEventChoiceTypes eEventChoice, CityEventTypes eCityEvent, bool bSendMsg, int iSpyID, PlayerTypes eSpyOwner)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityEventChoiceActivated`

**Preconditions**:

- `eEventChoice` parameter must not be `NO_EVENT_CHOICE_CITY`
- City event choice info must exist and be valid (`pkEventChoiceInfo != NULL`)
- City must have a valid owner and ID
- Network multiplayer synchronization is handled if `bSendMsg` is true

**Event Flow**:

1. `DoEventChoice` is called with a valid event choice type and optional city event context
2. Network multiplayer message is sent if required, returning early for synchronization
3. Event choice info is retrieved from the game database
4. One-shot choices are flagged as fired to prevent re-selection
5. Parent city events are deactivated (either specific event or all related events)
6. Choice effects are logged if logging is enabled
7. Event choice duration and cooldowns are calculated and applied based on game speed
8. `GAMEEVENT_CityEventChoiceActivated` hook is invoked with player ID, city ID, and choice ID
9. Espionage-related event choices may trigger additional player events for spy owners
10. Choice effects are applied to the city and game state

**Network Integration**:

- Multiplayer games use `NetMessageExt::Send::DoCityEventChoice` for synchronization
- Message includes owner, city ID, choice ID, event context, and espionage data
- Ensures all players see consistent event choice results

**Related Events**:

- `CityEventActivated`: The initial city event that provides choice options
- `CityEventChoiceEnded`: When the duration or effects of the choice conclude
- `EventChoiceActivated`: The general (non-city-specific) version of event choice activation
