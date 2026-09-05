# FLAVOR_ANTIAIR

## Overview

`FLAVOR_ANTIAIR` is an AI personality flavor that controls how strongly a civilization's leader prioritizes anti-aircraft defense and air interception capabilities. This flavor shapes the AI's approach to defending against enemy air power, influencing unit production decisions, technology research priorities, building construction, and overall defensive military strategy.

Unlike offensive air flavors (FLAVOR_AIR, FLAVOR_BOMBER) which focus on projecting air power, `FLAVOR_ANTIAIR` specifically drives the AI's **investment in protecting cities and ground forces from enemy air attacks** through dedicated anti-aircraft units, fighter interceptors, and defensive air infrastructure.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Defensive specialists: 6-7
  - Balanced military leaders: 4-5
  - Offensive-focused leaders: 4-5
  - Air power specialists (offense): 5-7
  - Ground-only focused leaders: 0-4

### Related Flavors

- **FLAVOR_AIR:** General air power investment (both offensive and defensive)
- **FLAVOR_DEFENSE:** General defensive military posture
- **FLAVOR_CITY_DEFENSE:** City fortification and defensive structures
- **FLAVOR_FIGHTER:** Specialization in fighter aircraft (overlaps with antiair role)

## Code References

### 1. Unit Promotion Selection - AntiAir Flavor Loading (CvUnit.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvUnit.cpp` (line 31670)

**Function:** Unit promotion valuation for anti-air considerations

```cpp
int iFlavorAntiAir = range(pFlavorMgr->GetPersonalityIndividualFlavor((FlavorTypes)GC.getInfoTypeForString("FLAVOR_ANTIAIR")), 1, 20);
```

**Interpretation:** The flavor value is loaded and clamped between 1-20 for promotion calculations. However, current code analysis shows this variable is **defined but not actively used** in promotion selection logic. This suggests FLAVOR_ANTIAIR is primarily used for unit production and building construction decisions rather than influencing individual unit promotion choices. The variable may be reserved for future promotion logic related to anti-aircraft capabilities.

### 2. Military Strategy - Need Anti-Air Units (CvMilitaryAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (lines 4028-4048)

**Function:** `MilitaryAIHelpers::IsTestStrategy_NeedAntiAirUnits()`

Determines when the AI critically needs to build more anti-aircraft units based on enemy air force presence.

```cpp
bool MilitaryAIHelpers::IsTestStrategy_NeedAntiAirUnits(CvPlayer* pPlayer, int iNumAA, int iNumMelee)
{
    bool bAnyAirforce = false;
    PlayerTypes eLoopPlayer;
    for(int iPlayerLoop = 0; iPlayerLoop < MAX_MAJOR_CIVS; iPlayerLoop++)
    {
        eLoopPlayer = (PlayerTypes) iPlayerLoop;
        if(eLoopPlayer != pPlayer->GetID() && pPlayer->GetDiplomacyAI()->IsPlayerValid(eLoopPlayer))
        {
            if(GET_PLAYER(eLoopPlayer).GetMilitaryAI()->HasAirforce())
            {
                bAnyAirforce = true;
                break;
            }
        }
    }

    if(bAnyAirforce)
    {
        // The original code simplifies to 4*iNumAA <= iNumMelee
        return (iNumAA * GD_INT_GET(AI_CONFIG_MILITARY_MELEE_PER_AA) <= iNumMelee);
    }
```

**Interpretation:** The "NEED_ANTIAIR" strategy activates when:

1. **Any opponent has air forces** - No point building AA without air threats
2. **Anti-air unit ratio falls below threshold** - Default: 1 AA unit per 2 melee units (ratio 1:2)
   - With 20 melee units: Need at least 10 AA units
   - With 40 melee units: Need at least 20 AA units

This strategy activation triggers the MILITARYAISTRATEGY_NEED_ANTIAIR, which applies a **+50 FLAVOR_ANTIAIR boost**, dramatically increasing anti-aircraft unit production priority until the minimum force ratio is restored.

