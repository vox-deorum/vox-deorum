# Overview

The `EventChoiceActivated` event is triggered when a player is presented with choices for a player-level event in Civilization V. This event occurs after an event has been activated and the game presents the player with multiple decision options, each potentially leading to different outcomes. This represents the interactive decision-making phase of the event system.

# Event Triggers

This event is triggered when the `DoEventChoice()` function is called on a player with a valid event choice type.

**Specific trigger conditions:**

- **Active event**: A player event must already be active and presenting choices to the player
- **Valid choice info**: The chosen event choice has valid configuration data in the game's event database
- **Choice activation**: The event choice is marked as active and duration is set
- **Decision point**: The player is being presented with options that will determine the event's outcome

**Related mechanics that can trigger event choices:**

- Automatic progression from `EventActivated` when an event has multiple choice options
- Player interaction with event notification UI
- Event chain progression where choices lead to subsequent events
- Scripted or modded event systems that programmatically activate choices

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who is making the event choice (from `GetID()`) |
| `eventChoiceID` | integer | The identifier of the specific event choice being activated (`eEventChoice`) |

# Event Details

Event choices represent the interactive decision-making component of the player event system. When an event choice is activated, the player is presented with narrative context and multiple options, each with different costs, benefits, and consequences that will shape the outcome of the event.

**Event choice mechanics:**

- **Choice duration**: Event choices may have time limits or duration periods before they expire
- **Choice costs**: Each choice option may require different resources, policies, or conditions
- **Choice effects**: Different choices lead to different outcomes affecting the civilization
- **Choice consequences**: Decisions may have immediate and long-term effects on gameplay
- **Multiple options**: Events typically present 2-4 different choice paths to the player

**Choice lifecycle:**

- **EventActivated**: The initial event activation that may lead to choices
- **EventChoiceActivated**: Fired when the player is presented with specific choice options
- **EventChoiceEnded**: Fired when the player selects a choice and the decision is finalized

**Choice effects:**

- Choices can provide different yield bonuses, military units, or buildings
- Choices may affect diplomatic relationships with other civilizations
- Choices can unlock or prevent access to certain technologies or policies
- Choices may trigger additional events or modify ongoing game mechanics
- Choices can have varying risk/reward profiles to encourage strategic thinking

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`, line 8057

**Function Context**: Called within `CvPlayer::DoEventChoice(EventChoiceTypes eEventChoice)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_EventChoiceActivated`

**Preconditions**:

- `eEventChoice` parameter must be a valid event choice type
- Event choice info must exist and be valid in the game database
- Player must have a valid ID
- The parent event must be active and allow choices

**Event Flow**:

1. `DoEventChoice` is called with a valid event choice type
2. Event choice info is retrieved from the game database
3. Event choice duration is calculated based on game speed
4. Choice duration is applied to track how long the choice remains active
5. `GAMEEVENT_EventChoiceActivated` hook is invoked with player ID and choice ID
6. Choice costs are processed and deducted from player resources
7. Choice effects are applied according to the choice configuration
8. UI updates to present the choice options to the player

**Related Events**:

- `EventActivated`: The initial event activation that precedes choice presentation
- `EventChoiceEnded`: When the player makes a final choice and the event concludes
- `CityEventChoiceActivated`: The city-specific version of event choice activation
