# FLAVOR_NAVAL_RECON

## Overview

FLAVOR_NAVAL_RECON is an AI personality flavor that controls the prioritization of naval exploration, sea scouting, and ocean-based reconnaissance in Civilization V. This flavor influences how aggressively the AI invests in naval units designed for exploration and vision, particularly units that can reveal the fog of war over water tiles and discover new continents.

## Description

Prioritization of naval exploration and sea-based reconnaissance units

## AI Behavior Impact

The FLAVOR_NAVAL_RECON flavor affects multiple aspects of AI decision-making across different game systems, with particular emphasis on maritime exploration and ocean control:

### Naval Explorer Calculation

**Dynamic Explorer Requirements**: The FLAVOR_NAVAL_RECON value directly modifies how many naval explorers the AI believes it needs. In `CvEconomicAI.cpp`, the calculation determines plots per explorer:

```
iPlotsPerExplorer = MAX_PLOTS_PER_EXPLORER - FLAVOR_NAVAL_RECON
```

- **Higher values** (e.g., 8-10): Reduce plots per explorer, requiring more exploration units
- **Lower values** (e.g., 2-4): Increase plots per explorer, requiring fewer exploration units
- **Standard range**: Typically 5-7 for most leaders

This means a leader with FLAVOR_NAVAL_RECON = 8 will want roughly 35% more naval explorers than a leader with value = 5.

**Recon State Management**: The AI maintains a naval reconnaissance state that determines exploration priorities:

- `RECON_STATE_NEEDED`: Actively seeking more naval explorers
- `RECON_STATE_NEUTRAL`: Maintaining current exploration capacity
- `RECON_STATE_ENOUGH`: Satisfied with current naval exploration coverage

### Naval Unit Production

**Exploration Ship Prioritization**: Higher FLAVOR_NAVAL_RECON values significantly increase the AI's tendency to produce and value naval units with exploration capabilities:

**Early Era Explorers** (Ancient to Medieval):

- Galley (FLAVOR_NAVAL_RECON: 7)
- Trireme (FLAVOR_NAVAL_RECON: 10)
- Carthaginian Quinquereme (FLAVOR_NAVAL_RECON: 15)

**Age of Exploration** (Renaissance to Industrial):

- Caravel (FLAVOR_NAVAL_RECON: 24) - Primary exploration vessel
- Portuguese Nau (FLAVOR_NAVAL_RECON: 30) - Enhanced exploration unique unit
- Longship (FLAVOR_NAVAL_RECON: 27) - Viking exploration vessel
- Privateer (FLAVOR_NAVAL_RECON: 26)
- Ironclad (FLAVOR_NAVAL_RECON: 28)

**Modern Era Reconnaissance Ships**:

- Destroyer (FLAVOR_NAVAL_RECON: 32)
- Fleet Destroyer (FLAVOR_NAVAL_RECON: 36)
- Submarine (FLAVOR_NAVAL_RECON: 30)
- Nuclear Submarine (FLAVOR_NAVAL_RECON: 36)
- Sensor Combat Ship (FLAVOR_NAVAL_RECON: 40) - Maximum recon capability
- Supercarrier (FLAVOR_NAVAL_RECON: 40) - Air-based naval reconnaissance

### Technology Research Priorities

**Exploration Technologies**: FLAVOR_NAVAL_RECON increases research priority for technologies that unlock naval exploration:

- **Compass** (FLAVOR_NAVAL_RECON: 20): Unlocks Caravel and Harbor, enables longer sea trade routes
- **Astronomy** (FLAVOR_NAVAL_RECON: 20): Enables ocean crossing and observatories, critical for transoceanic exploration

These technologies become significantly more attractive to leaders with high naval recon values.

### Policy Selection

**Navigation School Policy**: The Exploration tree's Navigation School policy has FLAVOR_NAVAL_RECON: 24, making it highly attractive to maritime exploration-focused civilizations. This policy enhances naval movement and vision range, directly supporting reconnaissance goals.

### Strategic AI Behavior

**Economic Strategies**:

**Expand to Other Continents** (+40 FLAVOR_NAVAL_RECON):

