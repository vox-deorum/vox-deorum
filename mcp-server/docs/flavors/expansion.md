# FLAVOR_EXPANSION

## Overview

FLAVOR_EXPANSION is an AI personality flavor in Civilization V that controls how aggressively a civilization pursues territorial expansion through settling new cities. This flavor influences settler production priorities, acceptable city site quality thresholds, cross-continent colonization decisions, and diplomatic attitudes toward land disputes.

**Typical Range:** 0-10 (with 20 being the absolute maximum cap) **Default Personality Value:** 7-8 for most leaders **Notable Leaders:**

- Pocatello (Shoshone): 10 - Peak expansionism
- Elizabeth (England): 9 - Naval expansion focus
- Washington (America): 9 - Manifest destiny

## How FLAVOR_EXPANSION Works

### Dynamic Adjustment by Map Size

The expansion flavor is automatically adjusted at game initialization based on the tiles-per-player ratio. On maps with more space per player, the flavor increases to encourage wider empires, while on crowded maps it decreases in favor of growth within existing cities.

**Code Reference:** `CvFlavorManager.cpp:373-385`

```
Adjustment = (log10(TilesPerPlayer) - 2.1) * 8
Standard reference: 2.1 log10 tiles per player
Coefficient: 8 points per log10 unit
Capped at: 20 maximum, 0 minimum
```

This dynamic scaling ensures AI behavior adapts appropriately to map conditions, promoting expansion when space is available and consolidation when territory is limited.

## Core Systems Affected

### 1. Settler Production Priority

**File:** `CvUnitProductionAI.cpp:1068-1089`

FLAVOR_EXPANSION is the primary driver for settler unit production decisions. The system uses `GetPersonalityAndGrandStrategy()` which combines the leader's base personality flavor with active grand strategy modifiers.

**Priority Calculation:**

- Base priority starts with expansion flavor (0-10+)
- Boosted by settle plot quality (adds plot score if positive)
- +100 bonus during EARLY_EXPANSION strategy phase
- +50 bonus for NEW_CONTINENT_FEEDER cities
- +10 bonus for leaders with Expansion WLTKD trait
- Reduced if empire is unhappy

**Strategy Modifiers:**

- AICITYSTRATEGY_SMALL_CITY: +30
- AICITYSTRATEGY_MEDIUM_CITY: +20
- AICITYSTRATEGY_LARGE_CITY: +10
- AICITYSTRATEGY_ENOUGH_TILE_IMPROVERS: +40
- AICITYSTRATEGY_NEW_CONTINENT_FEEDER: +100
- AICITYSTRATEGY_POCKET_CITY: -100
- AICITYSTRATEGY_ENOUGH_SETTLERS: -100

### 2. Minimum Acceptable City Site Quality

**File:** `CvPlayer.cpp:45690-45698`

FLAVOR_EXPANSION determines how picky the AI is about founding locations. Higher expansion flavor means the AI will settle in worse locations to claim territory quickly.

**Formula:**

```
MinAcceptableQuality = -3 * Expansion Flavor (clamped 0-12)
Result range: -36 to 0
Plot quality scores range from -50 to +50
```

**Examples:**

- Expansion 2: Requires quality > -6 (very picky, only excellent sites)
- Expansion 5: Requires quality > -15 (moderate sites acceptable)
- Expansion 10: Requires quality > -30 (accepts poor sites)
- Expansion 12: Requires quality > -36 (settles almost anywhere)

This directly impacts the `HaveGoodSettlePlot()` check used throughout expansion logic.

### 3. Cross-Continent Expansion Strategy

**File:** `CvEconomicAI.cpp:4425-4427`

Controls when the AI commits to expensive cross-continent colonization efforts.

**Threshold Check:**

```
if (NumCitiesFounded >= ExpansionFlavor * 2)
    return false; // Don't pursue overseas expansion
```

**Examples:**

- Expansion 5: Pursues overseas expansion up to 10 cities
- Expansion 7: Pursues overseas expansion up to 14 cities
- Expansion 10: Pursues overseas expansion up to 20 cities

Once this threshold is reached, the EXPAND_TO_OTHER_CONTINENTS strategy becomes inactive, saving resources for domestic development.

**Active Strategy Bonus:** +50 to expansion flavor when EXPAND_TO_OTHER_CONTINENTS is active (see CoreStrategyChanges.sql:88)

### 4. City Site Evaluation

