# Overview

The LoyaltyStateChanged event is triggered when a city's loyalty state changes in the Community Balance Patch's loyalty system. This event tracks changes in the city's loyalty level, which can affect city behavior and gameplay mechanics.

# Event Triggers

This event is fired from `CvCity::SetLoyaltyState()` when:

- The loyalty state of a city is explicitly changed through the `SetLoyaltyState()` method
- The new loyalty state value differs from the current loyalty state
- Called from Lua scripts or other game systems that modify city loyalty

The event is only triggered when there is an actual change in the loyalty state value, preventing duplicate notifications.

# Parameters

The event provides four integer parameters:

1. **Player ID** (`getOwner()`): The player who owns the city
2. **City ID** (`GetID()`): The unique identifier of the city whose loyalty changed
3. **Old Loyalty State** (`iOldLoyalty`): The previous loyalty state value
4. **New Loyalty State** (`iLoyalty`): The current loyalty state value

# Event Details

The loyalty state system uses the `LoyaltyStateTypes` enumeration with these possible values:

- `NO_LOYALTY_TYPE` (-1): Invalid/no loyalty state
- `LOYALTY_JFD_NEUTRAL` (0): Neutral loyalty state
- `LOYALTY_JFD_PATRIOTIC` (1): Patriotic loyalty state
- `LOYALTY_JFD_ALLEGIANT` (2): Allegiant loyalty state
- `LOYALTY_JFD_REBELLIOUS` (3): Rebellious loyalty state
- `LOYALTY_JFD_SEPARATIST` (4): Separatist loyalty state

The event captures transitions between these states, allowing AI systems to track city loyalty changes and respond accordingly. This is particularly useful for monitoring:

- Cities becoming more loyal or disloyal over time
- Effects of player actions on city loyalty
- Strategic implications of loyalty changes across an empire

# Technical Details

**Source Location**: `CvCity.cpp` line 34862  
**Event Definition**: `GAMEEVENT_LoyaltyStateChanged` with signature `"iiii"`  
**Storage Field**: `m_iLoyaltyStateType` (integer member variable)  
**Access Methods**:

- `GetLoyaltyState()`: Returns current loyalty state
- `SetLoyaltyState(int)`: Sets loyalty state and triggers event if changed
- `HasLoyaltyState(int)`: Checks if city has specific loyalty state

The loyalty state is persisted in save games and synchronized in multiplayer through the `SYNC_ARCHIVE_VAR` system.