- Actively triggered when the AI identifies new continents to settle
- Dramatically increases naval exploration priority
- Boosts production of ships capable of crossing oceans

**Really Need Recon Sea** (+50 FLAVOR_NAVAL_RECON):

- Emergency strategy when maritime areas are heavily unexplored
- Highest naval recon flavor boost of any strategy
- Takes precedence over other naval priorities

**Losing Money** (-300 FLAVOR_NAVAL_RECON):

- Severely reduces naval exploration when economy is struggling
- Exploration ships are expensive to maintain
- Shifts focus from exploration to economy

**Too Many Units** (-100 FLAVOR_NAVAL_RECON):

- Reduces naval recon priority when military is oversized
- Prevents excessive explorer production

**Military Strategies**:

**War Mobilization** (+25 FLAVOR_NAVAL_RECON):

- Increases naval reconnaissance during military buildup
- Scouts enemy coastlines and naval positions
- Identifies invasion routes and naval threat locations

**At War** (+20 to +30 FLAVOR_NAVAL_RECON):

- Moderate boost to naval reconnaissance during active warfare
- Maintains naval intelligence and coastal awareness
- City-level strategy provides +30, player-level provides +20

**Winning Wars** (+20 to +30 FLAVOR_NAVAL_RECON):

- Maintains aggressive naval scouting while dominating
- Identifies new targets and strategic opportunities
- Supports continued expansion efforts

**Losing Wars** (+20 FLAVOR_NAVAL_RECON):

- Maintains defensive naval awareness
- Monitors enemy naval movements and threats
- Lower priority than defensive units but still valued

**City Strategies**:

**Lakebound City** (-500 FLAVOR_NAVAL_RECON):

- Massive penalty for cities on lakes without ocean access
- Prevents wasteful production of ocean explorers
- Redirects naval resources to ocean-access cities

**New Continent Feeder City** (+100 FLAVOR_NAVAL_RECON):

- Dramatically increases naval recon priority for coastal cities on new continents
- These cities become primary producers of exploration vessels
- Supports continued exploration from forward positions

### Unit AI Assignment

**UNITAI_EXPLORE_SEA**: Units with high FLAVOR_NAVAL_RECON values are preferentially assigned to sea exploration AI:

- Sent to fog of war boundaries
- Scout unexplored ocean areas
- Reveal new continents and islands
- Identify resources and strategic positions

**Reconnaissance Missions**: Naval recon units are tasked with:

- Mapping coastlines and ocean tiles
- Discovering natural wonders and island chains
- Identifying potential settlement locations
- Monitoring enemy naval activity

### Advisor Recommendations

**Advisor System Integration**: FLAVOR_NAVAL_RECON affects advisor recommendations:

- **Military Advisor** (FLAVOR_NAVAL_RECON: 3): Lower priority, focused on combat ships
- **Foreign Advisor** (FLAVOR_NAVAL_RECON: 11): High priority for diplomatic exploration
- **Science Advisor** (FLAVOR_NAVAL_RECON: 11): High priority for discovery and mapping

Leaders with high foreign or science focus receive stronger naval exploration recommendations.

### Promotion Selection

**Naval Unit Promotions**: In `CvUnit.cpp`, the FLAVOR_NAVAL_RECON value (clamped to 1-20 range) influences promotion choices for naval units, affecting decisions about:

- Sight range improvements
- Movement speed enhancements
- Survival and evasion capabilities
- Coastal and ocean bonuses

## Relationship with Other Flavors

FLAVOR_NAVAL_RECON interacts with and balances against other exploration, military, and naval flavors:

### Complementary Flavors

- **FLAVOR_RECON**: Land-based reconnaissance counterpart; together they determine overall exploration aggression
- **FLAVOR_NAVAL**: General naval power focus; high naval + high naval recon = dominant maritime civilization
- **FLAVOR_EXPANSION**: Exploration reveals settlement opportunities; both flavors support territorial growth
- **FLAVOR_NAVAL_GROWTH**: Economic maritime development complements exploration infrastructure

### Opposing Flavors

- **FLAVOR_OFFENSE**: Combat units compete for production with exploration ships
- **FLAVOR_DEFENSE**: Defensive posture reduces resources available for exploration
- **FLAVOR_GOLD**: Economic focus may deprioritize expensive exploration fleets

