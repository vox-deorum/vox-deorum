# FLAVOR_AIRLIFT

## Overview

`FLAVOR_AIRLIFT` is an AI personality flavor that controls how strongly a civilization's leader prioritizes rapid military deployment through airlift capabilities. This flavor shapes the AI's approach to building airport infrastructure and utilizing air mobility for strategic repositioning of ground forces, influencing everything from building construction priorities to the strategic value of cities for air logistics.

Unlike general air power flavors (FLAVOR_AIR, FLAVOR_BOMBER) that focus on combat aircraft, `FLAVOR_AIRLIFT` specifically drives the AI's **investment in air mobility infrastructure and rapid deployment capabilities** for moving ground units across large distances instantaneously.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Expansionist leaders (far-flung empires): 7
  - Conqueror leaders (offensive doctrine): 6
  - Coalition leaders (defensive posture): 5
  - Diplomat leaders (defensive posture): 4
  - Barbarians: 0

### Related Flavors

- **FLAVOR_AIR:** General air power and aviation combat
- **FLAVOR_ANTIAIR:** Anti-aircraft defense capabilities
- **FLAVOR_AIR_CARRIER:** Naval aviation and carrier operations
- **FLAVOR_MOBILE:** Ground unit mobility and rapid maneuver
- **FLAVOR_EXPANSION:** Territorial expansion and distant settlements

## Code References

### 1. City Strategy - Good Airlift City Identification (CvCityStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCityStrategyAI.cpp` (lines 3292-3313)

**Function:** `CityStrategyAIHelpers::IsTestCityStrategy_GoodAirliftCity()`

This function identifies cities that are strategically valuable for airlift operations.

```cpp
bool CityStrategyAIHelpers::IsTestCityStrategy_GoodAirliftCity(CvCity *pCity)
{
    if (pCity->isCapital())
    {
        return true;
    }

    CvPlayer &kPlayer = GET_PLAYER(pCity->getOwner());
    CvCity *pCapital = kPlayer.getCapitalCity();

    if (pCity && pCapital && !pCity->HasSharedAreaWith(pCapital,true,true))
    {
        return true;
    }

    if (pCapital && pCity && plotDistance(pCity->getX(), pCity->getY(), pCapital->getX(), pCapital->getY()) > 20)
    {
        return true;
    }

    return false;
}
```

**Interpretation:** The AI identifies three types of cities as "good airlift cities":

1. **Capital City:** Always considered a good airlift hub as the political and logistical center
2. **Cross-Continental Cities:** Cities on different continents from the capital (no shared land/sea connection) require air mobility to receive reinforcements quickly
3. **Distant Cities:** Cities more than 20 tiles away from the capital benefit from airlift for rapid deployment

This strategy (AICITYSTRATEGY_GOOD_AIRLIFT_CITY) activates in these cities, making them prioritize airport construction. This creates a logical airlift network connecting the capital to remote territories.

**Strategic Implications:**

- Empire sprawl automatically triggers airport construction
- Cross-continental empires get airlift hubs on each landmass
- Creates defensive depth by enabling rapid reinforcement of distant borders
- Supports offensive operations by allowing quick redeployment from rear areas

### 2. Policy Evaluation - Conquest Value (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (line 4920)

**Function:** Policy valuation for conquest-focused gameplay

