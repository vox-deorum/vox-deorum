# FLAVOR_RECON

## Overview

FLAVOR_RECON is an AI flavor in Civilization V that controls the AI's emphasis on reconnaissance and exploration activities. This flavor influences how aggressively the AI explores the map, discovers new territories, and maintains scouting units. It works in conjunction with FLAVOR_NAVAL_RECON for sea-based exploration.

## Primary Impact

The FLAVOR_RECON flavor primarily affects:

1. **Explorer Unit Production Priority** - How eagerly the AI builds and maintains dedicated scout units
2. **Exploration Strategy Activation** - Threshold for triggering recon-related economic strategies
3. **Map Discovery Emphasis** - How important the AI considers revealing unexplored territory
4. **Advisor Recommendations** - Weighting for recon-related unit suggestions

## Code References

### Economic AI Strategy (CvEconomicAI.cpp)

**Line 2319**: Core calculation for explorer needs

```cpp
int iPlotsPerExplorer = /*20 in CP, 27 in VP*/ GD_INT_GET(MAX_PLOTS_PER_EXPLORER) -
    m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_RECON"));
```

**Purpose**: Determines how many unexplored plots the AI tolerates per explorer unit. Higher FLAVOR_RECON values reduce this threshold, causing the AI to build more explorers.

**Calculation**:

- Base value: 27 plots per explorer (Vox Populi) or 20 (Community Patch)
- Adjusted by: Subtracting the leader's FLAVOR_RECON value
- Example: A leader with FLAVOR_RECON of 7 would target 20 plots per explorer (27 - 7 = 20)
- Higher flavor = more explorers needed = more aggressive exploration

### Recon State Management (CvEconomicAI.cpp)

**Lines 2261-2556**: DoReconState() function

This function runs once per turn and determines the player's reconnaissance state, which can be:

- `RECON_STATE_NEEDED` - Not enough explorers, build more
- `RECON_STATE_NEUTRAL` - Acceptable explorer count
- `RECON_STATE_ENOUGH` - Too many explorers, convert some to combat units

**Key Logic**:

- Counts unexplored border plots (plots adjacent to known territory)
- Counts current exploring units with UNITAI_EXPLORE
- Compares ratio to personality-adjusted threshold
- Can convert non-native combat units to explorers when needed
- Can disband or reassign explorers when exploration is complete

**Special Conditions**:

- Exploration suspended during losing wars
- Exploration demand increases if losing units or seeing many goody huts
- City-states can be exempted from recon strategies via NoMinorCivs flag

### Strategy Triggers (CvEconomicAI.cpp)

**Lines 3464-3478**: IsTestStrategy_NeedRecon()

Determines if the ECONOMICAISTRATEGY_NEED_RECON strategy should activate:

- Blocked if player is a minor civ (when NoMinorCivs is set)
- Blocked if at war (MILITARYAISTRATEGY_AT_WAR is active)
- Returns true only if ReconState == RECON_STATE_NEEDED

**Lines 3481-3484**: IsTestStrategy_EnoughRecon()

Determines if the ECONOMICAISTRATEGY_ENOUGH_RECON strategy should activate:

- Returns true if ReconState == RECON_STATE_ENOUGH
- Signals AI should stop producing scouts and repurpose existing ones

### Naval Reconnaissance (CvEconomicAI.cpp)

**Lines 2455-2556**: Naval recon state management

Parallel system for sea exploration using FLAVOR_NAVAL_RECON:

- Only activates for civilizations with coastal cities
- Uses same plot-per-explorer calculation methodology
- Manages UNITAI_EXPLORE_SEA units
- Special urgency mode when player can cross oceans but has no ocean-capable explorers
- Related strategies: ECONOMICAISTRATEGY_NEED_RECON_SEA, ECONOMICAISTRATEGY_REALLY_NEED_RECON_SEA, ECONOMICAISTRATEGY_ENOUGH_RECON_SEA

### Advisor System (CvAdvisorRecommender.cpp)

