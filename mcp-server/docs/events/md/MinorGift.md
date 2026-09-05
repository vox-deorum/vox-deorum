# Overview

The MinorGift event is triggered when a city-state gives a first contact gift to a major civilization. This event captures the various types of gifts that city-states provide when major civilizations first encounter them, including gold, culture, faith, food, and experience bonuses.

# Event Triggers

This event is fired from `CvMinorCivAI::DoFirstContactWithMajor()` when:

- A major civilization makes first contact with a city-state
- The game options `MOD_GLOBAL_CS_GIFTS` and `MOD_EVENTS_MINORS_GIFTS` are both enabled
- The city-state provides any form of gift during first contact
- The gift calculation and distribution logic completes successfully

This is a one-time event per major civilization per city-state, occurring only on initial diplomatic contact.

# Parameters

The event provides eight parameters with mixed types (`"iiiiibbs"` signature):

1. **Minor Civ Player ID** (`GetPlayer()->GetID()`): The city-state providing the gift
2. **Major Civ Player ID** (`ePlayer`): The major civilization receiving the gift
3. **Gift Value** (`iGift`): The primary gift value (varies by city-state type)
4. **Friendship Boost** (`iFriendshipBoost`): The friendship/influence bonus received
5. **Reserved** (`0`): Currently unused parameter (always 0)
6. **Is First Major Civ** (`bFirstMajorCiv`): Boolean indicating if this is the first major civ to meet this city-state
7. **Reserved** (`false`): Currently unused boolean parameter (always false)
8. **Text Key Suffix** (`szTxtKeySuffix`): String identifier for the gift type/notification text

# Event Details

The gift system varies by city-state type and personality:

**Gift Types by City-State Trait:**

- **Cultured**: Provides culture points and general gifts (iGift = gold + culture + faith)
- **Maritime**: Provides food to cities and general gifts (iGift = general gifts + food)
- **Militaristic**: Provides unit experience and gift value represents unit type

**Personality Modifiers:**

- **Friendly**: 1.5x multiplier on most gifts, 2x unit gifts
- **Hostile**: 0.5x multiplier on most gifts, 0x unit gifts
- **Neutral/Irrational**: Standard gift amounts

**Special Mechanics:**

- First major civilization to meet the city-state receives enhanced bonuses
- Food gifts target the closest city to the city-state (or capital if pre-Medieval era)
- Unit experience bonuses scale with player's current era
- Maritime food gifts only apply if the major civilization has a capital city

# Technical Details

**Source Location**: `CvMinorCivAI.cpp` line 5227  
**Event Definition**: `GAMEEVENT_MinorGift` with signature `"iiiiibbs"`  
**Triggering Function**: `DoFirstContactWithMajor()`  
**Prerequisites**: Both `MOD_GLOBAL_CS_GIFTS` and `MOD_EVENTS_MINORS_GIFTS` must be enabled

**Gift Calculation Logic:**

- Base gifts determined by city-state trait and game constants
- Modified by city-state personality (friendly/hostile/neutral)
- Enhanced for first major civilization contact
- Different gift types processed differently (immediate vs. targeted delivery)

This event occurs alongside first contact notifications, UI updates, and quest seeding, making it part of the comprehensive first contact experience between major civilizations and city-states.
