# Overview

The `PietyRateChanged` event is triggered when a player's Piety generation rate is modified. The Piety rate determines how much Piety a civilization accumulates per turn, affecting the speed of religious development and the availability of Piety-based actions. This event enables tracking of changes to religious resource generation for strategic analysis.

# Event Triggers

This event is triggered in the following scenarios:

- When a player's Piety generation rate is set to a specific value via `SetPietyRate()`
- When a player's Piety generation rate is modified by a delta amount via `ChangePietyRate()`
- During the adoption of policies, buildings, or technologies that affect Piety generation
- When religious mechanics modify the rate of Piety accumulation
- As a result of government changes or other systems that influence religious resource generation

# Parameters

The event passes the following parameters:

1. **Player ID** (`GetID()`) - The unique identifier of the player whose Piety rate has changed
2. **Current Piety Rate** (`GetPietyRate()`) - The current Piety generation rate per turn before the change
3. **Change Value** (`iValue`) - The amount being set (for SetPietyRate) or the delta amount being applied (for ChangePietyRate)

# Event Details

The Piety rate system governs how quickly civilizations accumulate religious resources, making it a critical component of religious strategy. Changes to Piety rate affect:

- **Resource Planning:** Faster Piety generation enables more frequent religious actions
- **Strategic Timing:** Higher rates allow for quicker accumulation toward Piety-based goals
- **Competitive Advantage:** Superior Piety generation can provide religious superiority
- **Long-term Development:** Consistent rate improvements compound over time

Factors that typically influence Piety rate include:

- Religious buildings and infrastructure
- Government types and policy choices
- Religious beliefs and pantheon bonuses
- Technological advances that enhance spiritual development
- Special abilities from civilizations or leaders

The rate system enables civilizations to optimize their religious development by:

- Investing in rate-enhancing improvements
- Making strategic choices that boost long-term Piety generation
- Balancing immediate Piety expenditure with future generation capacity
- Adapting religious strategies based on generation capabilities

This event is valuable for AI systems to:

- Evaluate long-term religious potential of civilizations
- Plan optimal timing for Piety-dependent actions
- Assess the effectiveness of religious development strategies
- Predict future religious resource availability

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvPlayer.cpp` (lines 29494, 29502)

**Triggering Functions:**

- `CvPlayer::SetPietyRate(int iValue)` - Sets Piety rate to a specific value per turn
- `CvPlayer::ChangePietyRate(int iValue)` - Modifies Piety rate by a delta amount

**Related Members:**

- `m_iJFDPietyRate` - Internal member storing the current Piety generation rate
- `GetPietyRate()` - Accessor method returning the current Piety rate per turn
- `GetPiety()` - Related method for current Piety total

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_PietyRateChanged, GetID(), GetPietyRate(), iValue);
```

**Compilation Requirements:**

- Only available when `MOD_BALANCE_CORE` is defined
- Part of the JFD (JFD's Rise to Power) mod integration within Community Patch

**Integration:**

- Works in conjunction with the Piety accumulation system
- Affects the per-turn Piety gain calculations
- Influences the timing and feasibility of religious strategic decisions

**Note:** The event parameter `iValue` represents different things depending on the triggering function:

- In `SetPietyRate()`: the new rate value being set
- In `ChangePietyRate()`: the delta amount being applied to the current rate
