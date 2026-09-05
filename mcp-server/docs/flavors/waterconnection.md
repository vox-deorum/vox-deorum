# FLAVOR_WATER_CONNECTION

## Overview

FLAVOR_WATER_CONNECTION is an AI personality flavor that controls the prioritization of coastal city connections, harbor buildings, and maritime infrastructure linking cities together in Civilization V. This flavor influences how the AI values establishing water-based connections between cities and the capital, emphasizing the importance of harbors and seaports for trade routes and city connectivity.

## Description

Emphasis on coastal cities, harbors, and establishing maritime connections between settlements

## AI Behavior Impact

The FLAVOR_WATER_CONNECTION flavor affects AI decision-making across several game systems, though it has a more specialized role compared to broader economic flavors:

### Player Economic Strategy: One or Fewer Coastal Cities (ECONOMICAISTRATEGY_ONE_OR_FEWER_COASTAL_CITIES)

**Purpose**: This strategy nullifies WATER_CONNECTION flavor when the player lacks sufficient coastal presence.

**Activation Logic** (CvEconomicAI.cpp:4278-4292):

- Counts the total number of coastal cities in the empire
- Strategy activates when the player has 1 or fewer coastal cities
- When active, this strategy reduces or eliminates WATER_CONNECTION flavor influence

**Implementation Details**:

```cpp
/// "One or Fewer Coastal Cities" Player Strategy:
/// If we don't have 2 coastal cities, this runs nullifying the WATER_CONNECTION Flavor
bool EconomicAIHelpers::IsTestStrategy_OneOrFewerCoastalCities(CvPlayer* pPlayer)
{
    int iNumCoastalCities = 0;
    for(pLoopCity = pPlayer->firstCity(&iCityLoop); pLoopCity != NULL; pLoopCity = pPlayer->nextCity(&iCityLoop))
    {
        if(pLoopCity->isCoastal())
        {
            iNumCoastalCities++;
        }
    }
    return iNumCoastalCities <= 1;
}
```

**Strategic Impact**:

- Prevents the AI from overinvesting in harbor infrastructure with minimal coastal presence
- Ensures WATER_CONNECTION flavor only influences decisions when it's strategically relevant
- Automatically adapts AI priorities based on empire geography
- Helps landlocked or nearly-landlocked civilizations avoid wasting production on maritime infrastructure

**Lua API Exclusion** (CvLuaPlayer.cpp:19504-19506):

- This strategy is blacklisted from LLM (Language Model) access
- The formula-based calculation is not suitable for external AI decision-making
- Indicates this is a core internal AI balancing mechanism

### Policy and Ideology Selection

**Diplomatic Value Contribution** (CvPolicyAI.cpp:4984-4987):

