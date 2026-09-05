# FLAVOR_DEFENSE

## Overview

`FLAVOR_DEFENSE` is an AI personality flavor that controls how strongly a civilization's leader prioritizes defensive military capabilities. This flavor shapes the AI's army composition balance, promotion choices for units, and crisis response, but unlike `FLAVOR_OFFENSE` it does **not** directly affect tactical combat behavior (HP thresholds, unit loss acceptance).

The primary effect is through `CvMilitaryAI`, where Defense scales the weight of defensive unit production relative to offensive units, and through dynamic strategy modifiers that amplify Defense massively during wartime crises.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Defensive turtle leaders: 8-10
  - Moderate/balanced leaders: 5-7
  - Aggressive conquerors: 2-4

## Code References

### 1. Military AI - Defense vs Offense Unit Balance (CvMilitaryAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (lines 1818-1825)

**Function:** Army composition weighting

FLAVOR_DEFENSE directly scales the production weight of defensive units (land and naval).

```cpp
int iFlavorDefense = m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DEFENSE"));
int iDefenseModifier = 100 + iFlavorDefense * 2;

int iFlavorOffense = m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_OFFENSE"));
int iOffenseModifier = 100 + m_pPlayer->GetDiplomacyAI()->GetBoldness() + iFlavorOffense;

iLandDefenseWeight = iLandDefenseWeight * iDefenseModifier;
iNavalDefenseWeight = iNavalDefenseWeight * iDefenseModifier;
iTotalOffenseWeight = iTotalOffenseWeight * iOffenseModifier;
```

**Interpretation:**

- Defense modifier = `100 + (FLAVOR_DEFENSE * 2)` — each point adds 2% to defense weight
- Offense modifier = `100 + Boldness + FLAVOR_OFFENSE`
- A leader with FLAVOR_DEFENSE = 8 gets a 116% multiplier on defensive unit weights
- Unlike offense (which also adds Boldness), defense is a pure flavor-driven multiplier

This is the primary mechanism by which Defense shapes army composition: higher Defense means proportionally more garrison units, ranged defenders, and anti-cavalry units relative to melee attackers, cavalry, and siege.

### 2. Unit Promotion Selection (CvUnit.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvUnit.cpp` (line 31853)

**Function:** `CvUnit::AI_promotionValue()`

FLAVOR_DEFENSE biases which promotions the AI selects when units level up.

```cpp
int iFlavorDefense = range(pFlavorMgr->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DEFENSE")), 1, 20);
int iFlavorCityDefense = range(pFlavorMgr->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_CITY_DEFENSE")), 1, 20);
```

**Interpretation:** The flavor value (clamped 1-20) is used as a multiplier when evaluating defensive promotions. Higher Defense means units are more likely to pick promotions that improve fortification bonuses, terrain defense, and damage reduction over offensive promotions like flanking or open-terrain bonuses.

### 3. Religion - Belief Evaluation (CvReligionClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (lines 8602, 10346)

**Function:** `CvReligionAI::ScoreBeliefAtCity()` and related belief scoring

FLAVOR_DEFENSE uniquely acts as a **negative** modifier on happiness priority in belief selection.

```cpp
int iFlavorOffense = pFlavorManager->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_OFFENSE"));
int iFlavorDefense = pFlavorManager->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DEFENSE"));
int iFlavorHappiness = pFlavorManager->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_HAPPINESS"));

int iHappinessNeedFactor = iFlavorOffense * 2 + iFlavorHappiness - iFlavorDefense;
if (iHappinessNeedFactor > 15) iHappinessMultiplier = 15;
else if (iHappinessNeedFactor < 6) iHappinessMultiplier = 6;
```

**Interpretation:** High Defense reduces the happiness multiplier for belief scoring: `Happiness Need = (Offense * 2) + Happiness - Defense`. Defensive leaders value happiness-granting beliefs less, presumably because they expand less aggressively and face fewer happiness pressures. This is the only flavor that acts as a **subtractor** in belief evaluation.

