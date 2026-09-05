# FLAVOR_SPACESHIP

## Overview

`FLAVOR_SPACESHIP` is an AI personality flavor that controls how strongly a civilization's leader prioritizes the space race endgame and science victory through spaceship construction. This flavor is specifically focused on the **late-game science victory pursuit**, distinguishing it from `FLAVOR_SCIENCE` (which drives broad scientific research throughout the entire game).

While `FLAVOR_SCIENCE` influences technology research and science infrastructure from the ancient era onward, `FLAVOR_SPACESHIP` activates primarily in the late game when Apollo Program and spaceship parts become available, driving the AI to prioritize spaceship factory construction, spaceship part production, and the final push toward launching a colony ship to Alpha Centauri.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Science victory specialists (Korea, Babylon): 9-10
  - Science-focused leaders: 7-9
  - Balanced/generalist leaders: 5-6
  - Diplomatic/cultural leaders: 4-5
  - Warmongers and domination-focused leaders: 3-4

## Code References

### 1. Grand Strategy - AIGRANDSTRATEGY_SPACESHIP (CoreStrategyChanges.sql)

**Location:** `(1) Community Patch/Database Changes/AI/CoreStrategyChanges.sql` (lines 21, 35-37)

**Function:** Grand Strategy configuration for science victory

FLAVOR_SPACESHIP is the defining flavor for the AIGRANDSTRATEGY_SPACESHIP grand strategy, which represents the AI's pursuit of science victory through the space race.

```sql
INSERT INTO AIGrandStrategy_Flavors
    (AIGrandStrategyType, FlavorType, Flavor)
VALUES
    ('AIGRANDSTRATEGY_SPACESHIP', 'FLAVOR_SPACESHIP', 20);

INSERT INTO AIGrandStrategy_Yields
    (AIGrandStrategyType, YieldType, Yield)
VALUES
    ('AIGRANDSTRATEGY_SPACESHIP', 'YIELD_SCIENCE', 400),
    ('AIGRANDSTRATEGY_SPACESHIP', 'YIELD_FOOD', 300),
    ('AIGRANDSTRATEGY_SPACESHIP', 'YIELD_PRODUCTION', 200);
```

**Interpretation:** When an AI adopts the Spaceship grand strategy, it gains:

- **+20 FLAVOR_SPACESHIP** bonus, massively increasing spaceship-related priorities
- **+400 YIELD_SCIENCE** weight for city specialization and evaluation
- **+300 YIELD_FOOD** weight for population growth (larger cities = more production)
- **+200 YIELD_PRODUCTION** weight for spaceship part construction

This grand strategy becomes active when the AI determines that science victory is its best path, typically in the late game when it has strong technological leadership and the Apollo Program is available.

**Strategic Impact:** The grand strategy creates a positive feedback loop - spaceship construction increases spaceship priority, which reinforces the grand strategy, which further increases focus on spaceship parts. This prevents the AI from abandoning science victory once it commits to the space race.

### 2. City Specialization - Production Specialization for Spaceship (CvCitySpecializationAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCitySpecializationAI.cpp` (lines 544, 621-624, 635-638, 647)

**Function:** `CvCitySpecializationAI::GetWeightedProductionSpecializations()`

FLAVOR_SPACESHIP determines whether cities should specialize in spaceship part production, which is one of five production specialization types.

```cpp
int iFlavorSpaceship = m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_SPACESHIP"));
if (iFlavorSpaceship < 0) iFlavorSpaceship = 0;

// ...

if (CanBuildSpaceshipParts())
{
    iSpaceshipWeight += iFlavorSpaceship * /*10*/ GD_INT_GET(AI_CITY_SPECIALIZATION_PRODUCTION_WEIGHT_FLAVOR_SPACESHIP);
}

CvAIGrandStrategyXMLEntry* grandStrategy = GC.getAIGrandStrategyInfo(m_pPlayer->GetGrandStrategyAI()->GetActiveGrandStrategy());
if(grandStrategy)
{
    if(grandStrategy->GetSpecializationBoost(YIELD_PRODUCTION) > 0)
    {
        if(grandStrategy->GetFlavorValue((FlavorTypes)GC.getInfoTypeForString("FLAVOR_OFFENSE")) > 0)
        {
            iMilitaryTrainingWeight += grandStrategy->GetSpecializationBoost(YIELD_PRODUCTION);
        }
        else if(grandStrategy->GetFlavorValue((FlavorTypes)GC.getInfoTypeForString("FLAVOR_SPACESHIP")) > 0)
        {
            iSpaceshipWeight += grandStrategy->GetSpecializationBoost(YIELD_PRODUCTION);
        }
    }
}

// Add weights to our weighted vector
result.push_back(PRODUCTION_SPECIALIZATION_SPACESHIP, iSpaceshipWeight);
```

**Interpretation:** The spaceship production specialization weight is calculated by:

1. **Base Weight:** `FLAVOR_SPACESHIP × 10` (configurable via AI_CITY_SPECIALIZATION_PRODUCTION_WEIGHT_FLAVOR_SPACESHIP)
2. **Grand Strategy Bonus:** If pursuing spaceship grand strategy, add production boost from grand strategy (+200)
3. **Availability Gate:** Only applies if `CanBuildSpaceshipParts()` returns true (Apollo Program completed or spaceship parts unlocked)

**Example Calculations:**

- Leader with FLAVOR_SPACESHIP = 9: Base weight = 9 × 10 = 90
- With spaceship grand strategy active: 90 + 200 = 290 weight
- Leader with FLAVOR_SPACESHIP = 3: Base weight = 3 × 10 = 30
- With spaceship grand strategy: 30 + 200 = 230 weight

**Production Specialization Types:**

