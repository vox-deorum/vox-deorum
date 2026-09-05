# FLAVOR_TILE_IMPROVEMENT

## Overview

`FLAVOR_TILE_IMPROVEMENT` is an AI personality flavor that controls how much a civilization's leader values developing their territory through tile improvements. This flavor fundamentally shapes the AI's approach to worker production, improvement construction priorities, city founding decisions, and overall economic development strategy.

Unlike military-focused flavors that drive combat behavior, `FLAVOR_TILE_IMPROVEMENT` focuses on **infrastructure development and territorial optimization** - ensuring that every tile within the empire is improved for maximum economic output. This flavor represents a leader's commitment to building farms, mines, plantations, and other improvements that transform raw terrain into productive economic assets.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Leaders with unique improvements: 8-10 (Kamehameha, Pocatello, Isabella)
  - Infrastructure-focused leaders: 6-8 (Catherine, Ahmad al-Mansur, Pedro)
  - Balanced leaders: 5-7 (Standard default value)
  - Expansion-focused leaders: 3-5 (Genghis Khan)
  - Barbarians: 4 (Basic improvement needs)

## Code References

### 1. Economic Advisor Recommendation Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (line 306)

**Function:** `CvAdvisorRecommender::AdvisorInterestInFlavor()`

When the Economic Advisor evaluates recommendations, FLAVOR_TILE_IMPROVEMENT receives significant priority weight, ranking fourth highest among economic considerations.

```cpp
case ADVISOR_ECONOMIC:
    if(strFlavorName == "FLAVOR_GOLD")
    {
        return 23;  // Highest priority
    }
    // ... other flavors ...
    else if(strFlavorName == "FLAVOR_GROWTH")
    {
        return 15;
    }
    else if(strFlavorName == "FLAVOR_TILE_IMPROVEMENT")
    {
        return 13;  // Fourth priority for economic advisor
    }
    else if(strFlavorName == "FLAVOR_INFRASTRUCTURE")
    {
        return 9;
    }
```

**Interpretation:** FLAVOR_TILE_IMPROVEMENT is the fourth most important flavor for economic recommendations, scoring 13 out of possible priority values. This places it below Gold (23), Growth (15), and Production (16), but above Infrastructure (9) and Culture (3). The Economic Advisor uses this weight to recommend worker production, technologies that unlock improvements, and policies that enhance tile yields.

### 2. Science Advisor Minimal Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (line 473)

**Function:** `CvAdvisorRecommender::AdvisorInterestInFlavor()`

The Science Advisor gives minimal consideration to tile improvements, focusing instead on research infrastructure.

```cpp
case ADVISOR_SCIENCE:
    if(strFlavorName == "FLAVOR_TILE_IMPROVEMENT")
    {
        return 1;  // Minimal priority for science advisor
    }
    else if(strFlavorName == "FLAVOR_SCIENCE")
    {
        return 13;
    }
    else if(strFlavorName == "FLAVOR_SPACESHIP")
    {
        return 17;
    }
```

**Interpretation:** The Science Advisor treats tile improvements as nearly irrelevant (weight of 1), focusing instead on research buildings, technologies, and spaceship components. This differentiation ensures that science-focused players receive recommendations aligned with their victory path, rather than economic infrastructure development.

### 3. Settler Site Evaluation - Gold Yield Multiplier (CvSiteEvaluationClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvSiteEvaluationClasses.cpp` (lines 205-212)

**Function:** `CvSiteEvaluatorForSettler::ComputeFlavorMultipliers()`

FLAVOR_TILE_IMPROVEMENT directly influences where the AI founds new cities by affecting how much value is placed on gold-producing tiles.

```cpp
// Setup flavor multipliers - call once per player before PlotFoundValue()
void CvSiteEvaluatorForSettler::ComputeFlavorMultipliers(const CvPlayer* pPlayer)
{
    // ... initialization ...

    else if(strFlavor == "FLAVOR_GOLD" ||
            strFlavor == "FLAVOR_TILE_IMPROVEMENT")
    {
        m_iFlavorMultiplier[YIELD_GOLD] += pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(eFlavor);
        if(pkCitySpecializationEntry)
        {
            m_iFlavorMultiplier[YIELD_GOLD] += pkCitySpecializationEntry->GetFlavorValue(eFlavor);
        }
    }
```