### 4. Policy Weighting - Wartime Boost (CvPolicyClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyClasses.cpp` (line 6215)

**Function:** Policy flavor evaluation during wartime

When the AI is at war, FLAVOR_DEFENSE gets a flat +3 bonus in policy weighting.

```cpp
else if (bIsAtWarWithSomeone && iFlavor == GC.getInfoTypeForString("FLAVOR_DEFENSE"))
{
    iFlavorValue += 3;
}
```

**Interpretation:** During war, policies with FLAVOR_DEFENSE values become more attractive. This nudges wartime policy choices toward defensive bonuses (garrison strength, fortification bonuses, etc.).

### 5. Policy AI - Conquest Value Aggregation (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (line 4916)

**Function:** Generic combat flavor loop for conquest policy weighting

FLAVOR_DEFENSE is grouped with other military flavors (Offense, CityDefense, MilitaryTraining, etc.) when calculating a policy's "conquest value."

```cpp
if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_OFFENSE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_DEFENSE" || ...)
{
    iConquestValue += iFlavorValue;
}
```

**Interpretation:** Policies with Defense flavor contribute to conquest-oriented policy scoring. High Defense doesn't push toward pacifist policies — it pushes toward military policies generally, just the defensive side.

### 6. Tech AI - Conquest Focus (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (line 1256)

**Function:** Tech priority during conquest grand strategy

Same grouping pattern as policies: FLAVOR_DEFENSE is aggregated with other combat flavors to boost military-relevant techs during conquest focus.

### 7. Military Advisor Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (line 345)

```cpp
else if(strFlavorName == "FLAVOR_DEFENSE")
{
    return 16;  // Advisor weight (Offense gets 17)
}
```

**Interpretation:** Second-highest military advisor priority after Offense (17). Defense is the primary defensive recommendation driver.

## What Defense Does NOT Do

Unlike `FLAVOR_OFFENSE`, FLAVOR_DEFENSE has **no direct effect** on:

- **Tactical combat** (`CvTacticalAI`) — only Offense controls HP thresholds and unit loss acceptance. Zero references to FLAVOR_DEFENSE in CvTacticalAI.cpp.
- **City production** (`CvCityStrategyAI`) — Offense has 4 explicit checks driving operation/army unit production weights. Defense has none; it only affects city production indirectly through the generic FlavorUpdate pathway.
- **City specialization** (`CvCitySpecializationAI`) — Offense explicitly drives military training weight. Defense does not.
- **Diplomacy** (`CvDiplomacyAI`) — Offense contributes to domination victory scoring and city-state bullying. Defense has no explicit references.
- **Site evaluation** (`CvSiteEvaluationClasses`) — no reference.

Defense operates through **army composition** (CvMilitaryAI), **unit training** (promotions), **belief evaluation** (happiness reduction), and **strategy modifiers** (SQL), not through the production or tactical layers.

## Dynamic Strategy Modifiers

FLAVOR_DEFENSE has the largest crisis amplification of any flavor. These SQL-defined strategy entries fire automatically during wartime:

### Player-Level Military Strategies

| Strategy                                       | FLAVOR_DEFENSE |
| ---------------------------------------------- | -------------- |
| `MILITARYAISTRATEGY_AT_WAR`                    | +40            |
| `MILITARYAISTRATEGY_WINNING_WARS`              | +30            |
| `MILITARYAISTRATEGY_LOSING_WARS`               | **+100**       |
| `MILITARYAISTRATEGY_WAR_MOBILIZATION`          | +60            |
| `MILITARYAISTRATEGY_EMPIRE_DEFENSE`            | +75            |
| `MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL`   | **+150**       |
| `MILITARYAISTRATEGY_MINOR_CIV_THREAT_CRITICAL` | +80            |
| `MILITARYAISTRATEGY_MINOR_CIV_THREAT_ELEVATED` | +50            |
| `MILITARYAISTRATEGY_MINOR_CIV_GENERAL_DEFENSE` | +30            |

