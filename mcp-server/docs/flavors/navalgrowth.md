# FLAVOR_NAVAL_GROWTH

## Overview

FLAVOR_NAVAL_GROWTH is an AI personality flavor that controls the prioritization of coastal city development and maritime economic infrastructure in Civilization V. This flavor influences how aggressively the AI invests in harbor buildings, lighthouse construction, and improvements to ocean tiles, focusing on developing cities with significant coastal workable tiles to maximize their maritime potential.

## Description

Prioritization of coastal city growth, harbor development, and maritime economic infrastructure

## AI Behavior Impact

The FLAVOR_NAVAL_GROWTH flavor affects multiple aspects of AI decision-making across different game systems:

### City Strategy: Need Naval Growth (AICITYSTRATEGY_NEED_NAVAL_GROWTH)

**Activation Conditions**: This city-level strategy activates when a city has a significant proportion of ocean tiles in its workable radius.

**Implementation Details** (CvCityStrategyAI.cpp:2502-2548):

- Analyzes all workable plots within the city's 3-tile radius
- Counts ocean tiles (excludes lakes) owned by the city
- Calculates the percentage of ocean tiles versus total workable plots
- Default threshold: 35% ocean tiles triggers the strategy
- Threshold modifier: -1 weight per NAVAL_GROWTH flavor point
  - High NAVAL_GROWTH civs (8-10): Activates at 30-28% ocean tiles
  - Average NAVAL_GROWTH civs (5): Activates at 35% ocean tiles
  - Low NAVAL_GROWTH civs (2-3): Activates at 38-39% ocean tiles

**Purpose**: Identifies coastal cities that would significantly benefit from harbor infrastructure to make low-food ocean tiles more productive.

### Player Economic Strategy: Cities Need Naval Growth (ECONOMICAISTRATEGY_CITIES_NEED_NAVAL_GROWTH)

**Activation Logic** (CvEconomicAI.cpp:3873-3913):

- Counts how many cities are running AICITYSTRATEGY_NEED_NAVAL_GROWTH
- Calculates empire-wide threshold based on total city count
- Default threshold: 25 weight
- Threshold modifier: +1 weight per NAVAL_GROWTH flavor point
  - High NAVAL_GROWTH civs: Easier to activate (requires fewer coastal cities)
  - Low NAVAL_GROWTH civs: Harder to activate (requires more coastal cities)

**Weight Calculation**:

```
Current Weight = (Total Cities - 1) * 10 / Threshold
Strategy Activates when: Cities Needing Naval Growth > Current Weight
```

**Purpose**: Escalates NAVAL_GROWTH priority to empire-wide scale when enough cities need maritime development, influencing building queue priorities across all cities.

### Building Construction Priorities

Buildings with FLAVOR_NAVAL_GROWTH affinity receive increased priority in production queues:

**Ancient Era**:

- **Lighthouse** (FLAVOR_NAVAL_GROWTH: 20): Core maritime building providing food on ocean tiles
- **Runestone** (FLAVOR_NAVAL_GROWTH: 20): Danish unique lighthouse replacement with additional bonuses

**Medieval Era**:

- **Harbor** (FLAVOR_NAVAL_GROWTH: 20): Advanced maritime infrastructure providing gold, culture, and enhanced sea trade routes

**Information Era**:

- **Tidal Power Plant** (FLAVOR_NAVAL_GROWTH: 10): Late-game coastal power generation

### Technology Research

Technologies with FLAVOR_NAVAL_GROWTH affinity receive increased research priority:

**Ancient Era**:

- **Optics** (FLAVOR_NAVAL_GROWTH: 15): Unlocks Lighthouse, enables ocean navigation and sea trade routes

**Medieval Era**:

- **Compass** (FLAVOR_NAVAL_GROWTH: 10): Unlocks Harbor, increases sea trade route range, provides naval bonuses

**Special Tech Prioritization** (CvTechClasses.cpp:1282-1288):