**Interpretation:** When evaluating potential city sites, FLAVOR_TILE_IMPROVEMENT adds to the gold yield multiplier alongside FLAVOR_GOLD. This means leaders with high tile improvement flavor will prefer settling locations with good economic potential - tiles that can be improved for gold production (luxury resources, river tiles, plains, etc.).

A leader with FLAVOR_TILE_IMPROVEMENT = 9 would add 9 points to the gold multiplier, making locations with luxury resources, rivers, and improvable economic tiles significantly more attractive. This ensures that infrastructure-focused leaders found cities in locations with strong development potential, rather than purely military or defensive positions.

### 4. Minor Civilization Diplomacy - Worker Bullying Decision (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (lines 32093, 32176)

**Function:** `CvDiplomacyAI::DoContactMinorCivs()`

FLAVOR_TILE_IMPROVEMENT determines how likely the AI is to bully minor civilizations for worker units when infrastructure is needed.

```cpp
void CvDiplomacyAI::DoContactMinorCivs()
{
    int iDiplomacyFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DIPLOMACY"));
    int iGoldFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GOLD"));
    int iTileImprovementFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_TILE_IMPROVEMENT"));

    // ... later in the function ...

    // Would we like to get a unit by bullying this turn?
    bool bWantsToBullyUnit = false;

    // Check worker-to-city ratio and improved plot ratio
    if (GetPlayer()->GetEconomicAI()->GetWorkersToCitiesRatio() < 0.25 &&
        GetPlayer()->GetEconomicAI()->GetImprovedToImprovablePlotsRatio() < 0.50)
    {
        bWantsToBullyUnit = true;
    }
    // Otherwise, do a random roll
    else
    {
        int iThreshold = iTileImprovementFlavor;
        int iRandRoll = GC.getGame().randRangeExclusive(0, 10, CvSeeder::fromRaw(0xc87e263f).mix(GetID()));

        if (iRandRoll < iThreshold)
            bWantsToBullyUnit = true;
    }
}
```

**Interpretation:** The AI uses FLAVOR_TILE_IMPROVEMENT to decide whether to bully city-states for worker units. The decision follows two paths:

1. **Critical Need Path:** If the player has fewer than 0.25 workers per city AND less than 50% of improvable tiles are improved, automatically bully for workers regardless of flavor
2. **Random Roll Path:** Otherwise, perform a random roll (0-9) against the tile improvement flavor as threshold

**Behavioral Examples:**

- FLAVOR_TILE_IMPROVEMENT = 9: 90% chance to bully for workers each turn (rolls 0-8 succeed)
- FLAVOR_TILE_IMPROVEMENT = 5: 50% chance to bully for workers each turn (rolls 0-4 succeed)
- FLAVOR_TILE_IMPROVEMENT = 2: 20% chance to bully for workers each turn (rolls 0-1 succeed)

This creates a strategic trade-off: leaders who highly value tile improvements (Kamehameha, Pocatello) will more aggressively acquire workers through diplomacy, even if it damages their relationship with city-states. Leaders with low tile improvement flavor will only bully for workers when desperately needed.

### 5. Policy AI - Grand Strategy Weight Calculation (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4976-4979)

**Function:** Policy evaluation and selection system

FLAVOR_TILE_IMPROVEMENT contributes to the base weight when evaluating social policies, influencing which policy trees the AI pursues.

```cpp
// Evaluate policy flavors for grand strategy alignment
for (int iFlavor = 0; iFlavor < GC.getNumFlavorTypes(); iFlavor++)
{
    FlavorTypes eFlavor = (FlavorTypes)iFlavor;
    if (eFlavor == NO_FLAVOR)
        continue;

    int iFlavorValue = pkPolicyInfo->GetFlavorValue(eFlavor);
    if (iFlavorValue > 0)
    {
        iWeight += pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy((FlavorTypes)iFlavor);

        // ... other flavor checks ...

        else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_TILE_IMPROVEMENT")
        {
            iWeight += iFlavorValue;  // Add policy's tile improvement value to base weight
        }
```

