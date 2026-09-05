# Overview

The MinorAlliesChanged event is triggered when a city-state's ally relationship with a major civilization changes. This event specifically tracks when a major civilization gains or loses ally status with a city-state, as opposed to the broader friendship status changes.

# Event Triggers

This event is fired from `CvMinorCivAI::DoFriendshipChangeEffects()` when:

- A major civilization's friendship level with a city-state changes enough to cross the ally threshold
- The ally status actually changes (gains or loses ally relationship)
- The game option `MOD_EVENTS_MINORS` is enabled
- Only when there's an actual change in ally status (prevents duplicate notifications)

The ally relationship is determined by friendship thresholds and is exclusive - only one major civilization can be allied with a city-state at a time (unless special mechanics like permanent allies apply).

# Parameters

The event provides five parameters with mixed types (`"iibii"` signature):

1. **Minor Civ Player ID** (`m_pPlayer->GetID()`): The city-state whose ally relationship changed
2. **Major Civ Player ID** (`ePlayer`): The major civilization involved in the ally change
3. **Is Now Ally** (`bNowAllies`): Boolean indicating whether the major civ is now an ally
4. **Old Friendship** (`iOldFriendship`): The previous friendship level (before change)
5. **New Friendship** (`iNewFriendship`): The current friendship level (after change)

# Event Details

The ally system works as follows:

- Only major civilizations above the ally threshold can become allies
- Ally status is exclusive - gaining a new ally removes the previous ally
- The ally relationship provides significant bonuses compared to friendship
- Special mechanics like sphere of influence or permanent allies can override normal ally rules
- War status prevents ally relationships even with sufficient friendship

The event captures both gaining and losing ally status, allowing AI systems to:

- Monitor shifts in city-state allegiances
- Track diplomatic advantages and disadvantages
- Respond to changes in strategic city-state control
- Analyze the effectiveness of influence investment strategies

# Technical Details

**Source Location**: `CvMinorCivAI.cpp` line 12814  
**Event Definition**: `GAMEEVENT_MinorAlliesChanged` with signature `"iibii"`  
**Triggering Function**: `DoFriendshipChangeEffects()`  
**Prerequisites**: `MOD_EVENTS_MINORS` must be enabled

The ally determination logic considers:

- Friendship threshold requirements (`IsFriendshipAboveAlliesThreshold()`)
- War status exclusions
- City-state alive status
- Sphere of influence mechanics
- Permanent ally overrides (`GetPermanentAlly()`)

This event fires in conjunction with friendship change processing but specifically focuses on the higher-tier ally relationship changes rather than general friendship fluctuations.
