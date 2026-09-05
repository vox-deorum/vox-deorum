# FLAVOR_MOBILE

## Overview

FLAVOR_MOBILE is an AI personality flavor in Civilization V that controls the AI's preference for fast-moving, mobile military units. This flavor significantly influences unit composition, military strategies, promotion choices, and technology/policy preferences related to mobility and maneuverability on the battlefield.

The flavor value is used to determine how much an AI player values cavalry units, tanks, and other fast-moving units over slower infantry and melee units. Higher FLAVOR_MOBILE values result in armies with more mounted units and armor, while lower values lead to more traditional infantry-focused armies.

## Core Functionality

### Military Unit Composition Strategy

FLAVOR_MOBILE is a primary factor in determining whether the AI needs more mobile units or has enough:

**Military AI Strategies** (`CvMilitaryAI.cpp:2070-2073`):

- `MILITARYAISTRATEGY_NEED_MOBILE`: Activated when mobile unit ratio is too low relative to FLAVOR_MOBILE
- `MILITARYAISTRATEGY_ENOUGH_MOBILE`: Activated when mobile unit ratio meets or exceeds FLAVOR_MOBILE threshold

**Mobile Unit Classification** (`CvMilitaryAI.cpp:1697-1698`): Units are classified as "mobile" if they belong to these combat types:

- `UNITCOMBAT_MOUNTED`: Cavalry, horsemen, lancers, etc.
- `UNITCOMBAT_ARMOR`: Tanks, mechanized infantry, modern armor

### Strategy Evaluation Logic

**IsTestStrategy_EnoughMobileUnits** (`CvMilitaryAI.cpp:3932-3945`):

```
iFlavorMobile = player's FLAVOR_MOBILE value (from personality + grand strategy)

Without MOD_AI_UNIT_PRODUCTION:
  iRatio = (mobile units * 10) / (melee + mobile units)
  Strategy active if: iRatio >= iFlavorMobile

With MOD_AI_UNIT_PRODUCTION:
  iRatio = (mobile units * 10) / melee units
  Strategy active if: iRatio >= iFlavorMobile
```

**IsTestStrategy_NeedMobileUnits** (`CvMilitaryAI.cpp:3948-3961`):

```
iFlavorMobile = player's FLAVOR_MOBILE value

Without MOD_AI_UNIT_PRODUCTION:
  iRatio = (mobile units * 10) / (melee + mobile units)
  Strategy active if: iRatio <= iFlavorMobile / 2

With MOD_AI_UNIT_PRODUCTION:
  iRatio = (mobile units * 10) / melee units
  Strategy active if: iRatio <= iFlavorMobile / 2
```

This means an AI with FLAVOR_MOBILE of 10 will:

- Activate "Need Mobile" if mobile units are less than 5% of the ratio
- Activate "Enough Mobile" if mobile units reach 10% of the ratio

## Unit Promotion Preferences

FLAVOR_MOBILE heavily influences AI promotion choices for units. The flavor value (ranged 1-20) is used as a multiplier in calculating promotion value scores:

### High Priority Promotions (2x FLAVOR_MOBILE weight)

**Withdrawal Bonuses** (`CvUnit.cpp:32097`):

- Formula: `(2 * iFlavorMobile + iFlavorDefense)`
- Affects: Scout withdrawal, naval piracy, submarine wolfpack tactics
- Purpose: Allows units to escape combat, preserving mobile forces

**Movement Speed** (`CvUnit.cpp:32456`):

- Formula: `(2 * iFlavorMobile + iFlavorNavalRecon)`
- Affects: Mobility promotions, scouting speed, naval navigation
- Purpose: Increases tactical flexibility and map coverage

**Always Heal (March)** (`CvUnit.cpp:32399`):

- Formula: `(iFlavorOffense + 2 * iFlavorMobile)`
- Affects: March promotion for melee/mounted, Air Repair, Survivalism
- Purpose: Keeps mobile units operational without returning to cities

**Ignore Zone of Control** (`CvUnit.cpp:32301`):

- Formula: `(2 * iFlavorMobile + iFlavorOffense)`
- Affects: Trailblazer, Pincer, Skirmisher Doctrine
- Purpose: Allows rapid repositioning without enemy interference