**Interpretation:** When a policy has FLAVOR_TILE_IMPROVEMENT value (such as Liberty tree policies that grant worker speed bonuses or free improvements), the policy's flavor value is added to the evaluation weight. This makes infrastructure-focused leaders more likely to adopt policy trees that enhance tile development.

For example, if the Liberty policy tree has FLAVOR_TILE_IMPROVEMENT = 7, a leader with high tile improvement flavor will be more inclined to pursue Liberty over other policy trees, as it aligns with their infrastructure development priorities.

### 6. Grand Strategy AI - Spaceship Victory Priority Bonus (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 1450-1453)

**Function:** `CvGrandStrategyAI::GetSpaceshipPriority()`

FLAVOR_TILE_IMPROVEMENT from adopted policies contributes to spaceship victory pursuit priority.

```cpp
// Returns Priority for Spaceship Grand Strategy
int CvGrandStrategyAI::GetSpaceshipPriority()
{
    // ... base priority calculation ...

    // Add priority value based on flavors of policies we've acquired
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
                    if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_TILE_IMPROVEMENT")
                    {
                        iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
                    }
                }
            }
        }
    }
```

**Interpretation:** Policies with FLAVOR_TILE_IMPROVEMENT values contribute their flavor points to spaceship victory priority. This creates a connection between economic infrastructure development and scientific victory pursuit. The logic suggests that strong economic foundations (improved tiles generating gold, food, and production) support the massive resource investment required for spaceship construction.

Leaders who adopt infrastructure-focused policies throughout the game will gradually shift toward prioritizing spaceship victory, as their improved economic base makes scientific victory more feasible.

### 7. Grand Strategy AI - Building Flavor Bonus (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 1487-1490)

**Function:** Grand strategy priority calculation based on constructed buildings

Buildings with FLAVOR_TILE_IMPROVEMENT values influence grand strategy selection toward infrastructure-focused strategies.

```cpp
// Look for Buildings and grab flavors
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
                    // ... other flavor checks ...

                    else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_TILE_IMPROVEMENT")
                    {
                        iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop);
                    }
                }
            }
        }
    }
}
```

**Interpretation:** Buildings with FLAVOR_TILE_IMPROVEMENT values (such as Murano Glassworks with value 30, or Terracotta Army with value 50) contribute their flavor points to grand strategy priority calculations. Unlike the **double multiplier** given to military buildings in FLAVOR_OFFENSE calculations, tile improvement buildings contribute their **base value** to infrastructure-focused grand strategies.

This creates a feedback loop where constructing buildings that enhance tile improvements makes the AI more committed to economic development strategies. For example:

- Murano Glassworks (FLAVOR_TILE_IMPROVEMENT = 30) adds 30 points toward economic grand strategies
- Terracotta Army (FLAVOR_TILE_IMPROVEMENT = 50) adds 50 points, significantly boosting infrastructure commitment

## Database Flavor Assignments

### Units

**Location:** `(2) Vox Populi/Database Changes/AI/UnitFlavorSweeps.sql` (line 19)

```sql
('UNIT_WORKER', 'FLAVOR_TILE_IMPROVEMENT', 30)
```

**Interpretation:** Worker units have FLAVOR_TILE_IMPROVEMENT = 30, making them highly desirable for leaders with high tile improvement flavor. This ensures infrastructure-focused leaders consistently produce workers to develop their territory, while militaristic leaders (low tile improvement flavor) may delay worker production in favor of military units.

### Buildings

**Location:** `(2) Vox Populi/Database Changes/AI/BuildingFlavorSweeps.sql`

```sql
('BUILDING_MURANO_GLASSWORKS', 'FLAVOR_TILE_IMPROVEMENT', 30)  -- Line 815
('BUILDING_TERRACOTTA_ARMY', 'FLAVOR_TILE_IMPROVEMENT', 50)    -- Line 983
```

**Interpretation:**