### Context-Dependent Interactions

The effectiveness of FLAVOR_NAVAL_RECON is heavily context-dependent:

**Geographic Context**:

- **Island/Archipelago Maps**: FLAVOR_NAVAL_RECON becomes critically important
- **Pangaea Maps**: Naval recon value diminishes significantly
- **Coastal Access**: Cities without ocean access ignore naval recon flavor

**Game Phase**:

- **Ancient Era**: Limited by coastal-only ships (Galley, Trireme)
- **Medieval Era**: Explosive importance with Compass technology and Caravels
- **Renaissance-Industrial**: Peak importance during age of exploration
- **Modern Era**: Submarines and advanced ships maintain relevance

## Leader Personality Variation

Different AI leaders have varying FLAVOR_NAVAL_RECON values that reflect their historical maritime exploration traditions:

### High Naval Recon Leaders (8-10)

Leaders with strong historical exploration or naval dominance traditions:

- **Dido (Carthage)**: FLAVOR_NAVAL_RECON = 8, reflects Carthaginian maritime prowess
- Leaders focused on cross-ocean colonization
- Island-based civilizations with exploration heritage

### Moderate Naval Recon Leaders (5-7)

Most leaders fall in this range, providing balanced exploration behavior:

- **Standard Value**: FLAVOR_NAVAL_RECON = 7 (default personality baseline)
- **Barbarians**: FLAVOR_NAVAL_RECON = 4 (limited exploration)
- Adaptable to geographic and strategic needs

### Low Naval Recon Leaders (2-4)

Land-focused civilizations with minimal maritime exploration:

- Continental powers with limited naval traditions
- Landlocked historical empires
- Defense-oriented civilizations

## Game Phase Considerations

The impact of FLAVOR_NAVAL_RECON varies dramatically across different game phases:

### Ancient Era (4000 BC - 500 BC)

**Limited Coastal Exploration**:

- Galley and Trireme provide basic coastal scouting
- Cannot cross deep ocean tiles
- Focus on mapping coastlines and nearby islands
- Identifies barbarian naval camps

**Strategic Value**: Moderate importance, mainly for coastal civilizations

### Classical to Medieval Era (500 BC - 1000 AD)

**Enhanced Coastal Control**:

- Improved naval units with better range
- Fusta and Galleass provide ranged naval recon
- Still limited to coastal waters
- Critical for Mediterranean-style maps

**Strategic Value**: Growing importance as naval warfare develops

### Renaissance Era (1000 AD - 1500 AD)

**Age of Exploration Begins**:

- **Compass Technology**: Revolutionary impact on FLAVOR_NAVAL_RECON
- **Caravel**: First true ocean-going explorer (FLAVOR_NAVAL_RECON: 24)
- Cross-ocean exploration becomes possible
- Discovery of new continents and resources

**Strategic Value**: Peak importance; defines civilization expansion potential

### Industrial to Modern Era (1500 AD - 1900 AD)

**Advanced Naval Reconnaissance**:

- Ironclads and Destroyers combine combat and recon
- Longer sight ranges and faster movement
- Submarines provide covert reconnaissance
- Strategic resource identification becomes critical

**Strategic Value**: Sustained high importance for global powers

### Atomic to Information Era (1900 AD+)

**Technological Superiority**:

- Nuclear Submarines (FLAVOR_NAVAL_RECON: 36)
- Sensor Combat Ships (FLAVOR_NAVAL_RECON: 40)
- Supercarriers with air reconnaissance capabilities
- Complete ocean awareness and control

**Strategic Value**: Essential for naval dominance and power projection

## Conquest Victory Impact

FLAVOR_NAVAL_RECON is particularly important for Conquest strategies:

**Naval Invasion Planning**:

- Identifies enemy coastal cities and defenses
- Reveals landing zones and invasion routes
- Monitors enemy naval positions

**Island and Coastal Targets**:

- Essential for identifying and attacking island civilizations
- Coastal bombardment positioning
- Strategic chokepoint control

**Domination Synergy**: Works with FLAVOR_NAVAL and FLAVOR_OFFENSE to enable naval-based conquest

## Technical Implementation

