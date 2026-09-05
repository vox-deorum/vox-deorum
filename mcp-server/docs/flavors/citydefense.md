# FLAVOR_CITY_DEFENSE

## Overview

`FLAVOR_CITY_DEFENSE` is an AI personality flavor that controls the priority of city-specific defensive infrastructure — walls, castles, fortifications, and defensive wonders. It also heavily influences unit promotion selection (with 2x-3x weighting for garrison-relevant promotions) and religion belief evaluation (city range strike and healing beliefs).

Unlike `FLAVOR_DEFENSE` (which controls army composition balance through `CvMilitaryAI`), CityDefense has **no direct effect** on army composition, tactical combat, or diplomacy. Its primary code paths are unit promotions (`CvUnit.cpp`) and religion belief scoring (`CvReligionClasses.cpp`).

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Turtle/few-cities leaders (Enrico Dandolo): 9
  - Coalition/diplomatic leaders: 8-9
  - Balanced leaders: 5-7
  - Aggressive conquerors: 4

## Code References

### 1. Unit Promotion Selection (CvUnit.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvUnit.cpp` (line 31854+)

**Function:** `CvUnit::AI_promotionValue()`

CityDefense is the most heavily used flavor in promotion evaluation, appearing in 10+ promotion scoring formulas with unique weighting multipliers that distinguish it from both Offense and Defense.

```cpp
int iFlavorCityDefense = range(pFlavorMgr->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_CITY_DEFENSE")), 1, 20);
```

**Key promotion formulas using CityDefense:**

| Promotion type | Formula | CityDefense weight |
| --- | --- | --- |
| Friendly lands combat | `(iFlavorDefense + 2 * iFlavorCityDefense) * 0.3` | **2x** Defense |
| Capital defense | `(3 * iFlavorCityDefense) * 0.2` | **3x exclusive** |
| Friendly lands attack | `(iFlavorDefense + 2 * iFlavorCityDefense) * 0.15` | **2x** Defense |
| Attack above HP threshold | `(iFlavorDefense + 2 * iFlavorCityDefense)` | **2x** Defense |
| Logistics (extra attacks) | `(iFlavorOffense + iFlavorDefense + iFlavorCityDefense) * 20` | 1x (shared) |
| Splash damage | `(iFlavorOffense + iFlavorDefense + iFlavorCityDefense) * 1.5 * Range` | 1x (shared) |
| Tile damage | `(iFlavorOffense + iFlavorDefense + iFlavorCityDefense) * 1.5` | 1x (shared) |
| Terrain/feature attack | `(iFlavorOffense + iFlavorDefense + iFlavorCityDefense) * 0.2` | 1x (shared) |
| Max HP (ranged) | `(iFlavorOffense + iFlavorDefense + iFlavorCityDefense) * 0.5` | 1x (shared) |
| Adjacent unit modifier | `(iFlavorOffense + iFlavorDefense + iFlavorCityDefense)` | 1x (shared) |

**Interpretation:** CityDefense uniquely receives **2x weighting** for friendly-territory and garrison promotions, and **3x exclusive weighting** for capital defense promotions. No other flavor gets this treatment. Leaders with high CityDefense will produce units heavily specialized for defending their own territory — particularly their capital.

### 2. Religion - Belief Evaluation (CvReligionClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (lines 8603, 8652, 10345, 10409-10413)

**Function:** `CvReligionAI::ScoreBeliefAtCity()` and enhanced belief scoring

CityDefense directly drives the valuation of two specific belief types: city range strike modifiers and friendly healing.

**City range strike beliefs (line 8652):**

```cpp
iRtnValue += (pEntry->GetCityRangeStrikeModifier() / 3) *
    MAX(pEntry->GetCityRangeStrikeModifier() / 3, iFlavorCityDefense - iFlavorOffense);
```

