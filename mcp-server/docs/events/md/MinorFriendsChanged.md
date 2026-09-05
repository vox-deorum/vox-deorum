# Overview

The MinorFriendsChanged event is triggered when a city-state's friendship relationship with a major civilization changes. This event tracks when a major civilization gains or loses friend status with a city-state, which is the lower tier of positive relationship before ally status.

# Event Triggers

This event is fired from `CvMinorCivAI::DoFriendshipChangeEffects()` when:

- A major civilization's friendship level with a city-state changes enough to cross the friends threshold
- The friendship status actually changes (gains or loses friend relationship)
- The game option `MOD_EVENTS_MINORS` is enabled
- Only when there's an actual change in friend status (prevents duplicate notifications)

The friends relationship is determined by friendship thresholds and is non-exclusive - multiple major civilizations can be friends with the same city-state simultaneously.

# Parameters

The event provides five parameters with mixed types (`"iibii"` signature):

1. **Minor Civ Player ID** (`m_pPlayer->GetID()`): The city-state whose friendship relationship changed
2. **Major Civ Player ID** (`ePlayer`): The major civilization involved in the friendship change
3. **Is Now Friend** (`bNowFriends`): Boolean indicating whether the major civ is now a friend
4. **Old Friendship** (`iOldFriendship`): The previous friendship level (before change)
5. **New Friendship** (`iNewFriendship`): The current friendship level (after change)

# Event Details

The friendship system works as follows:

- Friends status requires crossing a minimum friendship threshold
- Multiple major civilizations can be friends with the same city-state
- Friends status provides moderate bonuses compared to neutral relations
- Friends status is a prerequisite for achieving ally status
- The city-state must be alive for friendship relationships to be active

When friendship is gained, the city-state:

- Marks that the civilization has been friends at least once (`SetEverFriends()`)
- Applies friendship bonuses through `DoSetBonus()`
- May trigger UI notifications unless ally changes are also occurring

When friendship is lost, the city-state:

- Removes friendship bonuses
- Wakes up all units belonging to that player in city-state territory
- Updates diplomatic status displays

# Technical Details

**Source Location**: `CvMinorCivAI.cpp` line 12812  
**Event Definition**: `GAMEEVENT_MinorFriendsChanged` with signature `"iibii"`  
**Triggering Function**: `DoFriendshipChangeEffects()`  
**Prerequisites**: `MOD_EVENTS_MINORS` must be enabled

The friendship determination logic uses:

- `IsFriendshipAboveFriendsThreshold()`: Checks if friendship meets minimum threshold
- `IsFriends()`: Current friendship status tracking
- City-state alive status verification
- Friends vs allies vs neutral status progression

This event typically fires alongside notifications and bonus adjustments, providing comprehensive tracking of city-state diplomatic relationship changes at the friendship tier.