**Military Advisor (Line 357-359)**:

- FLAVOR_RECON importance weight: 3
- Low priority compared to combat flavors (RANGED=13, OFFENSE=9)

**Foreign Advisor (Line 435-437)**:

- FLAVOR_RECON importance weight: 13
- High priority - foreign advisor emphasizes exploration for diplomacy

**Science Advisor (Line 477-479)**:

- FLAVOR_RECON importance weight: 11
- High priority - science advisor values map knowledge

This weighting system helps advisors recommend appropriate recon units based on the player's current advisor focus and the unit's flavor values.

### Deal AI (CvDealAI.cpp)

**Lines 2548-2554**: Map trading value adjustment

```cpp
EconomicAIStrategyTypes eNeedRecon = (EconomicAIStrategyTypes) GC.getInfoTypeForString("ECONOMICAISTRATEGY_NEED_RECON");
EconomicAIStrategyTypes eNavalRecon = (EconomicAIStrategyTypes) GC.getInfoTypeForString("ECONOMICAISTRATEGY_NEED_RECON_SEA");
if (eNeedRecon != NO_ECONOMICAISTRATEGY && GetPlayer()->GetEconomicAI()->IsUsingStrategy(eNeedRecon))
{
    iItemValue *= 115;
    iItemValue /= 100;
}
```

**Purpose**: AI values world maps and territory information 15% higher when actively needing reconnaissance. This makes the AI more willing to trade for maps when exploration is a priority.

### Diplomacy AI (CvDiplomacyAI.cpp)

**Lines 28468-28476**: WantsOpenBordersWithPlayer()

```cpp
EconomicAIStrategyTypes eNeedRecon = (EconomicAIStrategyTypes) GC.getInfoTypeForString("ECONOMICAISTRATEGY_NEED_RECON");
EconomicAIStrategyTypes eNeedNavalRecon = (EconomicAIStrategyTypes) GC.getInfoTypeForString("ECONOMICAISTRATEGY_NEED_RECON_SEA");
if (m_pPlayer->GetEconomicAI()->IsUsingStrategy(eNeedRecon))
{
    return true;
}
```

**Purpose**: AI is more eager to secure Open Borders agreements when it needs reconnaissance, allowing explorers to pass through other civilizations' territory.

## Unit Flavor Values

Units with high FLAVOR_RECON values from the database (UnitFlavorSweeps.sql):

### Land Reconnaissance Units

- **UNIT_XCOM_SQUAD**: 20 (highest recon value)
- **UNIT_BANDEIRANTE**: 18 (Brazil unique explorer)
- **UNIT_MARINE**: 18
- **UNIT_KLEPHT**: 17 (Greece unique)
- **UNIT_PARATROOPER**: 16
- **UNIT_COMMANDO**: 14
- **UNIT_SPANISH_CONQUISTADOR**: 14
- **UNIT_BERBER_CAVALRY**: 14
- **UNIT_EXPLORER**: 12
- **UNIT_HOLKAN**: 11 (Maya unique)
- **UNIT_SCOUT**: 10 (basic explorer)
- **UNIT_SHOSHONE_PATHFINDER**: 8
- **UNIT_AMERICAN_MINUTEMAN**: 8
- **UNIT_WARRIOR**: 1 (minimal recon capability)

### Naval Reconnaissance Units

All naval units also have FLAVOR_NAVAL_RECON values, which work with the parallel naval exploration system. See dedicated FLAVOR_NAVAL_RECON documentation for details.

## Leader Personality

From LeaderFlavorSweeps.sql, different leader archetypes have varying FLAVOR_RECON values:

### Conquerors (FLAVOR_RECON: 7)

Leaders: Ashurbanipal, Askia, Attila, Augustus, Darius, Genghis Khan, Gustavus Adolphus, Harald, Montezuma, Napoleon, Oda Nobunaga, Shaka