- Civilizations with the "Smaller" trait (focusing on quality over quantity) receive bonus tech priority for NAVAL_GROWTH techs
- This creates synergy between tall empire strategies and coastal development

### Advisor System Integration

**Economic Advisor Priority** (CvAdvisorRecommender.cpp:290-293):

- FLAVOR_NAVAL_GROWTH has priority level 7 in the Economic Advisor category
- This influences which buildings and improvements the advisor recommends to the player
- Similar priority to FLAVOR_NAVAL_TILE_IMPROVEMENT (7)
- Lower than FLAVOR_GROWTH (15) but higher than FLAVOR_CITY_DEFENSE (1)

### Process Production Evaluation

**Food Processes** (CvProcessProductionAI.cpp:206):

- Cities running AICITYSTRATEGY_NEED_NAVAL_GROWTH influence process production calculations
- Affects decisions about converting production to food via maritime processes
- Integrates with overall yield management strategy

### Strategic Context Modifiers

FLAVOR_NAVAL_GROWTH is dynamically reduced during wartime conditions to prioritize military needs:

**At War - Player Level** (CoreStrategyChanges.sql:212):

- MILITARYAISTRATEGY_AT_WAR: -10 NAVAL_GROWTH modifier
- Coastal development becomes less important during active warfare

**At War - City Level** (CoreStrategyChanges.sql:320):

- MILITARYAISTRATEGY_AT_WAR: -30 NAVAL_GROWTH modifier (cities)
- Individual cities deprioritize harbors even more aggressively during war

**Winning Wars** (CoreStrategyChanges.sql:238, 346):

- MILITARYAISTRATEGY_WINNING_WARS: -10 NAVAL_GROWTH modifier (player)
- MILITARYAISTRATEGY_WINNING_WARS: -10 NAVAL_GROWTH modifier (cities)
- Focus remains on military expansion rather than coastal development

**Losing Wars** (CoreStrategyChanges.sql:264, 372):

- MILITARYAISTRATEGY_LOSING_WARS: -40 NAVAL_GROWTH modifier (player)
- MILITARYAISTRATEGY_LOSING_WARS: -40 NAVAL_GROWTH modifier (cities)
- Drastic reduction as empire focuses on survival

### Happiness Emergency Strategy

**Starvation Happiness Crisis** (StrategyChanges.sql:56):

- AICITYSTRATEGY_NEED_HAPPINESS_STARVE: +60 NAVAL_GROWTH modifier
- When cities need happiness from reduced food consumption, harbor buildings become highly prioritized
- Harbors help by improving food yields from ocean tiles, addressing both growth and happiness needs
- This emergency boost overrides normal strategic considerations

## Relationship with Other Flavors

FLAVOR_NAVAL_GROWTH interacts with and balances against other economic and military flavors:

### Complementary Flavors

- **FLAVOR_NAVAL_TILE_IMPROVEMENT**: Works together for complete coastal development (workboats + harbors)
- **FLAVOR_GROWTH**: Both focus on city development, with NAVAL_GROWTH specializing in coastal cities
- **FLAVOR_WATER_CONNECTION**: Harbor buildings provide water connection benefits
- **FLAVOR_I_SEA_TRADE_ROUTE**: Harbors enhance maritime trade route effectiveness
- **FLAVOR_GOLD**: Harbor buildings generate significant gold income

### Related Military Flavors

- **FLAVOR_NAVAL**: While NAVAL_GROWTH focuses on economic infrastructure, FLAVOR_NAVAL focuses on military ships
- **FLAVOR_NAVAL_RECON**: Both emphasize maritime presence, but different purposes (economic vs scouting)

### Conflicting Priorities During War

- **FLAVOR_OFFENSE**: War strategies reduce NAVAL_GROWTH significantly
- **FLAVOR_DEFENSE**: Military needs override coastal development
- **FLAVOR_MILITARY_TRAINING**: Resources shift from harbors to military buildings

### Economic Balance

The AI's overall coastal development emerges from the combination of:

- High NAVAL_GROWTH + High I_SEA_TRADE_ROUTE = Maritime trade empire
- High NAVAL_GROWTH + High NAVAL = Complete naval dominance
- High NAVAL_GROWTH + Low EXPANSION = Tall coastal civilization
- Low NAVAL_GROWTH + High EXPANSION = Land-focused expansion

## Leader Personality Variation

Different AI leaders have varying FLAVOR_NAVAL_GROWTH values based on their historical maritime traditions:

**High Naval Growth Leaders** (LeaderFlavorSweeps.sql):

- Leaders from historically maritime civilizations receive values of 8-9
- Examples include civilizations known for seafaring, trade, or island settlements
- These leaders aggressively develop coastal cities and prioritize harbor construction

**Barbarian Naval Growth** (CoreLeaderFlavorChanges.sql:21):

- LEADER_BARBARIAN: FLAVOR_NAVAL_GROWTH value of 4
- Ensures barbarians develop basic maritime capabilities

**Average Leaders**:

- Most inland-focused leaders have lower NAVAL_GROWTH values (2-5)
- Develop coastal infrastructure only when strategically necessary
- Prioritize land-based development over maritime expansion

## Game Phase Considerations

The impact of FLAVOR_NAVAL_GROWTH varies across different game phases:

### Early Game (Ancient-Classical Era)

- **Optics Technology**: First major decision point for maritime civs
- **Lighthouse Construction**: Foundational building for coastal cities
- **Coastal City Placement**: Higher NAVAL_GROWTH influences settling near coasts
- **Ocean Exploration**: Enables early sea trade routes and resource access

### Mid Game (Medieval-Renaissance Era)

- **Harbor Construction**: Major infrastructure investment in productive coastal cities
- **Sea Trade Network**: Enhanced maritime trade route capabilities
- **Compass Technology**: Unlocks advanced naval infrastructure
- **Coastal City Specialization**: Cities with 35%+ ocean tiles become maritime specialists

### Late Game (Industrial-Information Era)

- **Tidal Power Plants**: Final coastal infrastructure improvement
- **Established Maritime Economy**: Mature harbor networks generating significant yields
- **Strategic Naval Bases**: Coastal cities support both economic and military naval operations
- **Trade Route Optimization**: Maximum benefit from sea trade route infrastructure

## Strategic Significance

Understanding FLAVOR_NAVAL_GROWTH is valuable for:

### AI Prediction

- Anticipating which leaders will invest heavily in coastal infrastructure
- Predicting settlement patterns (preference for coastal locations)
- Estimating maritime trade route development
- Identifying civilizations that will compete for coastal resources

### Diplomatic Strategy

- Maritime-focused AIs may be interested in open borders for sea trade
- High NAVAL_GROWTH leaders more vulnerable to naval blockades
- Coastal development creates opportunities for naval warfare or protection agreements
- Sea trade routes create economic interdependencies

### Military Strategy

- Coastal cities with harbors generate more gold (funding military)
- Harbor cities are more valuable targets for conquest
- Maritime infrastructure indicates likely naval military development
- Blockading harbors can significantly damage maritime economies

### Trade Strategy

- High NAVAL_GROWTH civs are ideal sea trade partners
- Maritime routes to harbor cities provide maximum benefits
- Coastal development creates natural trade networks
- Competition for limited coastal city sites

## Technical Implementation Details

### Threshold Calculation Formula

For city-level strategy activation:

```
Weight Threshold = Base Threshold (40) + Weight Modifier
Weight Modifier = -1 * NAVAL_GROWTH Flavor Value
Activation = (Ocean Plots * 100) / Total Workable Plots >= Weight Threshold
```

For player-level strategy activation:

```
Weight Threshold = Base Threshold (25) + Weight Modifier
Weight Modifier = +1 * NAVAL_GROWTH Flavor Value
Current Weight = (Total Cities - 1) * 10 / Weight Threshold
Activation = Cities Needing Naval Growth > Current Weight
```

### Database Integration

FLAVOR_NAVAL_GROWTH values are stored in the game database and associated with:

- Leader personality definitions (Leader_Flavors table)
- Building construction priorities (Building_Flavors table)
- Technology research weights (Technology_Flavors table)
- City strategy thresholds (AICityStrategy_Flavors table)
- Economic strategy thresholds (AIEconomicStrategy_Flavors table)
- Military strategy modifiers (AIMilitaryStrategy_Flavors table)

### Advisor System Suppression

Note: The advisor counsel for AICITYSTRATEGY_NEED_NAVAL_GROWTH is disabled in the UI to reduce notification spam (StrategyChanges.sql:28), but the strategy still functions internally for AI decision-making.

## Synergies and Special Cases

### Tall Empire Synergy

Civilizations with the "Smaller" trait receive bonus priority for NAVAL_GROWTH technologies, making maritime development particularly effective for tall, quality-focused empires.

### Happiness Crisis Override

During severe happiness problems related to food (AICITYSTRATEGY_NEED_HAPPINESS_STARVE), NAVAL_GROWTH receives a massive +60 boost, making harbor construction the top priority for affected coastal cities.

### Ocean Percentage Edge Cases

- **Pure Coastal Cities** (80%+ ocean): Strongly favor NAVAL_GROWTH strategies
- **Moderate Coastal Cities** (35-50% ocean): Typical harbor candidates
- **Marginal Coastal Cities** (25-35% ocean): Only high NAVAL_GROWTH civs develop these
- **Inland Cities with Lakes**: Lake tiles don't count toward ocean percentage

## Related Flavors

For a complete understanding of AI maritime and coastal behavior, consider these related flavors:

- **FLAVOR_NAVAL**: Military naval unit production and warfare
- **FLAVOR_NAVAL_RECON**: Naval exploration and reconnaissance units
- **FLAVOR_NAVAL_TILE_IMPROVEMENT**: Workboat production and ocean resource improvement
- **FLAVOR_WATER_CONNECTION**: City connection and coastal infrastructure
- **FLAVOR_I_SEA_TRADE_ROUTE**: International sea trade route prioritization
- **FLAVOR_GROWTH**: General city growth and food production
- **FLAVOR_GOLD**: Economic development and gold generation
- **FLAVOR_EXPANSION**: Settlement and territorial expansion patterns

## Notes

- Flavor values typically range from 0-10, with 5 being neutral
- NAVAL_GROWTH specifically affects economic maritime infrastructure, not military ships
- The flavor value inversely affects city-level thresholds (higher flavor = lower threshold)
- The flavor value positively affects player-level thresholds (higher flavor = easier activation)
- War conditions temporarily suppress NAVAL_GROWTH priorities by up to -40 points
- Happiness emergencies can temporarily boost NAVAL_GROWTH by +60 points
- The 35% ocean tile threshold is designed around the typical 21-37 workable plots per city
- Actual AI behavior emerges from the combination of multiple flavors and game context

## Data Sources

This documentation is based on:

- C++ source code analysis from civ5-dll/CvGameCoreDLL_Expansion2/
  - CvCityStrategyAI.cpp (lines 2502-2548): City strategy activation logic
  - CvEconomicAI.cpp (lines 3873-3913): Player strategy activation logic
  - CvAdvisorRecommender.cpp (lines 290-293): Advisor priority system
  - CvProcessProductionAI.cpp (line 206): Process production integration
  - CvTechClasses.cpp (lines 1282-1288): Technology prioritization
- SQL database configuration from civ5-dll/
  - (1) Community Patch/Database Changes/AI/CoreStrategyChanges.sql: War modifiers
  - (2) Vox Populi/Database Changes/AI/StrategyChanges.sql: Strategy definitions
  - (2) Vox Populi/Database Changes/AI/BuildingFlavorSweeps.sql: Building priorities
  - (2) Vox Populi/Database Changes/AI/TechFlavorSweeps.sql: Technology priorities
  - (2) Vox Populi/Database Changes/AI/LeaderFlavorSweeps.sql: Leader variations
- Community Patch AI architecture and flavor weighting system