1. PRODUCTION_SPECIALIZATION_MILITARY_TRAINING (long-term military buildup)
2. PRODUCTION_SPECIALIZATION_EMERGENCY_UNITS (immediate military needs)
3. PRODUCTION_SPECIALIZATION_MILITARY_NAVAL (naval forces)
4. PRODUCTION_SPECIALIZATION_WONDER (world wonders)
5. **PRODUCTION_SPECIALIZATION_SPACESHIP (spaceship parts)**

**Strategic Impact:** Cities with spaceship specialization will:

- Prioritize building spaceship factory if not already present
- Queue spaceship parts (SS Cockpit, SS Booster, SS Engine, SS Stasis Chamber)
- Assign specialists to engineer and scientist slots for production/science
- Focus tile improvements on production-enhancing tiles
- Manage citizens to maximize production output

This creates dedicated "space cities" that serve as the manufacturing hubs for the space race, typically the civilization's largest and most productive cities.

### 3. Grand Strategy Priority - Science Victory Evaluation (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 276-279, 1359-1520)

**Function:** `CvGrandStrategyAI::GetSpaceshipPriority()`

FLAVOR_SPACESHIP indirectly influences the science victory grand strategy priority calculation through the evaluation of policies and buildings.

```cpp
else if (strGrandStrategyName == "AIGRANDSTRATEGY_SPACESHIP")
{
    iTempPriority += GetSpaceshipPriority();
}
```

#### Apollo Program Check (Lines 1414-1421)

```cpp
// if I already built the Apollo Program I am very likely to follow through
ProjectTypes eApolloProgram = (ProjectTypes) GC.getInfoTypeForString("PROJECT_APOLLO_PROGRAM", true);
if(eApolloProgram != NO_PROJECT)
{
    if(GET_TEAM(m_pPlayer->getTeam()).getProjectCount(eApolloProgram) > 0)
    {
        iPriority += /*150*/ GD_INT_GET(AI_GS_SS_HAS_APOLLO_PROGRAM);
    }
}
```

**Interpretation:** Building the Apollo Program adds +150 priority to spaceship grand strategy, creating strong commitment to completing the space race. This represents the massive investment made in space infrastructure that should not be abandoned.

#### Policy Flavor Evaluation (Lines 1428-1457)

```cpp
//Add priority value based on flavors of policies we've acquired.
for(int iPolicyLoop = 0; iPolicyLoop < GC.getNumPolicyInfos(); iPolicyLoop++)
{
    const PolicyTypes ePolicy = static_cast<PolicyTypes>(iPolicyLoop);
    CvPolicyEntry* pkPolicyInfo = GC.getPolicyInfo(ePolicy);
    if(pkPolicyInfo)
    {
        if(GetPlayer()->GetPlayerPolicies()->HasPolicy(ePolicy) && !GetPlayer()->GetPlayerPolicies()->IsPolicyBlocked(ePolicy))
        {
            for(int iFlavorLoop = 0; iFlavorLoop < GC.getNumFlavorTypes(); iFlavorLoop++)
            {
                if(GC.getFlavorTypes((FlavorTypes) iFlavorLoop) == "FLAVOR_SPACESHIP")
                {
                    iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
                }
            }
        }
    }
}
```

**Interpretation:** The AI accumulates FLAVOR_SPACESHIP values from all adopted policies. Policies that support space race (like Space Procurements or Spaceflight Pioneers) increase the attractiveness of continuing toward science victory.

**Example Policy Accumulation:**

- Space Procurements (FLAVOR_SPACESHIP: 60)
- Spaceflight Pioneers (FLAVOR_SPACESHIP: 60)
- Total policy bonus: +120 priority toward spaceship grand strategy

#### Building Flavor Evaluation (Lines 1458-1495)

```cpp
//Look for Buildings and grab flavors.
int iLoop = 0;
for (CvCity* pLoopCity = m_pPlayer->firstCity(&iLoop); pLoopCity != NULL; pLoopCity = m_pPlayer->nextCity(&iLoop))
{
    int iNumBuildingInfos = GC.getNumBuildingInfos();
    for(int iI = 0; iI < iNumBuildingInfos; iI++)
    {
        const BuildingTypes eBuildingLoop = static_cast<BuildingTypes>(iI);
        if(eBuildingLoop == NO_BUILDING)
            continue;
        if(pLoopCity->GetCityBuildings()->GetNumBuilding(eBuildingLoop) > 0)
        {
            CvBuildingEntry* pkLoopBuilding = GC.getBuildingInfo(eBuildingLoop);
            if(pkLoopBuilding)
            {
                for(int iFlavorLoop = 0; iFlavorLoop < GC.getNumFlavorTypes(); iFlavorLoop++)
                {
                    if(GC.getFlavorTypes((FlavorTypes) iFlavorLoop) == "FLAVOR_SPACESHIP")
                    {
                        iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop);
                    }
                }
            }
        }
    }
}
```

**Interpretation:** Each spaceship-related building adds to the science victory priority. This creates a feedback loop where building space infrastructure makes science victory more attractive.

**Example Building Accumulation (per city):**

- Spaceship Factory (FLAVOR_SPACESHIP: 100) × 4 core cities = +400 priority
- Hubble Space Telescope (FLAVOR_SPACESHIP: 200) = +200 priority
- International Space Station (FLAVOR_SPACESHIP: 100) = +100 priority
- Recycling Center (FLAVOR_SPACESHIP: 50) × 4 cities = +200 priority
- **Total building bonus: +900 priority toward spaceship grand strategy**

**Strategic Impact:** The cumulative effect of policies and buildings creates enormous momentum toward science victory. A civilization that has invested in space infrastructure becomes highly committed to completing the space race, making it difficult to abandon this victory path mid-game.

### 4. Technology Research Priority - Science Focus (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (line 1278)

