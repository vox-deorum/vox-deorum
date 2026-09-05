# Overview

The PlayerRevoked event is triggered when a major civilization revokes their pledge of protection from a minor civilization (city-state). This event captures the diplomatic relationship change when a major power withdraws their commitment to defend a city-state, potentially breaking a previous protection agreement.

# Event Triggers

This event is triggered when:

- A major civilization revokes protection from a minor civilization
- The protection status is being set to false (protection is being removed)
- The MOD_EVENTS_MINORS_INTERACTION mod setting is enabled
- The revocation may or may not involve breaking an existing pledge

The event fires after any friendship penalties are applied but before the protection status is officially updated.

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `eMajor` | PlayerID | The player ID of the major civilization revoking protection |
| `GetPlayer()->GetID()` | PlayerID | The player ID of the minor civilization losing protection |
| `bPledgeNowBroken` | Boolean | Whether this action breaks an existing protection pledge |

# Event Details

The PlayerRevoked event represents the termination of a protection agreement between a major and minor civilization. This action can have significant diplomatic and strategic consequences depending on whether it breaks an existing pledge.

When `bPledgeNowBroken` is true, it indicates that the major civilization is dishonoring a previous commitment, which typically results in:

- Friendship penalties with the affected city-state
- Potential diplomatic consequences with other civilizations
- Reputation damage for breaking international agreements

When `bPledgeNowBroken` is false, the revocation may be occurring without breaking a formal pledge, such as when protection naturally expires or is mutually dissolved.

The event provides complete context for tracking these diplomatic changes, including the identities of both parties and the nature of the revocation (whether it constitutes pledge-breaking or not).

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvMinorCivAI.cpp` (Line 13685)

**Conditional Compilation**: This event is only available when `MOD_EVENTS_MINORS_INTERACTION` is defined and enabled.

**Execution Context**: The event is invoked:

- After potential friendship penalties are applied (when `bPledgeNowBroken` is true)
- After recording pledge break timestamp (if applicable)
- Before the final protection status update (`m_abPledgeToProtect[eMajor] = bProtect`)

**Game State**: The event fires during the protection revocation process, after consequences have been applied but before the official status change is recorded.