**Can Move After Attacking** (`CvUnit.cpp:32322`):

- Formula: `(2 * iFlavorMobile + iFlavorOffense)`
- Affects: Blitz promotion for melee/mounted units
- Purpose: Enables hit-and-run tactics and deep strikes

**Cargo Capacity** (`CvUnit.cpp:32507`):

- Formula: `(2 * iFlavorMobile + iFlavorOffense)`
- Affects: Flight Deck promotions for carriers
- Purpose: Increases air power projection capability

**Terrain Movement** (`CvUnit.cpp:32655-32687`):

- Formula: `(2 * iFlavorMobile + iFlavorRecon)`
- Affects: Terrain double move, ignore terrain cost, hill/woodland navigation
- Purpose: Eliminates movement penalties in difficult terrain

### Standard Priority Promotions (1x FLAVOR_MOBILE weight)

**Open Terrain Bonuses** (`CvUnit.cpp:31839, 31854`):

- Formula: `(iFlavorOffense + iFlavorDefense + iFlavorMobile)`
- Affects: Charge promotion, Field promotion, open ranged attacks
- Bonus: Doubled for mounted units
- Purpose: Enhances performance in plains and open ground

**Wounded Target Bonuses** (`CvUnit.cpp:31966`):

- Formula: `(iFlavorOffense + iFlavorDefense + iFlavorMobile)`
- Affects: Charge, Infiltrators for mounted units
- Bonus: 1.6x multiplier for mounted units
- Purpose: Increases effectiveness at finishing off damaged enemies

**Flanking Attack** (`CvUnit.cpp:32016`):

- Formula: `(iFlavorDefense + iFlavorOffense + iFlavorMobile)`
- Scaling: Multiplied by unit's base movement points
- Affects: Shock, Overrun, Buffalo Horns promotions
- Purpose: Rewards positioning and maneuver warfare

**Extra Flank Power** (`CvUnit.cpp:32029`):

- Formula: `(iFlavorOffense + iFlavorMobile + iFlavorRecon)`
- Scaling: Multiplied by movement and existing flank bonuses
- Affects: Screening promotion for reconnaissance units
- Purpose: Amplifies flanking tactics

**Ranged Flank Attack** (`CvUnit.cpp:32040`):

- Formula: `(iFlavorOffense + iFlavorMobile)`
- Bonus: 5x multiplier if unit can move after attacking or has range > 1
- Affects: Envelopment for mounted ranged units (skirmishers)
- Purpose: Enables mobile ranged flanking tactics

**Area Damage on Kill** (`CvUnit.cpp:32086`):

- Formula: `(2 * iFlavorOffense + iFlavorMobile)`
- Affects: Shock 4, Breacher promotions
- Purpose: Rewards aggressive mobile units breaking through lines

**Outside Friendly Lands** (`CvUnit.cpp:31920`):

- Formula: `(iFlavorMobile + 2 * iFlavorOffense)`
- Bonus: 1.5x during wartime
- Affects: Trailblazer 3, Infiltrators
- Purpose: Supports deep penetration raids

**No Adjacent Unit Bonus** (`CvUnit.cpp:31994`):

- Formula: `(iFlavorMobile + 2 * iFlavorOffense)`
- Scaling: Multiplied by unit movement
- Affects: Infiltrators for ranged units
- Purpose: Benefits isolated, fast-moving units

**Free Pillage Moves** (`CvUnit.cpp:32425`):

- Formula: `(iFlavorOffense + 2 * iFlavorMobile)`
- Bonus: 2x during wartime
- Affects: Press Gangs for naval melee
- Purpose: Enables economic warfare while maintaining mobility

**Heal on Pillage** (`CvUnit.cpp:32437`):

- Formula: `(2 * iFlavorOffense + iFlavorMobile)`
- Bonus: 2x during wartime
- Affects: Press Gangs for naval melee
- Purpose: Sustains raiding operations

**River Crossing** (`CvUnit.cpp:32479`):

- Formula: `(2 * iFlavorMobile + iFlavorOffense)`
- Affects: Amphibious promotion variants
- Purpose: Removes river crossing penalties

**Terrain Half Move Penalty** (`CvUnit.cpp:32687`):

