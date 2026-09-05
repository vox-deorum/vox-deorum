# Overview

The `GovernmentCooldownChanges` event is triggered whenever a player's government adoption cooldown period is modified. This cooldown mechanism prevents rapid switching between government types by imposing a waiting period after government changes. The event provides real-time tracking of cooldown modifications, which is essential for AI strategy systems to understand when governments can be changed.

# Event Triggers

This event is triggered in the following scenarios:

- When a player's government cooldown is changed via `ChangeGovernmentCooldown()`
- When a player's government cooldown is set to a new value via `SetGovernmentCooldown()` (unless the `bNoEvent` parameter is true)
- During government adoption mechanics that modify the cooldown period
- When game mechanics adjust the time remaining before a new government can be adopted

# Parameters

The event passes the following parameters:

1. **Player ID** (`GetID()`) - The unique identifier of the player whose government cooldown has changed
2. **Current Cooldown** (`GetGovernmentCooldown()`) - The current cooldown value in turns remaining before the player can adopt a new government

# Event Details

The government cooldown system is part of the expanded government mechanics in the Community Patch framework. When a player changes their government type, a cooldown period is imposed to prevent exploitative rapid switching between different government benefits. This event allows external systems to monitor these cooldown changes for:

- Strategic planning around optimal government switching timing
- AI decision-making regarding when to prepare for government changes
- Tracking government stability and transition periods
- Implementing gameplay mechanics that depend on government cooldown status

The cooldown value represents the number of turns remaining before the player can adopt a new government form. A value of 0 indicates the player can immediately change governments if desired.

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvPlayer.cpp` (lines 29625, 29639)

**Triggering Functions:**

- `CvPlayer::ChangeGovernmentCooldown(int iValue)` - Modifies the current cooldown by the specified amount
- `CvPlayer::SetGovernmentCooldown(int iValue, bool bNoEvent)` - Sets the cooldown to a specific value (event suppressed if bNoEvent is true)

**Related Members:**

- `m_iJFDGovernmentCooldown` - Internal member storing the current cooldown value
- `GetGovernmentCooldown()` - Accessor method returning the current cooldown value

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_GovernmentCooldownChanges, GetID(), GetGovernmentCooldown());
```

The event uses the standard game event system to broadcast cooldown changes to all registered listeners, enabling modular response systems and AI integration.
