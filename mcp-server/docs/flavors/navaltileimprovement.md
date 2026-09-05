# FLAVOR_NAVAL_TILE_IMPROVEMENT

## Overview

FLAVOR_NAVAL_TILE_IMPROVEMENT is an AI personality flavor that controls the prioritization of work boat production and ocean resource improvement in Civilization V. This flavor influences how aggressively the AI builds work boats to improve water-based resources such as fish, pearls, whales, crabs, and offshore platforms, ensuring that coastal cities can exploit sea resources for food, production, and gold yields.

## Description

Prioritization of work boat production and water resource exploitation to maximize yields from ocean and coastal tiles

## AI Behavior Impact

The FLAVOR_NAVAL_TILE_IMPROVEMENT flavor affects multiple aspects of AI decision-making across different game systems:

### City Strategy: Need Naval Tile Improvement (AICITYSTRATEGY_NEED_NAVAL_TILE_IMPROVEMENT)

**Activation Conditions**: This city-level strategy activates when a city has unimproved water resources within its workable radius.

**Implementation Details** (CvCityStrategyAI.cpp:2550-2586):

- Analyzes all workable plots within the city's 3-tile radius
- Specifically checks water tiles (ocean and coast) owned by the city
- Counts unimproved water resources that require work boats
- Validates resources using `NeedWorkboatToImproveResource()` check
- Strategy activates immediately when `iNumUnimprovedWaterResources > 0`
- **No threshold calculation**: Any unimproved water resource triggers the strategy

**Purpose**: Identifies cities with valuable but unexploited sea resources, triggering immediate work boat production prioritization.

### City Strategy: Enough Naval Tile Improvement (AICITYSTRATEGY_ENOUGH_NAVAL_TILE_IMPROVEMENT)

**Activation Logic** (CvCityStrategyAI.cpp:2588-2648):

- Only evaluated if AICITYSTRATEGY_NEED_NAVAL_TILE_IMPROVEMENT is NOT active
- Returns true when the "Need" strategy is not running
- Additional validation checks for work boats already in production or en route
- Scans for UNITAI_WORKER_SEA units near unimproved water tiles
- Checks if water tiles can be improved with current available builds
- Prevents over-production of work boats

**Purpose**: Prevents excessive work boat production once resources are being addressed or when work boats are already deployed.

### Player Economic Strategy: Cities Need Naval Tile Improvement (ECONOMICAISTRATEGY_CITIES_NEED_NAVAL_TILE_IMPROVEMENT)

**Activation Logic** (CvEconomicAI.cpp:3915-3962):

- Counts how many cities are running AICITYSTRATEGY_NEED_NAVAL_TILE_IMPROVEMENT
- **Simplified activation**: Strategy activates when `iNumCitiesNeedNavalTileImprovement > 0`
- Empire-wide strategy enables cities to build work boats for each other
- Previously used weighted threshold calculation (now commented out)
- Modifier was +1 weight per NAVAL_TILE_IMPROVEMENT flavor point

**Weight Calculation (Historical)**:

```
Weight Threshold = Base Threshold (25) + Weight Modifier
Weight Modifier = +1 * NAVAL_TILE_IMPROVEMENT Flavor Value
Current Weight = (Total Cities - 1) * 10 / Weight Threshold
Strategy Activated when: Cities Needing Naval Tile Improvement > Current Weight
```

**Purpose**: Escalates NAVAL_TILE_IMPROVEMENT priority empire-wide, allowing any city to produce work boats for coastal cities with unimproved resources.

### Unit Production: Work Boat Prioritization

**Work Boat (UNIT_WORKBOAT)** (UnitFlavorSweeps.sql:20):

- **FLAVOR_NAVAL_TILE_IMPROVEMENT**: 20
- Core naval improvement unit that creates fishing boats and offshore platforms
- High flavor weight ensures work boats are prioritized when strategy is active
- Work boats cannot attack and must be consumed to build improvements

**Production Priority Impact**:

- Cities running AICITYSTRATEGY_NEED_NAVAL_TILE_IMPROVEMENT receive massive flavor boost
- FLAVOR_NAVAL_TILE_IMPROVEMENT value of 150 for this strategy
- This creates strong pressure to build work boats immediately
- Only interrupted by urgent military or settler needs