FLAVOR_WATER_CONNECTION contributes to the diplomatic value (iDiploValue) calculation when the AI evaluates policies and ideology tenets:

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_WATER_CONNECTION" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_I_TRADE_DESTINATION")
{
    iDiploValue += iFlavorValue;
}
```

**Implementation Context**:

- Part of the `WeighPolicy` function that evaluates policy branches and ideology tenets
- WATER_CONNECTION is grouped with FLAVOR_I_TRADE_DESTINATION, indicating shared diplomatic/trade focus
- Policies and tenets with WATER_CONNECTION flavor receive increased weight for diplomatic-focused civilizations
- This links maritime connectivity with diplomatic victory strategies

**Strategic Implications**:

- AIs with high WATER_CONNECTION flavor are more likely to adopt policies that support:
  - International trade routes
  - City-state diplomacy (particularly maritime city-states)
  - Economic cooperation and trade agreements
  - Diplomatic victory paths leveraging trade networks
- Creates synergy between coastal development and diplomatic strategies
- Reflects the historical role of maritime trade in international relations

### Advisor System Integration

**Economic Advisor Priority** (CvAdvisorRecommender.cpp:334-337):

```cpp
else if(strFlavorName == "FLAVOR_WATER_CONNECTION")
{
    return 17;
}
```

**Priority Context**:

- FLAVOR_WATER_CONNECTION has priority level 17 in the Economic Advisor category
- This is the highest economic priority among commonly used flavors
- Significantly higher than:
  - FLAVOR_GROWTH: 15
  - FLAVOR_INFRASTRUCTURE: 9
  - FLAVOR_PRODUCTION: 6
  - FLAVOR_WONDER: 5
- Similar priority to top military concerns (FLAVOR_OFFENSE: 17)

**Advisor System Impact**:

- The Economic Advisor strongly recommends buildings, improvements, and technologies with WATER_CONNECTION flavor
- Players receive high-priority notifications about harbor construction opportunities
- Influences the UI recommendations shown to human players
- Reflects the game's emphasis on the strategic importance of maritime connectivity

## Relationship with Other Flavors

FLAVOR_WATER_CONNECTION interacts with and complements several other economic and maritime flavors:

### Complementary Flavors

- **FLAVOR_NAVAL_GROWTH**: Both focus on coastal development; NAVAL_GROWTH emphasizes harbor buildings for growth while WATER_CONNECTION emphasizes city connectivity
- **FLAVOR_INFRASTRUCTURE**: Both prioritize connections between cities; WATER_CONNECTION specializes in maritime routes
- **FLAVOR_I_SEA_TRADE_ROUTE**: Both enhance maritime trade; WATER_CONNECTION provides the infrastructure while I_SEA_TRADE_ROUTE drives route creation
- **FLAVOR_I_TRADE_DESTINATION**: Directly grouped together in policy evaluation, both supporting trade-focused strategies
- **FLAVOR_GOLD**: Harbor-based connections generate significant gold income through trade routes
- **FLAVOR_DIPLOMACY**: Linked through policy evaluation; maritime trade networks support diplomatic strategies

### Related Economic Flavors

- **FLAVOR_EXPANSION**: Settlement patterns interact with coastal connectivity needs
- **FLAVOR_I_LAND_TRADE_ROUTE**: Parallel land-based trade infrastructure
- **FLAVOR_NAVAL_TILE_IMPROVEMENT**: Develops ocean resources that make coastal cities more valuable

### Strategic Balance

The AI's overall maritime connectivity strategy emerges from combinations such as:

- High WATER_CONNECTION + High NAVAL_GROWTH = Comprehensive coastal empire
- High WATER_CONNECTION + High I_SEA_TRADE_ROUTE = Maritime trade dominance
- High WATER_CONNECTION + High DIPLOMACY = Trade-based diplomatic victory
- Low WATER_CONNECTION + High EXPANSION = Land-focused expansion empire

## Buildings and Infrastructure

While the specific buildings with WATER_CONNECTION flavor are defined in the game's XML database rather than the C++ code, this flavor typically influences:

**Expected Building Priorities**:

- **Harbor**: Primary building for establishing water connections between coastal cities and the capital
- **Seaport**: Advanced maritime infrastructure for enhanced connectivity
- **Lighthouse**: Early coastal infrastructure supporting maritime development
- **Grand Canal**: Wonder providing water connection benefits

**Technology Priorities**:

- **Optics**: Unlocks ocean navigation and early harbor buildings
- **Compass**: Enhances harbor functionality and extends maritime trade range
- **Navigation**: Advanced seafaring technology supporting maritime networks
- **Electricity**: Enables seaports and late-game maritime infrastructure

## Strategic Significance

Understanding FLAVOR_WATER_CONNECTION is valuable for:

### AI Prediction

- Identifying which leaders will prioritize coastal city placement
- Anticipating early harbor construction in coastal cities
- Predicting maritime trade route development patterns
- Estimating resistance to settling purely inland locations

### Empire Planning

- Leaders with high WATER_CONNECTION will:
  - Settle additional coastal cities even with minimal coastal tiles
  - Rush harbor buildings in coastal cities
  - Prioritize technologies that enable water connections
  - Avoid being trapped with only 1-2 coastal cities
- Leaders with low WATER_CONNECTION will:
  - Focus on land-based city connections
  - Delay harbor construction until strategically necessary
  - Prioritize inland expansion over coastal development

### Diplomatic Strategy

- High WATER_CONNECTION civs are natural trade partners for sea routes
- Maritime connectivity creates economic interdependencies
- Disrupting water connections through naval blockades is highly damaging
- Coastal development patterns reveal strategic priorities

### Military Strategy

- Cities with water connections have stronger economies
- Harbor cities are higher-value conquest targets
- Naval control becomes more strategically important
- Maritime trade route vulnerabilities can be exploited

## Economic Strategy Interactions

### Coastal City Threshold Mechanic

The "One or Fewer Coastal Cities" strategy creates important threshold behavior:

**0-1 Coastal Cities**:

- WATER_CONNECTION flavor effectively nullified
- AI avoids investing in maritime infrastructure
- Focus shifts to land-based development
- Harbor construction deprioritized

**2+ Coastal Cities**:

- WATER_CONNECTION flavor fully active
- AI invests in harbors and maritime connections
- Coastal development becomes economically viable
- Trade route networks expand

**Strategic Implications**:

- Creates a tipping point at 2 coastal cities
- Encourages either committing to coastal development or avoiding it entirely
- Prevents inefficient hybrid strategies
- Reinforces geographic specialization

### Geographic Adaptation

FLAVOR_WATER_CONNECTION demonstrates sophisticated geographic awareness:

- **Island/Archipelago Maps**: WATER_CONNECTION becomes critical for all civs
- **Pangaea Maps**: WATER_CONNECTION influence reduced for most civs
- **Coastal Civilizations**: High flavor value ensures maximum coastal exploitation
- **Inland Civilizations**: Strategy system prevents wasted maritime investment

## Technical Implementation Details

### Strategy Evaluation

The "One or Fewer Coastal Cities" strategy is evaluated each turn as part of the economic AI update cycle:

1. **City Counting**: Iterates through all player cities checking `isCoastal()` status
2. **Threshold Check**: Compares count against threshold (2 cities)
3. **Flavor Modification**: When active, this strategy modifies WATER_CONNECTION influence
4. **Dynamic Adjustment**: Re-evaluates each turn, adapting to city founding and conquest

### Policy Weight Calculation

FLAVOR_WATER_CONNECTION contributes to policy evaluation through:

```
iDiploValue += (Policy WATER_CONNECTION Flavor) * (Leader WATER_CONNECTION Flavor)
```

This creates multiplicative scaling where:

- High leader flavor + high policy flavor = strong preference
- Low leader flavor makes WATER_CONNECTION policies less attractive
- Zero policy flavor means no WATER_CONNECTION influence

### Advisor Priority Formula

The Economic Advisor uses WATER_CONNECTION's priority (17) to determine recommendation strength:

- Higher priority = more urgent recommendations
- Priority 17 ensures harbor construction appears as top economic priority
- Competing priorities from other flavors may still override in specific contexts

## Game Phase Considerations

### Early Game (Ancient-Classical Era)

- **Initial Scouting**: Coastal city placement decisions informed by WATER_CONNECTION
- **First Coastal City**: Triggers evaluation of coastal commitment
- **Second Coastal City**: Crosses threshold, activating full WATER_CONNECTION influence
- **Optics Research**: First major technology decision for maritime civs

### Mid Game (Medieval-Renaissance Era)

- **Harbor Construction**: Primary expression of WATER_CONNECTION flavor
- **Maritime Trade Networks**: Water connections enable profitable sea routes
- **Coastal Expansion**: Continued coastal settling for high WATER_CONNECTION leaders
- **Compass Technology**: Enhances existing maritime infrastructure

### Late Game (Industrial-Information Era)

- **Seaport Upgrades**: Advanced maritime infrastructure in established coastal cities
- **Trade Route Optimization**: Mature water connection networks maximize economic output
- **Strategic Consolidation**: Water connections become established empire features
- **Defensive Considerations**: Protected maritime routes provide reliable income

## Leader Personality Variation

While specific leader FLAVOR_WATER_CONNECTION values are defined in the game database, leaders typically fall into categories:

**High Water Connection Leaders** (expected values 7-10):

- Civilizations with strong maritime histories
- Island or coastal-based civilizations
- Trade-focused civilizations (Venice, Portugal, Carthage historical parallels)
- Leaders pursuing diplomatic or economic victories

**Moderate Water Connection Leaders** (expected values 4-6):

- Balanced civilizations with both coastal and inland presence
- Civilizations with flexible strategic options
- Leaders adapting to map conditions

**Low Water Connection Leaders** (expected values 1-3):

- Land-focused civilizations
- Militaristic expansionist leaders
- Civilizations with continental power bases
- Leaders prioritizing conquest over trade

## Synergies and Special Cases

### Trade-Diplomatic Victory Synergy

FLAVOR_WATER_CONNECTION's grouping with FLAVOR_I_TRADE_DESTINATION in policy evaluation creates natural synergy for trade-based diplomatic victories:

- Maritime trade routes provide both gold and diplomatic leverage
- Water connections enable maximum trade route efficiency
- Diplomatic policies become more attractive
- Creates viable alternative to military victory paths

### Geographic Threshold Effect

The 2-coastal-city threshold creates interesting strategic dynamics:

- Losing a coastal city (conquest/razing) may drop below threshold
- Reconquering or founding coastal cities reactivates flavor
- Creates strategic value in protecting/targeting coastal cities
- Encourages either full commitment or complete avoidance of coastal strategy

### Policy Branch Implications

Policies with WATER_CONNECTION flavor likely include:

- **Commerce/Liberty branches**: Supporting trade and expansion
- **Ideology tenets**: Freedom and Order trade-focused tenets
- **City-state policies**: Maritime city-state diplomacy bonuses
- **Trade route policies**: Enhancing sea route benefits

## Related Flavors

For complete understanding of AI coastal and maritime behavior, consider these related flavors:

- **FLAVOR_NAVAL_GROWTH**: Harbor buildings and coastal city development
- **FLAVOR_NAVAL**: Military naval unit production
- **FLAVOR_NAVAL_RECON**: Naval exploration units
- **FLAVOR_NAVAL_TILE_IMPROVEMENT**: Ocean resource improvements
- **FLAVOR_I_SEA_TRADE_ROUTE**: International sea trade routes
- **FLAVOR_I_TRADE_DESTINATION**: Being a desirable trade destination
- **FLAVOR_INFRASTRUCTURE**: General city connection and road networks
- **FLAVOR_DIPLOMACY**: Diplomatic relations enhanced by trade
- **FLAVOR_GOLD**: Economic benefits from trade routes
- **FLAVOR_EXPANSION**: Settlement patterns and city placement

## Notes

- Flavor values typically range from 0-10, with 5 being neutral
- WATER_CONNECTION has the highest Economic Advisor priority (17), indicating its strategic importance
- The 2-coastal-city threshold creates a sharp transition in AI behavior
- WATER_CONNECTION is grouped with trade and diplomatic flavors in policy evaluation
- This flavor is specifically about city connections, distinct from general naval or coastal development
- The strategy nullification system prevents inefficient maritime investment in landlocked empires
- Water connections provide both economic benefits (gold from trade) and city growth bonuses
- Actual AI behavior emerges from combinations of multiple flavors and current game state

## Data Sources

This documentation is based on analysis of:

### C++ Source Code

- **CvEconomicAI.cpp** (lines 4278-4292): "One or Fewer Coastal Cities" strategy implementation
- **CvEconomicAI.cpp** (line 615): Strategy activation in economic AI turn processing
- **CvPolicyAI.cpp** (lines 4984-4987): Policy weighting with diplomatic value contribution
- **CvPolicyAI.cpp** (lines 4792-5010): WeighPolicy function context and grand strategy integration
- **CvAdvisorRecommender.cpp** (lines 334-337): Economic Advisor priority assignment
- **CvEconomicAI.h** (line 330): Strategy helper function declaration
- **CvLuaPlayer.cpp** (lines 19504-19506): Strategy blacklisting for external AI systems

### Database and Configuration

- Buildings, technologies, and policies with WATER_CONNECTION flavor are defined in game XML/SQL databases
- Leader personality WATER_CONNECTION values defined in Leader_Flavors database table
- Strategy modifiers and thresholds defined in AI strategy XML/SQL configuration

### Strategic Context

- Community Patch AI architecture and flavor weighting system
- Economic strategy evaluation framework
- Policy and ideology selection algorithms
- Advisor recommendation system