**Interpretation:** Beliefs that boost city bombardment are scored using `CityDefense - Offense`. Defensive leaders (high CityDefense, low Offense) value these beliefs much more than aggressive leaders.

**Warmonger neighbor scoring (lines 10407-10413):**

```cpp
if (pEntry->GetFriendlyHealChange() > 0)
{
    iRtnValue += (iFlavorCityDefense + iFlavorDefense) *
        pEntry->GetFriendlyHealChange() * iNumWarmongerNeighbors * (bIsTall ? 2 : 1);
}
if (pEntry->GetCityRangeStrikeModifier() > 0)
{
    iRtnValue += (iFlavorCityDefense + iFlavorDefense) *
        pEntry->GetCityRangeStrikeModifier() * iNumWarmongerNeighbors * (bIsTall ? 2 : 1);
}
```

**Interpretation:** When surrounded by warmonger neighbors, healing and city strike beliefs are scored using `(CityDefense + Defense) * warmonger_count`. Tall civilizations (fewer cities) get a **2x multiplier** on top. A tall, defense-oriented leader with 2 warmonger neighbors could score these beliefs at 4x+ the baseline.

### 3. Policy Weighting - Wartime Boost (CvPolicyClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyClasses.cpp` (line 6219)

Same pattern as FLAVOR_DEFENSE: during war, CityDefense gets a flat +3 bonus for policy evaluation.

```cpp
else if (bIsAtWarWithSomeone && iFlavor == GC.getInfoTypeForString("FLAVOR_CITY_DEFENSE"))
{
    iFlavorValue += 3;
}
```

### 4. Tech Priority for Smaller Civs (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (line 1284)

Unique to CityDefense: leaders with the `IsSmaller()` trait get a tech priority boost for techs with CityDefense flavor.

