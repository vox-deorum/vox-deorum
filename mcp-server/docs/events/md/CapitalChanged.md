# Overview

The `CapitalChanged` event is fired whenever a civilization's capital city is changed or established. This event is part of the Community Patch DLL's custom game event system and provides notification when a player's capital city changes due to various game mechanics such as city founding, conquest, or automatic capital relocation.

# Event Triggers

The `CapitalChanged` event is triggered in the following scenarios:

1. **Initial Capital Establishment**: When a player founds their first city, which automatically becomes their capital
2. **City Conquest**: When a player acquires a new city through conquest and it becomes their new capital (either the first capital or replacing a lost one)
3. **City Purchase**: When acquiring cities through diplomatic or special means (such as Venice's Merchant of Venice ability)
4. **Automatic Capital Relocation**: When the current capital is lost or destroyed and the game automatically selects a new capital from the player's remaining cities
5. **First City Foundation**: When a civilization's first city is founded and receives free civilization buildings, including the Palace building (capital building)

The event is only fired when the `MOD_EVENTS_CITY_CAPITAL` custom mod option is enabled in the game configuration.

# Parameters

The event passes three integer parameters to registered event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| `iPlayer` | int | The player ID whose capital is changing |
| `iNewCapital` | int | The city ID of the new capital city |
| `iOldCapital` | int | The city ID of the previous capital city, or -1 if no previous capital existed |

# Event Details

## Parameter Details

- **Player ID (`iPlayer`)**: Identifies which civilization is experiencing the capital change. This corresponds to the player's unique identifier in the game.

- **New Capital ID (`iNewCapital`)**: The unique city identifier for the city that is becoming the new capital. This city will receive all capital-specific benefits and buildings.

- **Old Capital ID (`iOldCapital`)**: The unique city identifier for the previous capital city. This parameter is set to -1 in the following cases:
  - When establishing the first capital (no previous capital existed)
  - When the previous capital was destroyed or lost
  - In certain acquisition scenarios where the old capital reference is not available

## Event Behavior

The event is fired immediately after the capital change has been processed by the game engine, ensuring that:

- The new capital has already been assigned and is accessible via game queries
- Capital-specific buildings have been added to the new capital
- Any capital-related bonuses or penalties have been applied
- The old capital (if it still exists) has had its capital status removed

## Game State Changes

When this event fires, the following changes have already occurred:

1. The player's capital city ID has been updated to reference the new capital
2. Free capital buildings have been added to the new capital city
3. The new capital has been set as non-puppet if it was previously a puppet city
4. Any capital-specific game mechanics have been applied to the new city

# Technical Details

## Source Code Locations

The event is triggered from multiple locations in the Community Patch DLL:

### CvCity.cpp (Line 883)

```cpp
if (iI == iCapitalBuilding && MOD_EVENTS_CITY_CAPITAL)
{
    GAMEEVENTINVOKE_HOOK(GAMEEVENT_CapitalChanged, getOwner(), GetID(), -1);
}
```

Triggered when a civilization's first city is founded and receives free civilization buildings. This occurs specifically when the Palace (capital building) is added to the first city, establishing it as the capital.

### CvPlayer.cpp (Line 4153)

```cpp
if (MOD_EVENTS_CITY_CAPITAL)
    GAMEEVENTINVOKE_HOOK(GAMEEVENT_CapitalChanged, GetID(), pNewCity->GetID(), (pCurrentCapital ? pCurrentCapital->GetID() : -1));
```

Triggered during city acquisition when establishing a new capital.

### CvPlayer.cpp (Lines 4517, 4533)

```cpp
if (MOD_EVENTS_CITY_CAPITAL)
    GAMEEVENTINVOKE_HOOK(GAMEEVENT_CapitalChanged, GetID(), pNewCity->GetID(), -1);
```

Triggered during city acquisition processes where no old capital reference is available.

### CvPlayer.cpp (Line 11400)

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_CapitalChanged, GetID(), pBestCity->GetID(), (pOldCapital ? pOldCapital->GetID() : -1));
```

Triggered during automatic capital relocation (via `findNewCapital()` function).

## Event Definition

The event is defined in the Community Patch DLL as:

```cpp
#define GAMEEVENT_CapitalChanged "CapitalChanged", "iii"
```

The `"iii"` signature indicates three integer parameters, corresponding to the player ID, new capital ID, and old capital ID respectively.

## Integration Notes

- This event requires the `MOD_EVENTS_CITY_CAPITAL` configuration option to be enabled
- The event is part of the broader `MOD_EVENTS_CITY` event system
- Event handlers can be registered via the game's Lua scripting system using `GameEvents.CapitalChanged.Add()`
- The event provides a reliable way to track capital changes for AI decision-making, statistical tracking, or gameplay modifications