### Code-Level Integration

**CvEconomicAI.cpp**:

- `iPlotsPerExplorer` calculation directly uses FLAVOR_NAVAL_RECON
- Naval recon state machine manages exploration priorities
- Dynamic adjustment based on unexplored ocean tiles

**CvAdvisorRecommender.cpp**:

- Advisor-specific FLAVOR_NAVAL_RECON weights
- Recommendation system integration
- Context-aware advice based on flavor values

**CvGrandStrategyAI.cpp**:

- Grand strategy flavor bonuses during Conquest
- Policy evaluation for exploration trees
- Long-term maritime strategic planning

**CvPolicyAI.cpp**:

- Policy flavor calculations include FLAVOR_NAVAL_RECON
- Navigation School policy evaluation
- Exploration tree attractiveness

**CvUnit.cpp**:

- Promotion selection influenced by FLAVOR_NAVAL_RECON
- Unit AI assignment for UNITAI_EXPLORE_SEA
- Naval reconnaissance behavior patterns

### Database Integration

**Unit Flavors** (`UnitFlavorSweeps.sql`):

- Each naval unit has a specific FLAVOR_NAVAL_RECON value
- Progression from early explorers (7) to advanced recon ships (40)
- Affects unit production priority calculations

**Strategy Flavors** (`CoreStrategyChanges.sql`):

- Economic strategies modify FLAVOR_NAVAL_RECON dynamically
- Military strategies adjust naval reconnaissance priority
- City strategies provide location-specific modifiers

**Technology Flavors** (`TechFlavorSweeps.sql`):

- Compass and Astronomy have high FLAVOR_NAVAL_RECON weights
- Research priority adjustments based on naval exploration needs

**Policy Flavors** (`PolicyFlavorSweeps.sql`):

- Navigation School strongly favored by high naval recon leaders
- Exploration policy tree synergies

**Leader Flavors** (`LeaderFlavorSweeps.sql`):

- Base FLAVOR_NAVAL_RECON values define leader personalities
- Historical maritime exploration reflected in flavor values

### Dynamic Weighting

The effective FLAVOR_NAVAL_RECON weight is calculated through:

1. **Base Leader Personality**: Starting flavor value (typically 5-8)
2. **Strategic Modifiers**: Active strategies add/subtract flavor weight
3. **Situational Context**: Geographic factors (coastal access, island placement)
4. **Economic State**: Money and unit cap constraints modify weight
5. **War Status**: Military strategies provide combat-related recon boosts

**Formula Pattern**:

```
Effective_Naval_Recon = Base_Flavor
    + Strategy_Modifiers
    - Economic_Penalties
    + War_Bonuses
    + City_Location_Factors
```

### Contextual Modification

The effective weight of FLAVOR_NAVAL_RECON is modified by:

**Geographic Context**:

- Lakebound cities: -500 (completely disabled)
- New continent feeder cities: +100
- Coastal vs inland cities affect priority

**Economic Situation**:

- Losing money: -300 (severe penalty)
- Too many units: -100

**Military State**:

- War mobilization: +25
- Active warfare: +20 to +30
- Winning wars: +20 to +30
- Losing wars: +20

**Strategic Goals**:

- Expand to other continents: +40
- Really need sea recon: +50

## Strategic Significance

Understanding FLAVOR_NAVAL_RECON is valuable for:

### AI Prediction

**Exploration Patterns**:

- Leaders with high values (8+) will aggressively explore oceans
- Expect early Caravel production after researching Compass
- Anticipate discovery of remote islands and continents

**Naval Composition**:

- High naval recon leaders maintain standing exploration fleets
- Balance between combat ships and scout vessels
- Resource allocation to naval infrastructure

### Diplomatic Strategy

**Maritime Competition**:

- High naval recon civilizations compete for island settlements
- Ocean resources and wonders attract exploration-focused AIs
- Potential for naval conflicts over strategic positions

**Cooperative Opportunities**:

- Research agreements for Compass and Astronomy
- Open borders for mutual exploration
- Shared discovery of distant continents

### Counter-Strategy

**Blocking Exploration**:

- Naval units can intercept and block enemy explorers
- Contested waters slow exploration progress
- Submarine warfare against reconnaissance ships

