# FLAVOR_NAVAL

## Overview

`FLAVOR_NAVAL` is an AI personality flavor that controls a civilization's emphasis on naval power, sea-based military strength, and maritime warfare. This flavor affects naval unit production priorities, fleet composition decisions, coastal settlement preferences, and the overall balance between land and naval military forces.

Unlike specialized naval flavors (`FLAVOR_NAVAL_RECON`, `FLAVOR_NAVAL_MELEE`, `FLAVOR_NAVAL_RANGED`, `FLAVOR_SUBMARINE`), `FLAVOR_NAVAL` represents the general strategic importance the AI places on controlling the seas and projecting naval power.

### Value Range

- **Scale:** 0-20 (integer values, though personality values typically range 0-10)
- **Typical Values:**
  - Maritime civilizations: 7-10 (strong naval focus)
  - Balanced civilizations: 4-6 (moderate naval presence)
  - Landlocked/continental civilizations: 0-3 (minimal naval investment)

### Maritime Civilization Bonuses

Civilizations with the `isCoastalCiv()` trait (England, Polynesia, Carthage, etc.) receive additional bonuses that interact with FLAVOR_NAVAL, making them naturally prioritize coastal expansion and naval power regardless of their base flavor value.

## Code References

### 1. Naval-to-Land Force Ratio Calculation (CvMilitaryAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (lines 1811-1846)

**Function:** `CvMilitaryAI::UpdateMilitaryStrategies()`

This code determines what percentage of the AI's offensive military forces should be naval units versus land units.

#### Force Allocation Formula

```cpp
int iFlavorNaval = m_pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_NAVAL"));
int iNavalPercent = (iNumCoastalCities * iFlavorNaval * 7) / max(1, m_pPlayer->getNumCities());
```

**Calculation Breakdown:**

- Naval percentage is based on the proportion of coastal cities multiplied by FLAVOR_NAVAL
- Formula: `(Coastal Cities / Total Cities) × FLAVOR_NAVAL × 7`
- This percentage is then applied to offensive unit production weights

**Example Scenarios:**

- **High Naval Flavor (10), 100% Coastal Cities:**
  - `iNavalPercent = (10 × 10 × 7) / 10 = 70%`
  - 70% of offensive forces will be naval units

- **Moderate Naval Flavor (5), 50% Coastal Cities:**
  - `iNavalPercent = (5 × 5 × 7) / 10 = 17.5%`
  - ~18% of offensive forces will be naval units

- **Low Naval Flavor (2), 30% Coastal Cities:**
  - `iNavalPercent = (3 × 2 × 7) / 10 = 4.2%`
  - ~4% of offensive forces will be naval units

#### Force Distribution Application

```cpp
m_iRecLandUnits = (iMaxPossibleUnits * (100 * iLandDefenseWeight + iTotalOffenseWeight * (100 - iNavalPercent)))
                  / (100 * iTotalWeight);
m_iRecNavalUnits = (iMaxPossibleUnits * (100 * iNavalDefenseWeight + iTotalOffenseWeight * iNavalPercent))
                   / (100 * iTotalWeight);
```

**Interpretation:** FLAVOR_NAVAL directly scales the proportion of military production dedicated to building and maintaining a navy. Higher values create larger fleets, especially when the civilization has many coastal cities to defend and supply.

### 2. Naval Explorer Production (CvEconomicAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvEconomicAI.cpp` (lines 2455-2475)

**Function:** `CvEconomicAI::UpdateReconState()`

This code determines how many naval exploration units (UNITAI_EXPLORE_SEA) the AI should build to explore ocean tiles.

#### Explorer Density Calculation

```cpp
iPlotsPerExplorer = GD_INT_GET(MAX_PLOTS_PER_EXPLORER) -
                    m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
                        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_NAVAL_RECON"));
```

**Note:** This code uses `FLAVOR_NAVAL_RECON` rather than `FLAVOR_NAVAL`, showing that naval exploration is controlled by a specialized flavor. However, FLAVOR_NAVAL indirectly affects this by influencing coastal city placement and overall maritime strategy adoption.

**Interpretation:** While naval reconnaissance specifically uses FLAVOR_NAVAL_RECON, the broader FLAVOR_NAVAL determines whether the AI will have coastal cities that necessitate naval exploration in the first place.

### 3. Coastal City Settlement Priority (CvSiteEvaluationClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvSiteEvaluationClasses.cpp` (lines 693-707)