- **Murano Glassworks** (FLAVOR_TILE_IMPROVEMENT = 30): Venice's unique building that enhances tile improvements, making it highly desirable for infrastructure-focused leaders
- **Terracotta Army** (FLAVOR_TILE_IMPROVEMENT = 50): The wonder with the highest tile improvement flavor value, reflecting its massive boost to tile development through free Great Generals and promotion bonuses

### Technologies

**Location:** `(2) Vox Populi/Database Changes/AI/TechFlavorSweeps.sql`

Technologies with FLAVOR_TILE_IMPROVEMENT represent unlocking new improvements or yield bonuses:

**Ancient Era:**

```sql
('TECH_TRAPPING', 'FLAVOR_TILE_IMPROVEMENT', 15)          -- Unlocks camps
('TECH_THE_WHEEL', 'FLAVOR_TILE_IMPROVEMENT', 5)          -- Unlocks roads
('TECH_ANIMAL_HUSBANDRY', 'FLAVOR_TILE_IMPROVEMENT', 15)  -- Unlocks pastures
('TECH_MINING', 'FLAVOR_TILE_IMPROVEMENT', 15)            -- Unlocks mines
('TECH_CALENDAR', 'FLAVOR_TILE_IMPROVEMENT', 15)          -- Unlocks plantations
('TECH_MASONRY', 'FLAVOR_TILE_IMPROVEMENT', 15)           -- Unlocks quarries
('TECH_BRONZE_WORKING', 'FLAVOR_TILE_IMPROVEMENT', 10)    -- Jungle clearing
```

**Classical Era:**

```sql
('TECH_CURRENCY', 'FLAVOR_TILE_IMPROVEMENT', 15)          -- Trade route improvements
('TECH_METAL_CASTING', 'FLAVOR_TILE_IMPROVEMENT', 15)     -- Workshop improvements
```

**Medieval Era:**

```sql
('TECH_CIVIL_SERVICE', 'FLAVOR_TILE_IMPROVEMENT', 10)     -- Farm +1 Food, Pasture +2 Food
('TECH_GUILDS', 'FLAVOR_TILE_IMPROVEMENT', 10)            -- Economic improvements
('TECH_MACHINERY', 'FLAVOR_TILE_IMPROVEMENT', 5)          -- Production improvements
```

**Renaissance Era:**

```sql
('TECH_GUNPOWDER', 'FLAVOR_TILE_IMPROVEMENT', 5)          -- Minor improvements
('TECH_CHEMISTRY', 'FLAVOR_TILE_IMPROVEMENT', 10)         -- Advanced improvements
('TECH_ECONOMICS', 'FLAVOR_TILE_IMPROVEMENT', 5)          -- Economic bonuses
('TECH_METALLURGY', 'FLAVOR_TILE_IMPROVEMENT', 5)         -- Mine improvements
```

**Industrial Era:**

```sql
('TECH_RAILROAD', 'FLAVOR_TILE_IMPROVEMENT', 5)           -- Railroad construction
('TECH_STEAM_POWER', 'FLAVOR_TILE_IMPROVEMENT', 20)       -- Mine +2 Production, Quarry +1 Production
('TECH_RIFLING', 'FLAVOR_TILE_IMPROVEMENT', 5)            -- Minor improvements
('TECH_ARCHAEOLOGY', 'FLAVOR_TILE_IMPROVEMENT', 5)        -- Archaeological digs
('TECH_FERTILIZER', 'FLAVOR_TILE_IMPROVEMENT', 10)        -- Farm improvements
('TECH_INDUSTRIALIZATION', 'FLAVOR_TILE_IMPROVEMENT', 10) -- Factory improvements
('TECH_DYNAMITE', 'FLAVOR_TILE_IMPROVEMENT', 5)           -- Terrain clearing
```

**Modern Era:**

```sql
('TECH_COMBUSTION', 'FLAVOR_TILE_IMPROVEMENT', 20)        -- Oil well improvements
('TECH_PLASTIC', 'FLAVOR_TILE_IMPROVEMENT', 10)           -- Oil Well +2 Production
```

