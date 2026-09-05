# Overview

The `EventChoiceEnded` event is triggered when a player-level event choice expires or is cancelled in Civilization V. This event represents the end of an event choice's duration timer, not when a player makes a decision. The event choice concludes without the player having selected it, and any temporary effects are removed. This marks the expiration/cancellation stage of the event lifecycle.

# Event Triggers

This event is triggered when an event choice's duration timer reaches zero or the choice is manually cancelled.

**Specific trigger conditions:**

- **Duration expiration**: An event choice with a duration timer reaches 0 turns remaining
- **Manual cancellation**: The choice is cancelled through `DoCancelEventChoice` function
- **Espionage cancellation**: Spy missions or counterspy actions that cancel ongoing choices
- **Mutually exclusive conflicts**: When another choice in the same exclusive group becomes active

**Related mechanics that can trigger event choice endings:**

- Turn-by-turn duration countdown reaching zero
- Manual cancellation through Lua scripts or other systems
- Spy/counterspy mission interactions
- Event system cleanup when choices conflict
- Game state changes that invalidate active choices

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player whose event choice expired or was cancelled (from `GetID()`) |
| `eventChoiceID` | integer | The identifier of the specific event choice that expired or was cancelled (`eChosenEventChoice`) |

# Event Details

Event choice endings represent the expiration and cleanup phase of the player event system. When an event choice ends through duration expiration or cancellation, no player decision is implemented - instead, the choice simply expires and any temporary effects are removed.

**Event choice ending mechanics:**

- **Duration expiration**: The choice's turn-based timer reaches zero
- **State cleanup**: The event system removes the active choice and clears related flags
- **Effect removal**: Any temporary bonuses or penalties from the choice duration are removed
- **No reward application**: Unlike player-selected choices, expired choices typically provide no benefits
- **Logging**: The expiration is recorded in the event logging system

**Choice expiration outcomes:**

- **No immediate effects**: Expired choices typically don't grant rewards or penalties
- **State reset**: Related event flags and durations are reset to default values
- **Choice availability**: The choice may become available again in the future (unless it's a one-shot)
- **Opportunity loss**: The player loses the chance to gain benefits from this choice
- **System cleanup**: Event notifications and UI elements are removed

**Event lifecycle conclusion:**

- **EventActivated**: The initial event activation
- **EventChoiceActivated**: When choices were presented to the player
- **EventChoiceEnded**: Final stage where the choice expires without selection and is cleaned up

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`, line 6758

**Function Context**: Called within the `DoCancelEventChoice` function when an event choice expires or is cancelled

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_EventChoiceEnded`

**Preconditions**:

- `eChosenEventChoice` parameter must be a valid event choice type
- The event choice must have been previously activated with a duration
- Player must have a valid ID
- The choice duration has reached 0 or cancellation was triggered

**Event Flow**:

1. Event choice duration timer reaches 0 during turn processing, or manual cancellation occurs
2. `DoCancelEventChoice` function is called with the event choice ID
3. Choice validation occurs to ensure the choice exists and is valid for cancellation
4. `GAMEEVENT_EventChoiceEnded` hook is invoked with player ID and choice ID
5. Event state is cleaned up and the choice duration is reset
6. Any temporary effects from the choice are removed
7. Choice availability flags are updated for future activation
8. Event history is updated to track the expiration/cancellation

**Related Events**:

- `EventActivated`: The initial event that led to this choice
- `EventChoiceActivated`: When the choice options were presented
- `CityEventChoiceEnded`: The city-specific version of event choice endings