**Function:** `CvPlayerTechs::GetResearchPriority()`

FLAVOR_SPACESHIP increases technology research priority when the AI is pursuing a science-focused grand strategy.

```cpp
if(bScienceFocus && (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SCIENCE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SPACESHIP"))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

**Interpretation:** When the active grand strategy has a science focus (typically AIGRANDSTRATEGY_SPACESHIP), technologies with FLAVOR_SPACESHIP or FLAVOR_SCIENCE flavors receive +1 bonus priority. This creates a technology beeline effect toward spaceship-enabling technologies.

**Technologies with FLAVOR_SPACESHIP:**

- Satellites (FLAVOR_SPACESHIP: 75) - Unlocks Apollo Program, Hubble Space Telescope
- Robotics (FLAVOR_SPACESHIP: 50) - Unlocks Spaceship Factory
- Nanotechnology (FLAVOR_SPACESHIP: 20) - Unlocks SS Stasis Chamber
- Particle Physics (FLAVOR_SPACESHIP: 20) - Unlocks SS Engine
- Globalization (FLAVOR_SPACESHIP: 20) - Economic science support
- Nuclear Fusion (FLAVOR_SPACESHIP: 20) - Unlocks SS Booster

**Technology Beeline Strategy:** Science-focused leaders will prioritize:

1. **Satellites (75)** - Critical for Apollo Program and Hubble
2. **Robotics (50)** - Essential for Spaceship Factory
3. **Late-game techs (20 each)** - For individual spaceship parts

**Strategic Impact:** The AI rapidly advances through the late-game technology tree, unlocking spaceship-related technologies ahead of other late-game priorities. This ensures that when the AI commits to science victory, it has the technological foundation to complete the space race quickly.

### 5. Policy Selection - Space Race Policies (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4972-4975)

**Function:** Social policy AI evaluation

FLAVOR_SPACESHIP values from policies are accumulated into the science interest score, influencing policy selection priority.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SPACESHIP")
{
    iScienceValue += iFlavorValue;
}
```

**Interpretation:** Policies with FLAVOR_SPACESHIP are valued by science-focused AIs. The flavor value contributes to the science policy interest score that determines policy adoption priority.

**Space Race Policies:**

- **Space Procurements (Freedom Tier 2):** FLAVOR_SPACESHIP: 60
  - +100% production for Spaceship Factory building
  - Dramatic acceleration of spaceship part construction

- **Spaceflight Pioneers (Freedom Tier 3):** FLAVOR_SPACESHIP: 60
  - May finish spaceship parts with Great Engineers
  - Allows instant completion of spaceship components
  - Provides alternative to pure production approach

**Policy Tree Implications:** Leaders with high FLAVOR_SPACESHIP will strongly favor the Freedom ideology for its space race bonuses. The combination of Space Procurements and Spaceflight Pioneers provides both:

1. **Production acceleration:** Double speed spaceship factories
2. **Great Engineer synergy:** Convert great person production into instant spaceship parts

**Strategic Impact:** High FLAVOR_SPACESHIP leaders will prioritize Freedom ideology and rush these two policies when approaching the space race endgame. This creates a clear policy path for science victory that complements the building and technology strategies.

### 6. City Strategy - Science Victory Interest (CvCityStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCityStrategyAI.cpp` (lines 4533-4535)

**Function:** City economic strategy interest calculation

FLAVOR_SPACESHIP indirectly influences city strategy through the spaceship grand strategy priority.

```cpp
else if (strGrandStrategyName == "AIGRANDSTRATEGY_SPACESHIP")
{
    iScienceInterest += kPlayer.GetGrandStrategyAI()->GetGrandStrategyPriority(eGrandStrategy);
}
```

**Interpretation:** When the player's active grand strategy is AIGRANDSTRATEGY_SPACESHIP, the city's science interest increases by the grand strategy priority value. This influences city-level decisions about:

- Which buildings to construct (science vs. military vs. gold)
- How to allocate specialists (scientists vs. engineers vs. merchants)
- Which tiles to work (science-generating vs. production-generating)
- Whether to purchase buildings with gold or faith

**City Strategy Impact:**

- Cities in spaceship-pursuing civilizations prioritize science and production buildings
- Specialist slots allocated to scientists and engineers
- Citizens assigned to high-production tiles for spaceship part construction
- Gold savings directed toward purchasing spaceship factories or upgrading production capacity

### 7. Spaceship Part Production - Core City Selection (CvPlayer.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPlayer.cpp` (lines 46517-46519)

**Function:** AI spaceship part production city selection

FLAVOR_SPACESHIP indirectly affects which cities are designated as "core spaceship production cities" through the configurable define.

```cpp
int iNumCitiesToConsider = GD_INT_GET(AI_NUM_CORE_CITIES_FOR_SPACESHIP);
```

**Define Configuration:**

```sql
-- Number of cities the AI considers as core production cities for spaceship building
('AI_NUM_CORE_CITIES_FOR_SPACESHIP', 4),
```

**Interpretation:** The AI limits spaceship part production to the top 4 most productive cities (configurable). This creates focused production hubs rather than dispersing spaceship parts across all cities.

**Core City Selection Criteria:**

1. **Production capacity:** Cities with highest raw production
2. **Spaceship factory presence:** Cities with spaceship factories prioritized
3. **Growth potential:** Large cities with high food surplus
4. **Infrastructure:** Cities with research labs, public schools, factories
5. **Strategic location:** Capital and high-value core cities

**Strategic Impact:** Concentrating spaceship production in 4 core cities:

- **Maximizes efficiency:** Best production cities build parts faster
- **Simplifies management:** Fewer cities need spaceship specialization
- **Enables specialization:** Other cities can focus on science, military, or gold
- **Reduces vulnerability:** Core cities typically well-defended and away from borders