- Formula: `(3 * iFlavorMobile)` with negative value
- Purpose: AI avoids promotions that reduce mobility

## Grand Strategy and Policy

**Conquest Victory Focus** (`CvGrandStrategyAI.cpp:622-625`): FLAVOR_MOBILE is considered a conquest-oriented military flavor. When evaluating policies for conquest grand strategy, policies with FLAVOR_MOBILE bonuses receive priority increases.

**Policy Valuation** (`CvPolicyAI.cpp:4916`): FLAVOR_MOBILE is grouped with core military flavors (OFFENSE, DEFENSE, CITY_DEFENSE, MILITARY_TRAINING, RANGED, ARCHER, SIEGE, SKIRMISHER) when calculating the conquest value of policies. This means policies granting mobility bonuses are valued more highly by militaristic AIs.

## Technology Research

**Conquest-Focused Tech Research** (`CvTechClasses.cpp:1254`): Technologies with FLAVOR_MOBILE bonuses receive increased priority when the AI is pursuing conquest-focused grand strategies. This is grouped with other military flavors (OFFENSE, MILITARY_TRAINING, RANGED, DEFENSE, AIR) to identify military-critical technologies.

Technologies likely to have FLAVOR_MOBILE include:

- Horseback Riding (cavalry)
- Chivalry (knights)
- Military Science (cavalry corps)
- Combustion (tanks)
- Combined Arms (modern armor)
- Mobile Tactics (mechanized infantry)

## Advisor Recommendations

**Flavor Priority Index** (`CvAdvisorRecommender.cpp:365-368`): FLAVOR_MOBILE has a priority index of 7 in the advisor recommendation system. This moderate-high priority means mobile unit recommendations will be suggested fairly frequently, though less than core flavors like OFFENSE (1) or RANGED (13).

## Impact on AI Behavior

### Army Composition

- **High FLAVOR_MOBILE (8-10)**: Army will be 40-50% cavalry/armor, highly mobile strike forces
- **Medium FLAVOR_MOBILE (4-7)**: Balanced mix of mobile and infantry units (20-35% mobile)
- **Low FLAVOR_MOBILE (1-3)**: Infantry-focused armies with minimal cavalry (5-15% mobile)

### Tactical Implications

- High mobility AIs prefer:
  - Flanking maneuvers and envelopment tactics
  - Hit-and-run raids on enemy territory
  - Rapid redeployment between fronts
  - Pillaging and economic disruption
  - Exploiting open terrain advantages

- Low mobility AIs prefer:
  - Defensive formations and fortified positions
  - Slower, methodical advances
  - City siege warfare
  - Holding strategic positions

### Promotion Patterns

Mobile-focused AIs will heavily favor:

1. Movement speed increases (+1 movement)
2. Withdrawal chance bonuses
3. Ignore ZOC abilities
4. March/Always Heal for sustained operations
5. Flanking attack bonuses
6. Open terrain combat bonuses
7. River crossing abilities

### Technology and Policy Priorities

Mobile-focused AIs will:

- Research cavalry and armor technologies earlier
- Value policies improving unit movement and positioning
- Prioritize upgrades for mounted units
- Focus on doctrines enabling rapid warfare

## Related Flavors

FLAVOR_MOBILE often works in conjunction with:

- **FLAVOR_OFFENSE**: Combined for aggressive mobile warfare (blitzkrieg tactics)
- **FLAVOR_RECON**: Combined for scouting and fast reconnaissance forces
- **FLAVOR_NAVAL_RECON**: Combined for naval exploration and rapid sea control
- **FLAVOR_DEFENSE**: Balanced to determine offensive vs defensive mobile tactics

## Statistical Tracking

The game tracks mobile unit counts separately (`m_iNumMobileLandUnits` in `CvMilitaryAI.h:337`) and includes this data in military CSV logs for analysis and balancing.

## Implementation Notes

- FLAVOR_MOBILE values are typically ranged between 1-20 for calculations
- The flavor is retrieved via: `GC.getInfoTypeForString("FLAVOR_MOBILE")`
- Values are combined from leader personality base flavors and grand strategy modifiers
- The flavor affects hundreds of individual calculations throughout the AI decision-making process
- Mobile units specifically exclude immobile units (DOMAIN_IMMOBILE) and dead units from consideration
