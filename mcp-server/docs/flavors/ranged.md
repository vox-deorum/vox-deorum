# FLAVOR_RANGED

## Overview

FLAVOR_RANGED is an AI personality flavor in Civilization V that controls the AI's preference for ranged combat units and ranged combat tactics. This flavor influences decisions across multiple AI subsystems including unit production, military strategy, technology research, building construction, and unit promotion selection.

The flavor value typically ranges from 1-20 for individual leaders, with the AI dynamically adjusting this value based on strategic circumstances through various military and economic strategies.

## Core Functionality

### Unit Composition Strategy

FLAVOR_RANGED directly determines the desired ratio of ranged units to total military forces:

- **Target Ratio**: The AI aims for a ranged unit ratio equal to `FLAVOR_RANGED * 10%` of total military units
- **"Need Ranged" Strategy**: Triggered when ranged ratio falls below `FLAVOR_RANGED / 2 * 10%`
- **"Enough Ranged" Strategy**: Triggered when ranged ratio reaches or exceeds `FLAVOR_RANGED * 10%`

For example, a leader with FLAVOR_RANGED = 8 will:

- Target 80% ranged units in their army composition
- Need more ranged units if ratio drops below 40%
- Stop prioritizing ranged units at 80%+

### Unit Promotion Selection

FLAVOR_RANGED significantly influences AI promotion choices for both ranged and melee units. The flavor value (clamped to 1-20) is used in weighted calculations for:

- **Range bonuses**: Value scales with `3 * iFlavorRanged * 100 / currentRange`
- **Indirect Fire ability**: Value = `(iFlavorRanged * 2 + iFlavorOffense) * 20 * range`
- **Fortification attack bonuses**: For ranged units, value = `(bonus) * (2 * iFlavorRanged + iFlavorOffense) * 0.3`
- **Nearby enemy combat modifiers**: Value = `range * (iFlavorOffense + 2 * iFlavorRanged) * 20`
- **Anti-unhappiness modifiers**: Value = `bonus * (2 * iFlavorOffense + iFlavorRanged) / 6`

## Code References

### Military AI Strategy (CvMilitaryAI.cpp)

**Lines 3900-3906: Enough Ranged Units Strategy**

```cpp
bool MilitaryAIHelpers::IsTestStrategy_EnoughRangedUnits(CvPlayer* pPlayer, int iNumRanged, int iNumMelee)
{
    int iFlavorRange = pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_RANGED"));
    int iRatio = iNumRanged * 10 / max(1,iNumMelee+iNumRanged);
    return (iRatio >= iFlavorRange);
}
```

Determines when the player has sufficient ranged units. The ratio calculation converts unit counts to a percentage (0-10 scale), compared against the FLAVOR_RANGED value.

**Lines 3908-3922: Need Ranged Units Strategy**

```cpp
bool MilitaryAIHelpers::IsTestStrategy_NeedRangedUnits(CvPlayer* pPlayer, int iNumRanged, int iNumMelee)
{
    if(pPlayer->GetMilitaryAI()->IsBuildingArmy(ARMY_TYPE_LAND))
    {
        if (pPlayer->IsUnderrepresentedUnitType(UNITAI_RANGED) || pPlayer->IsUnderrepresentedUnitType(UNITAI_CITY_BOMBARD))
        {
            return true;
        }
    }

    int iFlavorRange = pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_RANGED"));
    int iRatio = iNumRanged * 10 / max(1,iNumMelee+iNumRanged);
    return (iRatio <= iFlavorRange / 2);
}
```

Triggers when ranged units fall below half the target ratio, or when building an army with underrepresented ranged unit types.

**Lines 3924-3929: Need Ranged for Early Sneak Attack**

```cpp
bool MilitaryAIHelpers::IsTestStrategy_NeedRangedDueToEarlySneakAttack(CvPlayer* pPlayer)
{
    MilitaryAIStrategyTypes eStrategyWarMob = (MilitaryAIStrategyTypes) GC.getInfoTypeForString("MILITARYAISTRATEGY_WAR_MOBILIZATION");
    return pPlayer->GetMilitaryAI()->IsUsingStrategy(eStrategyWarMob);
}
```

Ensures ranged units are produced during war mobilization for sneak attacks.

### Unit Promotion AI (CvUnit.cpp)

**Line 31664: Flavor Initialization**

