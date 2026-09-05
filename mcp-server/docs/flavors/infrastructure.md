# FLAVOR_INFRASTRUCTURE

## Overview

FLAVOR_INFRASTRUCTURE controls the AI's prioritization of basic infrastructure development, including roads, connections, and essential infrastructure buildings. This flavor represents an AI's focus on establishing and maintaining the fundamental systems that support civilization growth and connectivity.

## Primary Effects

### City Connection Strategy

The infrastructure flavor directly influences the AI's desire to connect cities through roads and harbors. High infrastructure flavors make the AI more likely to:

- Build roads between cities earlier
- Prioritize city connections for trade routes
- Value technologies that improve transportation networks

### Infrastructure Buildings

AI leaders with high infrastructure flavor prioritize buildings and wonders that improve connectivity and basic city functions:

- **Coaling Station** (Flavor: 20) - Industrial-era building for production and infrastructure
- **Machu Picchu** (Flavor: 10) - Wonder that provides gold and connection benefits

### Technology Research

Infrastructure flavor affects technology priorities, particularly for transportation and connection technologies:

- **The Wheel** (Flavor: 10) - Enables roads and early infrastructure
- **Engineering** (Flavor: 10) - Enables aqueducts, bridges, and advanced infrastructure
- **Railroad** (Flavor: 10) - Enables railroads, colonists, hotels, and advanced transportation

### Unit Production

The Roman Legion is the only unit with infrastructure flavor (Flavor: 10), reflecting Rome's historical focus on building roads and infrastructure throughout their empire.

### Policy Adoption

Infrastructure flavor influences policy choices:

- **Meritocracy** (Flavor: 5) - Liberty tree policy supporting expansion and infrastructure
- **Third Alternative** (Flavor: 60) - Autocracy policy with very high infrastructure emphasis

## Strategy Modifiers

### Military Strategies

Infrastructure priorities are significantly reduced during wartime as the AI focuses on military concerns:

#### Player-Level Military Strategies

- **At War**: -20 infrastructure flavor
- **Winning Wars**: -10 infrastructure flavor
- **Losing Wars**: -15 infrastructure flavor

#### City-Level Military Strategies

- **At War**: -10 infrastructure flavor
- **Winning Wars**: -10 infrastructure flavor
- **Losing Wars**: -40 infrastructure flavor (severe reduction when desperate)

### City Strategies

- **Need Happiness Connection** (AICITYSTRATEGY_NEED_HAPPINESS_CONNECTION): +60 infrastructure flavor
  - Activated when city needs happiness from being connected to capital
  - Dramatically increases priority of roads, harbors, and connection-related improvements

## Leader Personality Types

Leaders are categorized into personality types with different infrastructure priorities:

### Conquerors (Infrastructure: 4)

Low infrastructure focus, preferring military expansion over development:

- Ashurbanipal, Askia, Attila, Augustus, Darius, Genghis Khan
- Gustavus Adolphus, Harald, Montezuma, Napoleon, Oda Nobunaga, Shaka

### Coalitionists (Infrastructure: 7)

Moderate-high infrastructure focus, balancing development with cooperation:

- Casimir, Elizabeth, Haile Selassie, Harun al-Rashid, Kamehameha
- Nebuchadnezzar II, Pacal, Ramesses II, Washington

### Diplomats (Infrastructure: 5)

Moderate infrastructure focus, prioritizing cultural and scientific development:

- Ahmad al-Mansur, Enrico Dandolo, Gandhi, Maria I, Maria Theresa
- Pedro II, Ramkhamhaeng, Sejong, Theodora, William

### Expansionists (Infrastructure: 9)

Highest infrastructure focus, essential for rapid territorial growth:

- Alexander, Boudicca, Catherine, Dido, Gajah Mada, Hiawatha
- Isabella, Pachacuti, Pocatello, Suleiman, Wu Zetian

## Code References

### C++ Implementation

#### CvAdvisorRecommender.cpp

Lines 310-313 (Economic Advisor):

```cpp
else if(strFlavorName == "FLAVOR_INFRASTRUCTURE")
{
    return 9;
}
```

The Economic Advisor assigns moderate weight (9) to infrastructure considerations when making recommendations.

Lines 381-384 (Military Advisor):

```cpp
else if(strFlavorName == "FLAVOR_INFRASTRUCTURE")
{
    return 1;
}
```

The Military Advisor assigns minimal weight (1) to infrastructure, focusing on military concerns instead.

#### CvPolicyAI.cpp