**Impact**: Moderately aggressive exploration (27 - 7 = 20 plots per explorer). These leaders balance map knowledge with military conquest, needing good reconnaissance for military planning.

### Other Archetypes

The database defines multiple leader personality types (Coalitionists, Diplomats, etc.) with varying FLAVOR_RECON values ranging from 3-7, affecting how aggressively each leader explores the map.

## Gameplay Effects

### High FLAVOR_RECON (7-10)

- Builds scouts earlier and more frequently
- Maintains more explorer units throughout the game
- More willing to convert combat units to exploration role
- Highly values map trades and open borders
- Discovers natural wonders, ruins, and city-states faster
- Better strategic awareness of terrain and enemy positions

### Low FLAVOR_RECON (1-3)

- Builds minimal scouts
- Relies more on city sight radius and incidental exploration
- Slower to discover map features
- Less willing to dedicate resources to pure exploration
- May miss strategic resources or expansion opportunities

### Neutral FLAVOR_RECON (4-6)

- Balanced exploration approach
- Maintains 1-2 explorers in early game
- Scales exploration effort based on available territory
- Standard map discovery pace

## Related Systems

### Exploration Plot Tracking

The Economic AI maintains two lists:

- `m_vPlotsToExploreLand`: Land plots on the frontier between known and unknown
- `m_vPlotsToExploreSea`: Sea plots on the frontier

These are updated from scratch each turn via `UpdateExplorePlotsFromScratch()` and scored using `ScoreExplorePlot()` to guide explorer movement.

### Unit AI Types

- **UNITAI_EXPLORE**: Land-based exploration units
- **UNITAI_EXPLORE_SEA**: Naval exploration units

Units can be dynamically reassigned to/from these roles based on recon state.

### Economic AI Strategies

- **ECONOMICAISTRATEGY_NEED_RECON**: Active when more land explorers needed
- **ECONOMICAISTRATEGY_ENOUGH_RECON**: Active when too many land explorers
- **ECONOMICAISTRATEGY_NEED_RECON_SEA**: Active when more naval explorers needed
- **ECONOMICAISTRATEGY_REALLY_NEED_RECON_SEA**: Urgent need for ocean-going explorers
- **ECONOMICAISTRATEGY_ENOUGH_RECON_SEA**: Active when too many naval explorers

### Grand Strategy Integration

The flavor is accessed via:

```cpp
GetGrandStrategyAI()->GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_RECON"))
```

This combines the leader's base personality flavor with modifiers from the active Grand Strategy (Conquest, Science, Culture, Diplomacy), providing dynamic adjustment based on strategic situation.

## Technical Notes

### Recon State Enum

```cpp
enum ReconState
{
    NO_RECON_STATE = -1,
    RECON_STATE_ENOUGH,    // 0 - Too many explorers
    RECON_STATE_NEUTRAL,   // 1 - Acceptable number
    RECON_STATE_NEEDED,    // 2 - Need more explorers
};
```

### Persistence

Recon state is saved/loaded with game state via serialization (lines 353-354 in CvEconomicAI.cpp), ensuring exploration strategies persist across save/load cycles.

### Turn Order

`DoReconState()` is called early in the Economic AI turn processing (line 515), before strategy evaluation, ensuring recon strategies are based on current exploration needs.

## Summary

FLAVOR_RECON is a personality-driven modifier that determines how important map exploration is to an AI civilization. It directly reduces the plots-per-explorer threshold, causing higher-flavor leaders to maintain more scouts and explore more aggressively. The flavor integrates with economic strategies, diplomatic considerations (open borders, map trading), and advisor recommendations to create comprehensive exploration behavior that fits each leader's personality and current strategic situation.

Key equation:

```
Plots Per Explorer = BASE_VALUE - FLAVOR_RECON
More explorers needed when: (Unknown Border Plots / Plots Per Explorer) > Current Explorers
```

This elegant system allows a single personality value to cascade through multiple AI systems, creating emergent exploration behavior that varies meaningfully between leaders.