**Economic Warfare**:

- Target enemy exploration fleets to limit expansion
- Privateer raids disrupt maritime reconnaissance
- Force economic strain through naval attrition

## Balanced Flavor Combinations

The AI's overall naval behavior emerges from combinations:

### Maritime Dominance

- High FLAVOR_NAVAL_RECON (8+)
- High FLAVOR_NAVAL (7+)
- High FLAVOR_EXPANSION (7+)
- **Result**: Aggressive ocean exploration and island colonization

### Naval Warfare Focus

- Moderate FLAVOR_NAVAL_RECON (5-6)
- High FLAVOR_NAVAL (8+)
- High FLAVOR_OFFENSE (7+)
- **Result**: Combat-oriented navy with adequate reconnaissance

### Defensive Maritime

- Low FLAVOR_NAVAL_RECON (3-4)
- High FLAVOR_NAVAL_GROWTH (7+)
- High FLAVOR_DEFENSE (7+)
- **Result**: Economic maritime focus with minimal exploration

### Continental Power

- Low FLAVOR_NAVAL_RECON (2-4)
- Low FLAVOR_NAVAL (3-5)
- High FLAVOR_EXPANSION (8+)
- **Result**: Land-focused expansion, minimal ocean interest

## Related Flavors

For a complete understanding of AI naval and exploration behavior, consider these related flavors:

- **FLAVOR_NAVAL**: General naval military power and ship production
- **FLAVOR_RECON**: Land-based reconnaissance and exploration
- **FLAVOR_EXPANSION**: Settlement and territorial growth
- **FLAVOR_NAVAL_GROWTH**: Economic maritime development
- **FLAVOR_NAVAL_TILE_IMPROVEMENT**: Fish boats and ocean resource development
- **FLAVOR_NAVAL_MELEE**: Combat-focused melee naval units
- **FLAVOR_NAVAL_RANGED**: Combat-focused ranged naval units
- **FLAVOR_SUBMARINE**: Specialized submarine warfare and stealth recon

## Notes

- Flavor values typically range from 0-10 for base leader personalities
- Strategic modifiers can push effective values much higher (or into deep negative)
- FLAVOR_NAVAL_RECON has the widest swing of any flavor (-500 to +100 from strategies)
- Geographic context is the primary determinant of flavor effectiveness
- Ocean-crossing technologies (Compass, Astronomy) create inflection points in flavor impact
- Late-game submarine and sensor ships maintain reconnaissance relevance
- Lakebound penalty (-500) completely overrides all other considerations

## Code References

### C++ Implementation

**CvEconomicAI.cpp:2465**

```cpp
iPlotsPerExplorer = MAX_PLOTS_PER_EXPLORER -
    GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_NAVAL_RECON")
    );
```

Directly calculates how many explorers are needed based on FLAVOR_NAVAL_RECON value.

**CvAdvisorRecommender.cpp:373-375**

```cpp
else if(strFlavorName == "FLAVOR_NAVAL_RECON")
{
    return 3;  // Military Advisor weight
}
```

Military Advisor has low FLAVOR_NAVAL_RECON priority (3).

**CvAdvisorRecommender.cpp:439-442**

```cpp
else if(strFlavorName == "FLAVOR_NAVAL_RECON")
{
    return 11;  // Foreign Advisor weight
}
```

Foreign Advisor has high FLAVOR_NAVAL_RECON priority (11) for diplomatic exploration.

**CvAdvisorRecommender.cpp:481-484**

```cpp
else if(strFlavorName == "FLAVOR_NAVAL_RECON")
{
    return 11;  // Science Advisor weight
}
```

Science Advisor has high FLAVOR_NAVAL_RECON priority (11) for discovery.

