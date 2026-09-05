# Overview

The `StateReligionAdopted` event is triggered when a player adopts their first state religion, transitioning from having no official state religion to establishing one. This represents a major religious and governmental decision that affects the entire civilization through official religious endorsement and associated bonuses.

# Event Triggers

This event is triggered in the following scenarios:

- When a player establishes their first state religion via `SetStateReligion()`
- Upon official governmental adoption of a religion as the state faith
- When transitioning from having no state religion (`NO_RELIGION`) to adopting a specific religion
- During political or religious events that establish official religious endorsement
- Does NOT trigger when changing from one state religion to another (different event exists for that)

# Parameters

The event passes the following parameters:

1. **Player ID** (`m_pPlayer->GetID()`) - The unique identifier of the player adopting the state religion
2. **New State Religion** (`eNewStateReligion`) - The religion being adopted as the official state faith
3. **Previous State Religion** (`GetStateReligion()`) - The previous state religion (should be `NO_RELIGION` for this event)

# Event Details

State religion adoption represents the formal governmental endorsement of a particular faith, creating an official relationship between the state and religion. This decision has significant implications:

- **Official Recognition:** The state formally recognizes and endorses a specific religion
- **Governmental Benefits:** State religion often provides bonuses to the entire civilization
- **Religious Unity:** Creates stronger religious identity and potentially improved stability
- **Diplomatic Implications:** Affects relationships with civilizations of different faiths

Key aspects of state religion adoption:

- Only fires when transitioning from no state religion to having one
- Represents a one-time governmental decision with lasting consequences
- Often provides significant bonuses that justify the religious commitment
- May be tied to specific government types or policy choices

Strategic considerations for state religion adoption:

- **Timing:** When to make the commitment versus maintaining religious flexibility
- **Selection:** Choosing the most beneficial religion based on beliefs and spread
- **Diplomatic Impact:** How the choice affects relationships with other civilizations
- **Long-term Benefits:** Weighing immediate bonuses against future opportunities

Common effects of state religion adoption include:

- Bonuses to specific yields or game mechanics
- Enhanced religious pressure and unity within the empire
- Improved relationships with civilizations sharing the same faith
- Access to unique governmental or religious mechanics

This event is important for AI systems because:

- It signals a major religious and political commitment
- It indicates the civilization's religious strategic direction
- It affects diplomatic calculations and relationship predictions
- It enables understanding of religious unity and stability factors
- It marks a significant shift in the civilization's identity

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (line 3821)

**Triggering Functions:**

- `CvPlayerReligions::SetStateReligion(ReligionTypes eNewStateReligion, bool bOwnsReligion)` - Main function for establishing state religions

**Event Conditions:**

- Only triggers when `GetStateReligion() == NO_RELIGION` (transitioning from no state religion)
- Requires `eNewStateReligion != GetStateReligion()` (must be a change)
- Part of the state religion system in the Community Patch framework

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_StateReligionAdopted, m_pPlayer->GetID(), eNewStateReligion, GetStateReligion());
```

**Distinction from StateReligionChanged:**

- `StateReligionAdopted`: Fires when adopting first state religion (from NO_RELIGION)
- `StateReligionChanged`: Fires when changing from one state religion to another

**System Integration:**

- Updates civilization religious identity and bonuses
- Affects diplomatic relationship calculations
- Triggers appropriate notifications and messaging systems
- Updates religious unity and stability mechanics

**Related Systems:**

- Government type systems that may require or benefit from state religions
- Belief systems that provide state religion-specific bonuses
- Diplomatic systems that factor in religious compatibility
- Religious pressure and conversion mechanics

**Compilation Requirements:**

- Part of the extended religious and governmental systems
- Integrated with the Community Patch religious mechanics
- May interact with specific government types or policy systems
