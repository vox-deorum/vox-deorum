# Overview

The `ReligionReformed` event is triggered when a player adds a Reformation belief to their religion. Reformation beliefs represent the ultimate evolution of religious development, typically available through specific policy trees or special game conditions. These beliefs provide powerful late-game bonuses that can significantly impact victory conditions and strategic capabilities.

# Event Triggers

This event is triggered in the following scenarios:

- When a player adds a Reformation belief to their founded religion via `AddReformationBelief()`
- Upon meeting Reformation belief requirements (typically through policy choices or special abilities)
- After successful selection and integration of a Reformation belief into the religion
- During the late-game religious development phase when Reformation beliefs become available
- Only available to players who have already founded a religion and meet the Reformation requirements

# Parameters

The event passes the following parameters:

1. **Player ID** (`ePlayer`) - The unique identifier of the player adding the Reformation belief
2. **Religion Type** (`eReligion`) - The specific religion being reformed with the new belief
3. **Reformation Belief** (`eBelief1`) - The Reformation belief being added to the religion

# Event Details

Religion reformation represents the pinnacle of religious development, adding powerful late-game beliefs that can reshape civilizations and their victory paths. Reformation beliefs are typically:

- **Highly Powerful:** Provide significant bonuses that can alter game outcomes
- **Restricted Access:** Usually require specific policy choices or civilization abilities
- **Late Game Focus:** Designed to impact late-game strategies and victory conditions
- **Unique Effects:** Often provide bonuses unavailable through other belief types

Key aspects of religion reformation:

- Requires prior founding and often enhancement of a religion
- Typically gated behind policy trees (like Piety or Freedom)
- Each Reformation belief can only be chosen once per game
- The reformed religion gains a significant competitive advantage
- Often provides bonuses specifically relevant to victory conditions

Strategic implications of religion reformation:

- **Victory Path Optimization:** Many Reformation beliefs directly support specific victory types
- **Late Game Power Spike:** Provides significant bonuses when they matter most
- **Religious Dominance:** Reformed religions become significantly more competitive
- **Policy Synergy:** Reformation often synergizes with the policies that enabled it

Common Reformation belief effects include:

- Enhanced religious pressure and spread capabilities
- Bonuses to specific victory conditions (Science, Culture, Domination)
- Powerful economic or military enhancements
- Unique mechanics not available through other means

This event is crucial for AI systems because:

- It signals a major late-game power spike for the reforming civilization
- It indicates significant policy investment in religious trees
- It affects religious competition dynamics in the late game
- It enables prediction of enhanced victory condition pursuit
- It marks access to some of the most powerful religious bonuses available

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (line 1674)

**Triggering Functions:**

- `CvGameReligions::AddReformationBelief(PlayerTypes ePlayer, ReligionTypes eReligion, BeliefTypes eBelief1)` - Main function handling Reformation belief addition

**Requirements:**

- Player must have founded a religion
- Player must not have already added a Reformation belief
- Player must have policies granting Reformation beliefs OR have the `IsReformation()` flag

**Event Conditions:**

- Only fires when `MOD_EVENTS_FOUND_RELIGION` is defined and enabled
- Part of the extended religious events system

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_ReligionReformed, ePlayer, eReligion, eBelief1);
```

**System Updates:**

- Marks the religion as reformed (`m_bReformed = true` in MOD_BALANCE_CORE)
- Updates all cities following the religion with the new belief
- Refreshes player religion data and potentially traits
- Triggers comprehensive notifications to all players

**Related Systems:**

- `HasAddedReformationBelief()` - Tracking system for Reformation belief status
- `GetAvailableReformationBeliefs()` - System for determining available Reformation options
- `ChooseReformationBelief()` - AI system for selecting optimal Reformation beliefs
- Policy systems that grant access to Reformation beliefs

**Policy Integration:**

- Typically requires completion of specific policy branches
- `HasPolicyGrantingReformationBelief()` determines eligibility
- Integrates with the broader policy and religious systems

**Compilation Requirements:**

- Only active when `MOD_EVENTS_FOUND_RELIGION` is defined
- Part of the extended religious event framework