**Production Strategy:** The 4 core cities will alternate between building different spaceship parts to ensure balanced progress:

- City 1: SS Cockpit → SS Stasis Chamber → SS Cockpit (repeat)
- City 2: SS Booster → SS Engine → SS Booster (repeat)
- City 3: SS Booster → SS Stasis Chamber → SS Booster (repeat)
- City 4: SS Engine → SS Cockpit → SS Engine (repeat)

This rotation ensures all part types are produced in parallel, preventing bottlenecks where one part type is completed while others lag behind.

### 8. Advisor System - Recommendation Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (lines 493-496)

**Function:** Science advisor recommendation priority mapping

FLAVOR_SPACESHIP receives the highest priority weight in the advisor recommendation system.

```cpp
else if(strFlavorName == "FLAVOR_SPACESHIP")
{
    return 17;
}
```

**Interpretation:** FLAVOR_SPACESHIP has a priority weight of 17, the **highest of all flavors** in the advisor system. This reflects its critical importance during the space race endgame.

**Advisor Priority Comparison:**

- FLAVOR_SPACESHIP: 17 (highest - space race critical)
- FLAVOR_SCIENCE: 13 (high - general science importance)
- FLAVOR_WONDER: 12 (high - world wonder construction)
- FLAVOR_OFFENSE: 10 (moderate-high - military focus)
- FLAVOR_DEFENSE: 7 (moderate - defensive military)
- FLAVOR_GROWTH: 5 (moderate - population growth)

**Advisor Behavior:** When FLAVOR_SPACESHIP is active, the science advisor will:

- Strongly recommend building Apollo Program
- Prioritize Spaceship Factory construction in production cities
- Suggest completing spaceship parts as top priority
- Recommend technologies that unlock spaceship components
- Advise adopting Space Procurements and Spaceflight Pioneers policies
- Suggest protecting production cities from enemy attacks
- Recommend research agreements to accelerate technology progress

**Strategic Impact:** The advisor system's high priority for FLAVOR_SPACESHIP ensures that once the AI commits to science victory, its recommendations align consistently with space race completion. This prevents the advisor from suggesting conflicting strategies (like wonder construction or military expansion) when the space race is the top priority.

### 9. Victory Competition & Diplomacy - Spaceship Announcement (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (lines 9723, 10368, 31418, 36051)

**Function:** Victory competition detection and diplomatic statements

FLAVOR_SPACESHIP influences how the AI recognizes and responds to spaceship victory pursuits.

```cpp
AIGrandStrategyTypes eScience = (AIGrandStrategyTypes) GC.getInfoTypeForString("AIGRANDSTRATEGY_SPACESHIP");

// ...

else if(eStatement == DIPLO_STATEMENT_VICTORY_COMPETITION_ANNOUNCE_SPACESHIP)
```

**Diplomatic Messages:**

- `DIPLO_MESSAGE_VICTORY_COMPETITION_ANNOUNCE_SPACESHIP` - "I am working on my spaceship to Alpha Centauri"
- `DIPLO_MESSAGE_VICTORY_BLOCK_ANNOUNCE_SPACESHIP` - "I will not let you win the space race"

**Interpretation:** The AI tracks which civilizations are pursuing spaceship victory by monitoring:

1. **Apollo Program completion:** Indicates commitment to space race
2. **Spaceship part production:** Visible through diplomatic intelligence
3. **Grand strategy:** AIGRANDSTRATEGY_SPACESHIP adoption signals intent
4. **Technology progress:** Research of spaceship-enabling technologies

**Diplomatic Responses:**

- **Victory competition:** AIs competing for the same victory type become hostile
- **Victory blocking:** AIs may declare war to prevent space race completion
- **Cooperative victory:** Friendly AIs may assist with research agreements
- **Intelligence gathering:** Spies sent to monitor spaceship production progress

**Strategic Impact:** The diplomatic system creates dynamic competition for science victory. AIs that detect another civilization approaching space race completion may:

- Increase military pressure on production cities
- Propose defensive pacts with other threatened civilizations
- Accelerate their own space race efforts
- Attempt to delay the leading civilization through war or espionage

### 10. Spaceship Part Transport - Unit AI Priority (CvEnums.h & UnitAIChanges.sql)

**Location:**

- `CvGameCoreDLLUtil/include/CvEnums.h` (line 1860)
- `(2) Vox Populi/Database Changes/Units/UnitAIChanges.sql` (lines 234-237)

**Function:** Unit AI type for spaceship part transportation

FLAVOR_SPACESHIP indirectly affects the AI's handling of spaceship parts as special units requiring transportation.

```cpp
UNITAI_SPACESHIP_PART,			// spaceship part that needs to be taken to capital
```

```sql
('UNITCLASS_SS_STASIS_CHAMBER', 'UNITAI_SPACESHIP_PART'),
('UNITCLASS_SS_ENGINE', 'UNITAI_SPACESHIP_PART'),
('UNITCLASS_SS_COCKPIT', 'UNITAI_SPACESHIP_PART'),
('UNITCLASS_SS_BOOSTER', 'UNITAI_SPACESHIP_PART');
```

**Interpretation:** All spaceship parts are assigned the UNITAI_SPACESHIP_PART unit AI type, which governs their behavior and handling:

**Spaceship Part Behavior:**

1. **Automatic transport:** Parts move toward capital city automatically
2. **Protection priority:** Military units escort spaceship parts
3. **Route safety:** AI selects safest paths to capital, avoiding enemy territory
4. **Road utilization:** Prioritizes roads and railroads for faster transport
5. **Naval transport:** Uses cargo ships/embarked units for overseas transport

**Homeland AI Movement:**

```cpp
AI_HOMELAND_MOVE_SPACESHIP_PART
```

