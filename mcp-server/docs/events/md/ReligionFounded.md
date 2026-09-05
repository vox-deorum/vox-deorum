# Overview

The `ReligionFounded` event is triggered when a player successfully founds a religion. Religion founding is a major milestone that transforms a civilization's pantheon into a full religion with additional beliefs, a holy city, and the potential for enhanced religious spread and influence. This event marks one of the most significant religious developments in the game.

# Event Triggers

This event is triggered in the following scenarios:

- When a player uses a Great Prophet to found a religion
- Upon successful selection of founder beliefs and establishment of a holy city
- After Faith expenditure to create a religion from an existing pantheon
- When all religion founding requirements are met and the religion is established
- Only available to civilizations that have previously founded a pantheon

# Parameters

The event passes the following parameters:

**Modern Implementation (if MOD_EVENTS_FOUND_RELIGION enabled):**

1. **Player ID** (`ePlayer`) - The unique identifier of the player founding the religion
2. **Holy City ID** (`pkHolyCity->GetID()`) - The unique identifier of the city designated as the religion's holy city
3. **Religion Type** (`eReligion`) - The specific religion being founded
4. **Pantheon Belief** (`eBelief`) - The pantheon belief carried over from the player's pantheon
5. **Founder Belief 1** (`eBelief1`) - The first founder belief selected
6. **Founder Belief 2** (`eBelief2`) - The second founder belief selected
7. **Follower Belief 1** (`eBelief3`) - The first follower belief selected
8. **Follower Belief 2** (`eBelief4`) - The second follower belief selected

**Legacy Implementation:** Same parameter structure with identical beliefs and identifiers passed through Lua script hook.

# Event Details

Religion founding represents the transformation from pantheon to full religion, creating one of the game's major religious powers. The founding process involves:

- **Holy City Designation:** One city becomes the religion's center and source of pressure
- **Belief Selection:** Addition of multiple powerful beliefs beyond the pantheon
- **Religious Identity:** Creation of a named religion with unique characteristics
- **Competitive Position:** Entry into the global religious competition

Key aspects of religion founding:

- Limited number of religions can be founded per game (typically 4-7 depending on settings)
- Requires significant Faith investment, usually through Great Prophet generation
- Each belief type can only be chosen once across all religions
- The holy city becomes the strongest source of religious pressure for that faith
- Founded religions can later be enhanced with additional beliefs

Strategic implications of religion founding:

- **Religious Victory Path:** Essential for religious victory conditions
- **Cultural Bonuses:** Founder beliefs often provide powerful civilization-wide effects
- **Diplomatic Influence:** Religious spread affects relationships with other civilizations
- **Economic Benefits:** Many religious beliefs provide economic and infrastructure bonuses

This event is crucial for AI systems because:

- It signals the emergence of a major religious power
- It indicates substantial Faith generation and religious investment
- It affects global religious competition dynamics
- It enables prediction of religious spread patterns and conflicts
- It marks access to powerful belief bonuses that can reshape strategies

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (lines 1256, 1274)

**Triggering Functions:**

- `CvGameReligions::FoundReligion(PlayerTypes ePlayer, ReligionTypes eReligion, const char* szCustomName, BeliefTypes eBelief1, BeliefTypes eBelief2, BeliefTypes eBelief3, BeliefTypes eBelief4, CvCity* pkHolyCity)` - Main function handling religion founding

**Event Implementation:** The event uses different mechanisms based on mod configuration:

- **Modern Path:** Uses `GAMEEVENT_ReligionFounded` hook if `MOD_EVENTS_FOUND_RELIGION` is enabled
- **Legacy Path:** Uses Lua script hook `ReligionFounded` for backward compatibility

**Belief Organization:**

- `eBelief` - Inherited pantheon belief
- `eBelief1` & `eBelief2` - Founder beliefs providing civilization-wide bonuses
- `eBelief3` & `eBelief4` - Follower beliefs providing city-specific bonuses

**System Integration:**

- Integrates existing pantheon with new religious structure
- Establishes holy city as primary religious pressure source
- Updates global religious competition and availability
- Triggers notification systems for all players

**Event Hooks:**

```cpp
// Modern implementation
GAMEEVENTINVOKE_HOOK(GAMEEVENT_ReligionFounded, ePlayer, pkHolyCity->GetID(), eReligion, eBelief, eBelief1, eBelief2, eBelief3, eBelief4);

// Legacy implementation
LuaSupport::CallHook(pkScriptSystem, "ReligionFounded", args.get(), bResult);
```

**Post-Founding Effects:**

- Messaging and notifications sent to all players
- Religious pressure systems activated from the holy city
- Belief effects applied to appropriate cities and civilization systems
- Global religion tracking and competition updated
