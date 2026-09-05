# Overview

The `GovernmentCooldownRateChanges` event is triggered whenever a player's government cooldown rate modifier is changed. This rate affects how quickly the government cooldown period decreases each turn, allowing for acceleration or deceleration of the time required before a new government can be adopted. The event enables external systems to track changes in government transition speed modifiers.

# Event Triggers

This event is triggered in the following scenarios:

- When a player's government cooldown rate is modified via `ChangeGovernmentCooldownRate()`
- When a player's government cooldown rate is set to a new value via `SetGovernmentCooldownRate()`
- During gameplay mechanics that affect how quickly government cooldowns expire
- When bonuses, penalties, or effects modify the rate at which government transitions become available

# Parameters

The event passes the following parameters:

1. **Player ID** (`GetID()`) - The unique identifier of the player whose government cooldown rate has changed
2. **Rate Change Value** (`iValue`) - The amount by which the cooldown rate is being modified (positive values speed up cooldown reduction, negative values slow it down)

# Event Details

The government cooldown rate system provides a mechanism to modify how quickly players can transition between different government types. While the base cooldown represents a fixed waiting period, the cooldown rate acts as a multiplier or modifier that can:

- Accelerate government transitions through positive rate bonuses
- Slow down government transitions through negative rate penalties
- Reflect the influence of policies, technologies, or special circumstances on governmental stability

This event is crucial for AI systems to understand:

- When government flexibility will increase or decrease
- The impact of certain game mechanics on political adaptability
- Strategic timing for government-dependent actions
- Long-term planning around government transition availability

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvPlayer.cpp` (lines 29645, 29654)

**Triggering Functions:**

- `CvPlayer::ChangeGovernmentCooldownRate(int iValue)` - Modifies the current cooldown rate by the specified amount
- `CvPlayer::SetGovernmentCooldownRate(int iValue)` - Sets the cooldown rate to a specific value

**Related Members:**

- `m_iJFDGovernmentCooldownRate` - Internal member storing the current cooldown rate modifier
- `GetGovernmentCooldownRate()` - Accessor method returning the current cooldown rate

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_GovernmentCooldownRateChanges, GetID(), iValue);
```

**Note:** Unlike the base cooldown event, this event passes the change value (`iValue`) rather than the current total rate, allowing listeners to track incremental modifications to the rate system.