The homeland AI system has a dedicated movement type for spaceship parts, ensuring they receive appropriate priority and handling.

**Strategic Impact:**

- **Production cities:** Parts built in non-capital cities must be transported
- **Capital centralization:** Space race launches only from capital
- **Strategic vulnerability:** Parts in transit can be captured by enemy units
- **Defensive requirements:** AI must secure routes between production cities and capital
- **Time calculation:** AI factors transport time into space race completion estimates

### 11. Unit Production Priority - Spaceship Parts (UnitFlavorSweeps.sql)

**Location:** `(2) Vox Populi/Database Changes/AI/UnitFlavorSweeps.sql` (lines 55-58)

**Function:** Unit flavor values for spaceship parts

FLAVOR_SPACESHIP directly determines the priority of producing individual spaceship part units.

```sql
('UNIT_SS_BOOSTER', 'FLAVOR_SPACESHIP', 150),
('UNIT_SS_COCKPIT', 'FLAVOR_SPACESHIP', 150),
('UNIT_SS_ENGINE', 'FLAVOR_SPACESHIP', 150),
('UNIT_SS_STASIS_CHAMBER', 'FLAVOR_SPACESHIP', 150),
```

**Interpretation:** All four spaceship part types have identical FLAVOR_SPACESHIP values of 150, the **highest unit flavor value in the game**. This ensures that when pursuing science victory, spaceship parts become the absolute top production priority.

**Unit Priority Comparison:**

- Spaceship Parts: 150 (highest priority - space race critical)
- Giant Death Robot: ~50 (late-game super unit)
- Nuclear Missile: ~30 (strategic weapon)
- Aircraft Carrier: ~25 (naval power projection)
- Regular military units: 5-20 (standard warfare)

**Production Queue Priority:** When a city has spaceship production specialization, the production queue is evaluated with spaceship parts receiving:

- Base priority: 150 (from FLAVOR_SPACESHIP)
- Leader personality: × FLAVOR_SPACESHIP value (5-10)
- Grand strategy modifier: +20 from AIGRANDSTRATEGY_SPACESHIP
- **Total priority range:** 150 × 5 + 20 = 770 to 150 × 10 + 20 = 1520

**Part Requirements:**

- SS Cockpit: 1 required
- SS Booster: 3 required
- SS Engine: 1 required
- SS Stasis Chamber: 1 required
- **Total parts needed: 6**

**Strategic Impact:** The extreme flavor values ensure that once Apollo Program is complete, the AI's production cities immediately shift focus to spaceship parts. Other production items (military units, buildings, wonders) are deprioritized unless there are urgent military threats requiring emergency unit production.

## Database Flavor Values

### Buildings with FLAVOR_SPACESHIP

#### Space Race Buildings

**Spaceship Infrastructure:**

- **Spaceship Factory:** 100 (primary space production building)
  - +50% production for spaceship parts
  - Required in core production cities
  - Unlocked by Robotics technology

- **Recycling Center:** 50 (supporting infrastructure)
  - +2 aluminum (critical resource for spaceship parts)
  - Helps sustain spaceship production
  - Provides production bonuses

**World Wonders:**

- **Hubble Space Telescope:** 200 (highest spaceship wonder priority)
  - +25% production for spaceship parts globally
  - +2 free great scientists
  - Unlocked by Satellites technology
  - Critical for space race acceleration

- **International Space Station:** 100 (space race mega-project)
  - +1 production per specialist city-wide
  - +1 science per specialist city-wide
  - Global science and production boost
  - Late-game science powerhouse

#### Science Support Buildings

**Core Science Buildings with Spaceship Support:**

- Public School: 80 (FLAVOR_SCIENCE + indirect spaceship support)
- Research Lab: 75 (science infrastructure for space race)
- University: 50 (mid-game science foundation)
- Observatory: 35 (mountain science bonus)
- Library: 40 (early science foundation)

**Economic Buildings:**

- Bank: 10 (economic science support)
- Stock Exchange variants: 20-25 (late-game economic science)

**Strategic Impact:** High FLAVOR_SPACESHIP leaders will prioritize:

1. **Hubble Space Telescope (200)** - Builds immediately when available
2. **Spaceship Factory (100)** - Built in all 4 core production cities
3. **International Space Station (100)** - Constructed when approaching space victory
4. **Recycling Centers (50)** - Built to secure aluminum resources

The building progression creates a clear path: Science infrastructure → Hubble → Spaceship Factories → ISS → Spaceship Parts

### Technologies with FLAVOR_SPACESHIP

#### Space Race Technologies

**Critical Technologies:**

- **Satellites:** 75 (highest spaceship technology priority)
  - Unlocks Apollo Program project
  - Unlocks Hubble Space Telescope wonder
  - Reveals entire map
  - Prerequisite for all spaceship parts

- **Robotics:** 50 (second highest spaceship technology)
  - Unlocks Spaceship Factory building
  - Unlocks advanced military units (Giant Death Robot)
  - Production technology synergy

**Spaceship Part Technologies:**

- **Nanotechnology:** 20
  - Unlocks SS Stasis Chamber
  - Advanced materials technology

- **Particle Physics:** 20
  - Unlocks SS Engine
  - Fundamental physics breakthrough

- **Nuclear Fusion:** 20
  - Unlocks SS Booster
  - Energy technology advancement

- **Globalization:** 20
  - Economic and technological integration
  - Indirect spaceship support

**Technology Beeline Strategy:**

**Phase 1 - Foundation (Ancient to Renaissance):**

- Writing → Philosophy → Education → Scientific Theory
- Focus on science infrastructure and research speed

**Phase 2 - Preparation (Industrial to Modern):**

- Industrialization → Electricity → Radio → Computers
- Build production capacity and economic foundation

**Phase 3 - Space Race (Atomic Era):**