### 3. Military Strategy - Enough Anti-Air Units (CvMilitaryAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (lines 3999-4025)

**Function:** `MilitaryAIHelpers::IsTestStrategy_EnoughAntiAirUnits()`

Determines when the AI has built sufficient anti-aircraft forces and should stop prioritizing AA production.

```cpp
bool MilitaryAIHelpers::IsTestStrategy_EnoughAntiAirUnits(CvPlayer* pPlayer, int iNumAA, int iNumMelee)
{
    bool bAnyAirforce = false;
    PlayerTypes eLoopPlayer;
    for(int iPlayerLoop = 0; iPlayerLoop < MAX_MAJOR_CIVS; iPlayerLoop++)
    {
        eLoopPlayer = (PlayerTypes) iPlayerLoop;
        if(eLoopPlayer != pPlayer->GetID() && pPlayer->GetDiplomacyAI()->IsPlayerValid(eLoopPlayer))
        {
            if(GET_PLAYER(eLoopPlayer).GetMilitaryAI()->HasAirforce())
            {
                bAnyAirforce = true;
                break;
            }
        }
    }

    if(bAnyAirforce)
    {
        // The original code simplifies to 4*iNumAA > iNumMelee
        return (iNumAA * GD_INT_GET(AI_CONFIG_MILITARY_MELEE_PER_AA) > iNumMelee);
    }
    else
    {
        return true;
    }
}
```

**Interpretation:** The "ENOUGH_ANTIAIR" strategy returns true when:

