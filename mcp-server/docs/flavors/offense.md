# FLAVOR_OFFENSE

## Overview

`FLAVOR_OFFENSE` is an AI personality flavor that controls how aggressively a civilization's leader prioritizes offensive military capabilities and actions. This flavor fundamentally shapes the AI's approach to warfare, military production, and combat tactics, influencing everything from unit production priorities to tactical decision-making in battle.

Unlike `FLAVOR_DEFENSE` (which focuses on protection and defensive units), `FLAVOR_OFFENSE` specifically drives the AI's **willingness to build offensive military power and use it aggressively** in both strategic planning and tactical execution.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Highly aggressive warmongers: 8-10
  - Moderate military leaders: 5-7
  - Defensive/peaceful leaders: 2-4
  - Pacifist leaders: 0-2

## Code References

### 1. Military Advisor Recommendation Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (line 341)

**Function:** Advisor flavor weighting system

When the Military Advisor evaluates recommendations, FLAVOR_OFFENSE receives the highest priority weight among all military flavors.

```cpp
case ADVISOR_MILITARY:
    if(strFlavorName == "FLAVOR_OFFENSE")
    {
        return 17;  // Highest priority for military advisor
    }
    else if(strFlavorName == "FLAVOR_DEFENSE")
    {
        return 16;
    }
```

**Interpretation:** FLAVOR_OFFENSE is the most important flavor for military recommendations, scoring 17 out of possible priority values. This makes offensive capabilities the primary consideration when the military advisor suggests actions to the player, slightly outweighing even defensive concerns (16).

### 2. City Specialization - Military Training Weight (CvCitySpecializationAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCitySpecializationAI.cpp` (lines 546-552)

**Function:** `CvCitySpecializationAI::LogSpecializationUpdate()`

FLAVOR_OFFENSE directly influences how cities specialize for long-term military production.

```cpp
int iFlavorOffense = m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_OFFENSE"));
if (iFlavorOffense < 0) iFlavorOffense = 0;

// LONG-TERM MILITARY BUILD-UP
iMilitaryTrainingWeight += iFlavorOffense * /*10*/ GD_INT_GET(AI_CITY_SPECIALIZATION_PRODUCTION_TRAINING_PER_OFFENSE);
```

**Interpretation:** Each point of FLAVOR_OFFENSE adds 10 weight to the military training specialization (configurable via `AI_CITY_SPECIALIZATION_PRODUCTION_TRAINING_PER_OFFENSE`). A leader with FLAVOR_OFFENSE = 8 would add 80 points toward specializing cities for continuous military unit production, ensuring a steady stream of offensive units even during peacetime.

### 3. City Specialization - Grand Strategy Boost (CvCitySpecializationAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCitySpecializationAI.cpp` (lines 626-634)

**Function:** Grand strategy-based city specialization adjustments

When the active grand strategy provides a production boost, FLAVOR_OFFENSE determines if it should be applied to military training.

```cpp
CvAIGrandStrategyXMLEntry* grandStrategy = GC.getAIGrandStrategyInfo(
    m_pPlayer->GetGrandStrategyAI()->GetActiveGrandStrategy());
if(grandStrategy)
{
    if(grandStrategy->GetSpecializationBoost(YIELD_PRODUCTION) > 0)
    {
        if(grandStrategy->GetFlavorValue((FlavorTypes)GC.getInfoTypeForString("FLAVOR_OFFENSE")) > 0)
        {
            iMilitaryTrainingWeight += grandStrategy->GetSpecializationBoost(YIELD_PRODUCTION);
        }
```

**Interpretation:** If the current grand strategy (e.g., "Conquest") has a positive FLAVOR_OFFENSE value, any production bonuses from that strategy are channeled into military training specialization. This creates synergy between offensive personality traits and offensive grand strategies, amplifying military production when the AI commits to aggressive expansion.

### 4. City Production - Operation Units Priority (CvCityStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCityStrategyAI.cpp` (lines 729-730, 1187-1188)

**Function:** `CvCityStrategyAI::UpdateBuildables()`

FLAVOR_OFFENSE directly affects the production priority of units needed for military operations (invasions, city attacks, etc.).

```cpp
int iTempWeight = /*5000*/ GD_INT_GET(AI_CITYSTRATEGY_OPERATION_UNIT_BASE_WEIGHT);
int iOffenseFlavor = kPlayer.GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_OFFENSE")) +
    kPlayer.GetMilitaryAI()->GetNumberOfTimesOpsBuildSkippedOver();
iTempWeight += iOffenseFlavor * /*250*/ GD_INT_GET(AI_CITYSTRATEGY_OPERATION_UNIT_FLAVOR_MULTIPLIER);
```

**Interpretation:**

- Base weight for operation units: 5000
- Each point of FLAVOR_OFFENSE adds 250 weight (multiplier configurable)
- Additional penalty is added each time the AI skips building operation units, forcing aggressive leaders to eventually fulfill operation requirements
- A leader with FLAVOR_OFFENSE = 8 adds 2000 weight, making operation units 40% more likely to be selected for production