1. **Satellites (75)** - Apollo Program + Hubble [CRITICAL]
2. **Robotics (50)** - Spaceship Factory [CRITICAL]
3. **Nanotechnology (20)** - SS Stasis Chamber
4. **Particle Physics (20)** - SS Engine
5. **Nuclear Fusion (20)** - SS Booster

**Optimal Research Path:** Satellites → Robotics → (Parallel: Nanotechnology + Particle Physics + Nuclear Fusion)

The three spaceship part technologies (Nanotechnology, Particle Physics, Nuclear Fusion) have equal priority (20) and can be researched in parallel or in any order. The AI typically researches them based on which spaceship parts are needed next.

**Strategic Impact:** High FLAVOR_SPACESHIP leaders will aggressively beeline Satellites and Robotics, often ignoring other late-game technologies (Advanced Ballistics, Stealth, Mobile Tactics) until the space race foundation is established. This creates a focused technology strategy that maximizes speed to space race completion.

### Policies with FLAVOR_SPACESHIP

#### Space Race Policies

**Freedom Ideology - Space Race Tree:**

- **Space Procurements (Tier 2):** FLAVOR_SPACESHIP: 60
  - +100% production when constructing Spaceship Factory
  - Doubles speed of spaceship factory construction
  - Critical for rapid space race preparation

- **Spaceflight Pioneers (Tier 3):** FLAVOR_SPACESHIP: 60
  - May finish spaceship parts with Great Engineers
  - Allows instant completion of spaceship components
  - Converts great person production into space race progress

**Policy Adoption Strategy:**

Leaders with high FLAVOR_SPACESHIP will:

1. **Open Freedom ideology** when reaching late game (Modern/Atomic era)
2. **Rush Space Procurements** as first or second Freedom policy
3. **Rush Spaceflight Pioneers** as soon as Tier 3 unlocks
4. **Complete Freedom tree** to maximize space race bonuses

**Synergy Analysis:**

Space Procurements + Spaceflight Pioneers creates a powerful combination:

- **Fast factories:** 50% reduction in spaceship factory build time
- **Great Engineer stockpile:** Save great engineers for instant spaceship parts
- **Flexible completion:** Can rush critical parts to fill gaps in production

**Example Space Race Timeline:**

- Turn 280: Adopt Freedom ideology
- Turn 282: Research Satellites, build Apollo Program
- Turn 284: Adopt Space Procurements policy
- Turn 285: Build Spaceship Factory in 4 core cities (50% faster)
- Turn 290: Research Robotics, Nanotechnology, Particle Physics
- Turn 292: Begin spaceship part production
- Turn 294: Adopt Spaceflight Pioneers policy
- Turn 295: Use 3 Great Engineers to instantly complete parts
- Turn 300: Launch spaceship to Alpha Centauri

**Strategic Impact:** The Freedom ideology's space race policies provide a 20-30 turn advantage over civilizations without these bonuses. Combined with Hubble Space Telescope (+25% global production), a civilization with both Freedom policies and Hubble can complete the space race in approximately 10-15 turns of production, compared to 25-35 turns without these bonuses.

### Processes with FLAVOR_SPACESHIP

**Science Processes:**

- Research (Convert production → science): 5
  - Base science production process
  - Used when no buildings or units needed

- International Space Station: 50 (FLAVOR_SPACESHIP support)
  - Process tied to wonder construction
  - Not a standalone process for production conversion

**Interpretation:** FLAVOR_SPACESHIP does not directly affect process selection, but high spaceship flavor leaders will use the Research process in non-production cities to maximize science output while core cities focus on spaceship part construction.

### Unit Flavors

**Spaceship Part Units:**

- UNIT_SS_BOOSTER: 150
- UNIT_SS_COCKPIT: 150
- UNIT_SS_ENGINE: 150
- UNIT_SS_STASIS_CHAMBER: 150

**Great Person:**

- Great Scientist: 1 (baseline great person generation)
- Great Engineer: 1 (used with Spaceflight Pioneers for instant spaceship parts)

**Strategic Impact:** The extreme flavor values (150) ensure spaceship parts dominate production queues in specialized cities. Great Engineers gain special importance with Spaceflight Pioneers policy, allowing instant completion of spaceship parts.

## Strategy Modifiers

### Economic AI Strategies

**Location:** `(2) Vox Populi/Database Changes/AI/StrategyFlavorSweeps.sql` (lines 32-33, 47-48)

**Space Race Strategies:**

```sql
('ECONOMICAISTRATEGY_GS_SPACESHIP', 'FLAVOR_DIPLOMACY', 16),
('ECONOMICAISTRATEGY_GS_SPACESHIP_HOMESTRETCH', 'FLAVOR_DIPLOMACY', -50);
```

**Interpretation:**

1. **ECONOMICAISTRATEGY_GS_SPACESHIP:**
   - Active when pursuing science victory
   - +16 FLAVOR_DIPLOMACY modifier
   - Encourages peaceful diplomacy and research agreements
   - Prevents unnecessary wars that disrupt space race

2. **ECONOMICAISTRATEGY_GS_SPACESHIP_HOMESTRETCH:**
   - Active in final turns before space victory
   - -50 FLAVOR_DIPLOMACY modifier
   - Reduces diplomatic responsiveness
   - AI becomes less willing to compromise or negotiate
   - Focus shifts entirely to completing space race
   - May ignore diplomatic requests to avoid distractions

**Strategic Impact:** The homestretch strategy represents the AI's laser focus on completing the space race. During the final push:

- Research agreements become less important (already have required technologies)
- Diplomatic requests are deprioritized (avoid production delays)
- Military threats are managed defensively only (no offensive operations)
- All diplomatic capital spent on preventing interference rather than building relationships

