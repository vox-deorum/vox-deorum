# FLAVOR_AIR

## Overview

`FLAVOR_AIR` is an AI personality flavor that controls how strongly a civilization's leader prioritizes air power and aviation capabilities. This flavor shapes the AI's approach to building and deploying air units (fighters, bombers, and related support structures), influencing everything from technology research priorities to unit production and military strategy.

Unlike land-based military flavors (FLAVOR_OFFENSE, FLAVOR_MOBILE) or naval flavors (FLAVOR_NAVAL), `FLAVOR_AIR` specifically drives the AI's **investment in and utilization of air superiority, air support, and strategic bombing** as part of their overall military doctrine.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Air power specialists: 7-8
  - Balanced modern warfare leaders: 5-6
  - Traditional military leaders: 4-5
  - Ground/naval focused leaders: 0-3

### Related Flavors

- **FLAVOR_AIR_CARRIER:** Naval aviation and carrier operations
- **FLAVOR_AIRLIFT:** Air mobility and rapid deployment
- **FLAVOR_BOMBER:** Strategic bombing preference
- **FLAVOR_FIGHTER:** Air superiority and interception
- **FLAVOR_ANTIAIR:** Anti-aircraft defense

## Code References

### 1. Military Advisor Recommendation Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (line 377)

**Function:** Advisor flavor weighting for military recommendations

When the Military Advisor evaluates recommendations, FLAVOR_AIR receives high priority among military flavors.

```cpp
case ADVISOR_MILITARY:
    else if(strFlavorName == "FLAVOR_AIR")
    {
        return 17;  // High priority for military advisor
    }
```

**Interpretation:** FLAVOR_AIR scores 17 in the military advisor priority system, equal to FLAVOR_OFFENSE. This makes air power a top-tier consideration when the military advisor suggests actions, placing aviation on par with ground offensive capabilities in terms of strategic importance.

### 2. Economic Advisor Recommendation Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (line 485)

**Function:** Advisor flavor weighting for economic recommendations

The Economic Advisor also considers air power when making recommendations.

```cpp
case ADVISOR_ECONOMIC:
    else if(strFlavorName == "FLAVOR_AIR")
    {
        return 7;  // Moderate priority for economic advisor
    }
```

**Interpretation:** FLAVOR_AIR receives a moderate weight of 7 in economic recommendations, reflecting the economic investment required for air infrastructure (airports, military bases) and the maintenance costs of air units. This ensures that economically-focused recommendations still consider air power infrastructure needs.

### 3. Military Strategy - Air Unit Force Composition (CvMilitaryAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (lines 3964-3968)

**Function:** `MilitaryAIHelpers::IsTestStrategy_EnoughAirUnits()`

FLAVOR_AIR determines the optimal ratio of air units to ground units in the military force composition.

```cpp
bool MilitaryAIHelpers::IsTestStrategy_EnoughAirUnits(CvPlayer* pPlayer, int iNumAir, int iNumMelee)
{
    int iFlavorAir = pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_AIR"));
    int iRatio = iNumAir * 10 / max(1,iNumMelee+iNumAir);
    return (iRatio >= iFlavorAir);
}
```

**Interpretation:** The target air unit ratio is directly equal to FLAVOR_AIR as a percentage:

- **FLAVOR_AIR = 5:** Target 5% of military forces as air units (5 air units per 95 ground units)
- **FLAVOR_AIR = 7:** Target 7% air units
- **FLAVOR_AIR = 10:** Target 10% air units (1 air unit per 9 ground units)

This strategy returns true when the player has reached their target air force size, signaling the AI to stop prioritizing air unit production and focus on other needs.

### 4. Military Strategy - Need for Air Units (CvMilitaryAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (lines 3972-3977)

**Function:** `MilitaryAIHelpers::IsTestStrategy_NeedAirUnits()`

Determines when the AI critically needs to build more air units.

```cpp
bool MilitaryAIHelpers::IsTestStrategy_NeedAirUnits(CvPlayer* pPlayer, int iNumAir, int iNumMelee)
{
    int iFlavorAir = pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_AIR"));
    int iRatio = iNumAir * 10 / max(1,iNumMelee+iNumAir);
    return (iRatio <= iFlavorAir / 2);
}
```

**Interpretation:** The "NEED_AIR" strategy triggers when air units fall below half the target ratio:

- **FLAVOR_AIR = 8, Target = 8%:** Triggers when air units drop below 4% of total forces
- **FLAVOR_AIR = 6, Target = 6%:** Triggers when air units drop below 3%

This creates an urgency threshold that activates the MILITARYAISTRATEGY_NEED_AIR strategy, significantly boosting air unit production priorities until the minimum acceptable force composition is restored.

### 5. Unit Promotion Selection - Air Unit AI (CvUnit.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvUnit.cpp` (line 31669)

**Function:** Unit promotion valuation for air units

FLAVOR_AIR influences which promotions air units prioritize when leveling up.