**Atomic Era:**

```sql
('TECH_REFRIGERATION', 'FLAVOR_TILE_IMPROVEMENT', 5)      -- Farm improvements
('TECH_ATOMIC_THEORY', 'FLAVOR_TILE_IMPROVEMENT', 10)     -- Uranium mining
('TECH_ELECTRONICS', 'FLAVOR_TILE_IMPROVEMENT', 5)        -- Advanced improvements
```

**Information Era:**

```sql
('TECH_ECOLOGY', 'FLAVOR_TILE_IMPROVEMENT', 20)           -- Major eco improvements
('TECH_ROBOTICS', 'FLAVOR_TILE_IMPROVEMENT', 10)          -- Automated improvements
```

**Interpretation:** Technologies are weighted based on how significantly they improve tile yields:

- **High value (15-20):** Technologies that unlock entirely new improvement types or provide major yield bonuses (Animal Husbandry, Mining, Calendar, Steam Power, Combustion, Ecology)
- **Medium value (10):** Technologies that enhance existing improvements or unlock moderate bonuses (Civil Service, Chemistry, Fertilizer, Robotics)
- **Low value (5):** Technologies with minor improvement benefits or secondary effects (The Wheel, Machinery, Economics)

The highest values in late eras (Steam Power = 20, Combustion = 20, Ecology = 20) reflect major improvement yield bonuses that dramatically increase economic output.

### Policies

**Location:** `(2) Vox Populi/Database Changes/AI/PolicyFlavorSweeps.sql`

```sql
('POLICY_LIBERTY', 'FLAVOR_TILE_IMPROVEMENT', 7)          -- Line 26
('POLICY_CITIZENSHIP', 'FLAVOR_TILE_IMPROVEMENT', 5)      -- Line 29
```

**Interpretation:**

- **Liberty Policy Tree** (FLAVOR_TILE_IMPROVEMENT = 7): The policy tree focused on expansion and territorial development, providing worker speed bonuses and free improvements
- **Citizenship Policy** (FLAVOR_TILE_IMPROVEMENT = 5): Specific policy within Liberty that enhances worker effectiveness

Leaders with high FLAVOR_TILE_IMPROVEMENT will strongly favor the Liberty policy tree, aligning with their infrastructure development focus.

### City Strategies

**Location:** `(2) Vox Populi/Database Changes/AI/StrategyChanges.sql`

```sql
('AICITYSTRATEGY_NEED_HAPPINESS_CONNECTION', 'FLAVOR_TILE_IMPROVEMENT', 60)   -- Line 49
('AICITYSTRATEGY_NEED_HAPPINESS_PILLAGE', 'FLAVOR_TILE_IMPROVEMENT', 60)      -- Line 51
('AICITYSTRATEGY_NEED_HAPPINESS_STARVE', 'FLAVOR_TILE_IMPROVEMENT', 60)       -- Line 55
```

**Interpretation:** When cities activate happiness crisis strategies, FLAVOR_TILE_IMPROVEMENT receives massive weight (60) to prioritize infrastructure solutions:

1. **NEED_HAPPINESS_CONNECTION:** Build roads and connections to access luxury resources
2. **NEED_HAPPINESS_PILLAGE:** Protect existing tile improvements from enemy pillaging (high defense of infrastructure)
3. **NEED_HAPPINESS_STARVE:** Build farms and food-generating improvements to reduce population pressure

The very high value (60) ensures that infrastructure-focused solutions are prioritized during happiness crises, encouraging worker production and improvement construction rather than purely cultural or military solutions.

### Military Strategies

**Location:** `(1) Community Patch/Database Changes/AI/CoreStrategyChanges.sql`

```sql
('MILITARYAISTRATEGY_ERADICATE_BARBARIANS', 'FLAVOR_TILE_IMPROVEMENT', -15)          -- Line 173
('MILITARYAISTRATEGY_ERADICATE_BARBARIANS_CRITICAL', 'FLAVOR_TILE_IMPROVEMENT', -5)  -- Line 179
```