This creates a dramatic shift in AI behavior as it approaches space victory, becoming isolated and single-minded in its pursuit of launching the spaceship.

### Grand Strategy Flavor Modifiers

**Location:** `(2) Vox Populi/Database Changes/AI/StrategyChanges.sql` (line 69)

```sql
DELETE FROM AIGrandStrategy_FlavorMods WHERE FlavorType = 'FLAVOR_RELIGION' AND AIGrandStrategyType = 'AIGRANDSTRATEGY_SPACESHIP';
```

**Interpretation:** The spaceship grand strategy explicitly removes any religion flavor modifiers, indicating that religious focus is incompatible with space race pursuit. This prevents the AI from wasting time and resources on religion when pursuing science victory.

**Other Flavor Interactions:**

- FLAVOR_SCIENCE: Strongly synergizes (+400 science yield weight)
- FLAVOR_GROWTH: Synergizes (+300 food yield weight for larger cities)
- FLAVOR_PRODUCTION: Synergizes (+200 production yield weight)
- FLAVOR_RELIGION: Removed (incompatible with space race focus)
- FLAVOR_OFFENSE: Reduced (military takes lower priority)
- FLAVOR_CULTURE: Reduced (cultural victory incompatible)

### Leader Flavor Examples

**Location:** `(2) Vox Populi/Database Changes/AI/LeaderFlavorSweeps.sql`

Different leaders have varying FLAVOR_SPACESHIP values that shape their space race priorities:

**Highest Spaceship Focus (9-10):**

- **Sejong (Korea):** 10 (science victory specialist)
  - Primary victory focus: Science
  - Unique building: Seowon (enhanced university)
  - Strategy: Tall empire with massive science output

- **Nebuchadnezzar (Babylon):** 10 (science civilization)
  - Primary victory focus: Science
  - Unique ability: Extra great scientist from writing
  - Strategy: Great scientist engine for academies and technology boosts

- **Pacal (Maya):** 10 (calendar science specialist)
  - Primary victory focus: Science
  - Unique ability: Great person acceleration
  - Strategy: Rapid great person generation for science boosts

- **Ashurbanipal (Assyria):** 9 (conquest science hybrid)
  - Primary victory focus: Science
  - Unique ability: Free technology from capturing cities
  - Strategy: Aggressive expansion for technology acquisition

- **Pachacuti (Inca):** 9 (mountain science specialist)
  - Primary victory focus: Science
  - Unique ability: Terrace farm mountains
  - Strategy: Mountain city placement for observatories

- **Gandhi (India):** 9 (peaceful science leader)
  - Primary victory focus: Science
  - Playstyle: Tall, peaceful, defensive
  - Strategy: Avoid war, maximize science infrastructure

**Balanced Spaceship Focus (6-8):**

- **Wu Zetian (China):** 8 (science-culture balance)
- **Suleiman (Ottoman):** 8 (science-diplomacy balance)
- **Selassie (Ethiopia):** 8 (science secondary focus)
- **Catherine (Russia):** 7 (science-production balance)
- **Elizabeth (England):** 7 (naval-science balance)
- **Maria Theresa (Austria):** 7 (diplomacy-science balance)
- **Ramkhamhaeng (Siam):** 7 (city-state science allies)
- **William (Netherlands):** 6 (commerce-science balance)

**Lower Spaceship Focus (3-5):**

- **Bismarck (Germany):** 6 (military-science balance, reduced from 8)
- **Pedro (Brazil):** 6 (culture-science balance, reduced from 8)
- **Isabella (Spain):** 3 (domination focus, minimal space race interest)

**Interpretation:** The flavor values create distinct space race archetypes:

**Space Race Specialists (9-10):**

- Will almost always pursue science victory when conditions allow
- Build Apollo Program immediately upon unlocking Satellites
- Construct Hubble Space Telescope as top priority
- Complete spaceship in 10-15 turns after Apollo Program
- Rarely deviate to other victory types

**Science Generalists (7-8):**

- Pursue science victory if ahead in technology
- Consider alternative victories if facing strong competition
- Build space infrastructure but may delay Apollo Program
- Complete spaceship in 15-25 turns after Apollo Program
- Flexible strategy based on game circumstances

**Science Secondary (5-6):**

- Pursue science victory only if significantly ahead
- Prefer diplomatic or cultural victories
- Build space infrastructure for research bonuses, not victory
- Complete spaceship in 25-35 turns if pursuing
- Often switch to other victory types mid-game

**Minimal Space Race (3-4):**

- Rarely pursue science victory
- Build Apollo Program only if no competition
- Focus on domination or other victory types
- View space race as backup if primary strategy fails

## Summary of Effects

### Strategic Planning

- **Victory focus:** Primary driver of science victory pursuit through space race
- **Grand strategy:** AIGRANDSTRATEGY_SPACESHIP grants +20 flavor bonus
- **Late-game priority:** Activates strongly in Atomic Era when spaceship parts become available
- **Diplomatic stance:** +16 diplomacy during space race, -50 in homestretch phase
- **Technology beeline:** Satellites (75) → Robotics (50) → spaceship part techs (20 each)

### City Development

- **Production specialization:** 4 core cities designated for spaceship part production
- **Specialization weight:** FLAVOR_SPACESHIP × 10 + grand strategy bonus (+200)
- **Building priority:** Spaceship Factory (100) in all production cities
- **Wonder priority:** Hubble Space Telescope (200) >> International Space Station (100)
- **Citizen management:** Engineers and scientists for production/science output
- **Tile focus:** Production-heavy tiles prioritized in spaceship cities

### Victory Pursuit