**File:** `CvSiteEvaluationClasses.cpp:47, 197-203`

FLAVOR_EXPANSION directly increases the food yield multiplier used when evaluating potential city locations.

**Mechanism:**

```
FoodMultiplier += ExpansionFlavor + SpecializationFlavor
```

Combined with FLAVOR_GROWTH, this flavor makes the AI prioritize food-rich locations that can grow new cities quickly. The expansion flavor emphasizes getting cities founded rapidly, even if they start smaller.

### 5. ENOUGH_EXPANSION Strategy Trigger

**File:** `CvEconomicAI.cpp:3768-3814`

This critical strategy determines when the AI stops producing settlers entirely. Once active, expansion flavor is penalized by -100 at the city level.

**Strategy Activates When:**

- Player is barbarian, minor civ, or Venice (NoAnnexing trait)
- One City Challenge game option is enabled
- Empire is very unhappy
- Player is losing wars (MILITARYAISTRATEGY_LOSING_WARS)
- No good settle plots remain (checks against MinAcceptableSettleQuality)

**Strategy Suppressed By:**

- Having only 1 city
- EXPAND_TO_OTHER_CONTINENTS strategy is active
- EARLY_EXPANSION strategy is active

The `HaveGoodSettlePlot()` check is performed last as it can be computationally expensive, scanning all map plots against the flavor-based quality threshold.

### 6. Victory Pursuit Assessment

**File:** `CvDiplomacyAI.cpp:2383`

Expansion flavor contributes to domination victory assessment, representing territorial control as a path to military victory.

**Calculation:**

```
DominationScore += ExpansionFlavor / 2
Also includes: Boldness + Meanness + FLAVOR_OFFENSE/2
```

Leaders with high expansion flavors are more likely to pursue conquest-based victory conditions.

### 7. Diplomatic Land Disputes

**File:** `CvDiplomacyAI.cpp:12852, 42743-42750`

FLAVOR_EXPANSION directly affects diplomatic reactions to other civilizations settling near the AI's territory.

**Boldness Threshold (Line 12852):**

```
Bold behavior if: GetPersonalityAndGrandStrategy(FLAVOR_EXPANSION) > 7
Bold leaders: More aggressive about land disputes
```

Bold leaders are more likely to issue warnings and generate diplomatic penalties when others settle nearby.

**"Don't Settle Near Us" Request Evaluation (Lines 42743-42750):**

When evaluating another player's request not to settle near them, expansion flavor determines how likely the AI is to agree.

**Formula:**

```
Threshold = (8 - ExpansionFlavor) * 5
```

**Examples:**

- Expansion 2: (8-2)*5 = +30% likelihood to agree (not very expansionist)
- Expansion 5: (8-5)*5 = +15% likelihood to agree (moderate)
- Expansion 7: (8-7)*5 = +5% likelihood to agree (typical)
- Expansion 10: (8-10)*5 = -10% likelihood to agree (refuses territorial limits)

Higher expansion flavors make the AI less willing to restrict their settling options.

**Additional Modifiers:**

- Friendly approach: +30% more likely to agree
- Military strength differential affects willingness
- If ECONOMICAISTRATEGY_ENOUGH_EXPANSION is active: Always agrees

### 8. Policy Selection Weights

**File:** `CvPolicyAI.cpp:4928-4931`

FLAVOR_EXPANSION contributes to general policy weight calculations, favoring policies that support territorial growth.

**Affected Policies (from PolicyFlavorSweeps.sql):**

- POLICY_LIBERTY_FINISHER: +50
- POLICY_PARTY_LEADERSHIP: +60
- POLICY_INDUSTRIAL_ESPIONAGE: +60
- POLICY_FORTIFIED_BORDERS: +60
- POLICY_UNIVERSAL_HEALTHCARE_A: +60
- POLICY_EXPLORATION: +29
- POLICY_HONOR: +7

Policies with strong expansion flavors receive higher weights for leaders with high expansion personalities.

### 9. Technology Research Priorities

**File:** `CvTechClasses.cpp:1294-1297`

Technologies with expansion flavor receive boosted research priority for leaders with the Expansionist trait.

**Expansionist Trait Bonus:**

```
if (IsExpansionist() && TechHasFlavor(FLAVOR_EXPANSION))
    TechPriority += 1
```

**Technologies with Expansion Flavor (from TechFlavorSweeps.sql):**

