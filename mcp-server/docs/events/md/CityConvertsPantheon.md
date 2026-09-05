# Overview

The `CityConvertsPantheon` event is triggered when a city converts to following a pantheon belief system. This event is specific to the MOD_ISKA_PANTHEONS modification and handles pantheon-related religious conversions.

# Event Triggers

This event is triggered in one specific scenario:

1. **Initial Pantheon Adoption**: When a city with no previous religious majority (NO_RELIGION) converts to be dominated by a pantheon belief (RELIGION_PANTHEON)

The trigger occurs within the `CvCityReligions::RecomputeFollowers()` method in the Community Patch DLL, which calls the `CvCityReligions::CityConvertsPantheon()` method when the specific conversion condition is met.

# Parameters

The event passes three parameters to event handlers:

| Parameter | Type        | Description                                  |
| --------- | ----------- | -------------------------------------------- |
| Owner     | PlayerTypes | The ID of the player who owns the city       |
| X         | int         | The X coordinate of the city on the game map |
| Y         | int         | The Y coordinate of the city on the game map |

# Event Details

The event provides location and ownership information for pantheon conversions:

- **City Location**: The X and Y coordinates allow precise identification of the affected city's position
- **Ownership Context**: The owner parameter identifies which player's city has undergone the pantheon conversion
- **Religious Change**: The event specifically indicates an initial adoption of pantheon beliefs in a previously non-religious city, not a conversion from another religion

The event occurs as part of the religious conversion process within `RecomputeFollowers()` and is fired after the city's religious state has been updated to reflect the pantheon becoming the majority religion.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp`

**Trigger Location**:

- Line 5399-5401: Condition check in `CvCityReligions::RecomputeFollowers()`
- Line 5748: Event firing in `CvCityReligions::CityConvertsPantheon()`

**Event System**: Uses the Lua scripting hook system via `LuaSupport::CallHook()`

**Modification Dependency**: This event is conditionally compiled and only available when `MOD_ISKA_PANTHEONS` is defined, indicating it's part of a specific gameplay modification.

**Context**: The event is part of the extended pantheon system that tracks when cities first adopt pantheon beliefs from a non-religious state. This is distinct from the broader `CityConvertsReligion` event and provides specific tracking for initial pantheon adoption scenarios.