**Function:** `CvSiteEvaluatorForSettler::PlotFoundValue()`

This code evaluates potential city locations and applies bonuses for coastal sites when the AI has high naval flavor.

#### Coastal Bonus Application

```cpp
if (pPlot->isCoastalLand(GD_INT_GET(MIN_WATER_SIZE_FOR_OCEAN)))
{
    // Base coastal bonus
    iValueModifier += (iTotalPlotValue * GD_INT_GET(SETTLER_BUILD_ON_COAST_PERCENT)) / 100;

    // Additional bonus for high naval flavor or maritime civs
    int iNavalFlavor = pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
        (FlavorTypes)m_iNavalIndex); // m_iNavalIndex = FLAVOR_NAVAL

    if (iNavalFlavor > 7 || pPlayer->getCivilizationInfo().isCoastalCiv())
    {
        // Double coastal bonus for maritime-focused civilizations
        iValueModifier += (iTotalPlotValue * GD_INT_GET(SETTLER_BUILD_ON_COAST_PERCENT)) / 100;
    }
}
```

**Thresholds:**

- **FLAVOR_NAVAL ≤ 7:** Standard coastal bonus (typically +40% plot value)
- **FLAVOR_NAVAL > 7:** Double coastal bonus (+80% plot value)
- **Coastal Civilization Trait:** Automatic double bonus regardless of flavor

**Interpretation:** High FLAVOR_NAVAL (8+) makes the AI strongly prefer settling coastal cities, which in turn justifies and necessitates building naval forces. This creates a self-reinforcing maritime strategy where coastal cities drive naval production, and naval capability encourages more coastal expansion.

### 4. Unit Promotion Selection (CvUnit.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvUnit.cpp` (lines 31660-31670)

**Function:** `CvUnit::AI_promotionValue()`

When naval units gain experience and can select promotions, FLAVOR_NAVAL influences which promotions are valued most highly.

#### Flavor Retrieval

```cpp
CvFlavorManager* pFlavorMgr = GET_PLAYER(m_eOwner).GetFlavorManager();
int iFlavorNaval = range(pFlavorMgr->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_NAVAL")), 1, 20);
int iFlavorNavalRecon = range(pFlavorMgr->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_NAVAL_RECON")), 1, 20);
```

**Range Clamping:** Flavor values are clamped between 1-20 for promotion evaluation to ensure all promotion types receive at least minimal consideration.

**Interpretation:** FLAVOR_NAVAL affects how naval units prioritize combat-focused promotions versus utility promotions. Higher values lead to more aggressive naval unit configurations optimized for ship-to-ship combat and coastal raiding.

### 5. Policy Preference Weighting (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4916-4927)

**Function:** `CvPolicyAI::WeighPolicy()`

When evaluating social policies, the AI considers policy flavor values and maps them to strategic interests.