FLAVOR_AIRLIFT contributes to valuing policies that support military conquest.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_AIR" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_ANTIAIR" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_AIR_CARRIER" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_AIRLIFT" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_BOMBER" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_FIGHTER")
{
    iConquestValue += iFlavorValue;
}
```

**Interpretation:** FLAVOR_AIRLIFT is grouped with all aviation-related flavors when calculating a policy's value for conquest victory. Leaders with high airlift preferences will highly value policies that boost aviation infrastructure, recognizing rapid deployment as critical for successful military campaigns.

This treats airlift capability as a force multiplier for conquest strategies - the ability to rapidly concentrate forces at any point in the empire enables both offensive thrusts and defensive reinforcement during multi-front wars.

## Database References

### Building Flavor Values

The Airport building is the primary infrastructure element for airlift operations.

**Location:** `(2) Vox Populi/Database Changes/AI/BuildingFlavorSweeps.sql` (lines 517-520)

```sql
-- Airport
('BUILDING_AIRPORT', 'FLAVOR_CULTURE', 30),
('BUILDING_AIRPORT', 'FLAVOR_AIRLIFT', 30),
('BUILDING_AIRPORT', 'FLAVOR_AIR', 30),
('BUILDING_AIRPORT', 'FLAVOR_ANTIAIR', 30),
```

**Interpretation:** The Airport receives a flavor value of 30 for FLAVOR_AIRLIFT, making it highly attractive to leaders who value air mobility. This equal weighting with FLAVOR_AIR and FLAVOR_ANTIAIR reflects the airport's triple role:

1. **Airlift hub** for rapid unit deployment
2. **Air base** for housing combat aircraft
3. **Air defense node** providing interceptor capabilities

Leaders with high FLAVOR_AIRLIFT will prioritize airport construction in cities identified by the "good airlift city" strategy, creating a strategic airlift network.

The FLAVOR_CULTURE value (30) reflects the airport's tourism bonus in Vox Populi, making it valuable beyond pure military considerations.

### Policy Flavor Values

**Location:** `(2) Vox Populi/Database Changes/AI/PolicyFlavorSweeps.sql` (lines 186-188)

```sql
('POLICY_MILITARISM', 'FLAVOR_MILITARY_TRAINING', 30),
('POLICY_MILITARISM', 'FLAVOR_AIR', 60),
('POLICY_MILITARISM', 'FLAVOR_AIRLIFT', 30),
```

**Interpretation:** The Militarism policy (part of the Autocracy ideology tree) receives a FLAVOR_AIRLIFT value of 30, making it attractive to leaders who value rapid deployment. Combined with its very high FLAVOR_AIR value (60), Militarism strongly appeals to leaders pursuing modern mobile warfare doctrines.

The Militarism policy likely provides bonuses to air unit production and/or airlift capabilities, making it synergistic with airport construction and air mobility strategies. Leaders with high FLAVOR_AIRLIFT will view Militarism as essential for their grand strategy.

### Leader Personality Flavor Values

**Location:** `(2) Vox Populi/Database Changes/AI/LeaderFlavorSweeps.sql`

Leader types receive different FLAVOR_AIRLIFT values based on their strategic personalities:

**Conqueror Leaders** (lines 29-44)

- Leaders: Ashurbanipal, Askia, Attila, Augustus, Darius, Genghis Khan, Gustavus Adolphus, Harald, Montezuma, Napoleon, Oda Nobunaga, Shaka
- FLAVOR_AIRLIFT: **6**

**Coalition Leaders** (lines 101-116)

- Leaders: Casimir, Elizabeth, Selassie, Harun al-Rashid, Kamehameha, Nebuchadnezzar, Pacal, Ramesses, Washington
- FLAVOR_AIRLIFT: **5**

**Diplomat Leaders** (lines 175-190)

- Leaders: Ahmad al-Mansur, Enrico Dandolo, Gandhi, Maria I, Maria Theresa, Pedro II, Sejong
- FLAVOR_AIRLIFT: **4**

**Expansionist Leaders** (lines 249-264)

- Leaders: Alexander, Boudicca, Catherine, Dido, Gajah Mada, Hiawatha, Isabella, Pachacuti, Pocatello, Suleiman, Wu Zetian
- FLAVOR_AIRLIFT: **7** (highest)

**Barbarians** (`(1) Community Patch/Database Changes/AI/CoreLeaderFlavorChanges.sql` line 25)

- FLAVOR_AIRLIFT: **0** (barbarians don't use advanced infrastructure)

**Interpretation:**

1. **Expansionists prioritize airlift the most (7):** Leaders who spread their empires across large territories need air mobility to maintain cohesion and rapidly reinforce distant colonies. The ability to instantly move units from the core to frontier regions is critical for defending sprawling empires.

2. **Conquerors value airlift highly (6):** Aggressive leaders recognize airlift as enabling rapid concentration of forces at breakthrough points during offensive campaigns. The ability to redeploy armies from quiet fronts to active war zones provides operational flexibility.

3. **Coalition and Diplomatic leaders have moderate airlift (4-5):** Defensive-minded leaders value airlift for reinforcing threatened positions but prioritize other defensive measures more highly. Air mobility serves as crisis response rather than offensive doctrine.

4. **Barbarians ignore airlift (0):** As pre-industrial raiders, barbarians cannot and do not build airports or use modern logistics.

The clear gradient (Expansionist > Conqueror > Coalition > Diplomat > Barbarian) reflects how airlift capability serves different strategic needs: territorial control for expansionists, operational mobility for conquerors, crisis response for defenders, and irrelevance for primitives.

## Summary of Effects

### Strategic Planning

- **Building priorities:** Leaders with high FLAVOR_AIRLIFT prioritize airport construction in capital, cross-continental cities, and distant frontier cities
- **City identification:** Automatic detection of strategically valuable airlift hubs based on distance and continental separation
- **Policy selection:** Militarism policy becomes more attractive to leaders valuing air mobility
- **Network creation:** Forms logical airlift networks connecting core to periphery

### Military Operations

- **Rapid reinforcement:** Enables instant deployment of units to threatened borders
- **Force concentration:** Allows redeployment from quiet fronts to active war zones
- **Operational flexibility:** Supports multi-front wars by enabling strategic mobility
- **Defensive depth:** Creates ability to reinforce any point in empire within one turn

### Territorial Control

- **Cross-continental empires:** Essential for maintaining control of separated landmasses
- **Distant colonies:** Provides lifeline to remote settlements more than 20 tiles from capital
- **Frontier defense:** Enables rapid response to border threats in sprawling empires
- **Strategic depth:** Turns rear-area cities into potential reinforcement sources

### Infrastructure Development

- **Airport network:** Creates prioritized construction in capital and remote cities
- **Multi-purpose facilities:** Airports serve airlift, air combat, and air defense roles simultaneously
- **Cultural benefits:** Modern airport infrastructure provides tourism bonuses
- **Era scaling:** Becomes relevant in Atomic Era when airports unlock

## Design Philosophy

FLAVOR_AIRLIFT represents a civilization's doctrine regarding strategic mobility and rapid deployment:

1. **Strategic Mobility:** How important is the ability to instantly move forces across the empire
2. **Infrastructure Investment:** How much to invest in airlift-capable cities (airports)
3. **Operational Doctrine:** Whether to maintain centralized reserves or forward-deployed forces
4. **Territorial Control:** How to maintain cohesion across geographically separated territories

This creates distinct air mobility doctrines:

- **High AIRLIFT (7):** Expansionist empires that rely on rapid deployment to control vast territories and multiple landmasses
- **Moderate AIRLIFT (5-6):** Balanced militaries that value operational flexibility for offense and defense
- **Low AIRLIFT (4):** Traditional militaries that prefer static forward deployments over centralized reserves
- **Minimal AIRLIFT (0-3):** Primitive or compact civilizations where airlift provides minimal strategic value

### Historical Context

FLAVOR_AIRLIFT becomes relevant in the Atomic Era when the Airport building and airlift capabilities become available. Leaders with high FLAVOR_AIRLIFT will:

- Prioritize airport construction in capital and remote cities immediately
- Value policies that enhance air mobility (Militarism)
- Maintain mobile reserves in the core for rapid deployment
- Use airlift as first response to border threats
- Enable multi-front offensive operations through force redeployment

Leaders with low FLAVOR_AIRLIFT will:

- Build airports only when specifically needed for air units
- Maintain forward-deployed forces rather than centralized reserves
- Rely on traditional ground/naval movement for reinforcement
- Build airports primarily for air combat rather than transport

### Gameplay Implications

**For Players:**

- High-AIRLIFT AI opponents will rapidly reinforce threatened cities during wars
- Expansionist AIs with high AIRLIFT will be harder to conquer piecemeal (they can concentrate defenses)
- Attacking distant AI cities may trigger instant reinforcement from the core
- AI empires on multiple continents will connect them via airlift network

**For AI:**

- Expansionist personalities automatically build logical airlift infrastructure
- Cross-continental empires remain cohesive through air mobility
- Distant colonies can receive instant reinforcement during crises
- Enables "interior lines" strategy where centralized reserves can reinforce any front

## Related Flavors and Interactions

### Complementary Flavors

**FLAVOR_EXPANSION (9 for Expansionists):** Expansionist leaders have both high EXPANSION and high AIRLIFT, creating a strategic synergy. They spread across the map aggressively, then build airports to maintain control of their sprawling empires. AIRLIFT serves as the glue holding territorial acquisitions together.

**FLAVOR_MOBILE (7 for Expansionists, 7 for Conquerors):** Leaders who value mobile ground units also value airlift capability. Both represent doctrines of maneuver warfare and rapid response. Together they create highly flexible military forces that can respond quickly at both tactical (MOBILE) and strategic (AIRLIFT) scales.

**FLAVOR_AIR (5-8 across personalities):** Airports serve dual purpose: combat air base and airlift hub. Leaders with high AIR + AIRLIFT will build extensive airport networks and fully utilize them for both combat aviation and strategic mobility. The flavors reinforce each other's infrastructure investments.

**FLAVOR_CITY_DEFENSE (varies by personality):** High AIRLIFT provides defensive depth by enabling rapid reinforcement of threatened cities. Leaders with high CITY_DEFENSE + AIRLIFT can maintain smaller forward garrisons, relying on rapid deployment of reserves when cities are attacked. This is especially valuable for Coalition leaders (CITY_DEFENSE: 9, AIRLIFT: 5).

### Strategic Doctrines by Leader Type

**Expansionist Doctrine (EXPANSION: 9, AIRLIFT: 7):**

- Spread across multiple landmasses early
- Build airports in capital and each new continent
- Maintain centralized military reserves in core cities
- Deploy reserves to threatened frontiers via airlift
- Value territorial control over dense development

**Conqueror Doctrine (OFFENSE: 8, AIRLIFT: 6):**

- Use airlift for operational flexibility during wars
- Redeploy armies from completed conquests to new fronts
- Maintain strategic reserve for exploitation of breakthroughs
- Value rapid concentration of force at decisive points
- Combine with mobile units for deep penetration strategies

**Coalition Doctrine (CITY_DEFENSE: 9, AIRLIFT: 5):**

- Build airports for defensive reinforcement capability
- Maintain reserves in capital for crisis response
- Use airlift primarily for defensive counterattacks
- Value rapid response to allied defense requests
- Combine with defensive city improvements

**Diplomatic Doctrine (DIPLOMACY: 8, AIRLIFT: 4):**

- Build airports primarily for air combat, secondarily for mobility
- Lower priority on strategic reserve concept
- Prefer forward-deployed defensive forces
- Airlift serves as backup rather than primary strategy
- Value cultural/tourism aspects of airports over military

### Economic Considerations

Airlift capability requires significant infrastructure investment:

**FLAVOR_PRODUCTION:** Airports are expensive buildings (Atomic Era), requiring strong production. Leaders with high AIRLIFT but low PRODUCTION will struggle to build comprehensive airlift networks, creating strategic tension.

**FLAVOR_SCIENCE:** Airport technology (Rocketry) requires advanced scientific development. High-AIRLIFT leaders will prioritize the technology path leading to airports, potentially at the expense of other research branches.

**FLAVOR_GOLD:** Airports have maintenance costs. Economic pressure can delay or prevent airport construction even for leaders who value airlift. This creates interesting trade-offs between military doctrine and economic reality.

### Competing Priorities

**FLAVOR_DEFENSE vs FLAVOR_AIRLIFT:** Leaders can choose between static forward defenses (high DEFENSE) or mobile reserves with airlift (high AIRLIFT). Coalition leaders balance both (DEFENSE: 7, AIRLIFT: 5), while pure defensive leaders might prefer fortifications over mobility.

**FLAVOR_NAVAL vs FLAVOR_AIRLIFT:** For cross-continental empires, naval transport and airlift serve similar strategic functions. Leaders must balance investment in naval logistics (ports, cargo ships) versus air logistics (airports). Naval-focused leaders may under-invest in airports even when beneficial.

## Practical Examples

### Example 1: Expansionist Empire (AIRLIFT: 7)

**Setup:** Catherine (Russia) has expanded to three continents with cities 30+ tiles from capital

**AI Behavior:**

1. Capital Moscow gets AICITYSTRATEGY_GOOD_AIRLIFT_CITY (always true for capitals)
2. St. Petersburg on home continent (12 tiles away): No strategy, low priority
3. Vladivostok on second continent (no shared area): GOOD_AIRLIFT_CITY, builds airport
4. Alaska colony on third continent (35 tiles away): GOOD_AIRLIFT_CITY, builds airport

**Result:** Catherine creates a three-node airlift network (Moscow → Vladivostok → Alaska) enabling instant reinforcement of either frontier from the capital's strategic reserve.

**Combat Scenario:** When Japan attacks Vladivostok, Catherine airlifts 5 units from Moscow garrison in a single turn, surprising the attacker with instant reinforcements.

### Example 2: Conqueror Multi-Front War (AIRLIFT: 6)

**Setup:** Napoleon (France) is winning a war against Germany but gets declared on by Spain in the west

**AI Behavior:**

1. Paris has airport (capital + GOOD_AIRLIFT_CITY)
2. French eastern army is besieging Berlin
3. Spanish invasion threatens Marseille in the west
4. Napoleon airlifts 4 units from Paris reserve to Marseille
5. Eastern army continues pressure on Germany while western defense stabilizes

**Result:** High AIRLIFT (6) enables operational flexibility, fighting effectively on two fronts by rapidly redeploying strategic reserves.

### Example 3: Coalition Defensive Response (AIRLIFT: 5)

**Setup:** Washington (America) detects Shaka building up forces near border city of Boston

**AI Behavior:**

1. Washington has airports in capital and Boston (24 tiles away, GOOD_AIRLIFT_CITY)
2. Standing garrison in Boston: 3 units
3. Washington airlifts 2 additional units from capital reserve
4. Combined garrison of 5 units deters Shaka's attack

**Result:** Moderate AIRLIFT (5) enables defensive reinforcement, but Washington maintains larger forward garrisons than Catherine would (who relies more heavily on airlift for defense).

### Example 4: Diplomat Limited Airlift (AIRLIFT: 4)

**Setup:** Gandhi (India) has spread to nearby islands but capital Delhi is only 15 tiles from most cities

**AI Behavior:**

1. Only Delhi gets GOOD_AIRLIFT_CITY strategy (as capital)
2. Island cities too close to trigger distance-based strategy
3. Gandhi builds airport in Delhi for air combat, not primarily for airlift
4. Maintains forward-deployed forces in island cities rather than centralized reserves

**Result:** Low AIRLIFT (4) leads to minimal strategic use of air mobility. Gandhi relies on pre-positioned defenses and naval transport for reinforcement.

## Technical Notes

### City Strategy Activation

The AICITYSTRATEGY_GOOD_AIRLIFT_CITY strategy is checked every turn for each city using three criteria:

1. **Capital Check:** Always returns true for capital cities
2. **Continental Separation Check:** Uses `HasSharedAreaWith(pCapital, true, true)` to detect different landmasses
3. **Distance Check:** Uses `plotDistance()` with 20-tile threshold

This creates a dynamic network that expands as the empire grows. New colonies automatically become airlift priority cities when they exceed distance/separation thresholds.

### Building Production AI Integration

When AICITYSTRATEGY_GOOD_AIRLIFT_CITY is active, the city's building production AI receives modified weights. The Airport's FLAVOR_AIRLIFT value (30) gets multiplied by the leader's FLAVOR_AIRLIFT value (4-7) to produce final priority scores:

- Expansionist (AIRLIFT: 7): 30 × 7 = **210 priority boost**
- Conqueror (AIRLIFT: 6): 30 × 6 = **180 priority boost**
- Coalition (AIRLIFT: 5): 30 × 5 = **150 priority boost**
- Diplomat (AIRLIFT: 4): 30 × 4 = **120 priority boost**

This creates significant differences in airport construction priority across personality types, with expansionists building them 75% faster than diplomats in comparable situations.

### Policy Evaluation Impact

When evaluating the Militarism policy, leaders calculate conquest value as:

`iConquestValue += FLAVOR_AIRLIFT_value`

For leaders considering conquest victory:

- Expansionist adds 7 points to Militarism's conquest value
- Conqueror adds 6 points
- Coalition adds 5 points
- Diplomat adds 4 points

Combined with Militarism's other flavor values (MILITARY_TRAINING: 30, AIR: 60), this makes Militarism strongly attractive to high-AIRLIFT leaders pursuing military victory.

### Interaction with Game Mechanics

**Airlift Mechanics (Civ V):**

- Requires source and destination cities to both have airports
- Can transport land units instantly (range limited by modern era upgrades)
- One unit per turn per city (base rate)
- Costs movement points (unit cannot move after airlift)

**Strategic Implications:** Leaders with high FLAVOR_AIRLIFT build the infrastructure to exploit these mechanics, while low-FLAVOR_AIRLIFT leaders leave gaps in their network that limit tactical options during crisis situations.

**Barbarian Exclusion:** Barbarians have FLAVOR_AIRLIFT: 0 because they lack the technology level and organized logistics to build or use airports. This prevents barbarian camps from developing advanced infrastructure that would be anachronistic.
