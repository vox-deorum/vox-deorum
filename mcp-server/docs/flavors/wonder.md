# FLAVOR_WONDER

## Overview

`FLAVOR_WONDER` is an AI personality flavor that controls how strongly a civilization's leader prioritizes wonder construction. This flavor fundamentally shapes the AI's approach to competing for world wonders, national wonders, and related production decisions. It influences both the strategic priority given to wonder construction and how cities allocate their production capacity toward wonder projects.

Unlike production or culture flavors which have broader applications, `FLAVOR_WONDER` specifically drives the AI's **desire to construct prestigious buildings** that provide unique strategic advantages and prestige. This flavor creates the classic "wonder-building civilizations" that race for architectural achievements versus militaristic or expansionist neighbors.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Wonder-focused builders: 7-10
  - Balanced culturally-oriented leaders: 5-7
  - Pragmatic/military leaders: 3-5
  - Wonder-indifferent leaders: 0-2

## Code References

### 1. Advisor Recommendation Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (lines 330, 447)

**Function:** Advisor flavor weighting system

FLAVOR_WONDER influences recommendations from both Economic and Science advisors.

```cpp
// Economic Advisor (line 330)
else if(strFlavorName == "FLAVOR_WONDER")
{
    return 5;
}

// Science Advisor (line 447)
else if(strFlavorName == "FLAVOR_WONDER")
{
    return 5;
}
```

**Interpretation:** FLAVOR_WONDER receives a moderate priority weight (5) for both Economic and Science advisor recommendations. This reflects how wonders often provide both economic benefits (gold, happiness, culture) and scientific advantages (research, great people). The equal weighting across advisors indicates wonders are cross-cutting strategic investments rather than specialized choices.

### 2. City Specialization - Wonder Production Weight (CvCitySpecializationAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCitySpecializationAI.cpp` (lines 542-543, 609-619)

**Function:** `CvCitySpecializationAI::LogSpecializationUpdate()`

FLAVOR_WONDER is the primary driver of wonder-focused city specialization through a sophisticated calculation system.

```cpp
int iFlavorWonder = m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_WONDER"));
if (iFlavorWonder < 0) iFlavorWonder = 0;

// Wonder is MIN between weight of wonders available to build and value from flavors (but not less than zero)
int iWonderFlavorWeight = iFlavorWonder * /*250*/ GD_INT_GET(AI_CITY_SPECIALIZATION_PRODUCTION_WEIGHT_FLAVOR_WONDER);
int iWeightOfWonders = (int)(m_iNextWonderWeight * /*0.2f*/ GD_FLOAT_GET(AI_CITY_SPECIALIZATION_PRODUCTION_WEIGHT_NEXT_WONDER));
iWonderWeight = min(iWonderFlavorWeight, iWeightOfWonders);
iWonderWeight = max(iWonderWeight, 0);

// One-half of normal weight if critical defense is on
if (bCriticalDefenseOn)
{
    iWonderWeight /= 2;
}
```

**Interpretation:** This is the most complex and important FLAVOR_WONDER calculation in the codebase:

1. **Flavor-based weight:** Each point of FLAVOR_WONDER multiplies by 250 (configurable via `AI_CITY_SPECIALIZATION_PRODUCTION_WEIGHT_FLAVOR_WONDER`)
   - FLAVOR_WONDER = 8 would generate 2000 base weight for wonder specialization
   - FLAVOR_WONDER = 10 would generate 2500 base weight

2. **Availability limitation:** The final weight is capped by the weight of actually available wonders (`m_iNextWonderWeight * 0.2`)
   - This prevents over-specialization when few wonders remain available
   - A high FLAVOR_WONDER won't force cities to specialize for wonders if none can be built
   - Creates dynamic behavior where wonder specialization decreases as the game progresses and wonders are claimed

3. **Emergency defense override:** When `MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL` is active, wonder weight is halved
   - Even wonder-obsessed leaders recognize existential military threats
   - Wonder construction is deprioritized but not eliminated during defensive crises

**Design Philosophy:** This "MIN" approach is elegant - it represents desire tempered by opportunity. A leader might love building wonders (high flavor) but can't specialize cities for them if they're all already built or technologically unavailable.

### 3. Wonder Production Weight Configuration (CvGlobals.cpp/h)