- TECH_POTTERY: +25 (granary enables growth)
- TECH_SAILING: +5 (coastal expansion)
- TECH_BANKING: +15 (economic support for expansion)
- TECH_ASTRONOMY: +5 (ocean exploration)
- TECH_RAILROAD: +15 (infrastructure for large empires)

Expansionist leaders prioritize technologies that enable and support territorial growth.

### 10. Advisor Recommendations

**File:** `CvAdvisorRecommender.cpp:298-301`

The advisor system uses a baseline expansion flavor of 11 for recommendation calculations, treating expansion as a high-priority general gameplay element.

**Hard-coded Priority Values:**

- FLAVOR_GROWTH: 15 (highest)
- FLAVOR_TILE_IMPROVEMENT: 13
- FLAVOR_EXPANSION: 11
- FLAVOR_PRODUCTION: 10

This ensures expansion-related recommendations (settlers, land acquisition) appear prominently in the advisor interface.

## Unit, Building, and Improvement Flavors

### Units with FLAVOR_EXPANSION (from UnitFlavorSweeps.sql)

Settlers and colonization units are strongly associated with expansion flavor:

- UNIT_SETTLER: 25
- UNIT_PIONEER: 25 (Shoshone unique)
- UNIT_COLONIST: 25 (generic)
- UNIT_ASAMU: 50 (Inca unique - exceptional expansion unit)
- UNIT_VENETIAN_MERCHANT: 25 (Venice's unique expansion method)
- UNIT_SPANISH_CONQUISTADOR: 15 (exploration/expansion unit)

### Buildings with FLAVOR_EXPANSION (from BuildingFlavorSweeps.sql)

Buildings that support population growth and city founding:

- BUILDING_GRANARY: 5
- BUILDING_QULLQA: 20 (Inca unique granary)
- BUILDING_GER: 10 (Mongol unique stable)
- BUILDING_BUFFALO_POUND: 10 (Shoshone unique)
- BUILDING_HOMESTEAD: 15
- BUILDING_PYRAMID: 45 (wonder supporting expansion)
- BUILDING_ANGKOR_WAT: 20 (wonder supporting expansion)

## Military Strategy Impact

FLAVOR_EXPANSION is heavily penalized during military emergencies, forcing the AI to prioritize defense over territorial growth:

### Strategy Penalties (from CoreStrategyChanges.sql)

**Eradication of Barbarians:**

- MILITARYAISTRATEGY_ERADICATE_BARBARIANS: -5
- MILITARYAISTRATEGY_ERADICATE_BARBARIANS_CRITICAL: -5

**War States:**

- MILITARYAISTRATEGY_AT_WAR: -10
- MILITARYAISTRATEGY_WAR_MOBILIZATION: -15
- MILITARYAISTRATEGY_LOSING_WARS: -100 (complete halt)

During LOSING_WARS, the -100 penalty effectively eliminates settler production, forcing all resources toward military defense.

## Economic Strategy Modifiers

**ECONOMICAISTRATEGY_GS_CULTURE:** +8 (culture victories need more cities for tourism)

These modifiers integrate expansion decisions with broader strategic goals, ensuring territorial growth aligns with victory pursuit.

## Summary

FLAVOR_EXPANSION is a foundational AI personality trait that permeates nearly every aspect of territorial expansion in Civilization V. It controls:

1. **Settler Production:** How often and with what priority cities build settlers
2. **Site Quality Standards:** How picky the AI is about founding locations
3. **Expansion Limits:** When the AI stops expanding (city count thresholds, plot quality)
4. **Cross-Continent Colonization:** Whether to pursue expensive overseas expansion
5. **Diplomatic Behavior:** Reactions to land disputes and settling agreements
6. **Strategic Alignment:** Integration with victory pursuits and military states
7. **Technology/Policy Selection:** Research and social policy priorities
8. **Map Size Scaling:** Dynamic adjustment based on available territory

The flavor ranges from ultra-conservative (0-2) where the AI only settles exceptional locations, to ultra-aggressive (8-10) where the AI grabs territory rapidly even in marginal locations. Most leaders fall in the 7-8 range, balanced between territorial ambition and quality standards.

The system's elegance lies in its context-awareness: expansion flavor is automatically adjusted for map size, suppressed during military crises, boosted during favorable conditions, and integrated with quality thresholds to prevent mindless expansion. This creates dynamic, realistic AI expansion behavior that adapts to game circumstances while maintaining distinct leader personalities.