### Technology Research

Technologies with FLAVOR_NAVAL_TILE_IMPROVEMENT affinity receive increased research priority:

**Ancient Era**:

- **Pottery** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 5): Early tech enabling basic resource improvements
- **Sailing** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 25): Unlocks work boats and enables ocean resource exploitation

**Medieval Era**:

- **Compass** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 10): Improves naval infrastructure and sea resource yields

**Renaissance Era**:

- **Navigation** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 5): Enhanced maritime capabilities

**Industrial Era**:

- **Steam Power** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 10): Unlocks advanced sea improvements and capabilities

**Modern Era**:

- **Refrigeration** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 20): Unlocks offshore platforms, dramatically increases sea food/production yields
- **Ecology** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 20): Advanced maritime resource management

### Building Construction Priorities

Buildings with FLAVOR_NAVAL_TILE_IMPROVEMENT affinity enhance the effectiveness of improved water resources:

**Ancient Era**:

- **Lighthouse** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 20): Provides +1 food on water resources, synergizes with work boat improvements
- **Runestone** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 20): Danish unique lighthouse with additional bonuses

**Medieval Era**:

- **Harbor** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 20): +1 production on sea resources, enhances work boat improvements

**Industrial Era**:

- **Seaport** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 50): Major yield boost to water resources, maximizes work boat value

**Atomic Era**:

- **Tidal Power Plant** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 30): Advanced building providing production from coastal tiles

**Information Era**:

- **Centaurus Extractors** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 30): Corporation building enhancing resource extraction
- **Centaurus Extractors HQ** (FLAVOR_NAVAL_TILE_IMPROVEMENT: 60): Headquarters building with massive resource bonuses

### Advisor System Integration

**Economic Advisor Priority** (CvAdvisorRecommender.cpp:294-296):

- FLAVOR_NAVAL_TILE_IMPROVEMENT has priority level 7 in the Economic Advisor category
- Influences which units and buildings the advisor recommends
- Same priority as FLAVOR_NAVAL_GROWTH (7)
- Higher than FLAVOR_CITY_DEFENSE (1) but lower than FLAVOR_GROWTH (15)

**Science Advisor Priority** (CvAdvisorRecommender.cpp:469-471):

- FLAVOR_NAVAL_TILE_IMPROVEMENT has priority level 1 in the Science Advisor category
- Minimal influence on science-focused recommendations
- Science advisor prioritizes research over resource improvements

### Strategic Context Modifiers

FLAVOR_NAVAL_TILE_IMPROVEMENT is dynamically reduced during wartime but not as dramatically as NAVAL_GROWTH:

**At War Strategy** (CoreStrategyChanges.sql:112):

- ECONOMICAISTRATEGY_CITIES_NEED_NAVAL_TILE_IMPROVEMENT: +10 NAVAL_TILE_IMPROVEMENT modifier
- Paradoxically, the war strategy INCREASES this flavor slightly
- Work boats remain valuable during war for food/production from sea resources
- Less dramatic reduction compared to NAVAL_GROWTH because resources are immediate value

### City Strategy Flavor Modifiers

**Need Naval Tile Improvement** (CoreStrategyChanges.sql:433):

- AICITYSTRATEGY_NEED_NAVAL_TILE_IMPROVEMENT: +150 NAVAL_TILE_IMPROVEMENT modifier
- Massive boost ensures work boats are top production priority
- Overrides most other considerations except critical military needs

**Enough Naval Tile Improvement** (CoreStrategyChanges.sql:434):

- AICITYSTRATEGY_ENOUGH_NAVAL_TILE_IMPROVEMENT: -5 NAVAL_TILE_IMPROVEMENT modifier
- Small reduction once work boats are in production or deployed
- Prevents over-investment in work boats when resources are being addressed

### Work Boat Production AI

**Work Boat Demand Detection** (CvEconomicAI.cpp:2912):

- EconomicAI tracks cities with active AICITYSTRATEGY_NEED_NAVAL_TILE_IMPROVEMENT
- Influences empire-wide production priorities
- Coordinates work boat production across multiple cities
- Allows non-coastal cities to help by building work boats if they have coast access