```cpp
int iFlavorRanged = range(pFlavorMgr->GetPersonalityIndividualFlavor((FlavorTypes)GC.getInfoTypeForString("FLAVOR_RANGED")), 1, 20);
```

Retrieves the player's FLAVOR_RANGED value, clamped between 1-20, for use in promotion value calculations throughout the AI_PromotionValue function.

The flavor is then used extensively in promotion scoring calculations (see lines 31716, 32055, 32237, 32247, 33099) to weight ranged-focused promotions.

### Technology Research (CvTechClasses.cpp)

**Lines 1250-1269: Conquest Focus Bonus**

```cpp
if(bConquestFocus && (
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_OFFENSE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_MILITARY_TRAINING" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_MOBILE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_RANGED" ||
    // ... other military flavors
))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

When pursuing conquest grand strategy, technologies with FLAVOR_RANGED receive priority bonuses.

### Policy Selection (CvPolicyAI.cpp)

**Line 4916: Conquest Victory Scoring**

```cpp
if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_OFFENSE" || ... ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_RANGED" || ... )
{
    iConquestValue += iFlavorValue;
}
```

Policies with FLAVOR_RANGED contribute to conquest victory scoring, influencing policy tree selection for militaristic AIs.

### Grand Strategy AI (CvGrandStrategyAI.cpp)

**Lines 630-641: Policy Priority Bonuses**

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_RANGED")
{
    iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
}
```

Adds priority bonuses to policies that align with the player's ranged flavor preference.

### Advisor Recommendations (CvAdvisorRecommender.cpp)

**Lines 361-364: Unit Advisor Weighting**

```cpp
else if(strFlavorName == "FLAVOR_RANGED")
{
    return 13;
}
```

The advisor system assigns a weight of 13 to FLAVOR_RANGED when recommending units to the player, indicating high importance in unit selection recommendations.

## Strategic Influences

### Economic Strategies

**Losing Money (-300 to cities, -50 to player)** When the economy is struggling, FLAVOR_RANGED receives massive penalties to reduce expensive ranged unit production.

**Too Many Units (-100 to player, -300 to cities)** Reduces ranged unit production when the military is oversized relative to economy.

### Military Strategies

**Eradicate Barbarians Critical (+10)** Increases ranged preference when barbarians pose a serious threat, as ranged units are effective for defensive operations.

**War Mobilization (+60)** Major boost when preparing for war, ensuring adequate ranged support for offensive operations.

**At War (+30 player, +40 cities)** Sustained production of ranged units during active conflicts.

**Winning Wars (+40 player, +60 cities)** When winning, increases ranged production to press the advantage with superior firepower.

**Losing Wars (+20 player, +30 cities)** Moderate increase when losing, as ranged units provide defensive advantages.

## Unit Flavors

FLAVOR_RANGED is assigned to units across multiple categories:

### Foot Archers (FLAVOR_RANGED: 5-15)

- **Archer**: 5 (basic ranged unit)
- **Babylonian Bowman**: 7 (unique archer)
- **Composite Bowman**: 6
- **Mayan Atlatlist**: 9 (unique composite bowman)
- **Crossbowman**: 8
- **Chinese Chu-Ko-Nu**: 11 (unique crossbowman)
- **English Longbowman**: 12 (unique crossbowman)
- **Musketman**: 10
- **Ottoman Janissary**: 13 (unique musketman)
- **American Minuteman**: 13 (unique musketman)
- **Gatling Gun**: 12
- **Portuguese Cacador**: 15 (unique gatling gun)
- **Machine Gun**: 14
- **Bazooka**: 16

### Mounted Ranged Units (FLAVOR_RANGED: 2-13)

- **Chariot Archer**: 2
- **Egyptian War Chariot**: 5 (unique chariot archer)
- **Mongolian Keshik**: 4 (unique horse archer)
- **Hun Horse Archer**: 7
- **Arabian Camel Archer**: 9
- **Cavalry**: 10
- **Berber Cavalry**: 13 (unique cavalry)
- **Russian Cossack**: 13 (unique cavalry)

### Siege Units (FLAVOR_RANGED: 5-18)

- **Assyrian Siege Tower**: 5 (unique civilian siege unit)
- **Catapult**: 6
- **Roman Ballista**: 9 (unique catapult)
- **Trebuchet**: 8
- **Korean Hwacha**: 12 (unique trebuchet)
- **Cannon**: 10
- **Ottoman Great Bombard**: 12 (unique cannon)
- **Field Gun**: 12
- **French Licorne**: 15 (unique field gun)
- **Siamese Sua Mop**: 15 (unique field gun)
- **Artillery**: 14
- **German Krupp Gun**: 18 (unique artillery)
- **Rocket Artillery**: 16

