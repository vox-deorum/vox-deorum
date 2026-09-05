# Overview

The `StateReligionChanged` event is triggered when a player changes their state religion from one established religion to another. This represents a major shift in governmental religious policy, abandoning the previous official faith in favor of a new one. Such changes often reflect significant political, social, or strategic pressures within the civilization.

# Event Triggers

This event is triggered in the following scenarios:

- When a player changes from one established state religion to a different religion via `SetStateReligion()`
- Upon official governmental switching of religious endorsement
- When transitioning between two different established religions (not from NO_RELIGION)
- During political upheavals or strategic decisions that require religious realignment
- Does NOT trigger when initially adopting a state religion from having none (different event exists for that)

# Parameters

The event passes the following parameters:

1. **Player ID** (`m_pPlayer->GetID()`) - The unique identifier of the player changing their state religion
2. **New State Religion** (`eNewStateReligion`) - The religion being adopted as the new official state faith
3. **Previous State Religion** (`GetStateReligion()`) - The previously established state religion being abandoned

# Event Details

State religion changes represent significant governmental and social upheavals, indicating major shifts in a civilization's religious and political landscape. This type of change typically occurs due to:

- **Religious Pressure:** Overwhelming conversion of the population to a different faith
- **Strategic Necessity:** Political or diplomatic pressures requiring religious realignment
- **Conquest Consequences:** Territorial changes that alter the religious composition
- **Policy Evolution:** Changes in government that necessitate different religious approaches

Key aspects of state religion changes:

- Only fires when changing between two established religions (not from NO_RELIGION)
- Represents abandonment of previous religious commitments
- Often involves significant political and social costs
- May result in temporary instability or unrest
- Usually provides different bonuses based on the new religion

Strategic implications of state religion changes:

- **Diplomatic Realignment:** Affects relationships with civilizations of both old and new faiths
- **Internal Stability:** May cause temporary happiness or unity issues
- **Bonus Transition:** Loss of previous religious bonuses and gain of new ones
- **Religious Competition:** Impacts the global religious landscape

Common consequences of state religion changes include:

- Shifts in yield bonuses and governmental effectiveness
- Changes in religious pressure dynamics within the empire
- Altered diplomatic standings with other civilizations
- Potential population unrest during the transition period

Factors that might drive state religion changes:

- Majority of cities converting to a different religion
- Diplomatic pressure from powerful neighbors
- Strategic benefits offered by the new religion
- Government type changes that favor different religious approaches
- Military conquest requiring religious accommodation

This event is crucial for AI systems because:

- It signals major internal political or religious upheaval
- It indicates potential temporary weakness during transition periods
- It affects diplomatic relationship calculations significantly
- It suggests external pressure or strategic desperation
- It enables prediction of future religious and diplomatic alignments

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (line 3825)

**Triggering Functions:**

- `CvPlayerReligions::SetStateReligion(ReligionTypes eNewStateReligion, bool bOwnsReligion)` - Main function for managing state religion transitions

**Event Conditions:**

- Only triggers when `GetStateReligion() != NO_RELIGION` (changing from an existing state religion)
- Requires `eNewStateReligion != GetStateReligion()` (must be a genuine change)
- Part of the state religion management system in the Community Patch framework

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_StateReligionChanged, m_pPlayer->GetID(), eNewStateReligion, GetStateReligion());
```

**Distinction from StateReligionAdopted:**

- `StateReligionAdopted`: Fires when adopting first state religion (from NO_RELIGION)
- `StateReligionChanged`: Fires when changing from one state religion to another

**System Integration:**

- Updates civilization religious bonuses and penalties
- Triggers diplomatic relationship recalculations
- May cause temporary stability issues during transition
- Updates religious unity and governmental effectiveness

**Related Systems:**

- Happiness and stability systems that may be affected by religious changes
- Diplomatic systems that factor in religious compatibility changes
- Government efficiency systems that depend on religious unity
- Religious pressure systems that both cause and result from state religion changes

**Transition Management:**

- The event fires before the actual change is completed
- `GetStateReligion()` returns the old religion during event processing
- `eNewStateReligion` provides the target religion for the change
- External systems can track both the transition and its direction

**Compilation Requirements:**

- Part of the extended religious and governmental framework
- Integrated with Community Patch religious mechanics
- May interact with happiness, diplomatic, and stability systems