### City-Level Military Strategies

| Strategy                                     | FLAVOR_DEFENSE |
| -------------------------------------------- | -------------- |
| `MILITARYAISTRATEGY_AT_WAR`                  | +40            |
| `MILITARYAISTRATEGY_WINNING_WARS`            | +30            |
| `MILITARYAISTRATEGY_LOSING_WARS`             | **+100**       |
| `MILITARYAISTRATEGY_EMPIRE_DEFENSE`          | +80            |
| `MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL` | **+150**       |

### Economic / City Strategies

| Strategy                              | FLAVOR_DEFENSE |
| ------------------------------------- | -------------- |
| `ECONOMICAISTRATEGY_TOO_MANY_UNITS`   | -100           |
| `ECONOMICAISTRATEGY_LOSING_MONEY`     | -50            |
| `AICITYSTRATEGY_POCKET_CITY`          | +100           |
| `AICITYSTRATEGY_NEW_CONTINENT_FEEDER` | +50            |
| `AICITYSTRATEGY_ENOUGH_SETTLERS`      | +30            |

**Practical impact:** During a critical defense situation (`EMPIRE_DEFENSE_CRITICAL`), the flavor surges by +150 at both player and city level. Combined with `LOSING_WARS` (+100), a leader under extreme pressure can see Defense flavor spike by +250 — dwarfing the base personality value. This massive amplification means that even leaders with low base Defense will turtle heavily when losing.

The LLM sets flavors via `set-flavors`, but these in-game strategy overlays still apply. If the LLM sets Defense=30 (MCP scale) but the player is losing wars, the in-game +100 strategy modifier adds on top, partially counteracting any attempt to keep Defense low.

### Vox Deorum Auto-Activation

When `set-flavors` is called, custom flavor thresholds auto-toggle military strategies:

| Threshold    | Strategy                                     |
| ------------ | -------------------------------------------- |
| Defense > 60 | `MILITARYAISTRATEGY_EMPIRE_DEFENSE`          |
| Defense > 80 | `MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL` |

These fire their own flavor deltas (the tables above), but ignored through VD's flavor override.

## Summary of Effects

### Army Composition (Primary)

- Scales defensive unit production weight by `100 + (flavor * 2)`%
- Higher Defense means more garrison units, ranged defenders, anti-cavalry units
- Combined with Offense modifier to determine army's defensive/offensive balance

### Unit Training

- Biases promotion selection toward defensive promotions (fortification, terrain defense, damage reduction)
- Clamped 1-20 as a multiplier in promotion value calculation

### Religion

- Uniquely **reduces** happiness priority in belief evaluation
- Defensive leaders value happiness-granting beliefs less, faith-granting and military beliefs more

### Strategy Amplification

- Largest crisis modifier of any flavor (+150 for EMPIRE_DEFENSE_CRITICAL)
- Wartime strategies automatically spike Defense, causing defensive production cascade
- Even low-Defense leaders turtle when losing wars

## Related Flavors

- **FLAVOR_OFFENSE:** Complementary but asymmetric — Offense drives tactical combat thresholds, city production, and diplomacy; Defense drives army composition and crisis response
- **FLAVOR_CITY_DEFENSE:** Specializes in city-specific fortification (walls, garrison buildings); Defense covers broader unit production
- **FLAVOR_MILITARY_TRAINING:** General military investment; works alongside both Offense and Defense
- **FLAVOR_RANGED:** Ranged units often serve defensive roles; high Ranged + high Defense creates archer-heavy defensive armies

## Data Sources

- `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (army composition)
- `CvGameCoreDLL_Expansion2/CvUnit.cpp` (promotion selection)
- `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (belief evaluation)
- `CvGameCoreDLL_Expansion2/CvPolicyClasses.cpp` (wartime policy boost)
- `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (conquest policy aggregation)
- `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (conquest tech focus)
- `(1) Community Patch/Database Changes/AI/CoreStrategyChanges.sql` (strategy flavor entries)
