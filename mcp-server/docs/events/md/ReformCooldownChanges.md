# Overview

The `ReformCooldownChanges` event is triggered whenever a player's reform cooldown period is modified. This cooldown mechanism governs the frequency at which civilizations can enact reforms within their governmental or religious systems, preventing rapid successive changes and adding strategic timing considerations to reform implementation.

# Event Triggers

This event is triggered in the following scenarios:

- When a player's reform cooldown is changed via `ChangeReformCooldown()`
- When a player's reform cooldown is set to a new value via `SetReformCooldown()` (unless the `bNoEvent` parameter is true)
- During reform implementation that modifies the cooldown period
- When game mechanics adjust the time remaining before new reforms can be enacted
- As a result of policies, technologies, or special abilities that affect reform timing

# Parameters

The event passes the following parameters:

1. **Player ID** (`GetID()`) - The unique identifier of the player whose reform cooldown has changed
2. **Current Cooldown** (`GetReformCooldown()`) - The current cooldown value in turns remaining before the player can enact new reforms

# Event Details

The reform cooldown system is part of the expanded governmental and religious mechanics in the Community Patch framework. It serves to:

- **Prevent Exploitation:** Limits rapid successive reforms that could be used to exploit game mechanics
- **Add Strategic Depth:** Forces players to carefully time their reforms for maximum effectiveness
- **Create Decision Points:** Makes each reform decision more meaningful due to the waiting period
- **Balance Gameplay:** Ensures that reform-heavy strategies require long-term planning

The cooldown affects various reform-based actions such as:

- Religious reforms and doctrine changes
- Governmental structure modifications
- Policy adjustments in extended government systems
- Special reform abilities from civics or beliefs

Key strategic implications:

- Players must plan reform sequences in advance
- Timing reforms with other strategic actions becomes important
- The cooldown creates windows of vulnerability and opportunity
- Reform acceleration bonuses become more valuable

This event enables AI systems to:

- Track when opponents will be able to enact new reforms
- Plan counter-strategies around reform timing windows
- Optimize their own reform sequences for maximum impact
- Evaluate the effectiveness of reform-based strategies

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvPlayer.cpp` (lines 29586, 29600)

**Triggering Functions:**

- `CvPlayer::ChangeReformCooldown(int iValue)` - Modifies the current cooldown by the specified amount
- `CvPlayer::SetReformCooldown(int iValue, bool bNoEvent)` - Sets the cooldown to a specific value (event suppressed if bNoEvent is true)

**Related Members:**

- `m_iJFDReformCooldown` - Internal member storing the current cooldown value
- `GetReformCooldown()` - Accessor method returning the current cooldown value

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_ReformCooldownChanges, GetID(), GetReformCooldown());
```

**Event Conditions:**

- The event fires whenever the cooldown value changes
- Can be suppressed in `SetReformCooldown()` by setting the `bNoEvent` parameter to true
- Always fires for `ChangeReformCooldown()` calls

**Related Systems:**

- Reform rate system (separate event for rate changes)
- Government and religious reform mechanics
- Policy and civic systems that depend on reform timing
- Strategic AI planning systems that need to track reform availability

**Compilation Requirements:**

- Part of the extended government and religious systems in MOD_BALANCE_CORE
- Integrated with the JFD framework for governmental mechanics