```cpp
int iFlavorAir = range(pFlavorMgr->GetPersonalityIndividualFlavor((FlavorTypes)GC.getInfoTypeForString("FLAVOR_AIR")), 1, 20);
```

**Interpretation:** The flavor value is clamped between 1-20 for promotion calculations. Higher FLAVOR_AIR makes the AI value air-specific promotions more highly:

- Air Repair promotions (faster healing)
- Range extensions (larger operational radius)
- Evasion bonuses (survival against anti-air)
- Air Sweep bonuses (clearing enemy interceptors)

This ensures that leaders who invest in air power also develop their air units' capabilities through appropriate promotion choices.

### 6. Grand Strategy Priority - Policy Flavor Bonus (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 642-645)

**Function:** Grand strategy priority based on adopted policies

Policies with FLAVOR_AIR values influence grand strategy selection toward air-power-focused strategies.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_AIR")
{
    iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
}
```

**Interpretation:** Policies that grant aviation bonuses (like "Exploration" +25, "Militarism" +60) add their FLAVOR_AIR values to the grand strategy priority. This creates strategic coherence where adopting air-power-focused policies makes the AI more committed to air-centric military strategies.

### 7. Policy Evaluation - Conquest Value (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (line 4920)

**Function:** Policy valuation for conquest-focused gameplay

FLAVOR_AIR contributes to valuing policies that support military conquest.

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

**Interpretation:** FLAVOR_AIR is grouped with all aviation-related flavors when calculating a policy's value for conquest victory. Leaders with high air power preferences will highly value policies that boost aviation capabilities, recognizing air superiority as critical for successful military campaigns.

### 8. Technology Priority - Conquest Focus (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (line 1257)

**Function:** Technology research priority for conquest-focused civilizations

When pursuing conquest victory, FLAVOR_AIR increases the research priority of aviation technologies.

```cpp
if(bConquestFocus && (
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_OFFENSE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_MILITARY_TRAINING" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_MOBILE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_RANGED" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_DEFENSE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_AIR" ||
    // ...other military flavors
))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

**Interpretation:** When the AI is focused on conquest victory, technologies with FLAVOR_AIR values receive priority bonuses. This accelerates research of aviation technologies (Flight, Radar, Rocketry, Stealth) when the AI commits to military dominance, ensuring air power is available when needed for offensive campaigns.

## Database References

### Air Unit Flavor Values

Air units have varying FLAVOR_AIR values that indicate how strongly they appeal to air-power-focused leaders:

**Bombers (Strategic Bombing Role):**

- WWI Bomber: 14
- Heavy Bomber: 18
- American B17 (unique): 25
- Stealth Bomber: 24

**Fighters (Air Superiority Role):**

- Triplane: 10
- SPAD (unique): 15
- Fighter: 14
- Japanese Zero (unique): 19
- Jet Fighter: 18

**Interpretation:** Unique air units have higher FLAVOR_AIR values, making air-focused leaders more likely to prioritize civs with unique aviation units. Strategic bombers generally have higher values than fighters, reflecting their game-changing impact on warfare.

### Technology Flavor Values

Technologies that unlock or enhance air power have FLAVOR_AIR values:

- **Flight (Triplane, Paratrooper, WWI Bomber):** 25
- **Radar (Fighter, Heavy Bomber):** 25
- **Rocketry (Rocket Missile, Airport):** 20
- **Stealth (Stealth Bomber):** 15
- **Lasers:** 15
- **Robotics:** 10
- **Advanced Ballistics:** 10
- **Computers (Carrier):** 10 (FLAVOR_AIR_CARRIER)

**Interpretation:** Early aviation technologies (Flight, Radar) have the highest FLAVOR_AIR values (25), making them high priority for air-focused leaders. Later refinements (Stealth, Lasers) have lower values as they represent incremental improvements rather than foundational capabilities.

### Building Flavor Values

Buildings that support air operations have FLAVOR_AIR values:

- **Airport:** 30 (also FLAVOR_AIRLIFT: 30, FLAVOR_ANTIAIR: 30)
- **Military Base:** 30 (also FLAVOR_ANTIAIR: 30)
- **Pentagon (Wonder):** 100

**Interpretation:** Air infrastructure receives very high flavor values, ensuring air-focused leaders build airports and military bases in their cities. The Pentagon's value of 100 makes it an extremely high priority for aviation-focused civilizations, reflecting its dramatic impact on air unit experience and air unit capacity.

### Policy Flavor Values

Social policies that enhance air power operations:

- **Exploration:** 25 (naval/air expansion focus)
- **Militarism:** 60 (modern warfare doctrine)

**Interpretation:** Militarism has an extremely high FLAVOR_AIR value (60), making it a top-priority policy for air-power leaders. This reflects the policy's bonuses to air unit production and combat effectiveness, making it synergistic with aviation-focused strategies.

### Military Strategy Modifiers

FLAVOR_AIR receives dynamic modifications based on the current military situation:

**Economic Pressures (Negative Modifiers):**

- ECONOMICAISTRATEGY_TOO_MANY_UNITS: -300
- ECONOMICAISTRATEGY_LOSING_MONEY: -300

**Defensive Situations (Positive Modifiers):**

- MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL: +60 (AI Strategy)
- MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL: +50 (Player Strategy)

**Offensive Situations (Positive Modifiers):**

- MILITARYAISTRATEGY_AT_WAR: +40 (AI Strategy), +40 (Player Strategy)
- MILITARYAISTRATEGY_WINNING_WARS: +40 (AI Strategy), +50 (Player Strategy)
- MILITARYAISTRATEGY_LOSING_WARS: +30 (AI Strategy), +30 (Player Strategy)

**Direct Air Needs:**

- MILITARYAISTRATEGY_NEED_AIR: +50

**Interpretation:**

1. **Economic constraints severely penalize air power** (-300), as air units are expensive to build and maintain
2. **Critical defense situations strongly boost air power** (+50-60), recognizing air superiority as vital for homeland defense
3. **All war situations increase air power priority** (+30-50), with winning wars getting slightly higher boosts as the AI leverages air superiority for offensive operations
4. **The NEED_AIR strategy provides a massive +50 boost**, creating a feedback loop that rapidly builds air forces when below minimum thresholds

## Summary of Effects

### Strategic Planning

- **Technology research:** Prioritizes Flight, Radar, Rocketry, and Stealth technologies when focused on conquest
- **Grand strategy:** Air-focused policies and buildings reinforce commitment to air-power-based military strategies
- **Force composition:** Maintains a target percentage of air units relative to ground forces (directly tied to FLAVOR_AIR value)

### Military Production

- **Unit production:** Higher priority for building fighters, bombers, and helicopters
- **Infrastructure:** Prioritizes airports and military bases to support air operations
- **Balance:** Creates dynamic adjustments based on economic situation and military needs

### Tactical Capabilities

- **Air superiority:** Enables tactical bombing, city bombardment, and anti-armor operations
- **Unit development:** Selects promotions that enhance air unit effectiveness and survivability
- **Combined arms:** Integrates air power with ground and naval forces for coordinated operations

### Situational Response

- **Economic crisis:** Dramatically reduces air unit priority due to high costs
- **Defensive crisis:** Massively increases air power investment for homeland defense
- **Offensive operations:** Moderate boost to air power for supporting ground campaigns

## Design Philosophy

FLAVOR_AIR represents a civilization's doctrine regarding modern air warfare:

1. **Force Structure:** What percentage of military forces should be aircraft
2. **Infrastructure Investment:** How much to invest in air bases and support facilities
3. **Technology Priority:** How aggressively to research aviation technologies
4. **Operational Doctrine:** How to integrate air power with ground and naval forces

This creates distinct air power doctrines:

- **High AIR (7-8):** Aviation specialists who build large air forces and prioritize air superiority
- **Moderate AIR (5-6):** Balanced modern militaries that include air power as one component
- **Low AIR (3-4):** Traditional militaries that rely primarily on ground and naval forces
- **Minimal AIR (0-2):** Leaders who largely ignore aviation, focusing on classical warfare

### Historical Context

FLAVOR_AIR becomes increasingly important in the Industrial and Modern eras when aviation technologies become available. Leaders with high FLAVOR_AIR will:

- Rush to research Flight and Radar
- Build airports in major cities
- Maintain standing air forces even during peacetime
- Use air power as a primary tool of warfare

Leaders with low FLAVOR_AIR will:

- Delay aviation technologies
- Build minimal air infrastructure
- Produce air units only when critically needed
- Rely on ground and naval forces as primary military tools

## Related Flavors and Interactions

### Complementary Flavors

- **FLAVOR_OFFENSE:** Air power supports offensive operations through bombing and close air support
- **FLAVOR_AIR_CARRIER:** Naval aviation extends air power projection across oceans
- **FLAVOR_BOMBER:** Specialization in strategic bombing and city bombardment
- **FLAVOR_FIGHTER:** Specialization in air superiority and interceptor roles

### Competing Flavors

- **FLAVOR_DEFENSE:** Ground-based defensive forces compete with air power for production priority
- **FLAVOR_NAVAL:** Naval investment competes with air force development for resources
- **FLAVOR_ANTIAIR:** Defensive air doctrine (interceptors) vs offensive doctrine (bombers)

### Economic Factors

Air power is expensive in both production and maintenance. FLAVOR_AIR must compete with:

- **FLAVOR_GOLD:** Economic health limits air force size
- **FLAVOR_PRODUCTION:** Industrial capacity constrains how quickly air forces can be built
- **FLAVOR_SCIENCE:** Technology research speed determines when aviation becomes available

Leaders with high FLAVOR_AIR but weak economies will struggle to maintain large air forces, creating interesting strategic tensions where air power doctrine conflicts with economic reality.
