# FLAVOR_PRODUCTION

## Overview

`FLAVOR_PRODUCTION` is an AI personality flavor that controls how strongly a civilization's leader prioritizes production output (hammers) and manufacturing capacity. This flavor fundamentally shapes the AI's approach to city development, construction, and economic strategy, influencing tile improvement choices, building construction, technology research, policy selection, and even great person usage.

Unlike `FLAVOR_GOLD` (which focuses on economic output) or `FLAVOR_GROWTH` (which focuses on population), `FLAVOR_PRODUCTION` specifically drives the AI's **commitment to building and manufacturing efficiency** through production-enhancing buildings (forges, workshops, factories), production-focused tile improvements (mines, lumber mills), and production-oriented city management.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Production-focused leaders (wonder/military builders): 8-10
  - Balanced leaders: 5-7
  - Diplomatic/cultural leaders: 3-5
  - Leaders during warfare: Temporarily increased by 10-20

## Code References

### 1. Advisor Recommendation System (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (lines 314-317, 385-388)

**Function:** `CvAdvisorRecommender::GetRecommendationPriority()`

FLAVOR_PRODUCTION has specific priority weights for both Economic and Military advisor recommendations.

```cpp
// Economic Advisor
else if(strFlavorName == "FLAVOR_PRODUCTION")
{
    return 16;
}

// Military Advisor
else if(strFlavorName == "FLAVOR_PRODUCTION")
{
    return 1;
}
```

**Interpretation:**

- **Economic Advisor:** FLAVOR_PRODUCTION receives a priority weight of 16, making it the highest priority economic flavor (higher than gold at 14, infrastructure at 9, and growth at 15). The economic advisor will strongly recommend production-enhancing buildings, improvements, and strategies to civilizations with high production flavors.
- **Military Advisor:** FLAVOR_PRODUCTION receives a priority weight of only 1 for military recommendations, indicating that military planning focuses on unit types and tactics rather than the production capacity to build them.

**Strategic Impact:** Production-focused leaders will receive frequent advisor recommendations to build workshops, factories, mines, and other production infrastructure.

### 2. Builder (Worker) Tasking - Production Improvement Priority (CvBuilderTaskingAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvBuilderTaskingAI.cpp` (lines 2692-2696)

**Function:** `CvBuilderTaskingAI::ScorePlot()`

FLAVOR_PRODUCTION determines how workers prioritize building improvements that increase production yield.

```cpp
case YIELD_PRODUCTION:
    if(GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_PRODUCTION")
    {
        iYieldDifferenceWeight += iDeltaYield * pFlavorManager->GetPersonalityIndividualFlavor((FlavorTypes)iFlavorLoop)
            * /*2*/ GD_INT_GET(BUILDER_TASKING_PLOT_EVAL_MULTIPLIER_PRODUCTION);
    }
    break;
```

**Interpretation:** When workers evaluate which tiles to improve, FLAVOR_PRODUCTION multiplies the production yield improvement value by both the flavor value and a configurable multiplier (default 2). This means:

- A leader with FLAVOR_PRODUCTION = 9 will value a +2 production improvement as: 2 × 9 × 2 = 36 points
- A leader with FLAVOR_PRODUCTION = 3 will value it as: 2 × 3 × 2 = 12 points

**Practical Effect:** High-production leaders will prioritize building mines, lumber mills, and quarries over farms and trading posts. Workers will improve hills with iron and stone before wheat and deer when FLAVOR_PRODUCTION is high. This creates cities optimized for building wonders, units, and buildings quickly rather than growing large populations.

### 3. City Specialization - Production Focus (CvCitySpecializationAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCitySpecializationAI.cpp` (lines 471-472)

**Function:** `CvCitySpecializationAI::LogSpecializationUpdate()`

FLAVOR_PRODUCTION influences long-term city specialization decisions, determining whether cities should focus on production output.

```cpp
int iFlavorProduction = 10 * m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_PRODUCTION"));
if (iFlavorProduction < 0) iFlavorProduction = 0;
```

**Interpretation:** The production flavor is multiplied by 10 and combined with the active grand strategy to create a city specialization weight. This means:

- FLAVOR_PRODUCTION = 8 adds 80 weight toward production-focused specialization
- Cities will prioritize buildings, specialists, and citizen assignments that maximize production
- Production-specialized cities will work more hill tiles, mines, and lumber mills while avoiding food and gold tiles until production goals are met