```cpp
if (m_pPlayer->GetPlayerTraits()->IsSmaller() && (
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_GROWTH" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NAVAL_GROWTH" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_CITY_DEFENSE"))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

**Interpretation:** Civilizations with fewer cities (Venice, etc.) get a tech research boost toward Growth, NavalGrowth, and CityDefense techs. This ensures tall civs prioritize Masonry, Chivalry, Navigation, and other wall/castle techs.

### 5. Policy/Tech Conquest Value Aggregation (CvPolicyAI.cpp, CvTechClasses.cpp)

CityDefense is grouped with Offense, Defense, MilitaryTraining, and other combat flavors in the generic "conquest value" aggregation loops. Policies and techs with CityDefense flavor contribute to conquest-oriented scoring.

### 6. Military Advisor Priority (CvAdvisorRecommender.cpp)

```cpp
// ADVISOR_MILITARY: weight = 9 (vs Offense=17, Defense=16)
// ADVISOR_ECONOMIC / FOREIGN / SCIENCE: weight = 1
```

Moderate military advisor weight (9), minimal for other advisors.

## What CityDefense Does NOT Do (Directly)

- **Tactical combat** (`CvTacticalAI`) — zero references. No effect on HP thresholds, unit loss acceptance, or combat simulation.
- **Army composition** (`CvMilitaryAI`) — zero references. Unlike Defense (which has the `100 + flavor*2` modifier), CityDefense doesn't scale the defensive/offensive unit production ratio.
- **Diplomacy** (`CvDiplomacyAI`) — zero references. No effect on victory pursuit, approach selection, or deal valuation.

CityDefense **does** affect city production and specialization through the generic `FlavorUpdate` pathway shared by all flavors: units and buildings with `FLAVOR_CITY_DEFENSE` entries in their flavor tables (e.g. Walls=20, Castle=25, garrison units) get their production weight boosted when the personality CityDefense value is high. This is the standard mechanism and is marked as "dot" in the subsystem matrix, not unique to CityDefense.

## Dynamic Strategy Modifiers

### Player-Level Military Strategies

| Strategy                                       | FLAVOR_CITY_DEFENSE |
| ---------------------------------------------- | ------------------- |
| `MILITARYAISTRATEGY_AT_WAR`                    | +20                 |
| `MILITARYAISTRATEGY_WINNING_WARS`              | -20                 |
| `MILITARYAISTRATEGY_LOSING_WARS`               | +40                 |
| `MILITARYAISTRATEGY_MINOR_CIV_THREAT_CRITICAL` | +40                 |
| `MILITARYAISTRATEGY_MINOR_CIV_THREAT_ELEVATED` | +25                 |
| `MILITARYAISTRATEGY_MINOR_CIV_GENERAL_DEFENSE` | +10                 |

### City-Level Military Strategies

| Strategy                          | FLAVOR_CITY_DEFENSE |
| --------------------------------- | ------------------- |
| `MILITARYAISTRATEGY_AT_WAR`       | +20                 |
| `MILITARYAISTRATEGY_WINNING_WARS` | -30                 |
| `MILITARYAISTRATEGY_LOSING_WARS`  | +50                 |

### City Strategies

| Strategy                                | FLAVOR_CITY_DEFENSE |
| --------------------------------------- | ------------------- |
| `AICITYSTRATEGY_NEED_HAPPINESS_PILLAGE` | +20                 |

**Comparison with FLAVOR_DEFENSE:** CityDefense modifiers are roughly half the magnitude of Defense modifiers (CityDefense +40 vs Defense +100 for LOSING_WARS at player level). Defense has the more extreme crisis amplification.

## Summary of Effects

### Unit Training (Primary)

- **2x weighting** for friendly-territory and garrison promotions
- **3x exclusive** weighting for capital defense promotions
- Combined with Offense and Defense for general combat promotions
- Makes garrison units highly specialized for territory defense

### Religion

- Drives valuation of city range strike beliefs (scored as `CityDefense - Offense`)
- Drives healing belief scoring with warmonger neighbor multiplier
- Tall civilizations get 2x multiplier on defensive beliefs

### Building Production (Indirect)

- High-flavor buildings: Red Fort (75), Mughal Fort (40), Barbican/Walls of Babylon/Lamassu Gate (30), Military Base (30)
- Flows through generic FlavorUpdate to prioritize defensive buildings

### Tech Research

- Smaller civs get explicit tech priority boost for CityDefense techs
- Key techs: Masonry (20), Chivalry (20), Navigation (20), Radar (20)

## Distinction from FLAVOR_DEFENSE

| Aspect | FLAVOR_DEFENSE | FLAVOR_CITY_DEFENSE |
| --- | --- | --- |
| Army composition | `100 + flavor*2` multiplier | No effect |
| Promotion weighting | 1x base | 2-3x for garrison promotions |
| Belief evaluation | Reduces happiness need | Scores city strike / healing |
| Crisis amplification | +150 max (EMPIRE_DEFENSE_CRITICAL) | +50 max (LOSING_WARS city) |
| Auto-activation | Defense > 60/80 triggers strategies | No auto-activation thresholds |

## Related Flavors

- **FLAVOR_DEFENSE:** Army composition balance; complementary but distinct mechanisms
- **FLAVOR_OFFENSE:** Inverse in belief scoring (`CityDefense - Offense` for city strike beliefs)
- **FLAVOR_RANGED:** Ranged units benefit most from garrison promotions driven by CityDefense
- **FLAVOR_MILITARY_TRAINING:** General military investment; works alongside both defense flavors

## Data Sources

- `CvGameCoreDLL_Expansion2/CvUnit.cpp` (promotion selection — primary)
- `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (belief evaluation)
- `CvGameCoreDLL_Expansion2/CvPolicyClasses.cpp` (wartime policy boost)
- `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (smaller civ tech priority)
- `(1) Community Patch/Database Changes/AI/CoreStrategyChanges.sql` (strategy flavor entries)
- `(2) Vox Populi/Database Changes/AI/BuildingFlavorSweeps.sql` (building flavor values)
