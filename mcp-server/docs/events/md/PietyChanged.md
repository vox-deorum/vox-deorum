# Overview

The `PietyChanged` event is triggered when a player's Piety value is modified. Piety is a religious resource in the Community Patch framework that affects religious mechanics, government systems, and various gameplay elements. This event enables tracking of piety accumulation and expenditure for strategic religious and political planning.

# Event Triggers

This event is triggered in the following scenarios:

- When a player's Piety value is set to a specific amount via `SetPiety()`
- When a player's Piety value is modified by a delta amount via `ChangePiety()`
- During religious activities that grant or consume Piety points
- When game mechanics adjust Piety levels due to buildings, policies, or other effects
- After automatic clamping to stay within game speed-defined minimum and maximum values

# Parameters

The event passes the following parameters:

1. **Player ID** (`GetID()`) - The unique identifier of the player whose Piety has changed
2. **Current Piety** (`GetPiety()`) - The current total Piety value before the change
3. **Change Value** (`iValue`) - The amount being set (for SetPiety) or the delta amount being applied (for ChangePiety)

# Event Details

Piety represents a player's religious devotion and spiritual influence, functioning as a resource that can be accumulated and spent on various religious and governmental mechanics. The Piety system provides:

- **Religious Authority:** Higher Piety levels can enhance religious spread and effectiveness
- **Government Stability:** Piety affects the stability and effectiveness of certain government types
- **Special Actions:** Some mechanics may require Piety expenditure for powerful religious effects
- **Balance Mechanism:** Piety provides an alternative resource economy beyond Faith for religious gameplay

Key aspects of the Piety system:

- Piety values are automatically clamped to minimum and maximum values defined by game speed
- The system tracks both accumulation and expenditure of Piety points
- Piety changes can result from buildings, policies, events, or player actions
- The resource integrates with expanded government and religious mechanics

This event is crucial for AI systems to understand:

- Religious resource management and strategic priorities
- Timing for Piety-based actions and decisions
- The relative religious power and capability of civilizations
- Opportunities for religious competition or cooperation

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvPlayer.cpp` (lines 29465, 29473)

**Triggering Functions:**

- `CvPlayer::SetPiety(int iValue)` - Sets Piety to a specific value
- `CvPlayer::ChangePiety(int iValue)` - Modifies Piety by a delta amount

**Value Constraints:**

- Minimum value: `GC.getGame().getGameSpeedInfo().getPietyMin()`
- Maximum value: `GC.getGame().getGameSpeedInfo().getPietyMax()`
- Values are automatically clamped to these bounds

**Related Members:**

- `m_iJFDPiety` - Internal member storing the current Piety value
- `GetPiety()` - Accessor method returning the current Piety amount
- `GetPietyRate()` - Related method for Piety generation rate

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_PietyChanged, GetID(), GetPiety(), iValue);
```

**Compilation Requirements:**

- Only available when `MOD_BALANCE_CORE` is defined
- Part of the JFD (JFD's Rise to Power) mod integration within Community Patch

**Note:** The event parameter `iValue` represents different things depending on the triggering function:

- In `SetPiety()`: the new value being set
- In `ChangePiety()`: the delta amount being applied