**Strategic Impact:** Production-specialized cities become dedicated manufacturing centers that can rapidly build wonders, units, and buildings. These cities often work sub-optimal food tiles to maximize hammer output.

### 4. City-State Interaction - Production-Focused Diplomacy (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (line 32229)

**Function:** City-state gift and bullying priority calculation

FLAVOR_PRODUCTION influences city-state interactions, particularly regarding whether to bully city-states for units.

```cpp
int iProductionFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_PRODUCTION")) / 2;
```

**Interpretation:** FLAVOR_PRODUCTION is divided by 2 and used in city-state bullying calculations. Leaders with high production flavor are more likely to bully city-states for units rather than gold, as they value military production capacity. A leader with FLAVOR_PRODUCTION = 8 adds 4 points toward unit bullying priority.

**Strategic Impact:** Production-focused leaders will:

- Bully city-states for units when possible
- Value military city-states that provide production bonuses to unit construction
- Invest in alliances with city-states that provide production-related benefits

### 5. Grand Strategy - Cached Production Flavor (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (line 399)

**Function:** `CvGrandStrategyAI::DoTurn()`

FLAVOR_PRODUCTION is cached at the start of each turn for efficient access throughout AI calculations.

```cpp
m_iFlavorProduction = GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_PRODUCTION"));
```

**Interpretation:** The cached production flavor combines the leader's base personality flavor with any bonuses from the active grand strategy. This value is used throughout the turn to make consistent production-related decisions. Grand strategies like Conquest may increase FLAVOR_PRODUCTION, while Culture Victory may decrease it.

### 6. Grand Strategy - Diplomatic Victory Priority (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 1113-1116, 1150-1153)

**Function:** `CvGrandStrategyAI::GetDiplomaticVictoryPriority()`

Buildings and policies with FLAVOR_PRODUCTION values contribute to diplomatic victory grand strategy priority.

```cpp
// From policies
else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_PRODUCTION")
{
    iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
}

// From buildings
else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_PRODUCTION")
{
    iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop);
}
```

**Interpretation:** When the AI evaluates whether to pursue diplomatic victory, it sums the FLAVOR_PRODUCTION values of all policies and buildings it has adopted/constructed. Production-enhancing infrastructure increases the appeal of diplomatic victory, recognizing that building World Congress projects and completing diplomatic missions requires substantial manufacturing capacity.

**Strategic Feedback Loop:** Building workshops, factories, and adopting production-focused policies makes diplomatic victory more attractive, creating a synergy between economic infrastructure and diplomatic goals.

### 7. Great Person Directive - Manufactory Placement (CvPlayerAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPlayerAI.cpp` (lines 1602-1604, 1613-1619)

**Function:** Great Engineer improvement construction decisions

FLAVOR_PRODUCTION influences whether Great Engineers should construct manufactories versus using their special abilities to rush production.

```cpp
ImprovementTypes eManufactory = (ImprovementTypes)GC.getInfoTypeForString("IMPROVEMENT_MANUFACTORY");
int iFlavor = GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_PRODUCTION"));
iFlavor += GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GROWTH"));

// Later in the decision logic:
int iNumImprovement = getImprovementCount(eManufactory);
if(iNumImprovement <= iFlavor)
{
    // Build manufactory
}
```

**Interpretation:** Great Engineers evaluate whether to build manufactories based on combined production and growth flavors, adjusted by current era and existing manufactories. A leader with FLAVOR_PRODUCTION = 8 and FLAVOR_GROWTH = 5 will build up to 13 manufactories (adjusted downward by era and previous engineer usage) before switching to production rushing.

**Strategic Trade-off:**

- **High FLAVOR_PRODUCTION:** Build many manufactories for long-term sustained production
- **Low FLAVOR_PRODUCTION:** Rush wonders and buildings for immediate impact

### 8. Policy Selection - Production Policy Weighting (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4932-4935)

**Function:** Social policy selection priority