## Relationship with Other Flavors

FLAVOR_NAVAL_TILE_IMPROVEMENT interacts with and balances against other economic and naval flavors:

### Complementary Flavors

- **FLAVOR_NAVAL_GROWTH**: Works together for complete coastal development (work boats + harbors)
- **FLAVOR_GROWTH**: Both focus on food yields, with NAVAL_TILE_IMPROVEMENT providing sea food
- **FLAVOR_TILE_IMPROVEMENT**: General improvement flavor, NAVAL_TILE_IMPROVEMENT is maritime-specific
- **FLAVOR_PRODUCTION**: Work boats improve production yields from sea resources
- **FLAVOR_GOLD**: Certain sea resources (pearls, whales) provide gold yields

### Related Naval Flavors

- **FLAVOR_NAVAL**: While NAVAL_TILE_IMPROVEMENT focuses on resource exploitation, FLAVOR_NAVAL focuses on military ships
- **FLAVOR_NAVAL_RECON**: Scouting ships discover new sea resources that need improvement
- **FLAVOR_WATER_CONNECTION**: Infrastructure that complements improved sea resources

### Economic Balance

The AI's overall maritime resource strategy emerges from:

- High NAVAL_TILE_IMPROVEMENT + High NAVAL_GROWTH = Complete maritime economy
- High NAVAL_TILE_IMPROVEMENT + Low NAVAL_GROWTH = Resource-focused without infrastructure
- Low NAVAL_TILE_IMPROVEMENT + High NAVAL_GROWTH = Infrastructure without resource exploitation
- High TILE_IMPROVEMENT + High NAVAL_TILE_IMPROVEMENT = Total improvement focus

## Leader Personality Variation

Different AI leaders have varying FLAVOR_NAVAL_TILE_IMPROVEMENT values based on their maritime traditions:

**Barbarian Naval Development** (CoreLeaderFlavorChanges.sql:22):

- LEADER_BARBARIAN: FLAVOR_NAVAL_TILE_IMPROVEMENT value of 4
- Ensures barbarians can exploit basic sea resources

**High Naval Tile Improvement Leaders** (LeaderFlavorSweeps.sql):

- Leaders from seafaring civilizations receive values of 7-10
- **Kamehameha** (Polynesia): 10 - Highest priority due to island-based unique ability
- **Dido** (Carthage): 8 - Strong maritime trading tradition
- **Gajah Mada** (Indonesia): 8 - Island empire dependent on sea resources
- These leaders aggressively improve sea resources immediately upon discovery

**Average Leaders**:

- Most leaders have NAVAL_TILE_IMPROVEMENT values between 4-7
- Default value around 6 for balanced approach
- Improve sea resources when strategically valuable
- May delay work boat production if pressing military needs exist

**Inland-Focused Leaders**:

- Leaders with limited coastal access have lower values (2-4)
- Build work boats only when absolutely necessary
- Prioritize land-based tile improvements over sea resources

## Game Phase Considerations

The impact of FLAVOR_NAVAL_TILE_IMPROVEMENT varies across different game phases:

### Early Game (Ancient Era)

- **Sailing Technology**: Critical first decision for coastal civs
- **First Work Boat**: Immediate food/production boost from first sea resource
- **Fish vs Luxury**: Deciding whether to improve food (fish) or luxury (pearls, whales) first
- **Coastal Settlement**: Higher NAVAL_TILE_IMPROVEMENT influences settling near sea resources
- **Food Security**: Early fish improvements can determine city viability

### Mid Game (Classical-Medieval Era)

- **Resource Network**: Multiple work boats improving all accessible sea resources
- **Lighthouse Synergy**: Buildings multiplying the value of improved sea resources
- **Harbor Construction**: Further amplifying work boat improvements
- **Luxury Resource Trade**: Improved luxury sea resources enable trading for happiness
- **Expanding Sea Territory**: Work boats for newly founded coastal cities

### Late Game (Renaissance-Modern Era)

- **Offshore Platforms**: Refrigeration unlocks powerful oil/production platforms
- **Complete Exploitation**: All sea resources fully improved and enhanced by buildings
- **Strategic Resources**: Oil platforms become critical for late-game military
- **Seaport Multipliers**: Maximum yields from long-improved sea resources
- **Corporation Synergies**: Buildings like Centaurus Extractors maximize resource value