**Interpretation:** Barbarian eradication strategies have **negative** FLAVOR_TILE_IMPROVEMENT values, creating an interesting strategic tension:

- Leaders with **high tile improvement flavor** are **less likely** to pursue aggressive barbarian eradication, as they prefer focusing on infrastructure development over military campaigns
- Leaders with **low tile improvement flavor** are **more likely** to prioritize clearing barbarians, as they don't value peaceful development as highly

The difference between standard (-15) and critical (-5) reflects that even infrastructure-focused leaders will eventually address critical barbarian threats, but they'll delay as long as possible to focus on development.

### Leader Personalities

**Location:** `(2) Vox Populi/Database Changes/AI/LeaderFlavorSweeps.sql`

Default values and special cases:

```sql
-- Default base values
('FLAVOR_TILE_IMPROVEMENT', 3)   -- Barbarians, line 30/60
('FLAVOR_TILE_IMPROVEMENT', 6)   -- Standard default, line 132
('FLAVOR_TILE_IMPROVEMENT', 7)   -- Slightly elevated default, lines 206, 280

-- Leaders with unique improvements or infrastructure focus
UPDATE Leader_Flavors SET Flavor = 8 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_AHMAD_ALMANSUR';  -- Line 300, has unique improvement
UPDATE Leader_Flavors SET Flavor = 8 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_CATHERINE';      -- Line 346, unique building + unique ability
UPDATE Leader_Flavors SET Flavor = 7 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_GENGHIS_KHAN';   -- Line 396, unique building
UPDATE Leader_Flavors SET Flavor = 9 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_ISABELLA';       -- Line 436, unique improvement
UPDATE Leader_Flavors SET Flavor = 10 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_KAMEHAMEHA';    -- Line 446, unique improvement
UPDATE Leader_Flavors SET Flavor = 9 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_MARIA_I';        -- Line 460, unique improvement
UPDATE Leader_Flavors SET Flavor = 7 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_NAPOLEON';       -- Line 468, unique improvement
UPDATE Leader_Flavors SET Flavor = 9 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_PACHACUTI';      -- Line 487, unique improvement
UPDATE Leader_Flavors SET Flavor = 8 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_PEDRO';          -- Line 494, unique improvement
UPDATE Leader_Flavors SET Flavor = 9 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_POCATELLO';      -- Line 499, unique improvement
UPDATE Leader_Flavors SET Flavor = 9 WHERE FlavorType = 'FLAVOR_TILE_IMPROVEMENT' AND LeaderType = 'LEADER_WILLIAM';        -- Line 560, unique improvement
```

**Interpretation:** Leaders with civilization-specific tile improvements receive significantly elevated FLAVOR_TILE_IMPROVEMENT values:

- **Kamehameha (10):** Highest value, reflecting Polynesia's unique Moai improvement that defines their economic strategy
- **Isabella, Maria I, Pachacuti, Pocatello, William (9):** Very high value for civilizations with powerful unique improvements
- **Ahmad al-Mansur, Catherine, Pedro (8):** High value for leaders with unique improvements or buildings that enhance tile development
- **Genghis Khan, Napoleon (7):** Moderate value, slightly above default despite having unique improvements (balanced against military focus)
- **Barbarians (3-4):** Low value reflecting basic survival needs rather than sophisticated infrastructure development

## Summary of Effects

### Strategic Planning

- **City founding:** Prefers locations with high gold potential and improvable tiles (luxury resources, rivers, plains)
- **Grand strategy:** Adopts infrastructure-focused policies and buildings create feedback loops toward economic development
- **Victory pursuit:** Strong economic foundation gradually shifts priority toward spaceship victory as resources accumulate

### Economic Development

- **Worker production:** Dramatically increases worker production priority (unit flavor = 30)
- **Worker acquisition:** Higher likelihood of bullying city-states for workers (up to 90% chance per turn for flavor = 9)
- **Technology research:** Prioritizes technologies that unlock new improvements or enhance existing ones
- **Policy selection:** Strongly favors Liberty tree and other infrastructure-focused policies

### Territorial Optimization