1. **No enemies have air forces** - Always returns true (don't need more AA)
2. **Anti-air units exceed target ratio** - Default: More than 1 AA per 2 melee units
   - With 20 melee units and 11+ AA units: Enough AA units
   - With 40 melee units and 21+ AA units: Enough AA units

This signals the AI to stop prioritizing anti-aircraft production and redirect resources to other military needs.

### 4. Military Strategy Activation (CvMilitaryAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (lines 2080-2083)

**Function:** Military strategy evaluation

The NEED_ANTIAIR and ENOUGH_ANTIAIR strategies are evaluated each turn to determine current anti-aircraft priorities:

```cpp
else if(strStrategyName == "MILITARYAISTRATEGY_NEED_ANTIAIR")
    bStrategyShouldBeActive = MilitaryAIHelpers::IsTestStrategy_NeedAntiAirUnits(m_pPlayer, m_iNumAntiAirUnits, m_iNumMeleeLandUnits);
else if(strStrategyName == "MILITARYAISTRATEGY_ENOUGH_ANTIAIR")
    bStrategyShouldBeActive = MilitaryAIHelpers::IsTestStrategy_EnoughAntiAirUnits(m_pPlayer, m_iNumAntiAirUnits, m_iNumMeleeLandUnits);
```

**Interpretation:** These strategies are mutually exclusive - when NEED_ANTIAIR is active, ENOUGH_ANTIAIR is inactive, and vice versa. The AI dynamically shifts between building up anti-aircraft forces and focusing on other priorities based on enemy air power threats and current force composition.

### 5. Policy Evaluation - Conquest Value (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (line 4920)

**Function:** Policy valuation for conquest-focused gameplay

FLAVOR_ANTIAIR contributes to valuing policies that support military operations, including both offensive and defensive aviation capabilities.

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

**Interpretation:** FLAVOR_ANTIAIR is grouped with all aviation-related flavors when calculating a policy's value for conquest victory. This reflects that air defense is a critical component of military dominance - leaders pursuing conquest need both offensive air power and defensive capabilities to protect their forces from enemy air attacks. Leaders with high FLAVOR_ANTIAIR will value policies that enhance anti-aircraft capabilities as part of a comprehensive air warfare doctrine.

## Database References

### Anti-Aircraft Unit Flavor Values

Dedicated anti-aircraft units have FLAVOR_ANTIAIR values that indicate their primary purpose:

**Ground-Based Anti-Aircraft:**

- Anti-Aircraft Gun (UNIT_ANTI_AIRCRAFT_GUN): 15
- Mobile SAM (UNIT_MOBILE_SAM): 20

**Fighter Aircraft (Dual Role - Air Superiority & Interception):**

- Triplane (UNIT_TRIPLANE): 12 (also FLAVOR_AIR: 10)
- SPAD (UNIT_SPAD, unique): 18 (also FLAVOR_AIR: 15)
- Fighter (UNIT_FIGHTER): 16 (also FLAVOR_AIR: 14)
- Japanese Zero (UNIT_JAPANESE_ZERO, unique): 21 (also FLAVOR_AIR: 19)
- Jet Fighter (UNIT_JET_FIGHTER): 20 (also FLAVOR_AIR: 18)

**Interpretation:**

- **Dedicated AA units** (SAM, AA Gun) have pure FLAVOR_ANTIAIR values, making them prioritized by defensive-minded leaders
- **Fighter aircraft** have both FLAVOR_AIR and FLAVOR_ANTIAIR, appealing to leaders who value both offensive air operations and defensive interception
- **Mobile SAM has the highest value (20)**, reflecting its effectiveness as the ultimate anti-aircraft weapon
- **Unique fighters have significantly higher values**, making them more attractive to both air-power and air-defense focused civilizations

### Technology Flavor Values

Technologies that unlock or enhance anti-aircraft capabilities have FLAVOR_ANTIAIR values:

- **Ballistics (Anti-Aircraft Gun):** 10
- **Advanced Ballistics (Mobile SAM):** 10

**Interpretation:** Anti-aircraft technologies receive moderate FLAVOR_ANTIAIR values (10 each), making them important but not critical priorities. Leaders with high FLAVOR_ANTIAIR will accelerate research of these technologies when enemy air forces are detected, but won't rush them preemptively like they would with core military technologies.

### Building Flavor Values

Buildings that provide anti-aircraft defense have FLAVOR_ANTIAIR values:

- **Airport:** 30 (also FLAVOR_AIR: 30, FLAVOR_AIRLIFT: 30)
- **Military Base:** 30 (also FLAVOR_ANTIAIR: 30, FLAVOR_AIR: 30)

**Interpretation:** Air infrastructure receives very high FLAVOR_ANTIAIR values (30), reflecting that these buildings:

1. **Provide interception capabilities** - Units stationed in cities with these buildings can intercept enemy aircraft
2. **Extend air defense range** - Increase the operational radius of fighter aircraft
3. **Support fighter deployment** - Allow air units to be positioned for optimal interception coverage

Leaders with high FLAVOR_ANTIAIR will prioritize building airports and military bases in vulnerable cities and strategic locations to create defensive air coverage networks.

### Military Strategy Modifiers

FLAVOR_ANTIAIR receives dynamic modifications based on the current military and economic situation:

**Economic Pressures (Negative Modifiers):**

- ECONOMICAISTRATEGY_TOO_MANY_UNITS: -300
- ECONOMICAISTRATEGY_LOSING_MONEY: -300

**Direct Anti-Air Needs:**

- MILITARYAISTRATEGY_NEED_ANTIAIR: +50

**Interpretation:**

1. **Economic constraints severely penalize anti-air production** (-300), as AA units are specialized defensive assets that don't contribute to economic growth
2. **The NEED_ANTIAIR strategy provides a massive +50 boost**, creating strong pressure to build AA units when enemy air forces threaten and current forces are insufficient
3. **No war-specific bonuses** - Unlike offensive military flavors, FLAVOR_ANTIAIR doesn't get automatic boosts during wars unless the specific NEED_ANTIAIR threshold is crossed

### Leader Flavor Values (Examples)

Different leaders have varying FLAVOR_ANTIAIR values reflecting their defensive priorities:

**Defensive Specialists (7):**

- Enrico Dandolo
- Maria
- Maria I
- Pedro
- Ramkhamhaeng
- Sejong
- William

**Balanced Leaders (5-6):**

- Most standard civilization leaders
- Default values for generic AI personalities

**Reduced Priority (5):**

- Alexander (conquest-focused, reduced from 7)
- Elizabeth (naval/domination-focused, reduced from 7)

**Interpretation:**

- **Leaders with defensive or balanced doctrines** (7) prioritize maintaining anti-aircraft forces as part of comprehensive defensive strategy
- **Aggressive conquest-focused leaders** (5) reduce anti-aircraft investment to allocate more resources to offensive capabilities
- **The relatively narrow range (4-7)** suggests anti-aircraft defense is considered universally important in the modern era, with only moderate variation between leader personalities

## Summary of Effects

### Strategic Planning

- **Enemy assessment:** Continuously scans for enemy air force development
- **Force composition:** Maintains target ratio of 1 AA unit per 2 melee units when air threats exist
- **Technology research:** Prioritizes Ballistics and Advanced Ballistics when enemies develop air power
- **Infrastructure planning:** Builds airports and military bases in vulnerable cities

### Military Production

- **Unit production:** Activates when enemy air forces detected and AA ratio insufficient
- **Dynamic priority:** Strong +50 boost during NEED_ANTIAIR strategy, -300 penalty during economic crisis
- **Fighter vs dedicated AA:** Balance between multi-role fighters and specialized AA units based on both FLAVOR_AIR and FLAVOR_ANTIAIR
- **Preemptive vs reactive:** Only builds AA units after detecting enemy air threats (not preemptively)

### Defensive Capabilities

- **Interception network:** Positions fighters and AA units to provide overlapping coverage
- **City defense:** Prioritizes AA protection for important cities and production centers
- **Ground force protection:** Ensures field armies have AA support when operating in hostile airspace
- **Damage mitigation:** Reduces effectiveness of enemy bombing campaigns and air superiority operations

### Situational Response

- **No air threats:** Minimal investment (returns "Enough AA" immediately)
- **Air threats detected:** Ramps up production until target ratio achieved
- **Economic crisis:** Dramatically reduces AA priority despite threats
- **War without air threats:** No special bonuses (unlike offensive military flavors)

## Design Philosophy

FLAVOR_ANTIAIR represents a civilization's doctrine regarding air defense:

1. **Threat-Responsive:** Only activates when enemy air forces are detected
2. **Proportional Defense:** Maintains AA forces proportional to ground forces (not absolute numbers)
3. **Efficiency-Focused:** Stops building AA when target ratio reached
4. **Infrastructure-Integrated:** Links AA effectiveness to building development (airports, military bases)

This creates distinct anti-aircraft defense doctrines:

- **High ANTIAIR (6-7):** Defensive specialists who maintain robust AA coverage across their empire
- **Moderate ANTIAIR (4-5):** Balanced leaders who build sufficient AA to counter threats without over-investing
- **Low ANTIAIR (0-4):** Offensive-focused leaders who accept air vulnerability to maximize offensive power

### Reactive vs Proactive Defense

Unlike offensive military flavors that maintain standing forces, FLAVOR_ANTIAIR operates reactively:

- **No enemy air forces → No AA production** (even with high FLAVOR_ANTIAIR)
- **Enemy air forces detected → Build to target ratio** (1 AA per 2 melee units)
- **Target ratio achieved → Stop AA production** (redirect to other priorities)

This reflects the specialized nature of anti-aircraft units - they're only valuable when air threats exist.

### Historical Context

FLAVOR_ANTIAIR becomes relevant in the Industrial and Modern eras when aviation technologies become available (Flight, Ballistics, Radar, Advanced Ballistics). The flavor ensures that:

**Leaders with high FLAVOR_ANTIAIR will:**

- Quickly detect enemy air force development
- Immediately begin AA unit production when threats emerge
- Build airports and military bases for interception coverage
- Maintain AA forces proportional to army size throughout conflicts

**Leaders with low FLAVOR_ANTIAIR will:**

- Delay AA production even when facing air threats
- Build minimal AA forces (below target ratios)
- Prioritize offensive capabilities over defensive air coverage
- Accept losses to enemy air attacks to maintain offensive momentum

### Tactical Implications

The presence or absence of adequate anti-aircraft forces dramatically affects late-game warfare:

**With Strong AA Coverage:**

- Enemy bombers suffer high interception rates
- Fighters struggle to establish air superiority
- Ground forces operate safely under friendly air cover
- Cities resist strategic bombing campaigns

**Without AA Coverage:**

- Enemy air forces operate freely
- Ground forces suffer constant air attacks
- Cities lose infrastructure to bombing
- Tactical flexibility severely reduced

## Related Flavors and Interactions

### Complementary Flavors

- **FLAVOR_DEFENSE:** General defensive posture supports AA investment
- **FLAVOR_CITY_DEFENSE:** City fortifications work synergistically with AA protection
- **FLAVOR_AIR:** Multi-role fighters serve both offensive and defensive air missions
- **FLAVOR_FIGHTER:** Specialization in fighter aircraft enhances interception capabilities

### Competing Flavors

- **FLAVOR_OFFENSE:** Offensive unit production competes with AA for resources
- **FLAVOR_AIR/BOMBER:** Offensive air doctrine (bombers) competes with defensive doctrine (interceptors)
- **FLAVOR_MOBILE:** Fast attack units compete with defensive AA units for production priority
- **FLAVOR_NAVAL:** Naval investment competes with land-based AA development

### Synergistic Interactions

Leaders with **high FLAVOR_ANTIAIR + high FLAVOR_AIR** create balanced air doctrines:

- Build both fighters (dual offensive/defensive role) and dedicated AA units
- Prioritize airports and military bases for air operations
- Maintain air superiority while protecting ground forces
- Research aviation technologies aggressively

Leaders with **high FLAVOR_ANTIAIR + low FLAVOR_AIR** create pure defensive air doctrines:

- Focus on ground-based AA units (SAMs, AA guns) over fighters
- Build minimal offensive air power
- Protect ground and naval forces from enemy air attacks
- Research AA technologies but delay offensive aviation

### Economic Factors

Anti-aircraft defense competes with economic development:

- **FLAVOR_GOLD:** Economic health determines if AA forces can be afforded
- **FLAVOR_PRODUCTION:** Industrial capacity constrains how quickly AA networks can be built
- **FLAVOR_SCIENCE:** Technology research speed determines when AA units become available

Leaders with high FLAVOR_ANTIAIR but weak economies face critical vulnerabilities - they recognize air defense needs but cannot afford sufficient forces, leaving them vulnerable to enemy bombing campaigns during economic crises.

## Unique Characteristics

### Conditional Activation

Unlike most military flavors, FLAVOR_ANTIAIR is **conditionally dormant**:

- Completely inactive when no enemies have air forces
- Rapidly activates when air threats are detected
- Creates sudden shifts in production priorities mid-game
- Can deactivate if all enemy air forces are destroyed

### Proportional Scaling

FLAVOR_ANTIAIR uses **relative ratios** rather than absolute numbers:

- Small empires need fewer AA units
- Large empires need proportionally more AA units
- Ratio maintained as army size grows or shrinks
- Prevents both over-investment and under-protection

### Binary Strategy States

The flavor operates through binary strategy activation:

- NEED_ANTIAIR: Build AA units urgently
- ENOUGH_ANTIAIR: Stop building AA units
- No middle ground or gradual scaling
- Creates clear, decisive AI behavior shifts

This binary approach prevents the AI from perpetually building AA units and ensures resources are redirected once defensive needs are met.
