# FLAVOR_GROWTH

## Overview

`FLAVOR_GROWTH` is an AI personality flavor that controls how strongly a civilization's leader prioritizes population growth and food production. This flavor fundamentally shapes the AI's approach to city development, influencing everything from city site selection to building construction, improvement placement, technology research, and even great person usage.

Unlike `FLAVOR_EXPANSION` (which focuses on creating new cities), `FLAVOR_GROWTH` specifically drives the AI's **commitment to increasing population within existing cities** through food production, growth-enhancing buildings, and growth-oriented improvements.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Growth-focused leaders (tall empire builders): 8-10
  - Balanced leaders: 5-7
  - Production/military-focused leaders: 3-5
  - Warmongers during active conflicts: 0-3 (temporarily reduced)

## Code References

### 1. City Site Evaluation - Food Yield Multiplier (CvSiteEvaluationClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvSiteEvaluationClasses.cpp` (lines 46, 196-203)

**Function:** `CvCitySiteEvaluator::ComputeFlavorMultipliers()`

FLAVOR_GROWTH is a primary factor in evaluating potential city settlement locations, directly affecting how the AI values food resources and tiles.

```cpp
m_iGrowthIndex = GC.getInfoTypeForString("FLAVOR_GROWTH");

// Later in flavor multiplier calculation:
if(strFlavor == "FLAVOR_GROWTH" || strFlavor == "FLAVOR_EXPANSION")
{
    m_iFlavorMultiplier[YIELD_FOOD] += pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(eFlavor);
    if(pkCitySpecializationEntry)
    {
        m_iFlavorMultiplier[YIELD_FOOD] += pkCitySpecializationEntry->GetFlavorValue(eFlavor);
    }
}
```

**Interpretation:** FLAVOR_GROWTH directly increases the food yield multiplier used in city site evaluation. A leader with FLAVOR_GROWTH = 9 will weight food tiles 9 times more heavily when selecting settlement locations, preferring sites with wheat, fish, cattle, and other high-food resources over sites with gold, production, or strategic resources. This creates a strong tendency to settle near rivers, lakes, and coastal areas rich in food resources.

### 2. Builder (Worker) Tasking - Food Improvement Priority (CvBuilderTaskingAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvBuilderTaskingAI.cpp` (lines 2687-2690)

**Function:** `CvBuilderTaskingAI::ScorePlot()`

FLAVOR_GROWTH determines how workers prioritize building improvements that increase food yield.

```cpp
case YIELD_FOOD:
    if(GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_GROWTH")
    {
        iYieldDifferenceWeight += iDeltaYield * pFlavorManager->GetPersonalityIndividualFlavor((FlavorTypes)iFlavorLoop)
            * /*3*/ GD_INT_GET(BUILDER_TASKING_PLOT_EVAL_MULTIPLIER_FOOD);
    }
    break;
```

**Interpretation:** When workers evaluate which tiles to improve, FLAVOR_GROWTH multiplies the food yield improvement value by both the flavor value and a configurable multiplier (default 3). This means:

- A leader with FLAVOR_GROWTH = 8 will value a +2 food improvement as: 2 × 8 × 3 = 48 points
- A leader with FLAVOR_GROWTH = 2 will value it as: 2 × 2 × 3 = 12 points

**Practical Effect:** High-growth leaders will prioritize building farms, fishing boats, and pastures over mines and trading posts. Workers will improve wheat and cattle before iron or horses when FLAVOR_GROWTH is high.

### 3. City Specialization - Growth Focus (CvCitySpecializationAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCitySpecializationAI.cpp` (lines 462-463)

**Function:** `CvCitySpecializationAI::LogSpecializationUpdate()`

FLAVOR_GROWTH influences long-term city specialization decisions, determining whether cities should focus on population growth.

```cpp
int iFlavorGrowth = 10 * m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GROWTH"));
if (iFlavorGrowth < 0) iFlavorGrowth = 0;
```