**Location:**

- `CvGameCoreDLL_Expansion2/CvGlobals.cpp` (line 219)
- `CvGameCoreDLL_Expansion2/CvGlobals.h` (line 784)
- `(1) Community Patch/Database Changes/Defines/CoreDefineChanges.sql` (line 227)

**Function:** Global game configuration constant

```cpp
GD_INT_INIT(AI_CITY_SPECIALIZATION_PRODUCTION_WEIGHT_FLAVOR_WONDER, 250),
```

**Interpretation:** The multiplier constant (250) is defined as a global game parameter, allowing for:

- Mod customization without code changes
- Difficulty-level adjustments
- Balancing patches to AI behavior

This makes FLAVOR_WONDER's impact tunable. Increasing this value makes all wonder-focused leaders more aggressive about building wonders; decreasing it makes them more pragmatic.

### 4. Policy AI - Culture Victory Weight (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4980-4983)

**Function:** Policy flavor evaluation for culture generation

FLAVOR_WONDER contributes to culture-based strategy calculations when evaluating policies.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_WONDER")
{
    iCultureValue += iFlavorValue;
}
```

**Interpretation:** When evaluating social policies, any policy with FLAVOR_WONDER characteristics adds to the culture value calculation. This creates synergy where:

- Wonder-focused leaders prefer policies that support wonder construction (production bonuses, great engineer generation)
- Policies like Tradition (which has FLAVOR_WONDER = 10) become more attractive
- Culture victory strategies align with wonder-building strategies naturally

Example: The Tradition policy tree has FLAVOR_WONDER = 10, making it especially attractive to wonder-focused civilizations who also benefit from its culture and growth bonuses.

### 5. Technology Priority - Culture Focus (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (lines 1272-1277)

**Function:** `CvPlayerTechs::SetLocalePriorities()` - Technology research prioritization

FLAVOR_WONDER influences technology selection when pursuing culture-focused strategies.

```cpp
if(bCultureFocus && (
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_CULTURE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_GREAT_PEOPLE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_WONDER"))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

**Interpretation:** When the AI pursues a culture-focused grand strategy, technologies with FLAVOR_WONDER values receive increased research priority alongside culture and great people techs. This ensures wonder-builders research the technologies needed to unlock key wonders:

- Ancient Era: Stonehenge, Pyramids (unlocked by early techs with FLAVOR_WONDER)
- Medieval Era: Notre Dame, Machu Picchu (mid-game wonder techs)
- Modern/Future: Eiffel Tower, Cristo Redentor, Sydney Opera House (late wonders)

This creates a research path optimization where wonder-focused leaders don't get "stuck" on military or economic techs when key wonder-unlocking technologies are available.

### 6. Religion - Wonder Production Bonus Evaluation (CvReligionClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (lines 10371, 10445-10463)

**Function:** `CvReligionAIHelpers::ScoreBeliefForPlayer()` - Religious belief selection

FLAVOR_WONDER is used when evaluating religious beliefs that provide wonder production bonuses.

```cpp
int iFlavorWonder = pFlavorManager->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_WONDER"));

if (pEntry->GetWonderProductionModifier() > 0)
{
    iTemp = iFlavorWonder * pEntry->GetWonderProductionModifier() * (bIsTall ? 2 : 1);
    iTemp *= (100 + 2 * pPlayerTraits->GetWonderProductionModifier() + pPlayerTraits->GetWonderProductionModGA());
    iTemp /= 100;
    if (pEntry->GetObsoleteEra() > 0)
    {
        if (pEntry->GetObsoleteEra() > GC.getGame().getCurrentEra())
        {
            iTemp *= pEntry->GetObsoleteEra();
            iTemp /= 5;
        }
        else
        {
            iTemp = 0;
        }
    }
    iRtnValue += iTemp;
}
```

**Interpretation:** This is a sophisticated multi-factor calculation for wonder-boosting religious beliefs:

1. **Base calculation:** FLAVOR_WONDER × Wonder Production Modifier from belief
   - A belief granting +15% wonder production with FLAVOR_WONDER = 8 yields base score of 120

2. **Tall civilization bonus:** Doubled for "tall" (few cities, high population) civilizations
   - Tall empires focus production in fewer cities, making wonder bonuses more valuable
   - Wide empires spread production across many cities, reducing per-city wonder focus

3. **Trait synergy:** Multiplied by existing wonder production bonuses from civilization traits
   - Leaders with wonder-building traits (Egypt, France) value these beliefs even more highly
   - Creates compounding bonuses for specialist wonder-builders

4. **Era obsolescence:** Beliefs that become obsolete in later eras are valued based on remaining usefulness
   - If the belief expires soon, value approaches zero
   - If many eras remain, value is multiplied by the number of remaining eras divided by 5

**Example:** Egypt (wonder production trait) with FLAVOR_WONDER = 9, playing tall, evaluating a belief with +20% wonder production that expires in 4 eras:

- Base: 9 × 20 × 2 (tall) = 360
- With trait: 360 × (100 + trait bonuses) / 100 = ~450-500
- With era scaling: 450 × 4 / 5 = 360 final score

This ensures wonder-focused civilizations prioritize religious beliefs that support their architectural ambitions.

### 7. Victory Pursuit - Culture Victory Score (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (lines 2393-2398)

**Function:** `CvDiplomacyAI::DoUpdateVictoryPursuitScores()` - Victory type prioritization

FLAVOR_WONDER contributes to the AI's preference for culture victory.

```cpp
// Weight for culture
VictoryScores[VICTORY_PURSUIT_CULTURE] += GetDoFWillingness();
VictoryScores[VICTORY_PURSUIT_CULTURE] += GetWonderCompetitiveness();
VictoryScores[VICTORY_PURSUIT_CULTURE] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_WONDER")) / 2;
VictoryScores[VICTORY_PURSUIT_CULTURE] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_CULTURE")) / 2;
VictoryScores[VICTORY_PURSUIT_CULTURE] += static_cast<int>(GC.getGame().urandRangeInclusive(1, uRandom, ...));
```

**Interpretation:** FLAVOR_WONDER contributes half its value to culture victory pursuit score. This combines with:

- **Wonder Competitiveness:** A separate trait measuring how competitive the AI is about wonder races
- **DoF Willingness:** Desire for Declaration of Friendship (culture victories benefit from peaceful diplomacy)
- **FLAVOR_CULTURE:** Direct culture generation preference

A leader with FLAVOR_WONDER = 10 adds 5 points toward preferring culture victory, making them more likely to pursue policies, technologies, and production that support cultural dominance. Combined with FLAVOR_CULTURE and wonder competitiveness, this creates the "culture victory builder" archetype.

**Strategic Implications:** Wonder-focused leaders often pursue culture victories because:

- Many wonders provide culture output
- Wonders generate Great Artist/Writer/Musician slots (culture victory requirement)
- Wonder construction aligns with peaceful, infrastructure-focused gameplay
- Famous wonders (Eiffel Tower, Cristo Redentor, Sydney Opera House) provide tourism bonuses

### 8. Grand Strategy Priority - Policy Flavor Bonus (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 918-921)

**Function:** Grand strategy priority calculation based on adopted social policies

When a player adopts social policies with FLAVOR_WONDER values, it increases the priority of wonder-focused grand strategies.

```cpp
else if(GC.getFlavorTypes((FlavorTypes) iFlavorLoop) == "FLAVOR_WONDER")
{
    iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
}
```

**Interpretation:** Policies that support wonder construction add their FLAVOR_WONDER values to grand strategy priority. This creates strategic feedback loops:

**Example - Tradition Policy Tree:**

- Tradition opener has FLAVOR_WONDER = 10
- Adopting Tradition adds +10 to culture-focused grand strategy priority
- This makes the AI more likely to pursue Culture Victory grand strategy
- Culture Victory strategy then increases wonder production priority
- More wonders built → more culture → reinforces the strategic choice

This prevents strategic "drift" where an AI adopts wonder-supporting policies but then pursues conquest strategy, creating more coherent AI behavior.

### 9. Grand Strategy Priority - Building Flavor Bonus (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 955-958)

**Function:** Grand strategy priority based on constructed buildings

Buildings with FLAVOR_WONDER values (including wonders themselves) influence grand strategy selection.

```cpp
else if(GC.getFlavorTypes((FlavorTypes) iFlavorLoop) == "FLAVOR_WONDER")
{
    iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop);
}
```

**Interpretation:** Each wonder constructed contributes its FLAVOR_WONDER value to culture-focused grand strategy priority:

- **National Wonders** (National Epic, Hermitage, Oxford University, etc.) have FLAVOR_WONDER = 10 each
- **World Wonders** (most ancient through modern wonders) have FLAVOR_WONDER = 20 each
- **Late-game Wonders** (some spaceship-related or unique wonders) have FLAVOR_WONDER = 25 each

**Cumulative Effect Example:**

- Leader builds Stonehenge (20) + Temple of Artemis (20) + Hanging Gardens (20) = +60 culture strategy priority
- Adds National Epic (10) + National College (10) = +80 total
- With base personality FLAVOR_WONDER = 7 and wonder production specialization = 2000 points
- Result: Strong reinforcement toward culture victory pursuit

This creates a **commitment mechanism** - the more wonders you build, the more the AI commits to culture/wonder victory path, making it less likely to pivot to conquest or science victory mid-game. It rewards strategic consistency.

### 10. Military Strategy Modifiers - At War Penalty (CoreStrategyChanges.sql)

**Location:** `(1) Community Patch/Database Changes/AI/CoreStrategyChanges.sql` (lines 197, 223, 249, 305, 331, 357)

**Function:** Dynamic flavor adjustments based on military situation

FLAVOR_WONDER receives significant penalties when the AI is at war, ensuring wonder construction doesn't compromise survival.

```sql
-- MILITARYAISTRATEGY_AT_WAR
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_WONDER', -20),
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_WONDER', -30),  -- Player version (more severe)

-- MILITARYAISTRATEGY_WINNING_WARS
('MILITARYAISTRATEGY_WINNING_WARS', 'FLAVOR_WONDER', -10),

-- MILITARYAISTRATEGY_LOSING_WARS
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_WONDER', -50),
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_WONDER', -100),  -- Player version (much more severe)
```

**Interpretation:** This creates adaptive behavior based on military context:

1. **At War (-20/-30):** Moderate reduction in wonder priority
   - Wonder construction continues but at reduced priority
   - Leaders might finish wonders close to completion but won't start new ones
   - More severe for human player-controlled AI to prevent exploitable behavior

2. **Winning Wars (-10):** Minor reduction
   - Aggressive leaders winning wars only slightly reduce wonder focus
   - Can still secure wonders while conducting successful military campaigns
   - Reflects confidence and surplus production capacity

3. **Losing Wars (-50/-100):** Massive reduction
   - Wonder construction effectively halted during defensive emergencies
   - All production diverted to military units and defensive structures
   - Survival takes absolute priority over prestige
   - Player-controlled version completely eliminates wonder consideration

**Strategic Impact Example:**

- Peaceful leader: FLAVOR_WONDER = 9 (base) → At War: 9 - 20 = -11 (capped at 0, effectively 0)
- Warmonger: FLAVOR_WONDER = 3 (base) → At War: 3 - 20 = -17 (already low, now eliminated)
- Losing Wars: Even FLAVOR_WONDER = 10 becomes 10 - 50 = -40 (heavily negative)

This prevents the classic AI mistake of building wonders while being invaded, ensuring tactical adaptation to military pressure.

### 11. Database - Building Flavor Assignments (BuildingFlavorSweeps.sql)

**Location:** `(2) Vox Populi/Database Changes/AI/BuildingFlavorSweeps.sql` (various lines)

**Function:** Defines which buildings have FLAVOR_WONDER characteristics

Wonders themselves are tagged with FLAVOR_WONDER values:

```sql
-- National Wonders (flavor = 10)
('BUILDING_NATIONAL_EPIC', 'FLAVOR_WONDER', 10),
('BUILDING_NATIONAL_COLLEGE', 'FLAVOR_WONDER', 10),
('BUILDING_HERMITAGE', 'FLAVOR_WONDER', 10),
('BUILDING_IRONWORKS', 'FLAVOR_WONDER', 10),

-- World Wonders - Ancient through Industrial (flavor = 20)
('BUILDING_STONEHENGE', 'FLAVOR_WONDER', 20),
('BUILDING_PYRAMIDS', 'FLAVOR_WONDER', 20),
('BUILDING_GREAT_LIBRARY', 'FLAVOR_WONDER', 20),
('BUILDING_PETRA', 'FLAVOR_WONDER', 20),
('BUILDING_TAJ_MAHAL', 'FLAVOR_WONDER', 20),
('BUILDING_EIFFEL_TOWER', 'FLAVOR_WONDER', 20),

-- Late-game Wonders (flavor = 25)
('BUILDING_CRYSTAL_PALACE', 'FLAVOR_WONDER', 25),
('BUILDING_INTERNATIONAL_SPACE_STATION', 'FLAVOR_WONDER', 25),
('BUILDING_OLYMPIC_VILLAGE', 'FLAVOR_WONDER', 25),

-- Special Buildings (unique buildings with flavor = 10-40)
('BUILDING_NEUSCHWANSTEIN', 'FLAVOR_WONDER', 40),  -- Combined with other flavors
('BUILDING_MUGHAL_FORT', 'FLAVOR_WONDER', 10),  -- UB with wonder characteristics
```

**Interpretation:** The flavor value scaling reflects:

- **National Wonders (10):** Important but more accessible (one per civilization)
- **World Wonders (20):** Primary prestige buildings, highly competitive
- **Late-game Wonders (25):** Harder to build, greater impact, higher prestige
- **Special Cases (40):** Neuschwanstein has exceptionally high FLAVOR_WONDER (combined with happiness and culture) due to its tourism and culture bonuses

This scaling allows the AI to differentiate between:

- "Nice to have" national wonders
- "Highly desirable" world wonders
- "Game-changing" late wonders

### 12. Policy Flavor Assignments (FlavorChanges.sql)

**Location:** `(1) Community Patch/Database Changes/AI/FlavorChanges.sql` (line 24)

**Function:** Assigns FLAVOR_WONDER to social policies

```sql
('POLICY_TRADITION', 'FLAVOR_WONDER', 10),
```

**Interpretation:** The Tradition policy tree has FLAVOR_WONDER = 10, making it attractive to wonder-focused leaders. This makes strategic sense because:

- Tradition provides +15% growth in capital (faster wonder production through population)
- Tradition provides +3 culture in capital (culture synergy with wonder benefits)
- Tradition's finisher provides free Aqueduct in first 4 cities (infrastructure support)
- Tradition supports "tall" gameplay (few high-population cities), which suits wonder production

This flavor assignment ensures wonder-focused civilizations naturally prefer policy trees that support their wonder-building strategy, creating coherent AI personalities.

## Summary of Effects

### Strategic Planning

- **Victory focus:** Significantly increases preference for culture victory over domination or science paths
- **Grand strategy:** Creates strong feedback loops with culture-focused grand strategies
- **Technology path:** Prioritizes research of wonder-unlocking technologies when pursuing culture strategies
- **Policy selection:** Favors policies that support wonder construction (Tradition, Patronage culture policies)

### Production Allocation

- **City specialization:** Drives cities to specialize in wonder production (up to 2500 weight for FLAVOR_WONDER = 10)
- **Wonder priority:** Determines how aggressively the AI competes for available wonders
- **Availability-limited:** Wonder specialization is capped by actually available wonders, preventing waste
- **Emergency override:** Wonder production is halved or eliminated during defensive crises

### Religious Strategy

- **Belief selection:** Highly values religious beliefs providing wonder production bonuses
- **Trait synergy:** Wonder production beliefs are valued even more highly by civilizations with wonder-building traits
- **Era awareness:** Considers belief obsolescence when evaluating wonder-related religious bonuses

### Adaptive Behavior

- **War penalties:** FLAVOR_WONDER is reduced by 20-30 points when at war, by 10 when winning, and by 50-100 when losing
- **Strategic coherence:** Building wonders reinforces culture-focused strategies through feedback loops
- **Opportunity-driven:** Wonder construction adapts to availability rather than forcing impossible goals

## Design Philosophy

FLAVOR_WONDER represents the AI's fundamental approach to prestige and architectural achievement:

1. **Cultural Ambition:** The desire to build lasting monuments that provide both mechanical benefits and cultural prestige
2. **Production Investment:** Willingness to commit significant production capacity to non-military, non-expansion projects
3. **Strategic Patience:** Wonder-focused leaders play for long-term cultural dominance rather than quick military victories
4. **Competitive Drive:** The desire to claim wonders before rival civilizations, creating "wonder races"

This creates a spectrum of AI personalities:

- **High WONDER (8-10):** Classic wonder-builders like Egypt, France, Brazil - race for every available wonder, pursue culture victory
- **Moderate WONDER (5-7):** Balanced leaders who build key wonders opportunistically but don't obsess over them
- **Low WONDER (2-4):** Pragmatic leaders who only build wonders with immediate strategic value (e.g., military wonders during conquest)
- **Wonder-indifferent (0-1):** Leaders who virtually ignore wonders, focusing entirely on military or expansion

## Typical Leader Examples

Based on the AI flavor system, typical FLAVOR_WONDER values for leader archetypes:

- **Ramesses II (Egypt):** 9-10 - Historical wonder-builder with trait bonuses
- **Napoleon (France):** 7-8 - Cultural focus with wonder-building heritage
- **Gandhi (India):** 6-7 - Peaceful builder with cultural inclinations
- **Catherine (Russia):** 5-6 - Balanced leader who builds some wonders
- **Alexander (Greece):** 2-3 - Conquest-focused with minimal wonder interest
- **Attila (Huns):** 0-1 - Pure warmonger with no wonder focus

## Related Flavors

- **FLAVOR_CULTURE:** Direct culture generation preference; highly correlated with FLAVOR_WONDER
- **FLAVOR_GREAT_PEOPLE:** Many wonders provide Great People points; works synergistically
- **FLAVOR_SPACESHIP:** Competes with FLAVOR_WONDER for production in late game
- **FLAVOR_PRODUCTION:** General production preference that supports wonder construction
- **FLAVOR_SCIENCE:** Technology advancement unlocks wonders; moderate correlation
- **FLAVOR_OFFENSE:** Inversely correlated - wonder-builders tend to be peaceful

FLAVOR_WONDER typically correlates strongly with FLAVOR_CULTURE and FLAVOR_GREAT_PEOPLE, creating the "culture victory builder" archetype. It inversely correlates with FLAVOR_OFFENSE and FLAVOR_EXPANSION, as wonder construction requires concentrated production rather than military or settler production.

## Interaction with Game Systems

### Wonder Production Mechanics

The effectiveness of FLAVOR_WONDER is modified by:

- **Civilization traits:** Egypt (+20% wonder production), France (tourism from wonders)
- **Policy bonuses:** Tradition, Patronage finisher, Liberty policies
- **Religious beliefs:** Beliefs providing wonder production modifiers
- **Golden Ages:** Some leaders get wonder production bonuses during Golden Ages
- **Great Engineers:** Can be used to rush wonder completion

### Wonder Competition

FLAVOR_WONDER creates competitive dynamics:

- **Wonder races:** Multiple high-FLAVOR_WONDER AIs competing for limited wonders
- **Strategic timing:** When to start wonders based on competition and tech advantages
- **Fallback production:** What to build when a wonder is sniped by a rival

### Production Opportunity Costs

High FLAVOR_WONDER creates trade-offs:

- **Military vulnerability:** Production spent on wonders isn't building military units
- **Expansion delay:** Wonder construction delays settler production
- **Infrastructure gaps:** May prioritize wonders over essential buildings (granaries, libraries)

The `MILITARYAISTRATEGY_AT_WAR` penalties exist specifically to force wonder-focused leaders to make pragmatic military decisions when threatened, preventing them from being easy conquest targets.

## Configuration and Tuning

The primary tunable constant for FLAVOR_WONDER balance is:

```cpp
AI_CITY_SPECIALIZATION_PRODUCTION_WEIGHT_FLAVOR_WONDER = 250
```

**Increasing this value:**

- Makes wonder-focused leaders more aggressive about wonder construction
- Increases city specialization for wonder production
- Amplifies the difference between high and low FLAVOR_WONDER leaders

**Decreasing this value:**

- Makes all leaders more pragmatic about wonder construction
- Reduces city specialization for wonders
- Makes FLAVOR_WONDER differences more subtle

**Current value (250):** Provides strong but not overwhelming wonder focus. A leader with FLAVOR_WONDER = 10 gets 2500 base weight, which is significant but can be overridden by military emergencies or lack of available wonders.