#### Naval Flavors and Conquest Strategy

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NAVAL" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NAVAL_RECON" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_RECON" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NAVAL_MELEE" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NAVAL_RANGED" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SUBMARINE")
{
    iConquestValue += iFlavorValue;
}
```

**Interpretation:** Policies that provide bonuses tagged with FLAVOR_NAVAL contribute to the policy's perceived value for **Conquest victory strategy**. Leaders with high FLAVOR_NAVAL will value policies supporting naval warfare and maritime expansion more highly, as naval dominance is viewed as a path to military victory.

This links naval power directly to the AI's grand strategy preference for conquest over diplomatic, cultural, or scientific victories.

### 6. Technology Valuation (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (lines 1251-1267)

**Function:** Technology flavor evaluation for conquest-focused civilizations

When the AI is pursuing a conquest grand strategy, technologies that unlock units or improvements with FLAVOR_NAVAL receive increased priority.

#### Conquest-Naval Technology Boost

```cpp
if(bConquestFocus && (
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NAVAL" ||
    // ... other military flavors ...
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NAVAL_MELEE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NAVAL_RANGED" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SUBMARINE"))
{
    // Technology receives bonus priority
}
```

**Interpretation:** When pursuing military conquest, the AI prioritizes researching technologies that improve naval capabilities. Combined with high FLAVOR_NAVAL, this ensures maritime powers rapidly unlock advanced naval units like Frigates, Ironclads, Battleships, and Submarines.

### 7. Advisor Recommendation Weights (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (lines 290-483)

**Function:** Advisor system weighting for different flavor types

The AI's internal advisor system uses flavor weights to guide recommendations across different categories (Economic, Military, Foreign, Science).

#### Military Advisor Naval Weight

```cpp
// ADVISOR_MILITARY context
else if(strFlavorName == "FLAVOR_NAVAL")
{
    return 15;  // High priority weight
}
else if(strFlavorName == "FLAVOR_NAVAL_RECON")
{
    return 3;   // Lower priority weight
}
```

**Relative Weights:**

- FLAVOR_NAVAL: 15 (high priority for military advisor)
- FLAVOR_AIR: 17 (highest military priority)
- FLAVOR_RANGED: 13
- FLAVOR_NAVAL_RECON: 3 (low priority)

#### Economic Advisor Naval Growth Weight

```cpp
// ADVISOR_ECONOMIC context
else if(strFlavorName == "FLAVOR_NAVAL_GROWTH")
{
    return 7;   // Moderate economic importance
}
else if(strFlavorName == "FLAVOR_NAVAL_TILE_IMPROVEMENT")
{
    return 7;   // Moderate economic importance
}
```

**Interpretation:** FLAVOR_NAVAL is treated as a high-priority military concern (weight 15) by the advisor system. This means when the AI's FLAVOR_NAVAL is high, the military advisor will strongly recommend naval-related actions (building ships, researching naval techs, adopting naval policies).

Separate flavors like FLAVOR_NAVAL_GROWTH and FLAVOR_NAVAL_TILE_IMPROVEMENT handle the economic aspects of maritime strategy (fishing boats, sea trade routes, harbors).

## Summary of Effects

### Military Force Composition

- **Direct multiplier** for the percentage of offensive forces allocated to naval units
- Scales with the proportion of coastal cities in the empire
- Creates balanced land-naval forces for maritime civilizations
- Formula: `(Coastal Cities / Total Cities) × FLAVOR_NAVAL × 7 = Naval %`
- Affects both recommended unit counts and actual production priorities

### City Placement Strategy

- **Settlement bias** toward coastal locations when FLAVOR_NAVAL > 7
- Doubles the value bonus for coastal city sites (up to +80% plot value)
- Works synergistically with maritime civilization traits
- Influences early-game expansion patterns toward coastlines
- Creates foundation for naval infrastructure (harbors, seaports)

### Naval Infrastructure Investment

- Higher priority for buildings that support naval production (harbors, seaports)
- Increased value for sea-based trade routes and maritime resources
- More emphasis on fishing boats and offshore platform improvements
- Greater investment in coastal defensive structures

### Technology Research Priorities

- Technologies unlocking naval units receive higher priority
- Maritime technologies (Sailing, Compass, Astronomy, Navigation) fast-tracked
- Advanced naval warfare techs (Steam Power, Combustion, Electronics) valued more
- Balanced against other military tech needs based on strategic situation

### Policy Adoption Preferences

- Policies with naval bonuses contribute to **Conquest victory** preference
- Maritime policy branches (Exploration, Commerce) receive higher weight
- Naval-focused social policies valued more during military expansion phases
- Reinforces aggressive naval strategy alignment

### Unit Promotion Selection

- Naval units prioritize combat-effective promotions
- Higher FLAVOR_NAVAL leads to more offensive promotion choices
- Promotion values adjusted by clamped flavor range (1-20)
- Affects whether ships specialize in offense, defense, or utility roles

## Interaction with Related Flavors

### Complementary Flavors

#### FLAVOR_NAVAL_RECON

- Controls naval exploration and scouting priorities
- Determines number of exploration ships to build
- Works alongside FLAVOR_NAVAL to establish maritime presence
- Typical relationship: Lower than FLAVOR_NAVAL (3-5 vs 5-8)

#### FLAVOR_NAVAL_GROWTH

- Influences economic development of coastal cities
- Affects fishing boat construction and sea resource development
- Creates economic foundation that supports naval military expansion
- Enables larger fleets through improved coastal city production

#### FLAVOR_NAVAL_TILE_IMPROVEMENT

- Controls offshore platform and fishing boat prioritization
- Improves naval infrastructure and resource access
- Provides food and production to sustain large navies
- Economic counterpart to FLAVOR_NAVAL's military focus

#### Specialized Unit Flavors

- **FLAVOR_NAVAL_MELEE:** Prioritizes melee naval units (Triremes, Galleys, Destroyers)
- **FLAVOR_NAVAL_RANGED:** Emphasizes ranged naval units (Caravels, Frigates, Battleships)
- **FLAVOR_SUBMARINE:** Controls submarine production and underwater warfare
- **FLAVOR_AIR_CARRIER:** Affects aircraft carrier production and naval aviation

These specialized flavors determine the **composition** of the navy, while FLAVOR_NAVAL determines the **size and priority** of naval forces overall.

### Strategic Synergies

**High FLAVOR_NAVAL + High FLAVOR_OFFENSE:**

- Aggressive naval expansion and coastal raiding
- Prioritizes invasions via sea
- Builds balanced fleets with offensive capabilities
- Targets island and coastal civilizations early

**High FLAVOR_NAVAL + High FLAVOR_EXPANSION:**

- Maritime expansion strategy
- Settles islands and coastal territories aggressively
- Builds exploratory fleets early
- Competes for control of strategic sea resources

**High FLAVOR_NAVAL + High FLAVOR_DEFENSE:**

- Defensive naval posture with coastal focus
- Prioritizes protecting sea trade routes
- Builds balanced defensive-offensive fleets
- Focuses on denying enemy naval access to home waters

**Low FLAVOR_NAVAL (Continental Strategy):**

- Minimal naval investment regardless of coastal access
- Diverts resources to land forces even with coastal cities
- Only builds essential defensive naval units
- Vulnerable to maritime civilizations with naval superiority

## Design Philosophy

FLAVOR_NAVAL represents the **strategic importance** a civilization places on sea power, distinct from tactical preferences about which types of naval units to build. It answers the question: "How much of my military strength should be at sea?"

This allows for differentiated maritime AI personalities:

- **High NAVAL, High Specialized Flavors:** Balanced, powerful navy with diverse unit types (England, Spain)
- **High NAVAL, Low Specialized Flavors:** Large but generic navy lacking specialization
- **Low NAVAL, High Specialized Flavors:** Small but elite naval force focused on specific roles
- **Low NAVAL, Low Specialized Flavors:** Minimal naval presence, vulnerable at sea

The flavor also creates **emergent behavior** where:

1. Coastal city placement → justifies naval investment
2. Naval investment → enables more coastal expansion
3. Maritime infrastructure → supports larger fleets
4. Larger fleets → enables naval conquest strategies
5. Naval conquest → acquires more coastal territories
6. Cycle continues, reinforcing maritime dominance

## Typical Leader Values

While exact values vary by leader and civilization, typical FLAVOR_NAVAL distributions:

### High Naval Focus (8-10)

- Leaders of maritime civilizations (England, Polynesia, Carthage)
- Leaders with naval unique units or bonuses
- Leaders pursuing coastal/island expansion strategies

### Moderate Naval Presence (4-7)

- Balanced leaders with mixed strategies
- Leaders on continents with significant coastline
- Leaders adapting to map conditions with mixed land-sea terrain

### Low Naval Priority (0-3)

- Continental leaders focused on land warfare (Mongolia, Germany)
- Leaders on landlocked continents or small water bodies
- Leaders with strong land-based unique units

### Dynamic Adjustment

The flavor can be temporarily modified by:

- Map type (Archipelago vs Pangaea)
- Strategic circumstances (naval enemy, island resources)
- Grand strategy selection (Conquest, Culture, Science)
- Diplomatic situation (alliance with naval power vs land power)

## Related Flavors

- **FLAVOR_NAVAL_RECON:** Naval exploration and scouting emphasis
- **FLAVOR_NAVAL_GROWTH:** Coastal city economic development
- **FLAVOR_NAVAL_TILE_IMPROVEMENT:** Sea resource development priority
- **FLAVOR_NAVAL_MELEE:** Melee naval unit preference
- **FLAVOR_NAVAL_RANGED:** Ranged naval unit preference
- **FLAVOR_SUBMARINE:** Submarine warfare focus
- **FLAVOR_AIR_CARRIER:** Aircraft carrier and naval aviation emphasis
- **FLAVOR_OFFENSE:** General aggressive military behavior
- **FLAVOR_DEFENSE:** Defensive military posture
- **FLAVOR_EXPANSION:** City founding and territorial growth
- **FLAVOR_MILITARY_TRAINING:** Overall military unit production priority

FLAVOR_NAVAL acts as the **master control** for naval strategic commitment, with specialized naval flavors providing tactical refinement of fleet composition and doctrine.