Lines 4952-4955:

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_INFRASTRUCTURE")
{
    iWeight += iFlavorValue;
}
```

Infrastructure flavor contributes to general policy weight calculations, affecting which social policies the AI chooses to adopt.

#### CvTechClasses.cpp

Lines 1294-1298:

```cpp
if (m_pPlayer->GetPlayerTraits()->IsExpansionist() &&
    (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_INFRASTRUCTURE" ||
     GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_EXPANSION"))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

Expansionist leaders receive bonus tech priority for infrastructure-related technologies, reinforcing their focus on territorial development and connectivity.

### Database Configuration

#### Building Flavors

```sql
('BUILDING_COALING_STATION', 'FLAVOR_INFRASTRUCTURE', 20)
('BUILDING_MACHU_PICHU', 'FLAVOR_INFRASTRUCTURE', 10)
```

#### Technology Flavors

```sql
('TECH_THE_WHEEL', 'FLAVOR_INFRASTRUCTURE', 10)
('TECH_ENGINEERING', 'FLAVOR_INFRASTRUCTURE', 10)
('TECH_RAILROAD', 'FLAVOR_INFRASTRUCTURE', 10)
```

#### Unit Flavors

```sql
('UNIT_ROMAN_LEGION', 'FLAVOR_INFRASTRUCTURE', 10)
```

#### Policy Flavors

```sql
('POLICY_MERITOCRACY', 'FLAVOR_INFRASTRUCTURE', 5)
('POLICY_THIRD_ALTERNATIVE', 'FLAVOR_INFRASTRUCTURE', 60)
```

#### Strategy Flavors

```sql
-- Player-level military strategies
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_INFRASTRUCTURE', -20)
('MILITARYAISTRATEGY_WINNING_WARS', 'FLAVOR_INFRASTRUCTURE', -10)
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_INFRASTRUCTURE', -15)

-- City-level military strategies
('MILITARYAISTRATEGY_AT_WAR', 'FLAVOR_INFRASTRUCTURE', -10)
('MILITARYAISTRATEGY_WINNING_WARS', 'FLAVOR_INFRASTRUCTURE', -10)
('MILITARYAISTRATEGY_LOSING_WARS', 'FLAVOR_INFRASTRUCTURE', -40)

-- City strategies
('AICITYSTRATEGY_NEED_HAPPINESS_CONNECTION', 'FLAVOR_INFRASTRUCTURE', 60)
```

## Related Flavors

FLAVOR_INFRASTRUCTURE works in conjunction with other related flavors:

- **FLAVOR_EXPANSION** - Often paired with infrastructure for territorial growth
- **FLAVOR_WATER_CONNECTION** - Specifically for harbor and naval connections
- **FLAVOR_I_LAND_TRADE_ROUTE** - Internal land trade route emphasis
- **FLAVOR_I_SEA_TRADE_ROUTE** - Internal sea trade route emphasis
- **FLAVOR_TILE_IMPROVEMENT** - Worker actions and tile development
- **FLAVOR_GROWTH** - City development requiring infrastructure support

## Gameplay Impact

### High Infrastructure Leaders (8-9)

These leaders will:

- Connect cities early and maintain road networks
- Research transportation technologies promptly
- Build infrastructure buildings before specialized structures
- Maintain strong internal connectivity even during wartime
- Expand territory with supporting infrastructure

Examples: Expansionists like Hiawatha, Pachacuti, Catherine

### Moderate Infrastructure Leaders (5-7)

These leaders will:

- Balance infrastructure with other priorities
- Connect cities when economically beneficial
- Build infrastructure as needed rather than proactively
- Reduce infrastructure focus significantly during wars

Examples: Coalitionists like Washington, Diplomats like Gandhi

### Low Infrastructure Leaders (3-4)

These leaders will:

- Delay road construction until necessary
- Prioritize military or cultural buildings over infrastructure
- Only build basic connections when happiness requires it
- Significantly neglect infrastructure during military campaigns

Examples: Conquerors like Attila, Genghis Khan, Shaka

## Strategic Considerations

When playing against or analyzing AI behavior:

1. **Expansionists** (9 infrastructure) will have well-connected empires with strong internal trade
2. **Conquerors** (4 infrastructure) may have disconnected cities, creating vulnerability
3. **Wartime** dramatically reduces infrastructure focus (-10 to -40), potentially creating opportunities
4. **City connection happiness strategy** provides +60 infrastructure, overriding normal priorities
5. **Road networks** reveal leader personality - extensive networks indicate high infrastructure flavor
6. **Technology choices** reflect infrastructure priority - early Wheel/Engineering suggests high flavor