**Interpretation:** The growth flavor is multiplied by 10 and combined with the active grand strategy to create a city specialization weight. This means:

- FLAVOR_GROWTH = 7 adds 70 weight toward growth-focused specialization
- Cities will prioritize buildings, specialists, and citizen assignments that maximize food and population
- Growth-specialized cities will work more food tiles and avoid working production/gold tiles until population caps are reached

### 4. Victory Pursuit - Science Victory Preference (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (line 2404)

**Function:** `CvDiplomacyAI::DoUpdateVictoryPursuitScores()`

FLAVOR_GROWTH contributes to the AI's preference for science victory, reflecting that larger populations generate more science.

```cpp
// Weight for science
VictoryScores[VICTORY_PURSUIT_SCIENCE] += GetLoyalty();
VictoryScores[VICTORY_PURSUIT_SCIENCE] += GetWarmongerHate();
VictoryScores[VICTORY_PURSUIT_SCIENCE] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_SCIENCE")) / 2;
VictoryScores[VICTORY_PURSUIT_SCIENCE] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GROWTH")) / 2;
```

**Interpretation:** FLAVOR_GROWTH contributes half its value to science victory pursuit. This reflects the game mechanic that larger cities generate more science through population. A leader with FLAVOR_GROWTH = 10 adds 5 points toward preferring science victory, recognizing that population growth is a path to technological supremacy.

### 5. City-State Interaction - Food-Focused Allies (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (line 32223)

**Function:** City-state gift and alliance priority calculation

FLAVOR_GROWTH influences which city-states the AI values and how much to invest in them.

```cpp
int iGrowthFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GROWTH"));
```

**Interpretation:** This flavor value is retrieved when calculating city-state alliance priorities. Leaders with high FLAVOR_GROWTH will value:

- Maritime city-states (which provide food bonuses to coastal cities)
- City-states with food-boosting quests and benefits
- Alliance bonuses that increase food yields or growth rates

**Strategic Impact:** Growth-focused leaders will invest more gold in maritime city-states and prioritize their protection, creating a network of food-producing allies.

### 6. Grand Strategy - Science Victory Building Priority (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 1483-1486)

**Function:** `CvGrandStrategyAI::GetScienceVictoryPriority()`

Buildings with FLAVOR_GROWTH values contribute to science victory grand strategy priority.

```cpp
for(int iFlavorLoop = 0; iFlavorLoop < GC.getNumFlavorTypes(); iFlavorLoop++)
{
    if(GC.getFlavorTypes((FlavorTypes) iFlavorLoop) == "FLAVOR_GROWTH")
    {
        iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop);
    }
```

**Interpretation:** When the AI evaluates whether to pursue science victory, it sums the FLAVOR_GROWTH values of all buildings it has constructed. Growth-enhancing buildings like granaries, aqueducts, hospitals, and medical labs increase the appeal of science victory, creating a feedback loop where building for growth makes science victory more attractive.

**Buildings Contributing to Growth Priority:**

- Granary (FLAVOR_GROWTH: 35)
- Aqueduct (FLAVOR_GROWTH: 25)
- Grocer (FLAVOR_GROWTH: 25)
- Hospital (FLAVOR_GROWTH: 35)
- Medical Lab (FLAVOR_GROWTH: 40)

### 7. Great Person Directive - Improvement Placement (CvPlayerAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPlayerAI.cpp` (lines 1604, 1644, 1705)

**Function:** Great person improvement construction decisions

FLAVOR_GROWTH influences whether great people should construct tile improvements (Manufactories, Customs Houses, Academies) versus using their special abilities.

#### Great Engineer - Manufactory Decision

```cpp
int iFlavor = GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_PRODUCTION"));
iFlavor += GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GROWTH"));
```