**CvGrandStrategyAI.cpp:634-637**

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_NAVAL_RECON")
{
    iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
}
```

Grand strategy includes FLAVOR_NAVAL_RECON in policy priority calculations during Conquest.

**CvPolicyAI.cpp:4924**

```cpp
else if (/* FLAVOR_NAVAL || */ "FLAVOR_NAVAL_RECON" /* || other naval flavors */)
{
    iConquestValue += iFlavorValue;
}
```

Naval recon contributes to Conquest victory strategy policy evaluation.

**CvUnit.cpp:31668**

```cpp
int iFlavorNavalRecon = range(
    pFlavorMgr->GetPersonalityIndividualFlavor(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_NAVAL_RECON")
    ),
    1, 20
);
```

Retrieves and clamps FLAVOR_NAVAL_RECON (1-20) for naval unit promotion selection.

### Database Configuration

**CoreStrategyChanges.sql** - Economic Strategy Modifiers:

- Line 90: `ECONOMICAISTRATEGY_EXPAND_TO_OTHER_CONTINENTS` → +40 FLAVOR_NAVAL_RECON
- Line 109: `ECONOMICAISTRATEGY_LOSING_MONEY` → -300 FLAVOR_NAVAL_RECON
- Line 118: `ECONOMICAISTRATEGY_REALLY_NEED_RECON_SEA` → +50 FLAVOR_NAVAL_RECON
- Line 123: `ECONOMICAISTRATEGY_TOO_MANY_UNITS` → -100 FLAVOR_NAVAL_RECON

**CoreStrategyChanges.sql** - Military Strategy Modifiers:

- Line 180: `MILITARYAISTRATEGY_WAR_MOBILIZATION` → +25 FLAVOR_NAVAL_RECON
- Line 193: `MILITARYAISTRATEGY_AT_WAR` (Player) → +20 FLAVOR_NAVAL_RECON
- Line 219: `MILITARYAISTRATEGY_WINNING_WARS` (Player) → +20 FLAVOR_NAVAL_RECON
- Line 245: `MILITARYAISTRATEGY_LOSING_WARS` (Player) → +20 FLAVOR_NAVAL_RECON
- Line 301: `MILITARYAISTRATEGY_AT_WAR` (City) → +30 FLAVOR_NAVAL_RECON
- Line 327: `MILITARYAISTRATEGY_WINNING_WARS` (City) → +30 FLAVOR_NAVAL_RECON
- Line 353: `MILITARYAISTRATEGY_LOSING_WARS` (City) → +20 FLAVOR_NAVAL_RECON

**CoreStrategyChanges.sql** - City Strategy Modifiers:

- Line 414: `AICITYSTRATEGY_LAKEBOUND` → -500 FLAVOR_NAVAL_RECON
- Line 418: `AICITYSTRATEGY_NEW_CONTINENT_FEEDER` → +100 FLAVOR_NAVAL_RECON

**CoreLeaderFlavorChanges.sql** - Leader Personalities:

- Line 20: `LEADER_BARBARIAN` → FLAVOR_NAVAL_RECON = 4

**UnitFlavorSweeps.sql** - Naval Unit Recon Values:

- Early explorers: Galley (7), Trireme (10)
- Age of exploration: Caravel (24), Portuguese Nau (30), Longship (27)
- Modern reconnaissance: Destroyer (32), Nuclear Submarine (36), Sensor Combat Ship (40)

**TechFlavorSweeps.sql** - Technology Research Priorities:

- Line 177: `TECH_COMPASS` → FLAVOR_NAVAL_RECON = 20
- Line 201: `TECH_ASTRONOMY` → FLAVOR_NAVAL_RECON = 20

**PolicyFlavorSweeps.sql** - Policy Selection:

- Line 125: `POLICY_NAVIGATION_SCHOOL` → FLAVOR_NAVAL_RECON = 24

**LeaderFlavorSweeps.sql** - Default Leader Values:

- Line 39: Default personality FLAVOR_NAVAL_RECON = 7
- Line 111: Alternative default = 5
- Line 185: Alternative default = 8
- Line 259: Alternative default = 8
- Line 354: Dido (Carthage) = 8

## Data Sources

This documentation is based on analysis of:

- Community Patch DLL C++ source code in `civ5-dll/CvGameCoreDLL_Expansion2/`
- Vox Populi database modifications in `civ5-dll/(1) Community Patch/Database Changes/AI/`
- Vox Populi database modifications in `civ5-dll/(2) Vox Populi/Database Changes/AI/`
- AI flavor system configuration and strategic AI implementation
- Economic AI, Military AI, and Grand Strategy AI subsystems
