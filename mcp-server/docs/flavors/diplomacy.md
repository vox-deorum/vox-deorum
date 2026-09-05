# FLAVOR_DIPLOMACY

## Overview

FLAVOR_DIPLOMACY is an AI personality flavor in Civilization V that controls how strongly a civilization's leader prioritizes diplomatic relations, international cooperation, city-state alliances, and pursuit of diplomatic victory. This flavor fundamentally shapes the AI's approach to international relations, influencing diplomatic unit production, embassy placement, city-state interaction, United Nations voting, policy selection, and overall diplomatic posture.

Unlike FLAVOR_OFFENSE (which focuses on military aggression) or FLAVOR_CULTURE (which focuses on cultural influence), FLAVOR_DIPLOMACY specifically drives the AI's commitment to building and maintaining international relationships, securing votes for diplomatic victory, and resolving conflicts through negotiation rather than warfare.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Diplomatic/peaceful leaders: 8-10
  - Balanced leaders: 5-7
  - Military/aggressive leaders: 2-4
  - During warfare: Temporarily reduced by 20-60

### Notable Leaders (from LeaderFlavorSweeps.sql)

- **Enrico Dandolo (Venice):** 10 - Peak diplomatic focus
- **William (Netherlands):** 9 - Only diplomatic victory pursuit
- **Bismarck (Germany):** 10 - Domination leader with diplomatic tendencies
- **Alexander (Greece):** 8 - City-state focused diplomacy
- **Dido (Carthage):** 8 - Primary diplomatic strategy
- **Hiawatha (Iroquois):** 8 - Domination with diplomatic elements
- **Elizabeth (England):** 6 (reduced from 8) - Domination focus

## How FLAVOR_DIPLOMACY Works

### Core Philosophy

FLAVOR_DIPLOMACY represents a leader's fundamental preference for international cooperation over confrontation. High-diplomacy leaders:

- Prioritize production of diplomatic units (Emissaries, Envoys, Diplomats, Ambassadors)
- Place embassies to gain voting power in the World Congress
- Invest heavily in city-state alliances and influence
- Pursue diplomatic victory through vote accumulation
- Reduce diplomatic priorities during military conflicts
- Support World Congress projects and resolutions

## Code References

### 1. Victory Pursuit Assessment (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (line 2390)

**Function:** `CvDiplomacyAI::DoUpdateVictoryPursuitScores()`

FLAVOR_DIPLOMACY is a core component of the diplomatic victory assessment calculation.

```cpp
VictoryScores[VICTORY_PURSUIT_DIPLOMACY] += GetMinorCivCompetitiveness();
VictoryScores[VICTORY_PURSUIT_DIPLOMACY] += GetWorkWithWillingness();
VictoryScores[VICTORY_PURSUIT_DIPLOMACY] += GetDiploBalance() / 2;
VictoryScores[VICTORY_PURSUIT_DIPLOMACY] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DIPLOMACY")) / 2;
```

**Interpretation:** FLAVOR_DIPLOMACY contributes directly to determining whether an AI pursues diplomatic victory. The score is calculated by combining:

- Minor Civ Competitiveness (how aggressively the leader competes for city-states)
- Work With Willingness (tendency to form alliances and cooperate)
- Diplo Balance (overall diplomatic posture)
- FLAVOR_DIPLOMACY / 2 (personality contribution)

A high FLAVOR_DIPLOMACY value increases the likelihood that the AI will actively pursue diplomatic victory through vote accumulation, city-state alliances, and World Congress participation.

### 2. City-State Interaction Strategy (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (line 32091)

**Function:** `CvDiplomacyAI::DoContactMinorCivs()`

FLAVOR_DIPLOMACY is the primary flavor used to determine city-state interaction intensity.

```cpp
int iDiplomacyFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DIPLOMACY"));
int iGoldFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GOLD"));
int iTileImprovementFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_TILE_IMPROVEMENT"));
```

**Interpretation:** The diplomacy flavor (combined with grand strategy modifiers) drives city-state interaction decisions, including:

- Gold gifting to city-states for influence
- Prioritization of city-state quests
- Diplomatic unit deployment to city-state territories
- Protection of allied city-states
- Completion of city-state requests

Leaders with high FLAVOR_DIPLOMACY will invest more resources in securing and maintaining city-state alliances, viewing them as essential to diplomatic victory and international influence.

### 3. Grand Strategy Integration (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (line 403)

**Function:** `CvGrandStrategyAI::DoTurn()`

FLAVOR_DIPLOMACY is cached as a key strategic value each turn.

```cpp
m_iFlavorDiplomacy = GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DIPLOMACY"));
```

**Interpretation:** The Grand Strategy AI maintains a cached diplomacy flavor value that combines:

- Base personality flavor (leader's inherent diplomatic tendency)
- Active grand strategy modifiers (AIGRANDSTRATEGY_UNITED_NATIONS adds +20)
- Current economic/military strategy modifiers

This cached value is used throughout the turn for consistent diplomatic decision-making across all AI systems.

### 4. United Nations Priority Calculation (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 1261-1262)

**Function:** `CvGrandStrategyAI::GetUnitedNationsPriority()`

FLAVOR_DIPLOMACY determines early-game diplomatic victory pursuit before the World Congress forms.

```cpp
if (GC.getGame().GetGameLeagues()->GetNumActiveLeagues() == 0)
{
    // Before leagues kick in, add weight based on flavor
    int iFlavorDiplo = m_pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DIPLOMACY"));
    iPriority += (10 - m_pPlayer->GetCurrentEra()) * iFlavorDiplo * 125 / 100;
}
```

**Interpretation:** Before the World Congress activates, FLAVOR_DIPLOMACY drives early diplomatic preparations:

- **Formula:** `Priority += (10 - CurrentEra) * FlavorDiplomacy * 1.25`
- **Early Game Boost:** In Ancient Era (0), the multiplier is 10×, making early diplomatic investment high
- **Decreasing Weight:** As eras progress, the multiplier decreases (Medieval Era 4: 6×, Industrial Era 6: 4×)
- **Personality Scaling:** A leader with FLAVOR_DIPLOMACY = 9 in Ancient Era gets: 10 × 9 × 1.25 = 112.5 priority points

This creates strong early investment in diplomatic infrastructure (embassies, city-state alliances, diplomatic units) for high-diplomacy leaders, laying groundwork for eventual diplomatic victory pursuit.

### 5. Diplomatic Unit Production Strategy (CvEconomicAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvEconomicAI.cpp` (lines 4670-4676)

**Function:** `CvEconomicAI::UpdateEconomicStrategies()` - NEED_DIPLOMATS strategy

FLAVOR_DIPLOMACY determines the AI's baseline desire to produce diplomatic units.

```cpp
int iFlavorDiplo = pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DIPLOMACY"));

int iCSDesire = (((iFlavorDiplo + /*2*/ GD_INT_GET(NEED_DIPLOMAT_DESIRE_MODIFIER))
    * iNumCities) / 10); // Baseline desire

int iCSDistaste = /*6*/ GD_INT_GET(NEED_DIPLOMAT_DISTASTE_MODIFIER) - iFlavorDiplo;
// Lack of desire. Lower is better for diplo. If negative, counts as zero.

int iThreshold = iNumCities * /*125*/ GD_INT_GET(NEED_DIPLOMAT_THRESHOLD_MODIFIER) / 100;
```

**Interpretation:** The NEED_DIPLOMATS strategy calculation uses FLAVOR_DIPLOMACY to determine:

**Baseline Desire Calculation:**

- Formula: `((FlavorDiplo + 2) * NumCities) / 10`
- Examples:
  - FLAVOR_DIPLOMACY 3, 5 cities: (3+2) × 5 / 10 = 2.5 baseline desire
  - FLAVOR_DIPLOMACY 9, 5 cities: (9+2) × 5 / 10 = 5.5 baseline desire
  - FLAVOR_DIPLOMACY 9, 8 cities: (9+2) × 8 / 10 = 8.8 baseline desire

**Distaste Calculation:**

- Formula: `6 - FlavorDiplo` (if negative, treated as zero)
- Examples:
  - FLAVOR_DIPLOMACY 3: Distaste = 3 (higher resistance to building diplomats)
  - FLAVOR_DIPLOMACY 6: Distaste = 0 (neutral)
  - FLAVOR_DIPLOMACY 9: Distaste = 0 (no resistance, capped at 0)

High-diplomacy leaders have both higher baseline desire and lower distaste, creating strong motivation to produce diplomatic units throughout the game.

### 6. Embassy Placement Strategy (CvPlayerAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPlayerAI.cpp` (lines 1969-1982)

**Function:** `CvPlayerAI::GreatDiplomatDirective()`

FLAVOR_DIPLOMACY determines how many embassies the AI wants to construct.

```cpp
int iFlavorDiplo = GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DIPLOMACY"));
int iNumMinors = GC.getGame().GetNumMinorCivsAlive();
int iEmbassies = GetImprovementLeagueVotes();
int iDesiredEmb = range(iFlavorDiplo*2 - 3, 1, iNumMinors);

// Embassy numbers should be based on Diplomacy Flavor
if ((iEmbassies < iDesiredEmb) || GetDiplomacyAI()->IsGoingForDiploVictory())
{
    return GREAT_PEOPLE_DIRECTIVE_CONSTRUCT_IMPROVEMENT;
}
```

**Interpretation:** Great Diplomats place embassies based on FLAVOR_DIPLOMACY:

- **Formula:** `DesiredEmbassies = clamp(FlavorDiplo × 2 - 3, 1, NumMinorCivs)`
- **Examples:**
  - FLAVOR_DIPLOMACY 3: 3×2-3 = 3 desired embassies
  - FLAVOR_DIPLOMACY 5: 5×2-3 = 7 desired embassies
  - FLAVOR_DIPLOMACY 7: 7×2-3 = 11 desired embassies
  - FLAVOR_DIPLOMACY 10: 10×2-3 = 17 desired embassies (capped by number of minor civs)

**Strategic Impact:** High-diplomacy leaders will construct many embassies to maximize their voting power in the World Congress, while low-diplomacy leaders prefer to use Great Diplomats for their instant city-state influence ability instead.

### 7. Policy Selection Evaluation (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4894-4909)

**Function:** `CvPolicyAI::WeighPolicy()`

FLAVOR_DIPLOMACY affects policy weighting with special anti-warmonger logic.

```cpp
if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_DIPLOMACY")
{
    iDiploValue += iFlavorValue;

    for (int iMinorCivLoop = MAX_MAJOR_CIVS; iMinorCivLoop < MAX_CIV_PLAYERS; iMinorCivLoop++)
    {
        PlayerTypes eMinor = (PlayerTypes)iMinorCivLoop;

        // Loop through all minors - if we're itching to conquer, bail out on diplo policies
        if (GET_PLAYER(eMinor).isMinorCiv() && GET_PLAYER(eMinor).isAlive())
        {
            if (pPlayer->GetDiplomacyAI()->GetCivApproach(eMinor) >= CIV_APPROACH_HOSTILE)
            {
                iDiploValue -= iFlavorValue;
            }
        }
    }
}
```

**Interpretation:** When evaluating policies with FLAVOR_DIPLOMACY weights:

- Policies with diplomacy flavor receive higher weights for diplomatic leaders
- **Anti-Warmonger Check:** If the AI is hostile toward ANY city-state, the diplomacy flavor value is subtracted from the policy weight
- This prevents warmongers from accidentally selecting diplomatic policies that conflict with their conquest strategy
- Leaders actively conquering city-states will avoid Patronage and other diplomatic policy trees

### 8. Advisor Recommendation Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (line 455)

**Function:** `CvAdvisorRecommender::GetRecommendationPriority()`

FLAVOR_DIPLOMACY has a specific priority weight in the advisor recommendation system.

```cpp
else if(strFlavorName == "FLAVOR_DIPLOMACY")
{
    // Priority value not shown in available code, but FLAVOR_DIPLOMACY is recognized
}
```

**Interpretation:** The advisor system uses FLAVOR_DIPLOMACY to recommend:

- Diplomatic unit production
- Embassy construction
- City-state interaction opportunities
- Diplomatic policies and technologies
- World Congress participation strategies

### 9. Technology Research Priorities (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (line 1245)

**Function:** Technology evaluation for diplomatic focus

```cpp
if (bDiploFocus && (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_DIPLOMACY"))
{
    // Boost technology research for diplomatic technologies when pursuing diplo victory
}
```

**Interpretation:** When the AI is pursuing diplomatic victory (bDiploFocus = true), technologies with FLAVOR_DIPLOMACY receive research priority boosts, ensuring diplomatic leaders research key technologies like Printing Press, Globalization, and other diplomatic techs efficiently.

### 10. Religious Belief Selection (CvReligionClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (line 8793)

**Function:** Religion belief evaluation

```cpp
iTR = pEntry->GetYieldPerActiveTR(iI) * pFlavorManager->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DIPLOMACY"));
```

**Interpretation:** FLAVOR_DIPLOMACY influences religious belief selection, particularly beliefs that provide bonuses per active trade route. Diplomatic leaders value trade route bonuses more highly because:

- Trade routes connect to city-states for influence
- Trade routes generate gold for diplomatic gifts
- Trade routes create international relationships

## Grand Strategy Integration

### United Nations Grand Strategy (CoreStrategyChanges.sql)

**Location:** `(1) Community Patch/Database Changes/AI/CoreStrategyChanges.sql` (line 20)

When the AI activates the AIGRANDSTRATEGY_UNITED_NATIONS grand strategy:

```sql
('AIGRANDSTRATEGY_UNITED_NATIONS', 'FLAVOR_DIPLOMACY', 20)
```

**Effect:** +20 FLAVOR_DIPLOMACY bonus while pursuing diplomatic victory

**Combined Impact:**

- Base FLAVOR_DIPLOMACY: 7-10 for diplomatic leaders
- Grand Strategy Bonus: +20
- **Total Active Diplomacy Flavor: 27-30**

This massive boost when pursuing diplomatic victory causes:

- Extremely high diplomatic unit production priority
- Maximum city-state investment
- Strong preference for diplomatic policies
- Prioritization of diplomatic technologies
- Aggressive embassy construction
- Focus on World Congress projects

## Military Strategy Impact

FLAVOR_DIPLOMACY is heavily penalized during military conflicts, representing the incompatibility between diplomatic pursuit and warfare:

### Player-Level Military Strategy Penalties (StrategyFlavorSweeps.sql)

**At War Penalties:**

```sql
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_DIPLOMACY', -25)
('MILITARYAISTRATEGY_WINNING_WARS', 'FLAVOR_DIPLOMACY', -10)
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_DIPLOMACY', -20)
```

**Defense Penalties:**

```sql
('MILITARYAISTRATEGY_EMPIRE_DEFENSE', 'FLAVOR_DIPLOMACY', -15)
('MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL', 'FLAVOR_DIPLOMACY', -35)
('MILITARYAISTRATEGY_WAR_MOBILIZATION', 'FLAVOR_DIPLOMACY', -15)
('MILITARYAISTRATEGY_ERADICATE_BARBARIANS', 'FLAVOR_DIPLOMACY', -10)
```

### City-Level Military Strategy Penalties

**More Severe City-Level Penalties:**

```sql
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_DIPLOMACY', -40)
('MILITARYAISTRATEGY_WINNING_WARS', 'FLAVOR_DIPLOMACY', -30)
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_DIPLOMACY', -30)
('MILITARYAISTRATEGY_EMPIRE_DEFENSE', 'FLAVOR_DIPLOMACY', -25)
('MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL', 'FLAVOR_DIPLOMACY', -50)
('MILITARYAISTRATEGY_WAR_MOBILIZATION', 'FLAVOR_DIPLOMACY', -20)
('MILITARYAISTRATEGY_ERADICATE_BARBARIANS', 'FLAVOR_DIPLOMACY', -20)
```

**Interpretation:** During warfare, diplomatic priorities are severely reduced:

- **At War:** -25 to -40 penalty discourages diplomatic unit production during active combat
- **Losing Wars:** -20 to -30 penalty forces focus on military survival
- **Critical Defense:** -35 to -50 penalty completely halts diplomatic efforts during existential threats

**Practical Effect:** Cities will stop producing diplomatic units and shift to military production. The AI postpones diplomatic victory pursuit until peace is restored, recognizing that warfare damages diplomatic relationships and voting power.

### Historical Context Penalties (CoreStrategyChanges.sql)

Additional penalties from older Community Patch definitions:

```sql
-- Player Level
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_DIPLOMACY', -20)
('MILITARYAISTRATEGY_WINNING_WARS', 'FLAVOR_DIPLOMACY', -10)
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_DIPLOMACY', -40)

-- City Level
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_DIPLOMACY', -50)
('MILITARYAISTRATEGY_WINNING_WARS', 'FLAVOR_DIPLOMACY', -30)
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_DIPLOMACY', -60)
```

These values represent earlier balancing iterations and may be overridden by Vox Populi changes, but show the design intent of severe diplomatic penalties during warfare.

## Economic Strategy Modifiers

### Happiness Strategy Synergies

```sql
('ECONOMICAISTRATEGY_NEED_HAPPINESS', 'FLAVOR_DIPLOMACY', 6)
('ECONOMICAISTRATEGY_NEED_HAPPINESS_CRITICAL', 'FLAVOR_DIPLOMACY', 11)
```

**Interpretation:** During happiness crises, FLAVOR_DIPLOMACY receives small boosts because:

- City-state alliances provide luxury resources
- Diplomatic relationships enable luxury trading
- Peaceful diplomatic approach avoids wartime unhappiness

### Diplomat Production Strategies

```sql
('ECONOMICAISTRATEGY_NEED_DIPLOMATS', 'FLAVOR_DIPLOMACY', 20)
('ECONOMICAISTRATEGY_NEED_DIPLOMATS_CRITICAL', 'FLAVOR_DIPLOMACY', 60)
```

**Interpretation:** When the NEED_DIPLOMATS strategy activates:

- **Standard Need:** +20 FLAVOR_DIPLOMACY boost
- **Critical Need:** +60 FLAVOR_DIPLOMACY boost (massive priority increase)

These bonuses dramatically increase diplomatic unit production when:

- Not enough diplomatic units exist to maintain city-state influence
- Competing civilizations are dominating city-state relationships
- Pursuing diplomatic victory without sufficient diplomatic presence

### Grand Strategy Economic Modifiers

**Player-Level Modifiers:**

```sql
('ECONOMICAISTRATEGY_GS_DIPLOMACY', 'FLAVOR_DIPLOMACY', 26)
('ECONOMICAISTRATEGY_GS_CULTURE', 'FLAVOR_DIPLOMACY', 22)
('ECONOMICAISTRATEGY_GS_CONQUEST', 'FLAVOR_DIPLOMACY', 11)
('ECONOMICAISTRATEGY_GS_SPACESHIP', 'FLAVOR_DIPLOMACY', 16)
('ECONOMICAISTRATEGY_GS_SPACESHIP_HOMESTRETCH', 'FLAVOR_DIPLOMACY', -50)
```

**City-Level Modifiers:**

```sql
('ECONOMICAISTRATEGY_GS_DIPLOMACY', 'FLAVOR_DIPLOMACY', 30)
('ECONOMICAISTRATEGY_GS_CULTURE', 'FLAVOR_DIPLOMACY', 22)
('ECONOMICAISTRATEGY_GS_CONQUEST', 'FLAVOR_DIPLOMACY', 11)
('ECONOMICAISTRATEGY_GS_SPACESHIP', 'FLAVOR_DIPLOMACY', 16)
('ECONOMICAISTRATEGY_GS_SPACESHIP_HOMESTRETCH', 'FLAVOR_DIPLOMACY', -50)
```

**Interpretation:**

- **Diplomatic Victory:** +26 to +30 bonus when pursuing diplomatic victory
- **Cultural Victory:** +22 bonus (diplomatic relationships support cultural influence)
- **Conquest Victory:** +11 bonus (some diplomatic work still valuable)
- **Science Victory:** +16 bonus (peaceful science victory benefits from diplomacy)
- **Science Homestretch:** -50 penalty (final space race phase deprioritizes everything else)

### Other Economic Modifiers

```sql
('ECONOMICAISTRATEGY_ISLAND_START', 'FLAVOR_DIPLOMACY', -10)
('ECONOMICAISTRATEGY_TOO_MANY_UNITS', 'FLAVOR_DIPLOMACY', -10 to -15)
```

**Interpretation:**

- **Island Start:** -10 penalty reflects difficulty of diplomatic engagement from isolated position
- **Too Many Units:** -10 to -15 penalty reflects economic strain limiting diplomatic investment

## City Strategy Adjustments

### City-Level Diplomacy Strategies (StrategyFlavorSweeps.sql)

**Threat and Expansion Penalties:**

```sql
('AICITYSTRATEGY_CAPITAL_UNDER_THREAT', 'FLAVOR_DIPLOMACY', -40)
('AICITYSTRATEGY_CAPITAL_NEED_SETTLER', 'FLAVOR_DIPLOMACY', -30)
```

**Interpretation:** Cities deprioritize diplomatic units when:

- Capital is under direct military threat (-40 penalty)
- Capital needs to produce settlers for expansion (-30 penalty)

**Diplomat Production Bonuses:**

```sql
('AICITYSTRATEGY_NEED_DIPLOMATS', 'FLAVOR_DIPLOMACY', 20)
('AICITYSTRATEGY_NEED_DIPLOMATS_CRITICAL', 'FLAVOR_DIPLOMACY', 40)
```

**Interpretation:** Cities dramatically increase diplomatic unit production when strategic need is identified.

**City Size Modifiers:**

```sql
('AICITYSTRATEGY_LARGE_CITY', 'FLAVOR_DIPLOMACY', 11)
('AICITYSTRATEGY_MEDIUM_CITY', 'FLAVOR_DIPLOMACY', 6)
('AICITYSTRATEGY_SMALL_CITY', 'FLAVOR_DIPLOMACY', -30)
('AICITYSTRATEGY_TINY_CITY', 'FLAVOR_DIPLOMACY', -300)
```

**Interpretation:** Only large, developed cities should produce diplomatic units:

- **Large Cities (10+ population):** +11 bonus (capable of producing diplomats)
- **Medium Cities (6-9 population):** +6 bonus (can produce diplomats)
- **Small Cities (4-5 population):** -30 penalty (should focus on growth)
- **Tiny Cities (1-3 population):** -300 penalty (completely prevents diplomat production)

This ensures that only economically developed cities with sufficient infrastructure produce expensive diplomatic units, while small cities focus on growth and infrastructure.

## Units with FLAVOR_DIPLOMACY

### Diplomatic Units (UnitFlavorSweeps.sql)

**Progressive Diplomatic Unit Hierarchy:**

```sql
('UNIT_EMISSARY', 'FLAVOR_DIPLOMACY', 30)
('UNIT_ENVOY', 'FLAVOR_DIPLOMACY', 40)
('UNIT_DIPLOMAT', 'FLAVOR_DIPLOMACY', 60)
('UNIT_AMBASSADOR', 'FLAVOR_DIPLOMACY', 80)
```

**Interpretation:** Diplomatic units have escalating flavor values reflecting their increasing power:

- **Emissary (Ancient):** 30 flavor - Basic city-state influence, low maintenance
- **Envoy (Classical):** 40 flavor - Improved influence, minor voting power
- **Diplomat (Medieval):** 60 flavor - Strong influence, significant voting power
- **Ambassador (Industrial):** 80 flavor - Maximum influence, peak voting power

Leaders with high FLAVOR_DIPLOMACY will continuously upgrade their diplomatic corps, maintaining maximum diplomatic presence throughout the game.

### Great Diplomat Units

```sql
('UNIT_GREAT_DIPLOMAT', 'FLAVOR_DIPLOMACY', 1)
('UNIT_TADODAHO', 'FLAVOR_DIPLOMACY', 60)
```

**Interpretation:**

- **Great Diplomat:** Flavor value of 1 (Great People use different evaluation systems)
- **Tadodaho (Iroquois unique):** 60 flavor (exceptional diplomatic unit)

Great Diplomats can either construct embassies (boosting voting power) or conduct diplomatic missions (massive instant city-state influence boost). The choice depends on current embassy count vs desired embassies (see Embassy Placement Strategy above).

## Buildings with FLAVOR_DIPLOMACY

### Early Game Buildings (BuildingFlavorSweeps.sql)

```sql
('BUILDING_PITZ_COURT', 'FLAVOR_DIPLOMACY', 5)
```

**Interpretation:** Basic early building with minor diplomatic benefits.

### Medieval Era Buildings

```sql
('BUILDING_CHANCERY', 'FLAVOR_DIPLOMACY', 35)
('BUILDING_EXAMINATION_HALL', 'FLAVOR_DIPLOMACY', 35)
('BUILDING_HANSE', 'FLAVOR_DIPLOMACY', 20)
('BUILDING_WAT', 'FLAVOR_DIPLOMACY', 20)
```

**Interpretation:**

- **Chancery (Generic):** 35 flavor - Core diplomatic building
- **Examination Hall (Chinese unique):** 35 flavor - Diplomatic/great people building
- **Hanse (German unique):** 20 flavor - Economic/diplomatic hybrid
- **Wat (Siamese unique):** 20 flavor - Cultural/diplomatic building

### Renaissance Era Buildings

```sql
('BUILDING_WIRE_SERVICE', 'FLAVOR_DIPLOMACY', 20)
```

**Interpretation:** Communication infrastructure supporting diplomatic efforts.

### High-Value Diplomatic Buildings

These buildings receive substantial priority from diplomatic leaders:

- Chancery: Primary diplomatic infrastructure
- Examination Hall: Combines diplomacy with Great People generation
- Buildings with 20+ flavor values become high construction priorities

## Technologies with FLAVOR_DIPLOMACY

### Key Diplomatic Technologies (TechFlavorSweeps.sql)

**Ancient Era:**

```sql
('TECH_WRITING', 'FLAVOR_DIPLOMACY', 15)
```

- **Writing:** Enables embassies, diplomatic correspondence, early diplomatic infrastructure

**Classical Era:**

```sql
('TECH_CIVIL_SERVICE', 'FLAVOR_DIPLOMACY', 15)
```

- **Civil Service:** Governmental organization, diplomatic bureaucracy

**Medieval Era:**

```sql
('TECH_EDUCATION', 'FLAVOR_DIPLOMACY', 10)
```

- **Education:** Trained diplomats, international scholarship

**Renaissance Era:**

```sql
('TECH_PRINTING_PRESS', 'FLAVOR_DIPLOMACY', 25)
```

- **Printing Press:** Highest diplomatic technology flavor, enables mass communication, diplomatic correspondence, and advanced diplomatic units

**Industrial Era:**

```sql
('TECH_INDUSTRIALIZATION', 'FLAVOR_DIPLOMACY', 15)
('TECH_REPLACEABLE_PARTS', 'FLAVOR_DIPLOMACY', 10)
('TECH_RADIO', 'FLAVOR_DIPLOMACY', 10)
('TECH_REFRIGERATION', 'FLAVOR_DIPLOMACY', 10)
```

- **Industrialization:** Infrastructure supporting diplomatic networks
- **Replaceable Parts:** Economic infrastructure for diplomacy
- **Radio:** Mass communication
- **Refrigeration:** Trade infrastructure

**Modern Era:**

```sql
('TECH_ATOMIC_THEORY', 'FLAVOR_DIPLOMACY', 15)
```

- **Atomic Theory:** Nuclear diplomacy, international cooperation

**Information Era:**

```sql
('TECH_GLOBALIZATION', 'FLAVOR_DIPLOMACY', 20)
```

- **Globalization:** Peak diplomatic technology, United Nations, Delegates bonus, final diplomatic infrastructure

### Technology Research Strategy

Diplomatic leaders prioritize:

1. **Printing Press (25):** Highest priority diplomatic tech
2. **Globalization (20):** Endgame diplomatic tech enabling victory
3. **Writing, Civil Service, Industrialization, Atomic Theory (15 each):** Core diplomatic progression
4. **Education, Replaceable Parts, Radio, Refrigeration (10 each):** Supporting technologies

This creates a clear technology path for diplomatic victory: Writing → Civil Service → Education → **Printing Press** → Industrialization → Atomic Theory → **Globalization**

## Policies with FLAVOR_DIPLOMACY

### Patronage Policy Tree (PolicyFlavorSweeps.sql)

**Core Patronage Policies:**

```sql
('POLICY_PATRONAGE', 'FLAVOR_DIPLOMACY', 15)
('POLICY_PHILANTHROPY', 'FLAVOR_DIPLOMACY', 13)
('POLICY_CONSULATES', 'FLAVOR_DIPLOMACY', 15)
('POLICY_CULTURAL_DIPLOMACY', 'FLAVOR_DIPLOMACY', 18)
('POLICY_PATRONAGE_FINISHER', 'FLAVOR_DIPLOMACY', 50)
```

**Interpretation:**

- **Patronage Opener:** 15 flavor - Foundation of diplomatic policy tree
- **Philanthropy:** 13 flavor - Enhanced city-state gifting
- **Consulates:** 15 flavor - Improved city-state relationships
- **Cultural Diplomacy:** 18 flavor - Highest individual policy flavor
- **Patronage Finisher:** 50 flavor - Massive bonus reflecting complete diplomatic mastery

The Patronage tree is essential for diplomatic victory, and diplomatic leaders will prioritize completing this tree early.

### Rationalism Policy Tree

```sql
('POLICY_ETHICS', 'FLAVOR_DIPLOMACY', 12)
```

**Interpretation:** Ethics policy (Rationalism tree) has diplomatic flavor, representing international scientific cooperation.

### Freedom Ideology Policies

```sql
('POLICY_URBANIZATION', 'FLAVOR_DIPLOMACY', 40)
('POLICY_ARSENAL_DEMOCRACY', 'FLAVOR_DIPLOMACY', 60)
('POLICY_TREATY_ORGANIZATION', 'FLAVOR_DIPLOMACY', 60)
```

**Interpretation:**

- **Urbanization:** 40 flavor - City development supporting diplomacy
- **Arsenal of Democracy:** 60 flavor - Democratic military cooperation
- **Treaty Organization:** 60 flavor - International alliances and treaties

Freedom ideology strongly supports diplomatic victory, with multiple high-value diplomatic policies.

### Order Ideology Policies

```sql
('POLICY_UNITED_FRONT', 'FLAVOR_DIPLOMACY', 60)
```

**Interpretation:** United Front represents international worker movements and solidarity, supporting diplomatic relationships even under authoritarian government.

### Autocracy Ideology Policies

```sql
('POLICY_GUNBOAT_DIPLOMACY', 'FLAVOR_DIPLOMACY', 60)
```

**Interpretation:** Gunboat Diplomacy represents coercive diplomacy backed by military force, showing that even aggressive regimes use diplomatic mechanisms.

### Highest Value Diplomatic Policies

**Top Diplomatic Policies (60 flavor):**

- Arsenal of Democracy (Freedom)
- Treaty Organization (Freedom)
- United Front (Order)
- Gunboat Diplomacy (Autocracy)

**Major Diplomatic Policies (40-50 flavor):**

- Patronage Finisher (50)
- Urbanization (40)

These policies become extremely high priority for leaders with FLAVOR_DIPLOMACY ≥ 7, often selected immediately when available.

## Processes with FLAVOR_DIPLOMACY

### World Congress Projects (ProcessFlavorSweeps.sql)

```sql
('PROCESS_WORLD_FAIR', 'FLAVOR_DIPLOMACY', 30)
('PROCESS_WORLD_GAMES', 'FLAVOR_DIPLOMACY', 30)
('PROCESS_UNITED_NATIONS', 'FLAVOR_DIPLOMACY', 100)
('PROCESS_INTERNATIONAL_SPACE_STATION', 'FLAVOR_DIPLOMACY', 30)
```

**Interpretation:**

- **World's Fair:** 30 flavor - Cultural cooperation project
- **World Games:** 30 flavor - Athletic cooperation project
- **United Nations:** 100 flavor - Absolute highest priority for diplomatic leaders
- **International Space Station:** 30 flavor - Scientific cooperation project

**Strategic Impact:** When pursuing diplomatic victory, the AI will dedicate significant production to World Congress projects, especially the United Nations (100 flavor value). The United Nations project receives maximum priority, as completing it provides massive voting power bonuses essential for diplomatic victory.

Leaders with FLAVOR_DIPLOMACY ≥ 8 will commit multiple cities to these projects when available, viewing them as essential to diplomatic victory pursuit.

## City Specialization Integration

### Commerce City Specialization (CitySpecializationFlavorChanges.sql)

```sql
('CITYSPECIALIZATION_GENERAL_ECONOMIC', 'FLAVOR_DIPLOMACY', 6)
('CITYSPECIALIZATION_COMMERCE', 'FLAVOR_DIPLOMACY', 11)
```

**Interpretation:** Cities specialized for commerce receive diplomatic flavor bonuses because:

- Economic wealth funds diplomatic initiatives
- Trade routes create diplomatic relationships
- Gold enables city-state influence through gifting

**Strategic Effect:** Economic cities become natural producers of diplomatic units and diplomatic infrastructure, leveraging their wealth to support diplomatic victory pursuit.

## Event Flavor Modifiers

### Revolutionary Choice Events (EventFlavorChanges.sql)

```sql
('PLAYER_EVENT_REVOLUTION_CHOICE_2', 'FLAVOR_DIPLOMACY', 40)
```

**Interpretation:** Certain revolution event choices provide temporary +40 FLAVOR_DIPLOMACY bonuses, representing diplomatic reforms or international cooperation commitments that dramatically boost diplomatic priorities for a limited time.

## Summary

### Core Systems Affected by FLAVOR_DIPLOMACY

1. **Victory Pursuit Assessment:** Determines likelihood of pursuing diplomatic victory
2. **Diplomatic Unit Production:** Controls production of Emissaries, Envoys, Diplomats, Ambassadors
3. **Embassy Construction:** Determines how many embassies Great Diplomats construct
4. **City-State Interaction:** Drives gold investment, quest completion, and alliance maintenance
5. **World Congress Participation:** Prioritization of voting, resolutions, and projects
6. **Policy Selection:** Strong preference for Patronage and diplomatic ideology policies
7. **Technology Research:** Beelines Printing Press, Globalization, and other diplomatic techs
8. **Building Construction:** Prioritizes Chanceries and diplomatic infrastructure
9. **Military Conflict Behavior:** Severe penalties during warfare, peace-seeking tendencies
10. **Grand Strategy Integration:** Massive bonuses when pursuing United Nations victory

### Diplomatic Victory Pathway

For leaders with FLAVOR_DIPLOMACY ≥ 8:

**Early Game (Ancient-Classical):**

- Research Writing technology (15 flavor) for embassies
- Open Patronage policy tree (15 flavor)
- Produce Emissaries (30 flavor) and Envoys (40 flavor)
- Begin city-state gold gifting and quest completion

**Mid Game (Medieval-Renaissance):**

- Research Printing Press (25 flavor) - highest diplomatic tech priority
- Complete Patronage tree, especially Cultural Diplomacy (18) and Patronage Finisher (50)
- Construct Chanceries (35 flavor) in major cities
- Upgrade to Diplomats (60 flavor) for stronger city-state influence
- Place embassies with Great Diplomats based on formula: (FlavorDiplo × 2 - 3)

**Late Game (Industrial-Modern):**

- Research Globalization (20 flavor) for United Nations
- Select diplomatic ideology policies (60 flavor each)
- Upgrade to Ambassadors (80 flavor) for maximum influence
- Commit production to United Nations project (100 flavor)
- Maximize voting power through embassies, city-state alliances, and World Congress participation

**Victory Conditions:**

- Achieve majority vote in United Nations
- Maintain city-state alliances for delegate bonuses
- Win critical World Congress votes
- Secure diplomatic victory through vote accumulation

### Spectrum of AI Diplomatic Behavior

**Ultra-Diplomatic Leaders (FLAVOR_DIPLOMACY 9-10):**

- Enrico Dandolo (Venice): 10
- William (Netherlands): 9
- **Behavior:** Single-minded pursuit of diplomatic victory, maximum city-state investment, extensive embassy network, avoids warfare at all costs, completes entire Patronage tree early

**High Diplomacy Leaders (FLAVOR_DIPLOMACY 7-8):**

- Alexander (Greece): 8
- Dido (Carthage): 8
- Hiawatha (Iroquois): 8
- **Behavior:** Strong diplomatic focus with flexibility for other victory types, maintains robust city-state relationships, builds substantial diplomatic infrastructure

**Moderate Diplomacy Leaders (FLAVOR_DIPLOMACY 5-6):**

- Most balanced leaders
- **Behavior:** Opportunistic diplomacy, invests in city-states when strategic, maintains some diplomatic presence, may pursue diplomatic victory if circumstances favor it

**Low Diplomacy Leaders (FLAVOR_DIPLOMACY 2-4):**

- Military-focused leaders like Attila, Alexander the Great (Conquest), Genghis Khan
- **Behavior:** Minimal diplomatic investment, may conquer city-states instead of befriending them, ignores diplomatic victory entirely, uses diplomacy only for tactical alliances

### Dynamic Adjustment Patterns

**Positive Adjustments:**

- **Pursuing Diplomatic Victory:** +20 from grand strategy, +26-30 from economic strategy (total: +46-50)
- **Need Diplomats Critical:** +60 temporary boost when falling behind in city-state competition
- **Revolutionary Events:** +40 temporary boost from specific event choices

**Negative Adjustments:**

- **At War:** -25 to -40 penalty during active combat
- **Losing Wars:** -20 to -30 penalty during military defeats
- **Empire Defense Critical:** -35 to -50 penalty during existential threats
- **Science Homestretch:** -50 penalty when completing spaceship (all other priorities drop)
- **Tiny Cities:** -300 penalty prevents small cities from wasting production on diplomats

### Interaction with Other Flavors

**Synergistic Flavors:**

- **FLAVOR_GOLD:** Provides wealth for city-state gifting and diplomatic investments
- **FLAVOR_CULTURE:** Cultural influence supports diplomatic relationships
- **FLAVOR_SCIENCE:** Peaceful science victory pairs well with diplomatic approach
- **FLAVOR_I_TRADE_ROUTE:** Trade routes connect civilizations and city-states

**Conflicting Flavors:**

- **FLAVOR_OFFENSE:** Military aggression damages diplomatic relationships
- **FLAVOR_CONQUEST:** Conquering city-states destroys potential alliances
- **FLAVOR_NUKE:** Nuclear warfare devastates diplomatic standing
- **FLAVOR_USE_NUKE:** Actually using nuclear weapons ruins all diplomatic relationships

### Design Philosophy

FLAVOR_DIPLOMACY represents the AI's fundamental approach to international relations:

1. **Cooperation vs Confrontation:** How the AI resolves international conflicts
2. **Investment Strategy:** Whether to spend resources on diplomatic infrastructure or military forces
3. **Victory Path:** Pursuit of diplomatic victory vs other victory types
4. **City-State Approach:** Alliance and protection vs conquest and exploitation
5. **Wartime Behavior:** Peace-seeking vs prolonged warfare
6. **World Congress Participation:** Active engagement vs passive indifference

The flavor creates a spectrum from pure warmongers who view diplomacy as weakness (FLAVOR 2-3) to dedicated diplomats who pursue international cooperation as their primary strategy (FLAVOR 9-10). The system's sophistication lies in its dynamic adjustments: diplomacy is automatically deprioritized during military crises, boosted when pursuing diplomatic victory, and integrated with economic capacity to ensure only prosperous civilizations can afford extensive diplomatic operations.

This creates realistic AI behavior where diplomatic leaders avoid unnecessary conflicts, invest in international relationships, and pursue victory through votes rather than conquest, while military leaders view city-states as targets for expansion rather than partners for cooperation.
