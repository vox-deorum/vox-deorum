# FLAVOR_ESPIONAGE

## Overview

FLAVOR_ESPIONAGE is an AI flavor in Civilization V that influences how aggressively an AI leader pursues espionage-related activities and investments. This flavor affects multiple aspects of AI decision-making, including building construction priorities, policy selection, technology research priorities, and strategic planning around intelligence gathering and counterintelligence.

Leaders with high espionage flavor values prioritize:

- Constructing counterintelligence buildings (Police Stations, Constabularies)
- Researching espionage-enabling technologies
- Adopting espionage-focused social policies
- Protecting key science cities from enemy spies
- Intelligence gathering operations

## Flavor Value Range

**Standard Range:** 0-10 (most leaders fall between 3-8) **Notable Examples:**

- Elizabeth (England): 10 - Highest espionage focus, tied to her unique abilities and buildings
- Dido (Carthage): 8
- Catherine (Russia): 7
- Isabella (Spain): 3 - One of the lowest, reflecting passive playstyle
- Barbarian: 0 - No espionage capability

## Code References

### 1. City Strategy: Key Science City Identification

**File:** `CvGameCoreDLL_Expansion2/CvCityStrategyAI.cpp` (lines 3030-3081) **Function:** `IsTestCityStrategy_KeyScienceCity()`

**Purpose:** Determines whether a city should be flagged as a "key science city" that warrants additional counterintelligence protection.

**Logic:**

```
fCutOff = 0.05 * leader's FLAVOR_ESPIONAGE value
fRatio = (number of cities with better science output) / (total other cities)
City is key science city if: fRatio < fCutOff
```

**Effect:**

- Leaders with high espionage flavor (e.g., 10) have a cutoff of 0.5, meaning cities in the top 50% for science output are considered key targets
- Leaders with low espionage flavor (e.g., 3) have a cutoff of 0.15, only cities in the top 15% are flagged
- This strategy likely influences building construction priorities for counterintelligence buildings in these cities

### 2. Player Strategy: Tech Leader Status

**File:** `CvGameCoreDLL_Expansion2/CvEconomicAI.cpp` (lines 3634-3695) **Function:** `IsTestStrategy_TechLeader()`

**Purpose:** Determines if the player should adopt a "Tech Leader" strategy, emphasizing counterintelligence to protect technological advantages.

**Logic:**

```
fCutOff = 0.05 * leader's FLAVOR_ESPIONAGE value
fRatio = (number of players ahead in tech count) / (total other players)
Tech Leader strategy active if: fRatio < fCutOff
```

**Effect:**

- Leaders with high espionage flavor are more likely to activate Tech Leader strategy even when not significantly ahead
- When active, this strategy likely prioritizes:
  - Counterintelligence buildings (Police Stations, Military Bases)
  - Technologies that enhance security
  - Policies that protect against tech stealing

### 3. Policy Evaluation: Diplomatic Victory Path

**File:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4992-4995) **Function:** Policy weighting calculation

**Purpose:** When evaluating social policies, espionage flavor contributions are counted toward the diplomatic victory path value.

**Effect:**

- Policies with espionage flavor values contribute to `iDiploValue`
- This makes espionage-focused leaders more likely to adopt policies like:
  - Covert Action (60 espionage flavor)
  - Double Agents (60 espionage flavor)
  - Scholasticism (15 espionage flavor)
  - Patronage tree (12 espionage flavor)
- Espionage is treated as complementary to diplomatic strategies (along with FLAVOR_GOLD and FLAVOR_DIPLOMACY)

### 4. Technology Research: Diplomatic Victory Focus

**File:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (lines 1245-1249) **Function:** Grand Strategy tech priority calculation

**Purpose:** When pursuing a diplomatic victory, technologies with espionage flavor receive bonus priority.

**Effect:**

- When `bDiploFocus` is true (pursuing diplomatic victory), techs with FLAVOR_ESPIONAGE get priority boosts
- Key espionage technologies prioritized:
  - Computers (20 espionage flavor) - Modern era, enables NSA building
  - Banking (10 espionage flavor) - Renaissance era
  - Electronics (10 espionage flavor) - Modern era
  - Radar (10 espionage flavor) - Atomic era

## Game Elements Affected by FLAVOR_ESPIONAGE

### Buildings

#### Counterintelligence Buildings

- **Constabulary** (25) - Renaissance era police building
- **Doelen** [Dutch UB] (40) - Enhanced constabulary replacement
- **Military Base** (25) - Modern era defensive building
- **Police Station** (50) - Modern era counterintelligence building
- **White Tower** [World Wonder] (50) - Espionage wonder
- **Intelligence Agency** [National Wonder] (50) - Required for espionage operations

#### Unique Buildings

- **Great Firewall** [World Wonder] (100) - Maximum espionage value, prevents internet-based stealing
- **Bletchley Park** [World Wonder] (30) - Historical codebreaking facility
- **Motherland Calls** [World Wonder] (30) - Russian defensive monument

### Technologies

Technologies with FLAVOR_ESPIONAGE influence AI research priorities:

| Technology | Espionage Flavor | Era | Significance |
| --- | --- | --- | --- |
| Banking | 10 | Renaissance | Early espionage infrastructure |
| Electronics | 10 | Modern | Electronic surveillance |
| Computers | 20 | Modern | Advanced intelligence gathering |
| Radar | 10 | Atomic | Detection and tracking |

### Social Policies

Policies with FLAVOR_ESPIONAGE influence AI adoption decisions:

| Policy | Espionage Flavor | Tree | Effect |
| --- | --- | --- | --- |
| Patronage | 12 | Patronage | City-state diplomatic boost |
| Scholasticism | 15 | Patronage | Science from city-state allies |
| Covert Action | 60 | Autocracy | Enhanced spy effectiveness |
| Double Agents | 60 | Autocracy | Counterintelligence bonus |

## Strategic Implications

### For High Espionage Leaders (8-10)

**Priorities:**

1. **Early counterintelligence infrastructure** - Build Constabularies and Police Stations proactively
2. **Protect science cities** - Identify and defend top 50% of science-producing cities
3. **Tech security** - Activate Tech Leader strategy even with modest leads
4. **Policy focus** - Strongly value espionage-focused policies (Covert Action, Double Agents)
5. **Diplomatic synergy** - Use espionage as part of diplomatic victory strategy

**Examples:** Elizabeth (10), Dido (8), Catherine (7)

### For Moderate Espionage Leaders (4-6)

**Priorities:**

1. **Balanced approach** - Build counterintelligence when clearly threatened
2. **Selective protection** - Only defend top science cities (top 20-30%)
3. **Opportunistic policies** - Adopt espionage policies when they align with other goals
4. **Tech as needed** - Research espionage technologies when convenient

**Examples:** Most default leaders (~5), Bismarck (6)

### For Low Espionage Leaders (0-3)

**Priorities:**

1. **Minimal investment** - Rarely build counterintelligence structures
2. **Narrow protection** - Only defend absolute top science cities (top 15%)
3. **Policy avoidance** - Rarely choose espionage-focused policies
4. **Tech deprioritization** - Skip espionage technologies unless other benefits exist

**Examples:** Isabella (3), Barbarian (0)

## Interaction with Other Systems

### Espionage AI System

- FLAVOR_ESPIONAGE does not directly control spy operations (moving, stealing, rigging)
- Instead, it influences the **infrastructure** that supports or counters espionage
- The actual spy behavior is controlled by the EspionageAI system

### Grand Strategy Integration

- Espionage flavor is considered part of the **Diplomatic victory path**
- Works alongside FLAVOR_DIPLOMACY and FLAVOR_GOLD
- Leaders pursuing diplomatic victory receive tech priority bonuses for espionage-related technologies

### Victory Condition Alignment

- **Diplomatic Victory:** Primary alignment - espionage supports influence and city-state manipulation
- **Science Victory:** Secondary alignment - counterintelligence protects technology leads
- **Domination Victory:** Tertiary alignment - intelligence gathering supports military planning
- **Culture Victory:** Minimal alignment - espionage has limited cultural benefits

## Database Configuration

### Leader Flavor Configuration

Located in: `(2) Vox Populi/Database Changes/AI/LeaderFlavorSweeps.sql`

Example entries:

```sql
-- High espionage leader
UPDATE Leader_Flavors SET Flavor = 10 WHERE FlavorType = 'FLAVOR_ESPIONAGE' AND LeaderType = 'LEADER_ELIZABETH';

-- Moderate espionage leader
UPDATE Leader_Flavors SET Flavor = 6 WHERE FlavorType = 'FLAVOR_ESPIONAGE' AND LeaderType = 'LEADER_BISMARCK';

-- Low espionage leader
UPDATE Leader_Flavors SET Flavor = 3 WHERE FlavorType = 'FLAVOR_ESPIONAGE' AND LeaderType = 'LEADER_ISABELLA';
```

### Building Flavor Configuration

Located in: `(2) Vox Populi/Database Changes/AI/BuildingFlavorSweeps.sql`

Buildings with high espionage values are prioritized by leaders with high FLAVOR_ESPIONAGE.

### Tech Flavor Configuration

Located in: `(2) Vox Populi/Database Changes/AI/TechFlavorSweeps.sql`

Technologies with espionage flavors receive research priority boosts, especially when pursuing diplomatic victory.

### Policy Flavor Configuration

Located in: `(2) Vox Populi/Database Changes/AI/PolicyFlavorSweeps.sql`

Policies with espionage flavors are weighted more heavily during policy selection.

## Summary

FLAVOR_ESPIONAGE primarily governs **defensive and infrastructural** aspects of espionage gameplay:

- **Counterintelligence focus:** Building structures to prevent enemy espionage
- **Strategic identification:** Recognizing which cities and resources need protection
- **Policy alignment:** Adopting social policies that enhance security or intelligence capabilities
- **Technology prioritization:** Researching espionage-related technologies
- **Diplomatic integration:** Using espionage as part of diplomatic victory strategies

The flavor operates through mathematical thresholds (typically 0.05 × flavor value) that determine when strategies activate and which assets require protection. Higher values make leaders more paranoid and proactive about intelligence matters, while lower values result in reactive or minimal espionage investment.