### Information Era

- **Ecology Benefits**: Advanced sea resource yields
- **Mature Maritime Economy**: Decades-old work boat improvements paying dividends
- **Strategic Value**: Oil platforms supporting aircraft carrier and submarine production
- **Trade Route Bonuses**: Improved resources enhancing international sea trade routes

## Strategic Significance

Understanding FLAVOR_NAVAL_TILE_IMPROVEMENT is valuable for:

### AI Prediction

- Anticipating which leaders will quickly improve sea resources
- Predicting work boat production timing
- Estimating food/production capacity of coastal cities
- Identifying civilizations competing for maritime resources

### Diplomatic Strategy

- Sea resource trading becomes possible after improvement
- High NAVAL_TILE_IMPROVEMENT leaders have luxury resources to trade
- Improved resources increase city yields, affecting power balance
- Strategic resources (oil) critical for late-game military agreements

### Military Strategy

- Pillaging work boat improvements can cripple coastal cities
- Sea resource-dependent cities are vulnerable to blockades
- Work boats themselves are defenseless and easy targets
- Improved oil platforms indicate modern naval capability
- Denying sea resources through control of work boats disrupts economy

### Economic Strategy

- Coastal cities with many improved resources generate significant yields
- Work boat improvements are permanent (until pillaged)
- Sea resources often more valuable than land tiles (with buildings)
- Competing for limited luxury sea resources affects happiness strategies
- Oil platforms are crucial for late-game production capacity

### Settling Strategy

- High NAVAL_TILE_IMPROVEMENT AIs will settle aggressively near sea resources
- Fish resources make otherwise poor coastal locations viable
- Multiple sea resources in range significantly increase settlement value
- Blocking AI access to sea resources through settlement is strategic

## Technical Implementation Details

### Unimproved Resource Detection

For city-level strategy activation (CvCityStrategyAI.cpp:2550-2586):

```cpp
Algorithm:
1. Iterate through all workable plots (3-tile radius from city)
2. Check if plot is water and owned by player
3. If plot has resource and NO_IMPROVEMENT:
   - Validate resource requires work boat
   - Increment unimproved counter
4. Activate strategy if counter > 0
```

### Work Boat Sufficiency Check

For "Enough" strategy evaluation (CvCityStrategyAI.cpp:2588-2648):

```cpp
Algorithm:
1. If "Need" strategy is active, return false (still need work boats)
2. Scan city radius for:
   - UNITAI_WORKER_SEA units near unimproved water tiles
   - Available builds that can improve water plots
3. Count work boats already addressing the need
4. Return true if work boats are present or resources being improved
```

### Empire-Wide Coordination

For player-level strategy (CvEconomicAI.cpp:3915-3962):

```cpp
Current Implementation:
- Count cities with AICITYSTRATEGY_NEED_NAVAL_TILE_IMPROVEMENT active
- Activate empire strategy if count > 0
- Enables ANY city to build work boats for coastal cities

Historical Implementation (Commented Out):
- Weight Threshold = 25 + (1 * NAVAL_TILE_IMPROVEMENT Flavor)
- Current Weight = (Total Cities - 1) * 10 / Weight Threshold
- Activate when: Cities Needing > Current Weight
```

### Database Integration

FLAVOR_NAVAL_TILE_IMPROVEMENT values are stored in the game database and associated with:

- Leader personality definitions (Leader_Flavors table)
- Unit production priorities (Unit_Flavors table)
- Building construction weights (Building_Flavors table)
- Technology research priorities (Technology_Flavors table)
- City strategy thresholds (AICityStrategy_Flavors table)
- Economic strategy thresholds (AIEconomicStrategy_Flavors table)

## Resource Types Affected

Work boats can improve various water resources:

### Food Resources

- **Fish**: +1 food base, enhanced by lighthouse (+1) and harbor
- **Crabs**: Food and gold yields
- Crucial for coastal city growth and population

### Luxury Resources

- **Pearls**: Gold and culture yields, provides happiness
- **Whales**: Food, production, and gold yields, provides happiness
- Critical for empire happiness and trade opportunities