### Modern Ranged Units (FLAVOR_RANGED: 12-16)

- **Anti-Tank Gun**: 12
- **Helicopter Gunship**: 14

## Technology Flavors

Technologies that unlock or enhance ranged units receive FLAVOR_RANGED:

### Ancient Era

- **Animal Husbandry** (5): Unlocks Chariot Archer, the first mounted ranged unit
- **Trapping** (10): Critical early ranged unit technology

### Classical Era

- **Mathematics** (10): Unlocks Skirmisher units
- **Construction** (10): Key ranged unit advancements
- **Currency** (10): Economic support for ranged armies

### Medieval Era

- **Physics** (20): Major boost - unlocks Trebuchet and Heavy Skirmisher
- **Machinery** (10): Unlocks Crossbowman
- **Gunpowder** (10): Introduces gunpowder ranged units

### Renaissance Era

- **Metallurgy** (20): Critical advancement for ranged warfare

### Industrial Era

- **Rifling** (10): Modern infantry with ranged capabilities
- **Dynamite** (10): Unlocks Gatling Gun
- **Military Science** (10): Cavalry and ranged tactics

### Modern Era

- **Ballistics** (30): Highest FLAVOR_RANGED value - unlocks Artillery and Machine Gun

### Atomic Era

- **Advanced Ballistics** (10): Late-game ranged improvements
- **Mobile Tactics** (20): Combined arms with strong ranged component

## Building Flavors

### Production Buildings

- **Siege Foundry** (20): Specialized building for siege unit production, strongly preferred by ranged-focused AIs

### Wonders

- **Temple of Artemis** (20): Ancient era wonder that provides ranged unit benefits, highly valued by ranged-focused civilizations

## Leader Flavor Values

Representative leader FLAVOR_RANGED values from the database:

- **Standard Leaders**: 7-8 (baseline ranged preference)
- **Unique Unit Bonus**: Leaders with ranged unique units receive +1 (e.g., Nebuchadnezzar, Pacal, Washington)

## AI Behavior Summary

### High FLAVOR_RANGED (12+)

- Maintains 80%+ ranged units in armies
- Aggressively pursues ranged unit technologies
- Highly values Siege Foundry and Temple of Artemis
- Prioritizes ranged unit promotions heavily
- Focuses on artillery and siege units in later eras

### Medium FLAVOR_RANGED (6-11)

- Balanced 40-70% ranged composition
- Researches ranged technologies at normal priority
- Considers ranged buildings based on situation
- Balanced promotion selection

### Low FLAVOR_RANGED (1-5)

- Minimal ranged units (10-30%)
- Deprioritizes ranged technologies unless required
- Rarely builds Siege Foundry
- Focuses promotions on melee capabilities

## Dynamic Adjustments

The effective FLAVOR_RANGED value changes dynamically based on:

1. **War Status**: +60 during war mobilization, +30-60 during active wars
2. **Economic Health**: -300 when losing money (cities), -100 when too many units
3. **Military Success**: +40-60 when winning wars, +20-30 when losing
4. **Barbarian Threat**: +10 during critical barbarian situations
5. **Grand Strategy**: Bonuses when pursuing conquest victory

These modifiers stack with the base personality flavor, creating adaptive AI behavior that responds to game circumstances while maintaining individual leader personalities.

## Related Flavors

FLAVOR_RANGED works in conjunction with other military flavors:

- **FLAVOR_OFFENSE**: Balanced with ranged for overall military aggression
- **FLAVOR_DEFENSE**: Ranged units provide defensive capabilities
- **FLAVOR_MOBILE**: Mobile ranged units combine both flavors
- **FLAVOR_ARCHER**: More specific subset focusing on foot archers (when AI_UNIT_PRODUCTION mod enabled)
- **FLAVOR_SIEGE**: More specific subset focusing on siege weapons (when AI_UNIT_PRODUCTION mod enabled)
- **FLAVOR_CITY_DEFENSE**: Ranged units excel at city defense

The AI considers all military flavors together when making strategic decisions, with FLAVOR_RANGED being one of the primary drivers of unit composition and tactical approach.