This ensures that aggressive leaders consistently build the units needed for offensive military campaigns, while defensive leaders (low FLAVOR_OFFENSE) may delay or deprioritize these units.

### 5. City Production - Sneak Attack Army Units (CvCityStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCityStrategyAI.cpp` (lines 746-747, 1214-1215)

**Function:** Production priority for pre-war military buildup

When planning sneak attacks or building armies before declaring war, FLAVOR_OFFENSE affects unit production priority.

```cpp
int iTempWeight = /*750*/ GD_INT_GET(AI_CITYSTRATEGY_ARMY_UNIT_BASE_WEIGHT);
int iOffenseFlavor = kPlayer.GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_OFFENSE"));
iTempWeight += iOffenseFlavor * /*250*/ GD_INT_GET(AI_CITYSTRATEGY_OPERATION_UNIT_FLAVOR_MULTIPLIER);
```

**Interpretation:**

- Base weight for army units: 750
- Each FLAVOR_OFFENSE point adds 250 weight
- FLAVOR_OFFENSE = 9 would add 2250 weight, making army units over 3x more likely to be produced

This mechanic enables aggressive leaders to rapidly assemble invasion forces, while cautious leaders (low FLAVOR_OFFENSE) build armies more slowly, potentially telegraphing their intentions less and building fewer standing military units.

### 6. Victory Pursuit - Domination Score (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (line 2382)

**Function:** `CvDiplomacyAI::DoUpdateVictoryPursuitScores()`

FLAVOR_OFFENSE contributes to the AI's preference for domination victory over other victory types.

```cpp
// Weight for conquest
VictoryScores[VICTORY_PURSUIT_DOMINATION] += GetBoldness();
VictoryScores[VICTORY_PURSUIT_DOMINATION] += GetMeanness();
VictoryScores[VICTORY_PURSUIT_DOMINATION] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_OFFENSE")) / 2;
VictoryScores[VICTORY_PURSUIT_DOMINATION] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_EXPANSION")) / 2;
```

**Interpretation:** FLAVOR_OFFENSE contributes half its value to domination victory pursuit score. Combined with boldness, meanness, and expansion flavors, this determines whether the AI will pursue military conquest or focus on diplomatic, cultural, or scientific victories. A leader with FLAVOR_OFFENSE = 10 adds 5 points toward preferring domination victory, making them more likely to pursue aggressive expansion and military dominance throughout the game.

### 7. Victory Blocks - City State Aggression (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (line 32227)

**Function:** Victory block calculation related to city-state interaction

FLAVOR_OFFENSE influences how the AI values and targets city-states.

```cpp
int iOffenseFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_OFFENSE"));
```

**Interpretation:** This flavor is retrieved as part of calculating whether to block opponents' diplomatic victory attempts by conquering or bullying city-states. Leaders with high FLAVOR_OFFENSE are more likely to use military force against city-states as a strategic tool, both for expansion and to deny diplomatic leverage to competitors.

### 8. Grand Strategy Priority - Policy Flavor Bonus (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 618-621)

**Function:** Grand strategy priority calculation based on adopted policies

When a player has adopted social policies with FLAVOR_OFFENSE values, it increases the priority of offensive-focused grand strategies.

```cpp
for (int iFlavorLoop = 0; iFlavorLoop < GC.getNumFlavorTypes(); iFlavorLoop++)
{
    if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_OFFENSE")
    {
        iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
    }
```

**Interpretation:** Policies that grant offensive bonuses (military unit production, combat strength, etc.) add their FLAVOR_OFFENSE values to the grand strategy priority calculation. This creates a feedback loop where adopting militaristic policies makes the AI more likely to commit to aggressive grand strategies like Conquest, which in turn influences future policy and production choices.

### 9. Grand Strategy Priority - Building Flavor Bonus (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 707-710)

**Function:** Grand strategy priority based on constructed buildings

Buildings with FLAVOR_OFFENSE values (like barracks, military academies, arsenals) influence grand strategy selection.

```cpp
if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_OFFENSE")
{
    iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop) * 2;
}
```

**Interpretation:** Each offensive military building contributes **double** its FLAVOR_OFFENSE value to offensive grand strategy priority. This rewards the AI for investing in military infrastructure by making it more committed to using that infrastructure for conquest. A player who has built multiple barracks, armories, and military academies across their cities will have significantly increased priority for Conquest grand strategy.

### 10. Military AI - Offense vs Defense Unit Balance (CvMilitaryAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (lines 1820-1825)

**Function:** `CvMilitaryAI::UpdateThreats()`

FLAVOR_OFFENSE directly modifies the balance between offensive and defensive unit production.

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

- Offense modifier = 100 + Boldness + FLAVOR_OFFENSE
- Defense modifier = 100 + (FLAVOR_DEFENSE × 2)
- A leader with FLAVOR_OFFENSE = 8 and Boldness = 7 has offense modifier of 115%, increasing offensive unit weights by 15%
- This creates a fundamental strategic split: defensive leaders focus on garrison units and ranged defenders, while offensive leaders prioritize melee attackers, cavalry, and siege units