- **Improvement prioritization:** AI focuses on building improvements rather than leaving tiles unimproved
- **Resource development:** Ensures luxury and strategic resources are quickly improved and connected
- **Yield maximization:** Actively works to maximize food, production, and gold output from every tile

### Happiness Management

- **Crisis response:** During happiness crises, heavily weights infrastructure solutions (road connections, farm construction, luxury resource development)
- **Defensive priorities:** Protects tile improvements from pillaging during conflicts
- **Population control:** Uses food-generating improvements to manage population pressure

### Diplomatic Behavior

- **City-state relations:** More willing to damage relationships with city-states by bullying for workers when infrastructure needs arise
- **Trade priorities:** Values trade routes and connections that enhance economic infrastructure
- **Conflict avoidance:** Less likely to pursue aggressive barbarian eradication, preferring to focus on peaceful development

### Military Balance

- **Strategic tension:** High tile improvement flavor creates negative weight for barbarian eradication strategies, delaying military campaigns
- **Resource allocation:** Infrastructure-focused leaders may have delayed military responses as they prioritize worker and building production
- **Defensive posture:** More likely to protect existing improvements rather than pursuing offensive operations

## Design Philosophy

FLAVOR_TILE_IMPROVEMENT represents the AI's fundamental approach to territorial development and economic optimization:

1. **Infrastructure Investment:** How aggressively to produce workers and construct improvements
2. **Economic Foundation:** Commitment to building strong economic base before military expansion
3. **Resource Development:** Priority placed on exploiting every tile's potential
4. **Long-term Planning:** Willingness to invest in improvements that pay dividends over many turns

This creates a spectrum of AI personalities:

- **High TILE_IMPROVEMENT (9-10):** Infrastructure specialists who maximize every tile's potential, rapidly develop territory, and maintain large worker forces (Kamehameha, Pocatello, Isabella)
- **Moderate TILE_IMPROVEMENT (6-8):** Balanced leaders who develop infrastructure alongside other priorities (Catherine, Pedro, most default leaders)
- **Low TILE_IMPROVEMENT (4-5):** Expansion or military-focused leaders who may leave tiles unimproved in favor of rapid expansion or military buildup (Genghis Khan)
- **Minimal TILE_IMPROVEMENT (3):** Barbarians and purely military-focused entities with basic survival needs

## Related Flavors

- **FLAVOR_GOLD:** Often paired with FLAVOR_TILE_IMPROVEMENT in city founding and economic calculations
- **FLAVOR_GROWTH:** Complementary focus on population that requires improved food tiles
- **FLAVOR_PRODUCTION:** Infrastructure focus that benefits from improved production tiles
- **FLAVOR_EXPANSION:** Can conflict with tile improvement (expand first vs. improve first strategies)
- **FLAVOR_INFRASTRUCTURE:** Broader category that includes buildings, roads, and general development beyond just tile improvements
- **FLAVOR_NAVAL_TILE_IMPROVEMENT:** Naval equivalent focused on fishing boats and sea resources

## Typical Synergies

**Infrastructure Specialist (High TILE_IMPROVEMENT + High GOLD + High PRODUCTION):**

- Maximizes economic output through comprehensive tile development
- Strong focus on gold-generating luxuries and production-enhancing mines
- Example: Catherine, Kamehameha

**Balanced Developer (Moderate TILE_IMPROVEMENT + Moderate GROWTH + Moderate EXPANSION):**

- Balances territorial expansion with infrastructure development
- Improves tiles as cities expand naturally
- Example: Most default leaders

**Rapid Expansionist (Low TILE_IMPROVEMENT + High EXPANSION + High OFFENSE):**

- Prioritizes claiming territory over improving it
- May leave many tiles unimproved while pursuing new settlements or conquests
- Example: Genghis Khan

FLAVOR_TILE_IMPROVEMENT typically correlates positively with FLAVOR_GOLD and FLAVOR_INFRASTRUCTURE, creating consistent economic-focused personalities. However, it can conflict with FLAVOR_EXPANSION and FLAVOR_OFFENSE when resources are limited, forcing strategic choices between improvement depth vs. territorial breadth.
