# Overview

The `PantheonFounded` event is triggered when a player successfully founds a pantheon by accumulating enough Faith points and selecting a pantheon belief. Pantheons are the first step in the religious system, providing early bonuses and serving as the foundation for potentially founding a full religion later in the game.

# Event Triggers

This event is triggered in the following scenarios:

- When a player accumulates sufficient Faith points to found a pantheon (varies by game speed and pantheons already founded)
- Upon successful selection and adoption of a pantheon belief
- After the pantheon belief has been assigned to the player and their cities
- Only for major civilizations (not City-States or Barbarians)

# Parameters

The event passes the following parameters:

**Modern Implementation (if MOD_EVENTS_FOUND_RELIGION enabled):**

1. **Player ID** (`ePlayer`) - The unique identifier of the player founding the pantheon
2. **Capital City ID** - The unique identifier of the player's capital city
3. **Religion Type** (`RELIGION_PANTHEON`) - Fixed identifier indicating this is a pantheon
4. **Belief Type** (`eBelief`) - The specific pantheon belief being adopted

**Legacy Implementation:**

1. **Player ID** (`ePlayer`) - The unique identifier of the player founding the pantheon
2. **City ID** - The ID of the capital city (or first city if no capital exists)
3. **Religion Type** (`RELIGION_PANTHEON`) - Fixed identifier for pantheon
4. **Belief Type** (`eBelief`) - The specific pantheon belief being adopted

# Event Details

Pantheons represent the early religious development of civilizations, providing immediate benefits through pantheon beliefs. The founding of a pantheon is significant because:

- **Faith Economy:** It represents the player's first major Faith expenditure and religious milestone
- **Strategic Benefits:** Pantheon beliefs provide ongoing bonuses that can shape early game strategy
- **Religion Foundation:** Pantheons serve as prerequisites for founding full religions later
- **Competitive Element:** Limited pantheon beliefs create competition between civilizations

Key aspects of pantheon founding:

- Each pantheon belief can only be chosen once per game across all players
- The Faith cost increases with each pantheon founded globally
- Pantheons automatically spread to all of the player's existing cities
- The pantheon forms the foundation for any future religion the player might found

The event fires after the pantheon has been successfully established and the minimum Faith cost for the next pantheon has been updated, ensuring all game systems are synchronized before external systems respond.

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (line 1070 for Lua hook, line 1046 for GAMEEVENT hook)

**Triggering Functions:**

- `CvGameReligions::FoundPantheon(PlayerTypes ePlayer, BeliefTypes eBelief)` - Main function handling pantheon founding

**Event Implementation:** The event uses different mechanisms based on mod configuration:

- **Modern Path:** Uses `GAMEEVENT_PantheonFounded` hook if `MOD_EVENTS_FOUND_RELIGION` is enabled
- **Legacy Path:** Uses Lua script hook `PantheonFounded` for backward compatibility

**System Updates:**

- Updates minimum Faith requirement for next pantheon via `SetMinimumFaithNextPantheon()`
- Scales Faith cost based on game speed settings
- Automatically spreads pantheon to all player cities

**Event Hooks:**

```cpp
// Modern implementation
GAMEEVENTINVOKE_HOOK(GAMEEVENT_PantheonFounded, ePlayer, GET_PLAYER(ePlayer).getCapitalCity()->GetID(), RELIGION_PANTHEON, eBelief);

// Legacy implementation
LuaSupport::CallHook(pkScriptSystem, "PantheonFounded", args.get(), bResult);
```

**Safety Measures:**

- Validates player is not a minor civilization or barbarian
- Handles cases where the player has no capital city by using the first available city
- Only fires for valid player states to prevent erroneous events