- **Apollo Program bonus:** +150 priority after construction (massive commitment signal)
- **Policy accumulation:** +120 priority from Space Procurements + Spaceflight Pioneers
- **Building accumulation:** +900 priority from spaceship infrastructure (factories, wonders, etc.)
- **Feedback loop:** Each space investment increases attraction of science victory
- **Homestretch focus:** Ignores diplomacy (-50 flavor) during final push
- **Competition detection:** Tracks other civilizations' space race progress

### Economic Strategy

- **Policy path:** Freedom ideology → Space Procurements → Spaceflight Pioneers
- **Production acceleration:** +100% spaceship factory construction (Space Procurements)
- **Great Engineer synergy:** Instant part completion (Spaceflight Pioneers)
- **Trade routes:** Maintains science-focused routes for research speed
- **Resource management:** Secures aluminum through Recycling Centers
- **Gold allocation:** Purchases spaceship factories if behind schedule

### Unit Production

- **Part priority:** 150 flavor value (highest in game)
- **Transport handling:** Dedicated UNITAI_SPACESHIP_PART for safe capital delivery
- **Production queue:** Spaceship parts override all non-emergency production
- **Part rotation:** Balanced production across all 4 part types
- **Great Engineer usage:** Stockpile for instant completions with Spaceflight Pioneers
- **Escort priority:** Military units protect parts during transport

### Advisor Recommendations

- **Priority weight:** 17 (highest of all flavors in game)
- **Recommendation focus:** Apollo Program → Hubble → Spaceship Factories → Parts
- **Technology advice:** Prioritize spaceship-enabling technologies
- **Policy advice:** Rush Freedom space race policies
- **Diplomatic advice:** Avoid wars during space race, protect production cities

### Dynamic Adjustments

- **Apollo Program threshold:** Massive priority boost (+150) after construction
- **Era scaling:** Minimal priority until Atomic Era, then dramatic increase
- **Grand strategy synergy:** +20 flavor from AIGRANDSTRATEGY_SPACESHIP
- **Competition response:** Accelerates if detecting rival space race progress
- **Victory proximity:** -50 diplomacy in homestretch (tunnel vision on completion)

## Design Philosophy

FLAVOR_SPACESHIP represents the AI's approach to the science victory endgame:

1. **Late-game Specialization:** Unlike FLAVOR_SCIENCE (broad research throughout game), FLAVOR_SPACESHIP activates primarily in late game
2. **Focused Commitment:** Once Apollo Program is built, massive priority boost creates strong commitment
3. **Production Concentration:** Limited to 4 core cities for efficient part manufacturing
4. **Policy Dependency:** Freedom ideology's space race policies provide critical advantages
5. **Technology Beeline:** Clear progression through Satellites → Robotics → part technologies

This creates distinct space race strategies based on leader personality:

- **High SPACESHIP (9-10):** Space race specialists who commit immediately and aggressively pursue science victory. Build Apollo Program turn 1 after unlocking Satellites. Complete spaceship in minimum time.

- **Moderate SPACESHIP (6-8):** Flexible science leaders who pursue space race if conditions favorable. Evaluate competition before committing to Apollo Program. Complete spaceship if maintaining technological advantage.

- **Low SPACESHIP (4-5):** Generalist leaders who build space infrastructure for science bonuses but rarely pursue victory. Construct Apollo Program only if completely dominant in science. Switch to other victories if facing competition.

- **Minimal SPACESHIP (0-3):** Non-science leaders who ignore space race entirely. Never build Apollo Program voluntarily. View science victory as impossible or undesirable given playstyle.

## Related Flavors

- **FLAVOR_SCIENCE:** Broad science infrastructure and research (synergizes strongly with spaceship)
- **FLAVOR_GROWTH:** Population growth for larger production cities (food yield +300 in spaceship grand strategy)
- **FLAVOR_PRODUCTION:** Raw production capacity (production yield +200 in spaceship grand strategy)
- **FLAVOR_WONDER:** Wonder construction priority (Hubble Space Telescope critical)
- **FLAVOR_DIPLOMACY:** Diplomatic focus (increases during space race +16, decreases in homestretch -50)
- **FLAVOR_RELIGION:** Religious focus (explicitly removed from spaceship grand strategy)
- **FLAVOR_OFFENSE:** Military aggression (reduced to avoid distracting from space race)
- **FLAVOR_GREAT_PEOPLE:** Great person generation (engineers critical with Spaceflight Pioneers)

**Typical Combinations:**

- **High Spaceship + High Science:** Classic science victory strategy (Korea, Babylon) - dominant research with focused space race execution
- **High Spaceship + High Production:** Production science hybrid (Russia, China) - leverages industrial capacity for rapid spaceship construction
- **High Spaceship + High Growth:** Tall empire science (India, Maya) - massive cities generate enormous science and production
- **High Spaceship + Low Offense:** Peaceful researcher (Gandhi) - avoids military conflicts entirely to maximize space race focus
- **Moderate Spaceship + High Science:** Flexible science leader (England, Siam) - maintains science lead but considers alternative victories
- **Low Spaceship + High Science:** Science infrastructure without space race (Arabia, Netherlands) - builds science for economic/diplomatic advantages

**Anti-Synergies:**

- **FLAVOR_SPACESHIP + FLAVOR_OFFENSE:** Conflicts - wars disrupt production and delay space race
- **FLAVOR_SPACESHIP + FLAVOR_CULTURE:** Conflicts - cultural victory incompatible with space race focus
- **FLAVOR_SPACESHIP + FLAVOR_RELIGION:** Incompatible - explicitly removed from spaceship grand strategy

FLAVOR_SPACESHIP creates a clear end-game strategic path that differs fundamentally from other victory pursuits. While FLAVOR_SCIENCE drives broad technological advancement, FLAVOR_SPACESHIP narrows focus to the specific goal of launching a colony ship to Alpha Centauri, requiring production concentration, policy optimization, and diplomatic isolation during the final push to victory.
