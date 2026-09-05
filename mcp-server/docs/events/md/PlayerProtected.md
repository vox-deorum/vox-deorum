# Overview

The PlayerProtected event is triggered when a major civilization pledges to protect a minor civilization (city-state). This event captures the diplomatic relationship change when a major power commits to defending a city-state from potential threats and aggression.

# Event Triggers

This event is triggered when:

- A major civilization successfully pledges protection to a minor civilization
- The major civilization can legally provide protection (passes `CanMajorProtect` validation)
- The MOD_EVENTS_MINORS_INTERACTION mod setting is enabled
- The protection pledge is being established (not revoked)

The event fires immediately after the protection pledge is recorded and timestamped.

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `eMajor` | PlayerID | The player ID of the major civilization pledging protection |
| `GetPlayer()->GetID()` | PlayerID | The player ID of the minor civilization being protected |

# Event Details

The PlayerProtected event represents a significant diplomatic action in the relationship between major and minor civilizations. When a major civilization pledges protection to a city-state, it establishes a formal commitment to defend that city-state against aggression from other players.

This protection pledge has several implications:

- Creates a diplomatic obligation for the major civilization
- May influence other players' decisions to attack the protected city-state
- Affects the relationship dynamics between the major and minor civilizations
- Can impact diplomatic standings with other major civilizations

The event provides the essential information needed to track these protection relationships: the identity of both the protector (major civilization) and the protected (minor civilization).

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvMinorCivAI.cpp` (Line 13667)

**Conditional Compilation**: This event is only available when `MOD_EVENTS_MINORS_INTERACTION` is defined and enabled.

**Execution Context**: The event is invoked:

- After protection eligibility validation (`CanMajorProtect` check)
- After recording the pledge timestamp (`SetTurnLastPledgedProtectionByMajor`)
- Within the protection status update logic

**Game State**: The event fires during the process of establishing protection, ensuring that the protection relationship is officially recorded when the event is triggered.