FLAVOR_PRODUCTION adds weight to social policies that provide production bonuses.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_PRODUCTION")
{
    iWeight += iFlavorValue;
}
```

**Interpretation:** Policies with FLAVOR_PRODUCTION values are prioritized by production-focused leaders. The flavor value from the policy is added directly to the policy's selection weight. Leaders will favor policies that enhance manufacturing capacity, production efficiency, and wonder construction.

### 9. Religion Founding - Production Belief Selection (CvReligionClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (lines 8092-8094)

**Function:** `CvReligionAI::ScoreBeliefForPlayer()`

FLAVOR_PRODUCTION heavily influences which religious beliefs the AI selects when founding or enhancing religions.

```cpp
case YIELD_PRODUCTION:
    iPersonFlavor = pFlavorManager->GetPersonalityIndividualFlavor(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_PRODUCTION")) * 50;
    break;
```

**Interpretation:** When evaluating religious beliefs that grant production yields, the FLAVOR_PRODUCTION value is multiplied by 50. This creates significant differences in belief selection:

- FLAVOR_PRODUCTION = 9: Production-granting beliefs score 450 points
- FLAVOR_PRODUCTION = 3: Production-granting beliefs score 150 points

**Affected Beliefs:**

- Religious Idols (+1 production from mines on gold/silver)
- Religious Center (+2 production in holy city)
- Divine Inspiration (+4 faith from wonders, encourages wonder production)
- Monasteries/Synagogues (buildings that provide production bonuses)

**Strategic Impact:** Production-focused leaders will almost always select production-boosting beliefs for their religions, while diplomatic and cultural leaders will prioritize other yields.

### 10. Site Evaluation - Production Yield Multiplier (CvSiteEvaluationClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvSiteEvaluationClasses.cpp` (lines 214-221)

**Function:** `CvCitySiteEvaluator::ComputeFlavorMultipliers()`

FLAVOR_PRODUCTION directly affects how the AI values potential city settlement locations based on production resources.

```cpp
else if(strFlavor == "FLAVOR_PRODUCTION" ||
        strFlavor == "FLAVOR_WONDER")
{
    m_iFlavorMultiplier[YIELD_PRODUCTION] += pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(eFlavor);
    if(pkCitySpecializationEntry)
    {
        m_iFlavorMultiplier[YIELD_PRODUCTION] += pkCitySpecializationEntry->GetFlavorValue(eFlavor);
    }
}
```

**Interpretation:** FLAVOR_PRODUCTION (along with FLAVOR_WONDER) directly increases the production yield multiplier used in city site evaluation. A leader with FLAVOR_PRODUCTION = 9 will weight production tiles (hills, forests, strategic resources) 9 times more heavily when selecting settlement locations.

**Settlement Pattern Impact:**

- **High FLAVOR_PRODUCTION:** Prefers settling near hills, forests, stone, and strategic resources
- **Low FLAVOR_PRODUCTION:** Prefers settling near food, gold, or cultural resources

Production-focused leaders will often settle in less hospitable but resource-rich locations like hilly regions, forested areas, and mountain ranges.

### 11. Military Strategy Modifiers - War Increases Production (CoreStrategyChanges.sql)

**Location:** `(1) Community Patch/Database Changes/AI/CoreStrategyChanges.sql` (lines 200, 226, 252, 308, 334, 360)

**Function:** Dynamic flavor adjustment during warfare

FLAVOR_PRODUCTION is **temporarily increased** when the AI enters wartime strategies, reflecting that warfare requires sustained military production.

```sql
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_PRODUCTION', 10),
('MILITARYAISTRATEGY_WINNING_WARS', 'FLAVOR_PRODUCTION', 15),
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_PRODUCTION', 10),

-- Empire Defense strategies (when AI is defending at home)
('MILITARYAISTRATEGY_EMPIRE_DEFENSE', 'FLAVOR_PRODUCTION', -10),
('MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL', 'FLAVOR_PRODUCTION', 20),
('MILITARYAISTRATEGY_NEED_NAVAL_BOMBARDMENT', 'FLAVOR_PRODUCTION', 20),
```

**Interpretation:**

- **At War:** +10 FLAVOR_PRODUCTION (moderate increase for sustained military output)
- **Winning Wars:** +15 FLAVOR_PRODUCTION (aggressive production to capitalize on advantage)
- **Losing Wars:** +10 FLAVOR_PRODUCTION (defensive production to rebuild military)
- **Empire Defense (Normal):** -10 FLAVOR_PRODUCTION (building units, not infrastructure)
- **Empire Defense (Critical):** +20 FLAVOR_PRODUCTION (emergency infrastructure for military)
- **Need Naval Bombardment:** +20 FLAVOR_PRODUCTION (build naval units rapidly)

**Strategic Impact:** During warfare, the AI will:

- Prioritize production buildings (forges, workshops) to sustain military output
- Work more production tiles to build units faster
- Build more mines and lumber mills
- Delay culture and science buildings in favor of production infrastructure
- Rush production technologies

This creates realistic wartime behavior where civilian economies are converted to war production.

### 12. City Strategy - Happiness Crisis Response (StrategyChanges.sql)

**Location:** `(2) Vox Populi/Database Changes/AI/StrategyChanges.sql` (line 41)

**Function:** City-level strategy adjustments during happiness crises

FLAVOR_PRODUCTION temporarily **increases** during certain happiness crisis strategies.

```sql
('AICITYSTRATEGY_NEED_HAPPINESS_DEFENSE', 'FLAVOR_PRODUCTION', 40),
```

**Interpretation:** When a city needs happiness and defense simultaneously, FLAVOR_PRODUCTION increases by 40. This represents the AI's recognition that it must build defensive structures (walls, castles) and production infrastructure to overcome the crisis through military strength.

**Contextual Response:** The massive production boost during happiness defense crises reflects the game design philosophy that production infrastructure helps solve multiple problems: it builds defensive structures, creates military units to deter attackers, and establishes economic stability.

### 13. Process Selection - World Fair Production Focus (ProcessFlavorSweeps.sql)

**Location:** `(2) Vox Populi/Database Changes/AI/ProcessFlavorSweeps.sql` (line 16)

**Function:** City production process selection

FLAVOR_PRODUCTION heavily influences the selection of the "World Fair" production process.

```sql
('PROCESS_WORLD_FAIR', 'FLAVOR_PRODUCTION', 60),
```

**Interpretation:** Cities can convert production into World Congress projects through the World Fair process. Leaders with FLAVOR_PRODUCTION ≥ 6 will strongly prioritize this process when the World Fair is active, recognizing that their manufacturing capacity can be directed toward diplomatic goals.

**Strategic Synergy:** Production-focused civilizations excel at World Congress competitions (like World Fair, World Games, International Space Station) because they can dedicate their substantial hammer output to these projects while maintaining other city functions.

## Database Flavor Values

### Buildings with High FLAVOR_PRODUCTION

Buildings are evaluated by the AI based on their FLAVOR_PRODUCTION values. Higher values mean the AI prioritizes these buildings when production-focused.

**Early Game (Ancient-Classical Era):**

- Forge: 20
- Well: 25
- Stone Works: 20
- Buffalo Pound: 35 (also provides growth)
- Siege Foundry: 25

**Unique Buildings (Early):**

- Qullqa (Incan): 20
- Herbalist: 20
- Longhouse (Iroquois): 50 (exceptional production focus)
- Smokehouse: 20
- Ger (Mongolian): 20
- Mud Pyramid Mosque (Tabya): 40

**Mid Game (Medieval-Renaissance Era):**

- Watermill: 25
- Nilometer (Egyptian): 30
- Workshop: 40 (core production building)
- Elephant Camp (Siamese): 50
- Stable: 25
- Ducal Stable: 25
- Homestead: 30
- Seowon (Korean): 20
- Krepost (Russian): 20

**Late Game (Industrial-Modern Era):**

- Windmill: 30
- Brewhouse (German): 30
- Agribusiness: 10
- Andelsbevaegelse (Danish): 20
- Coaling Station: 50
- Factory: 50 (core industrial building)
- Steam Mill (German unique): 80 (highest building production flavor)
- Seaport: 20
- Refinery: 30
- Chaebol (Korean): 40

**Information Era:**

- Hydro Plant: 70
- Nuclear Plant: 90 (highest late-game production building)
- Solar Plant: 70
- Tidal Plant: 70
- Wind Plant: 70
- Spaceship Factory: 10

**Wonders:**

- Ironworks: 50 (national wonder providing massive production)
- Arsenale di Venezia: 50 (Venice shipyard)
- Great Cothon: 25 (Carthage harbor)
- White Tower: 10

**Religious Buildings:**

- Synagogue: 10
- Pagoda: 4
- Mandir: 2

**Corporations:**

- Firaxite Materials (Office): 50
- Firaxite Materials (HQ): 100
- Hexxon Refinery (Office): 50
- Hexxon Refinery (HQ): 100
- Centaurus Extractors (Office): 30
- Centaurus Extractors (HQ): 60

### Technologies with High FLAVOR_PRODUCTION

**Ancient Era:**

- Mining: 10 (Unlocks mines, stone quarries, Well building, Pyramids wonder)
- Bronze Working: 10 (Unlocks Forge, reveals Iron, production from chopping)
- Calendar: 5 (Plantations, jungle chopping)

**Classical Era:**

- Construction: 15 (Watermill, Arena, improved roads for movement)
- Metal Casting: 15 (Baths, Circus Maximus, Lumber Mills, Manufactory +3 production)

**Medieval Era:**

- Machinery: 10 (Crossbowmen, Workshop building)
- Civil Service: 10 (Farm improvements, bureaucracy)
- Chivalry: 5 (Knights, mounted production)
- Steel: 5 (Military production)

**Renaissance Era:**

- Economics: 20 (Windmills, banking systems for production financing)

**Industrial Era:**

- Railroad: 15 (Rapid unit movement, production logistics)
- Steam Power: 15 (Factories, coal power)
- Industrialization: 25 (Factory building, aluminum, production efficiency)
- Fertilizer: 5 (Agricultural production support)

**Modern Era:**

- Corporations: 30 (Corporate franchises providing production bonuses)

**Atomic Era:**

- Lasers: 15 (Jet fighters, modern manufacturing)

**Information Era:**

- Ecology: 20 (Hydro/Solar/Nuclear/Wind/Tidal plants - all renewable production power)

### Policies with High FLAVOR_PRODUCTION

**Ancient Era:**

- Aristocracy (Tradition): 5 (Wonder production bonus)
- Liberty: 7 (Early expansion and production)
- Republic (Liberty): 5 (Production in cities)

**Classical Era:**

- Discipline (Honor): 5 (Military production efficiency)
- Professional Army (Honor): 5 (Unit production bonuses)
- Piety: 14 (Religious production benefits)
- Organized Religion (Piety): 12 (Production from temples)
- Reformation (Piety): 12 (Production through faith)
- Free Religion (Piety): 12 (Religious production flexibility)

**Medieval-Renaissance Era:**

- Commerce: 23 (Trade-based production bonuses)
- Trade Unions (Commerce): 24 (Worker efficiency, faster improvements)
- Merchant Navy (Commerce): 24 (Naval production)
- Treasure Fleets (Commerce): 24 (Maritime production bonuses)
- Scientific Revolution (Rationalism): 24 (Science building production)

**Ideology Policies (Industrial Era+):**

**Order:**

- Five Year Plan: 60 (Massive production bonus - core Order policy)

**Autocracy:**

- Total War: 60 (Military production focus)
- Infiltration: 30 (Strategic production)

### City Events with FLAVOR_PRODUCTION

City events (random occurrences in cities) have choices influenced by FLAVOR_PRODUCTION:

- Mine Collapse Choice 2: +2 (Rebuild mine infrastructure)
- Corruption Choice 3: +20 (Invest in administrative production)
- Hurricane Choice 3: +20 (Rebuild production infrastructure)
- Hurricane Choice 5: +25 (Emergency reconstruction)
- Wanderer Choice 2: +20 (Recruit skilled worker for production)

## Summary of Effects

### Strategic Planning

- **Victory focus:** Increases preference for diplomatic and conquest victories, which require substantial production capacity
- **Grand strategy:** Creates feedback loops with production-focused buildings and policies
- **City placement:** Prioritizes production-rich locations (hills, forests, strategic resources) over food or gold sites

### City Development

- **Building priority:** Prioritizes forges, workshops, factories, and power plants over culture, gold, or science buildings
- **Specialization:** Designates cities as production-focused, working hill tiles and mines over flat food tiles
- **Tile improvements:** Workers prioritize mines, lumber mills, and quarries over farms and trading posts
- **Citizen assignment:** Cities work production tiles even at the expense of growth and gold

### Economic Strategy

- **Technology research:** Beelines production-enhancing technologies (Mining, Bronze Working, Machinery, Industrialization)
- **Policy selection:** Favors production-boosting policies (Five Year Plan, Trade Unions, Total War)
- **Religion:** Selects production-granting beliefs (Religious Idols, Divine Inspiration)
- **City-states:** Values military and industrial city-states that provide production bonuses

### Great People

- **Great Engineers:** Build many manufactories for long-term production before rushing wonders
- **Placement priority:** Manufactories placed on high-production tiles near production-specialized cities

### Dynamic Adjustments

- **Wartime:** FLAVOR_PRODUCTION temporarily increases by 10-20 during warfare, emphasizing military production
- **Empire defense:** Mixed adjustments (-10 normal, +20 critical) depending on defense urgency
- **Happiness crisis:** FLAVOR_PRODUCTION increases by 40 when defense is needed, forcing infrastructure construction
- **Grand strategy shifts:** Production flavor interacts with active grand strategy (higher during Conquest, lower during Culture)

## Design Philosophy

FLAVOR_PRODUCTION represents the AI's fundamental approach to manufacturing and construction:

1. **Development Strategy:** What to build (production infrastructure vs culture/science/gold buildings)
2. **Settlement Strategy:** Where to settle (resource-rich hills vs food-rich plains)
3. **Economic Priorities:** Whether to prioritize hammers over beakers, culture, or gold
4. **Military Capacity:** Ability to sustain prolonged military production during warfare

This creates a spectrum of AI economic development strategies:

- **High PRODUCTION (8-10):** Wonder builders and military powerhouses who maximize hammer output, build extensive production infrastructure, and can rapidly construct wonders, units, and buildings
- **Moderate PRODUCTION (5-7):** Balanced leaders who maintain healthy production while also investing in growth, culture, and science
- **Low PRODUCTION (2-4):** Diplomatic or cultural leaders who prioritize beakers, culture, and gold over hammers
- **Wartime (temporarily increased):** All leaders temporarily become more production-focused during warfare to sustain military output

## Related Flavors

- **FLAVOR_WONDER:** Synergizes with production (wonders require substantial hammers)
- **FLAVOR_OFFENSE / FLAVOR_DEFENSE:** Military flavors that benefit from high production capacity
- **FLAVOR_GROWTH:** Alternative development path focusing on population over hammers
- **FLAVOR_GOLD:** Alternative economic focus on gold over production
- **FLAVOR_TILE_IMPROVEMENT:** Infrastructure focus that includes mines, lumber mills, and production improvements
- **FLAVOR_EXPANSION:** Rapid expansion benefits from strong production to build settlers quickly

**Typical Combinations:**

- **High Production + High Wonder:** Classic wonder-builder strategy (Egypt, France)
- **High Production + High Offense:** Military powerhouse focused on unit production (Germany, Zulu)
- **High Production + High Expansion:** Rapid settler production and infrastructure building (Rome, Shoshone)
- **Low Production + High Culture:** Cultural/diplomatic civilizations that value culture and gold over hammers (France, Brazil)

FLAVOR_PRODUCTION is dynamically adjusted by military strategies and city strategies, making it one of the most responsive flavors to changing game conditions. A peacetime wonder-builder may temporarily become a wartime arms manufacturer, then return to civilian production after the war.

## Interaction with Game Mechanics

### Wonder Construction

FLAVOR_PRODUCTION heavily influences wonder construction decisions:

- Leaders with FLAVOR_PRODUCTION ≥ 7 will aggressively pursue wonders
- Production-specialized cities are designated as wonder-building cities
- Great Engineers are more likely to rush wonders when FLAVOR_PRODUCTION is high
- Technologies unlocking wonders receive bonus research priority

### Unit Production During War

During warfare, FLAVOR_PRODUCTION increases significantly:

- At War: Base +10
- Winning Wars: +15 (aggressive expansion requires sustained unit production)
- Losing Wars: +10 (defensive production to rebuild military)
- Critical Defense: +20 (emergency military mobilization)

This creates realistic behavior where wartime production shifts toward military units while still maintaining production infrastructure to sustain the war effort.

### Corporate Strategy

In late-game, FLAVOR_PRODUCTION influences corporate strategy:

- Production-focused leaders prioritize Firaxite Materials and Hexxon Refinery corporations
- Corporate offices and headquarters with high FLAVOR_PRODUCTION values are built in production-specialized cities
- Corporate franchises are valued based on production bonuses they provide

### Power Plant Selection

In the Information Era, FLAVOR_PRODUCTION determines power plant construction:

- Nuclear Plant: 90 (highest production bonus, but requires uranium)
- Hydro/Solar/Tidal/Wind Plants: 70 each (renewable alternatives)
- Leaders with FLAVOR_PRODUCTION ≥ 8 will prioritize Nuclear Plants when uranium is available
- Coastal cities with high production focus will build Tidal Plants

This creates diverse energy strategies based on production priorities and resource availability.