**Interpretation:** Great Engineers evaluate whether to build manufactories based on combined production and growth flavors. FLAVOR_GROWTH increases the likelihood that engineers will place manufactories (which provide food in addition to production) rather than rushing production on buildings or wonders. A leader with FLAVOR_GROWTH = 8 will build up to 8+ manufactories before switching to production rushing.

#### Great Merchant - Customs House Decision

```cpp
int iFlavor = GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GOLD"));
iFlavor += GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GROWTH"));
```

**Interpretation:** Great Merchants similarly consider growth flavor when deciding whether to build customs houses. Growth-focused leaders prefer the long-term benefit of tile improvements that boost both gold and food over one-time gold injections from trade missions.

#### Great Scientist - Academy Decision

```cpp
iFlavor += GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GROWTH"));
```

**Interpretation:** Even Great Scientists consider FLAVOR_GROWTH when deciding whether to build academies. Growth-focused leaders are more likely to plant academies for long-term science bonuses (which scale with population growth) rather than consuming scientists for immediate technology boosts.

### 8. Religion Founding - Follower Belief Selection (CvReligionClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (lines 8090-8091)

**Function:** `CvReligionAI::ScoreBeliefForPlayer()`

FLAVOR_GROWTH heavily influences which religious beliefs the AI selects when founding or enhancing religions.

```cpp
case YIELD_FOOD:
    iPersonFlavor = pFlavorManager->GetPersonalityIndividualFlavor(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GROWTH")) * 50;
```

**Interpretation:** When evaluating religious beliefs that grant food yields, the FLAVOR_GROWTH value is multiplied by 50. This creates enormous differences in belief selection:

- FLAVOR_GROWTH = 9: Food-granting beliefs score 450 points
- FLAVOR_GROWTH = 3: Food-granting beliefs score 150 points

**Affected Beliefs:**

- Fertility Rites (+10% growth in cities)
- Feed the World (Granary provides +2 food)
- Religious Community (+1% growth per city following religion)
- Cathedrals/Pagodas (buildings that provide food bonuses)

**Strategic Impact:** Growth-focused leaders will almost always select food-boosting beliefs for their religions, while warmongers and production-focused leaders will ignore these beliefs in favor of military or production bonuses.

### 9. Policy Selection - Growth Policy Weighting (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4944-4947)

**Function:** Social policy selection priority

