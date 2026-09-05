# Overview

The `ReligionEnhanced` event is triggered when a player successfully enhances their founded religion by adding enhancer beliefs. Religion enhancement is the second major step in religious development, occurring after founding a religion, and provides additional powerful beliefs that significantly strengthen the religion's capabilities and spread.

# Event Triggers

This event is triggered in the following scenarios:

- When a player spends Faith to enhance their founded religion with enhancer beliefs
- Upon successful selection and addition of enhancer beliefs to an existing religion
- After the enhancer beliefs have been integrated into the religion and applied to all cities
- During the religion enhancement process via Great Prophets or Faith expenditure
- Only for players who have previously founded a religion that is eligible for enhancement

# Parameters

The event passes the following parameters:

**Modern Implementation (if MOD_EVENTS_FOUND_RELIGION enabled):**

1. **Player ID** (`ePlayer`) - The unique identifier of the player enhancing the religion
2. **Religion Type** (`eReligion`) - The specific religion being enhanced
3. **First Enhancer Belief** (`eBelief1`) - The first enhancer belief being added
4. **Second Enhancer Belief** (`eBelief2`) - The second enhancer belief being added

**Legacy Implementation:**

1. **Player ID** (`ePlayer`) - The unique identifier of the player enhancing the religion
2. **Religion Type** (`eReligion`) - The specific religion being enhanced
3. **First Enhancer Belief** (`eBelief1`) - The first enhancer belief being added
4. **Second Enhancer Belief** (`eBelief2`) - The second enhancer belief being added

# Event Details

Religion enhancement represents a major milestone in religious development, transforming a basic founded religion into a more powerful and competitive faith. The enhancement process involves:

- **Enhancer Beliefs:** Adding two powerful beliefs that provide significant bonuses
- **Religious Strength:** Enhanced religions become more effective at spreading and competing
- **Strategic Depth:** Enhancer beliefs often provide unique strategic advantages
- **Faith Investment:** Significant Faith cost represents a major resource commitment

Key aspects of religion enhancement:

- Only available to civilizations that have already founded a religion
- Requires substantial Faith expenditure, typically through Great Prophets
- Each enhancer belief can only be chosen once per game across all religions
- Enhanced religions gain significant competitive advantages in religious conflict
- The enhancement is permanent and affects all cities following the religion

Benefits of religion enhancement include:

- More effective religious spread and pressure
- Unique gameplay bonuses based on chosen enhancer beliefs
- Increased competitiveness against other religions
- Access to advanced religious strategies and victory paths

This event is critical for AI systems because:

- It signals a major increase in a civilization's religious power
- It indicates substantial Faith investment and religious commitment
- It affects religious competition dynamics across the game
- It enables prediction of future religious strategies and capabilities

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (lines 1493, 1507)

**Triggering Functions:**

- `CvGameReligions::EnhanceReligion(PlayerTypes ePlayer, ReligionTypes eReligion, BeliefTypes eBelief1, BeliefTypes eBelief2, bool bNotify, bool bSetAsEnhanced)` - Main function handling religion enhancement

**Event Implementation:** The event uses different mechanisms based on mod configuration:

- **Modern Path:** Uses `GAMEEVENT_ReligionEnhanced` hook if `MOD_EVENTS_FOUND_RELIGION` is enabled
- **Legacy Path:** Uses Lua script hook `ReligionEnhanced` for backward compatibility

**System Updates:**

- Updates all cities following the religion with new enhancer beliefs
- Refreshes player religion data and trait systems
- Triggers appropriate notifications to all players
- Updates religious competition and pressure systems

**Event Hooks:**

```cpp
// Modern implementation
GAMEEVENTINVOKE_HOOK(GAMEEVENT_ReligionEnhanced, ePlayer, eReligion, eBelief1, eBelief2);

// Legacy implementation
LuaSupport::CallHook(pkScriptSystem, "ReligionEnhanced", args.get(), bResult);
```

**Related Systems:**

- `UpdateAllCitiesThisReligion()` - Updates all cities with the enhanced religion
- `UpdateReligion()` - Refreshes player religious data
- `InitPlayerTraits()` - Updates civilization traits affected by religious beliefs
- Religious pressure and spread mechanics enhanced by the new beliefs