### Strategic Resources

- **Oil** (Offshore): Production and gold yields (with Refrigeration tech)
- Essential for late-game military units (aircraft, modern armor)
- Offshore platforms can be pillaged, unlike land oil

### Combined Yields

- Buildings multiply the base yields from improved resources
- Lighthouse, Harbor, Seaport create stacking bonuses
- Late-game improved sea resources can exceed land tile yields
- Corporation buildings add additional multipliers

## Synergies and Special Cases

### Lighthouse + Work Boat Synergy

Work boat improvements provide base yields, lighthouses multiply them. The combination is more powerful than either alone, creating strong incentive for both.

### Strategic Resource Dependency

Late-game military requires oil. Civilizations without land oil MUST improve offshore oil platforms, making FLAVOR_NAVAL_TILE_IMPROVEMENT critical for military competitiveness.

### Island Start Synergy

Civilizations starting on islands or small continents have inherently higher FLAVOR_NAVAL_TILE_IMPROVEMENT value since sea resources are their primary food/production source.

### Work Boat Defense Vulnerability

Work boats are civilian units with no combat strength. They can be captured or killed, making them vulnerable during wartime. This creates risk-reward decisions about when to send work boats.

### Pillaging Impact

Unlike land improvements, pillaged water improvements require a new work boat to rebuild. This makes sea resource improvements more vulnerable to disruption than land improvements.

### Multi-City Cooperation

The empire-wide strategy allows inland cities with coast access to build work boats for distant coastal cities that lack production capacity. This coordination is unique to this flavor.

## Related Flavors

For a complete understanding of AI maritime resource behavior, consider these related flavors:

- **FLAVOR_NAVAL_GROWTH**: Harbor and lighthouse construction to enhance sea tile yields
- **FLAVOR_TILE_IMPROVEMENT**: General land-based improvement prioritization
- **FLAVOR_GROWTH**: Food production and city growth priorities
- **FLAVOR_PRODUCTION**: Production capacity and improvement priorities
- **FLAVOR_NAVAL**: Military naval unit production
- **FLAVOR_NAVAL_RECON**: Naval exploration to discover sea resources
- **FLAVOR_WATER_CONNECTION**: Coastal infrastructure and city connections
- **FLAVOR_GOLD**: Economic development and gold generation
- **FLAVOR_EXPANSION**: Settlement patterns near sea resources

## Notes

- Flavor values typically range from 0-10, with 5 being neutral
- NAVAL_TILE_IMPROVEMENT affects economic resource exploitation, not military
- The strategy has no threshold - ANY unimproved water resource triggers it
- Empire-wide coordination is unique to this flavor (simplified in current version)
- Work boats are single-use units consumed when creating improvements
- Buildings like Lighthouse and Harbor dramatically multiply work boat value
- Strategic sea resources (oil) make this flavor critical in late game
- Barbarians can capture work boats, making early improvements risky
- Work boat production competes with military and settler production
- Actual AI behavior emerges from combination of multiple flavors and game context

## Data Sources

This documentation is based on:

- C++ source code analysis from civ5-dll/CvGameCoreDLL_Expansion2/
  - CvCityStrategyAI.cpp (lines 2550-2648): City strategy activation logic
  - CvEconomicAI.cpp (lines 3915-3962): Player strategy activation logic
  - CvAdvisorRecommender.cpp (lines 294-296, 469-471): Advisor priority system
- SQL database configuration from civ5-dll/
  - (1) Community Patch/Database Changes/AI/CoreStrategyChanges.sql: Strategy definitions
  - (1) Community Patch/Database Changes/AI/CoreLeaderFlavorChanges.sql: Barbarian flavor
  - (2) Vox Populi/Database Changes/AI/UnitFlavorSweeps.sql: Work boat priorities
  - (2) Vox Populi/Database Changes/AI/TechFlavorSweeps.sql: Technology priorities
  - (2) Vox Populi/Database Changes/AI/LeaderFlavorSweeps.sql: Leader variations
  - (2) Vox Populi/Database Changes/AI/BuildingFlavorSweeps.sql: Building priorities
- Community Patch AI architecture and flavor weighting system