FLAVOR_GROWTH adds weight to social policies that provide growth bonuses.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_GROWTH")
{
    iWeight += iFlavorValue;
}
```

**Interpretation:** Policies with FLAVOR_GROWTH values are prioritized by growth-focused leaders. The flavor value from the policy is added directly to the policy's selection weight.

**Growth-Focused Policies:**

- Tradition (FLAVOR_GROWTH: 7) - Overall growth-focused tree
- Monarchy (FLAVOR_GROWTH: 5) - +1 gold/happiness per 2 population
- Collective Rule (FLAVOR_GROWTH: 5) - Free settler and +50% settler production
- Piety/Mandate of Heaven (FLAVOR_GROWTH: 14/12) - Religious growth bonuses
- Merchant Navy (FLAVOR_GROWTH: 24) - Maritime trade and coastal growth
- Rationalism (FLAVOR_GROWTH: 30) - Science from population
- Resettlement (FLAVOR_GROWTH: 60) - Order policy for growth in new cities

**Policy Tree Prioritization:** Leaders with FLAVOR_GROWTH ≥ 7 will strongly favor the Tradition policy tree, which synergizes with tall empire strategies focused on growing fewer, larger cities.

### 10. Technology Research - Growth Technology Priority (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (lines 1282-1287)

**Function:** Technology research priority for "Smaller" player trait

For civilizations with the "Smaller" trait (bonuses for fewer, larger cities), FLAVOR_GROWTH increases technology research priority.

```cpp
if (m_pPlayer->GetPlayerTraits()->IsSmaller() &&
    (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_GROWTH" ||
     GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NAVAL_GROWTH" ||
     GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_CITY_DEFENSE"))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

**Interpretation:** "Smaller" civilizations (designed for tall empire play) get bonus research priority for technologies with growth flavors. This ensures they pursue food-enhancing techs earlier and more consistently.

**Growth-Focused Technologies:**

- Agriculture (FLAVOR_GROWTH: 10) - Farms and wheat
- Pottery (FLAVOR_GROWTH: 20) - Granaries and settlers
- Trapping (FLAVOR_GROWTH: 10) - Camps and deer
- Calendar (FLAVOR_GROWTH: 5) - Plantations
- Construction (FLAVOR_GROWTH: 5) - Improved farms
- Engineering (FLAVOR_GROWTH: 15) - Aqueducts
- Civil Service (FLAVOR_GROWTH: 10) - Farm bonuses on rivers
- Chemistry (FLAVOR_GROWTH: 15) - Grocers
- Economics (FLAVOR_GROWTH: 5) - Windmills
- Fertilizer (FLAVOR_GROWTH: 5) - Farm yield improvements
- Biology (FLAVOR_GROWTH: 15) - Medical research
- Corporations (FLAVOR_GROWTH: 30) - Corporate franchises
- Penicillin (FLAVOR_GROWTH: 25) - Medical labs

**Research Impact:** High FLAVOR_GROWTH leaders will beeline technologies that unlock growth-enhancing buildings and improvements, often delaying military or wonder technologies.

### 11. Military Strategy Modifiers - War Penalizes Growth (CoreStrategyChanges.sql)

**Location:** `(1) Community Patch/Database Changes/AI/CoreStrategyChanges.sql` (lines 201, 227, 253, 275)

**Function:** Dynamic flavor adjustment during warfare

FLAVOR_GROWTH is **temporarily reduced** when the AI enters wartime strategies, reflecting that warfare interrupts population growth.

```sql
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_GROWTH', -10),
('MILITARYAISTRATEGY_WINNING_WARS', 'FLAVOR_GROWTH', -10),
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_GROWTH', -30),
('MILITARYAISTRATEGY_WAR_MOBILIZATION', 'FLAVOR_GROWTH', -10),
```

**Interpretation:**

- **At War:** -10 FLAVOR_GROWTH (moderate reduction)
- **Winning Wars:** -10 FLAVOR_GROWTH (conquest takes priority)
- **Losing Wars:** -30 FLAVOR_GROWTH (desperate military focus)
- **War Mobilization:** -10 FLAVOR_GROWTH (preparing for conflict)

**Strategic Impact:** During warfare, the AI will:

- Deprioritize granaries, aqueducts, and hospitals
- Work fewer food tiles in favor of production tiles
- Build fewer farms and more mines
- Accept stagnant or negative growth to build military units
- Delay growth technologies in favor of military techs

This creates realistic wartime behavior where civilian growth projects are suspended in favor of military mobilization.

### 12. City Strategy - Happiness Crisis Response (StrategyChanges.sql)

**Location:** `(2) Vox Populi/Database Changes/AI/StrategyChanges.sql` (lines 42, 45, 57)

**Function:** City-level strategy adjustments during happiness crises

FLAVOR_GROWTH temporarily **increases** during certain happiness crisis strategies, causing the AI to build growth infrastructure to work through the crisis.

```sql
('AICITYSTRATEGY_NEED_HAPPINESS_DEFENSE', 'FLAVOR_GROWTH', 40),
('AICITYSTRATEGY_NEED_HAPPINESS_GOLD', 'FLAVOR_GROWTH', 30),
('AICITYSTRATEGY_NEED_HAPPINESS_STARVE', 'FLAVOR_GROWTH', 60),
```

**Interpretation:**

- **Need Happiness (Defense):** +40 FLAVOR_GROWTH - Build growth infrastructure to overcome unhappiness
- **Need Happiness (Gold):** +30 FLAVOR_GROWTH - Grow to generate more gold for happiness buildings
- **Need Happiness (Starve):** +60 FLAVOR_GROWTH - Massive growth bonus to prevent starvation

**Counterintuitive Logic:** When cities are starving or facing severe unhappiness, FLAVOR_GROWTH increases dramatically. This represents the AI's recognition that it must build granaries, aqueducts, and hospitals to stabilize the situation, even though these buildings don't directly provide happiness.

### 13. Process Selection - Food Production Focus (ProcessFlavorSweeps.sql)

**Location:** `(2) Vox Populi/Database Changes/AI/ProcessFlavorSweeps.sql` (line 11)

**Function:** City production process selection

FLAVOR_GROWTH influences the selection of the "Wealth/Food Production" process.

```sql
('PROCESS_FOOD', 'FLAVOR_GROWTH', 5),
```

**Interpretation:** Cities with nothing else to build can convert production into food through a process. Leaders with FLAVOR_GROWTH ≥ 5 will more frequently select this option during peacetime, actively converting hammers into food to continue growing beyond the natural food surplus.

### 14. Advisor Recommendation System (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (lines 302-305)

**Function:** Economic advisor recommendation priority

When the Economic Advisor provides recommendations to the player, FLAVOR_GROWTH has a specific priority weight.

```cpp
else if(strFlavorName == "FLAVOR_GROWTH")
{
    return 15;
}
```

**Interpretation:** FLAVOR_GROWTH receives a priority weight of 15 in the economic advisor's recommendation system. This is higher than expansion (11), infrastructure (9), and tile improvement (13), but lower than gold (18) and production (14). The economic advisor will recommend growth-enhancing actions (building granaries, working food tiles) more frequently to civilizations with high growth flavors.

## Database Flavor Values

### Buildings with High FLAVOR_GROWTH

Buildings are evaluated by the AI based on their FLAVOR_GROWTH values. Higher values mean the AI prioritizes these buildings when growth-focused.

**Early Game (Ancient-Classical Era):**

- Granary: 35
- Qullqa (Incan unique): 50
- Longhouse (Iroquois unique): 30
- Smokehouse: 20
- Herbalist: 20
- Buffalo Pound: 25
- Well: 15
- Lighthouse: 10

**Mid Game (Medieval-Renaissance Era):**

- Aqueduct: 25
- Harappan Reservoir (Indian unique): 40
- Watermill: 25
- Nilometer (Egyptian unique): 40
- Bimaristan: 20
- Runestone: 15

**Late Game (Industrial-Modern Era):**

- Grocer: 25
- Windmill: 10
- Brewhouse: 10
- Agribusiness: 30
- Andelsbevaegelse (Danish unique): 40
- Hospital: 35
- Hydro Plant: 30
- Medical Lab: 40

**Wonders:**

- Temple of Artemis: 30
- Hanging Gardens: 30
- Huey Teocalli: 30
- Angkor Wat: 20
- Etemenanki: 20
- Forbidden Palace: 20
- International Finance Center: 60

**Religious Buildings:**

- Monastery: 15
- Mandir: 6
- Gurdwara: 10

**Corporations:**

- Two-Kay Foods (Office): 50
- Two-Kay Foods (HQ): 100

### Technologies with High FLAVOR_GROWTH

**Ancient Era:**

- Agriculture: 10 (Farms, wheat)
- Pottery: 20 (Granary, settlers, fishing boats)
- Trapping: 10 (Camps, food resources)

**Classical Era:**

- Calendar: 5 (Plantations)
- Construction: 5 (Building improvements)

**Medieval Era:**

- Engineering: 15 (Aqueducts)
- Civil Service: 10 (Farm bonuses on rivers)

**Renaissance Era:**

- Chemistry: 15 (Grocers)
- Economics: 5 (Windmills)

**Industrial Era:**

- Fertilizer: 5 (Farm improvements)
- Biology: 15 (Medical advances)

**Modern Era:**

- Corporations: 30 (Food corporations)
- Penicillin: 25 (Medical labs)

## Summary of Effects

### Strategic Planning

- **Victory focus:** Increases preference for science victory, recognizing that population drives science output
- **Grand strategy:** Creates feedback loops with science-focused buildings and policies
- **City placement:** Prioritizes food-rich locations (rivers, coasts, wheat, fish, cattle) over strategic or production-rich sites

### City Development

- **Building priority:** Prioritizes granaries, aqueducts, hospitals, and medical labs over production or gold buildings
- **Specialization:** Designates cities as growth-focused, working food tiles over production/gold tiles
- **Tile improvements:** Workers prioritize farms, fishing boats, and pastures over mines and trading posts
- **Citizen assignment:** Cities work food tiles even at the expense of production and gold

### Economic Strategy

- **Technology research:** Beelines food-enhancing technologies (Pottery, Civil Service, Chemistry, Biology)
- **Policy selection:** Favors Tradition tree, Rationalism, and growth-boosting policies
- **Religion:** Selects food-granting beliefs (Fertility Rites, Feed the World, Religious Community)
- **City-states:** Invests in maritime city-states for food bonuses

### Great People

- **Great Engineers:** Build manufactories for long-term food/production over rushing wonders
- **Great Merchants:** Build customs houses for long-term yield over one-time gold injections
- **Great Scientists:** Plant academies for long-term science over immediate tech boosts

### Dynamic Adjustments

- **Wartime:** FLAVOR_GROWTH temporarily decreases by 10-30 during warfare, suspending growth projects
- **Happiness crisis:** FLAVOR_GROWTH increases by 30-60 during unhappiness emergencies, forcing infrastructure construction
- **Grand strategy shifts:** Growth flavor interacts with active grand strategy to modify building and research priorities

## Design Philosophy

FLAVOR_GROWTH represents the AI's fundamental approach to population and food:

1. **Settlement Strategy:** Where to place cities (food-rich vs resource-rich locations)
2. **Development Priority:** What to build (growth infrastructure vs military/production buildings)
3. **Long-term Planning:** Whether to pursue tall empire strategy (fewer, larger cities) vs wide empire strategy (many small cities)

This creates a spectrum of AI city development strategies:

- **High GROWTH (8-10):** Tall empire builders who maximize city sizes, build extensive growth infrastructure, and pursue science victory through large populations
- **Moderate GROWTH (5-7):** Balanced leaders who maintain healthy city sizes while also investing in production, military, and gold
- **Low GROWTH (2-4):** Wide empire or production-focused leaders who prioritize territory and hammers over population
- **Warmongers (0-2 during war):** Military-focused leaders who accept stagnant growth during conquest campaigns

## Related Flavors

- **FLAVOR_EXPANSION:** Territorial growth through new city settlement (complements high growth for "tall" empires, contrasts for "wide" empires)
- **FLAVOR_PRODUCTION:** Alternative development path focusing on hammers over food
- **FLAVOR_SCIENCE:** Synergizes with growth (larger cities = more science)
- **FLAVOR_NAVAL_GROWTH:** Specialized growth for coastal/island civilizations
- **FLAVOR_TILE_IMPROVEMENT:** Infrastructure focus that includes farms but also mines and trading posts
- **FLAVOR_INFRASTRUCTURE:** Roads, railroads, and connectivity (complements growth by connecting food-producing cities)

**Typical Combinations:**

- **High Growth + High Science:** Classic tall empire/science victory strategy (Korea, Babylon)
- **High Growth + Low Expansion:** Few large cities focused on maximizing population
- **High Growth + High Expansion:** Rapid settlement followed by aggressive growth (requires strong happiness management)
- **Low Growth + High Production:** Military/wonder-focused civilizations that value hammers over population

FLAVOR_GROWTH is dynamically adjusted by military strategies and city strategies, making it one of the most responsive flavors to changing game conditions. A peacetime growth-focused leader may temporarily become a wartime production-focused leader, then return to growth priorities after the war.