The ratio between offensive and defensive unit production becomes increasingly skewed as FLAVOR_OFFENSE increases, with highly aggressive leaders potentially having 150%+ offensive focus while producing minimal defensive units.

### 11. Tactical AI - Combat Aggressiveness (CvTacticalAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTacticalAI.cpp` (lines 10794-10796)

**Function:** `CvTacticalAnalysisMap::FindBestAssignmentsForUnits()`

FLAVOR_OFFENSE fundamentally alters how the AI conducts tactical combat, affecting unit risk tolerance and minimum HP thresholds.

```cpp
int iOffenseFlavor = range(GET_PLAYER(ePlayer).GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_OFFENSE")), 0, 10);
gDefaultUnitLossThreshold = (iOffenseFlavor>6 && vUnits.size()>6) ? 1 : 0;
gMinHpForTactsim = 50 - 2 * iOffenseFlavor;
```

**Interpretation:**

- **Unit Loss Threshold:** Leaders with FLAVOR_OFFENSE > 6 (and more than 6 units) will accept losing 1 unit per turn in tactical combat. Lower offense leaders refuse any unit losses unless forced.
- **Minimum HP for Combat:** Starts at 50 HP, reduced by 2 per FLAVOR_OFFENSE point
  - FLAVOR_OFFENSE = 0: Units won't fight if below 50 HP
  - FLAVOR_OFFENSE = 5: Units fight down to 40 HP (50 - 10)
  - FLAVOR_OFFENSE = 10: Units fight down to 30 HP (50 - 20)

**Tactical Impact:** This is a critical behavioral difference. Aggressive leaders (high FLAVOR_OFFENSE) will:

- Press attacks even with wounded units
- Accept tactical casualties to achieve objectives
- Continue combat engagements when defensive leaders would withdraw
- Create more dynamic and aggressive battlefield behavior

Defensive leaders (low FLAVOR_OFFENSE) will:

- Withdraw damaged units to heal
- Refuse combat unless units are at near-full health
- Preserve forces rather than trading units for objectives
- Create more cautious, conservative tactical play

## Summary of Effects

### Strategic Planning

- **Victory focus:** Directly increases preference for domination victory over diplomatic, cultural, or scientific paths
- **Grand strategy:** Synergizes with Conquest grand strategy, creating feedback loops with military buildings and policies
- **City specialization:** Drives cities to specialize in military production, creating dedicated military production centers

### Military Production

- **Unit priority:** Dramatically increases production weight for offensive military units (up to +2250 weight for high-offense leaders)
- **Operation readiness:** Ensures aggressive leaders consistently build units needed for military campaigns
- **Force composition:** Shifts unit mix toward offensive units (melee, cavalry, siege) over defensive units (archers, anti-air)

### Tactical Behavior

- **Combat aggression:** Lower HP thresholds for combat (30-50 HP minimum based on flavor)
- **Risk tolerance:** Willing to accept unit casualties to achieve objectives (>6 offense accepts 1 loss/turn)
- **Persistence:** Continues fighting with wounded units rather than withdrawing

### Diplomatic Impact

- **City-state relations:** More willing to conquer or bully city-states for strategic advantage
- **Threat assessment:** Combined with other flavors to determine overall military threat level
- **Victory blocking:** More aggressive in using military force to block opponents' victory attempts

## Design Philosophy

FLAVOR_OFFENSE represents the AI's fundamental approach to military power:

1. **Production Investment:** How much to invest in building offensive military capabilities
2. **Strategic Commitment:** How strongly to pursue domination victory over alternatives
3. **Tactical Doctrine:** How aggressively to use military forces in combat

This creates a spectrum of AI personalities:

- **High OFFENSE (8-10):** Aggressive warmongers who build large armies, seek conquest victory, and fight aggressively
- **Moderate OFFENSE (5-7):** Balanced leaders who maintain military strength but don't always seek war
- **Low OFFENSE (2-4):** Defensive leaders who build minimal offensive forces and avoid aggressive wars
- **Pacifist (0-1):** Leaders who avoid military conflict, building defensive units only when necessary

## Related Flavors

- **FLAVOR_DEFENSE:** Opposite focus - garrison units, city defense, fortifications
- **FLAVOR_EXPANSION:** Territorial growth that often precedes or justifies military action
- **FLAVOR_MILITARY_TRAINING:** Overall investment in military infrastructure and unit experience
- **FLAVOR_MOBILE:** Preference for fast-moving cavalry and mounted units
- **FLAVOR_RANGED:** Preference for ranged attack units
- **FLAVOR_USE_NUKE:** Willingness to use nuclear weapons (extreme form of offense)

FLAVOR_OFFENSE typically correlates with FLAVOR_EXPANSION and inversely correlates with FLAVOR_DEFENSE, creating consistent aggressive or defensive personalities. However, they can diverge for nuanced behavior (e.g., expansionist who avoids military conflict, or defensive militarist who builds large armies but rarely attacks).
