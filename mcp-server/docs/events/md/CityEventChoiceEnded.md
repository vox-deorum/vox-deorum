# Overview

The `CityEventChoiceEnded` event is triggered when a city event choice's duration expires or is manually cancelled in Civilization V. This event marks the conclusion of an active event choice, typically reversing or completing the effects that were applied when the choice was initially activated. It represents the natural end of a temporary city event effect.

# Event Triggers

This event is triggered when the `DoCancelEventChoice()` function is called on a city with a valid city event choice type.

**Specific trigger conditions:**

- **Duration expiration**: The event choice's duration timer has reached zero through natural turn progression
- **Manual cancellation**: The event choice is manually cancelled through game mechanics or scripting
- **Effect reversal**: The system needs to remove temporary effects that were applied by the event choice
- **Counterspy missions**: Espionage-related event choices that are being cancelled or expired

**Related mechanisms that can trigger event choice ending:**

- Natural turn-by-turn duration countdown reaching zero
- Counterspy operations that cancel ongoing espionage events
- Event system cleanup when choices reach their natural conclusion
- Manual termination through modding or scripting interfaces
- Game state changes that force event choice cancellation

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city where the event choice is ending (from `getOwner()`) |
| `cityID` | integer | The unique identifier of the city where the event choice is concluding (from `GetID()`) |
| `choiceID` | integer | The identifier of the specific event choice that is ending (`eChosenEventChoice`) |

# Event Details

City event choice endings represent the conclusion of temporary or duration-based effects that were applied when players made specific event choices. This event is crucial for maintaining game balance by ensuring that temporary bonuses, penalties, and special effects are properly removed when their intended duration expires.

**Event choice ending mechanics:**

- **Duration reset**: The event choice duration is set to zero to ensure complete termination
- **Effect reversal**: Temporary effects that were applied when the choice was activated are reversed
- **Building removal**: Temporary buildings granted by the event choice are removed from the city
- **Modifier cleanup**: Growth, yield, and other modifiers applied by the choice are reversed
- **State validation**: The system ensures the event choice is properly marked as inactive

**Types of effects that get reversed:**

- **Temporary buildings**: Special buildings added by the event choice are removed
- **Growth modifiers**: Population growth bonuses/penalties are reversed
- **Yield modifiers**: Temporary yield bonuses to food, production, gold, etc., are removed
- **Counter effects**: Various temporary city modifiers are reset to their original values
- **Espionage effects**: Counterspy missions and related effects are concluded

**Expiration conditions:**

- **Natural expiration**: Most event choices have a defined duration and expire automatically
- **Conditional expiration**: Some choices expire when specific conditions are met or change
- **Counterspy expiration**: Espionage-related choices may expire due to spy activities

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 4790

**Function Context**: Called within `CvCity::DoCancelEventChoice(CityEventChoiceTypes eChosenEventChoice)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityEventChoiceEnded`

**Preconditions**:

- `eChosenEventChoice` parameter must not be `NO_EVENT_CHOICE_CITY`
- City event choice info must exist and be valid (`pkEventChoiceInfo != NULL`)
- City must have a valid owner and ID

**Event Flow**:

1. `DoCancelEventChoice` is called with a valid event choice type
2. Event choice info is retrieved from the game database
3. `GAMEEVENT_CityEventChoiceEnded` hook is invoked immediately with player ID, city ID, and choice ID
4. Event choice conclusion is logged if logging is enabled
5. Event choice duration is reset to zero via `ChangeEventChoiceDuration`
6. Effect reversal begins if the choice was active and marked as expiring
7. Temporary buildings are removed if they were granted by the event choice
8. Growth modifiers, yield bonuses, and other temporary effects are reversed
9. City state is updated to reflect the removal of all event choice effects
10. Additional cleanup occurs for specific event choice types

**Effect Reversal Process**:

- **Building removal**: Temporary event buildings are set to 0 count via `SetNumRealBuilding`
- **Growth reversal**: Growth modifiers are reversed by applying the negative of the original bonus
- **Yield reversal**: Various yield modifiers are reversed to their pre-event state
- **Counter reversal**: Specialized counters and modifiers are reset appropriately

**Espionage Integration**:

- Counterspy missions have special handling during event choice ending
- Some espionage-related choices may have different expiration behaviors
- Spy-related effects are properly cleaned up when choices conclude

**Related Events**:

- `CityEventActivated`: The initial event that led to choice options being available
- `CityEventChoiceActivated`: When the choice was initially selected and activated
- `EventChoiceEnded`: The general (non-city-specific) version of event choice ending
