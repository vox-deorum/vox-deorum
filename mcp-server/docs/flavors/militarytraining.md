# FLAVOR_MILITARY_TRAINING

## Overview

`FLAVOR_MILITARY_TRAINING` is an AI personality flavor that controls how much a civilization prioritizes building and maintaining a well-trained, experienced military force. This flavor affects the AI's interest in constructing military training facilities (barracks, armories, military academies), prioritizing unit upgrades, and adopting policies and technologies that enhance unit effectiveness.

Unlike offensive or defensive flavors that focus on unit production or combat strategy, `FLAVOR_MILITARY_TRAINING` specifically emphasizes the **quality and readiness** of military forces through infrastructure investment and unit experience systems.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Aggressive Conquerors: 8-10 (heavy investment in military quality)
  - Balanced Military Leaders: 5-7 (moderate military infrastructure)
  - Peaceful/Diplomatic Leaders: 3-5 (basic military readiness)
  - Barbarians: 4 (moderate training priority)

### Notable Leader Values

Based on the database changes, certain leaders have distinctive FLAVOR_MILITARY_TRAINING values:

- **Genghis Khan:** 10 (maximum military training priority)
- **Shaka:** 10 (maximum due to Ikanda unique building)
- **Oda Nobunaga:** 10 (maximum due to Dojo unique building)
- **Montezuma:** 9 (very high military training focus)
- **Napoleon:** 9 (very high military training focus)
- **Alexander:** 8 (high military training emphasis)
- **Bismarck:** 8 (Unit Gifter personality but still trains well)
- **Elizabeth:** 8 (strong military training for domination)
- **Catherine:** 7 (domination-oriented leader)
- **Isabella:** 6 (moderate domination focus)
- **Maria I:** 6 (benefits from Great General/Admiral bonuses)
- **Wu Zetian:** 6 (secondary domination focus)
- **Suleiman:** 6 (secondary domination focus)
- **Theodora:** 5 (generalist approach)
- **William:** 5 (can benefit from aggressive unique units)

## Code References

### 1. Military Advisor Recommendation Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (line 353-356)

**Function:** Advisor recommendation weight calculation

When the Military Advisor evaluates recommendations (buildings, units, technologies), FLAVOR_MILITARY_TRAINING contributes to the priority weighting.

```cpp
else if(strFlavorName == "FLAVOR_MILITARY_TRAINING")
{
    return 7;
}
```

**Interpretation:** FLAVOR_MILITARY_TRAINING receives a weight of 7 out of the various military flavors considered by the advisor system. This places it at moderate-high importance for military recommendations, equal to FLAVOR_MOBILE and below FLAVOR_OFFENSE (17) and FLAVOR_DEFENSE (16).

**Impact:** Buildings and technologies with FLAVOR_MILITARY_TRAINING values will be recommended by the Military Advisor with moderate-high priority, encouraging the player to invest in military training infrastructure.

### 2. Conquest Grand Strategy Policy Evaluation (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 626-629)

**Function:** `CvGrandStrategyAI::GetConquestPriority()` - Policy priority bonus for conquest strategy

When evaluating which policies to pursue while following a Conquest grand strategy, the AI adds priority bonuses based on military-related flavors.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_MILITARY_TRAINING")
{
    iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
}
```

**Interpretation:** Policies with FLAVOR_MILITARY_TRAINING values (such as Honor opener, Military Tradition, Elite Forces) receive priority bonuses when the AI is pursuing conquest victory. Each point of FLAVOR_MILITARY_TRAINING in the policy adds directly to its priority score.

**Impact:** Leaders with high FLAVOR_MILITARY_TRAINING will more strongly favor military training-focused policies when pursuing conquest, creating synergy between personality, grand strategy, and policy choices.

### 3. Conquest Grand Strategy Building Evaluation (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 711-714)

**Function:** `CvGrandStrategyAI::GetConquestPriority()` - Building priority bonus for conquest strategy

When calculating conquest priority, the AI examines existing buildings in all cities and adds bonuses based on their military training values.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_MILITARY_TRAINING")
{
    iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop);
}
```

**Interpretation:** Each building with FLAVOR_MILITARY_TRAINING (barracks, armories, military academies, etc.) in the player's empire increases the priority of the Conquest grand strategy. The AI recognizes that existing military infrastructure makes conquest more viable.

**Impact:** As players build more training facilities, the AI becomes more confident in pursuing conquest, creating a positive feedback loop where military infrastructure investment reinforces aggressive grand strategy.

### 4. Unit Upgrade Gold Priority (CvHomelandAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvHomelandAI.cpp` (lines 1862-1872)

**Function:** `CvHomelandAI::ExecuteUpgradeMoves()` - Unit upgrade financial priority calculation

When units need upgrading but lack sufficient gold, the AI determines how much to prioritize saving gold for upgrades.

```cpp
if(GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_MILITARY_TRAINING")
{
    iCurrentFlavorMilitaryTraining = m_pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor((FlavorTypes)iFlavorLoop);
}
if(m_pPlayer->IsAtWar())
{
    iCurrentFlavorMilitaryTraining *= 50;
}
```

**Gold Priority Calculation:**

```cpp
iGoldPriority = AI_GOLD_PRIORITY_UPGRADE_BASE + (iCurrentFlavorMilitaryTraining * AI_GOLD_PRIORITY_UPGRADE_PER_FLAVOR_POINT);
```

**Interpretation:**

- Base gold priority for upgrades: 500
- Each point of FLAVOR_MILITARY_TRAINING adds 100 to the priority
- **During wartime, FLAVOR_MILITARY_TRAINING is multiplied by 50**, making upgrades extremely high priority
- Example: Leader with FLAVOR_MILITARY_TRAINING = 8 at peace → priority = 500 + (8 × 100) = 1300
- Example: Same leader at war → priority = 500 + (400 × 100) = 40,500 (critical priority)

**Impact:** Leaders with high FLAVOR_MILITARY_TRAINING will aggressively save gold for unit upgrades, especially during warfare. This ensures their military remains technologically competitive. The dramatic multiplier during war means these leaders will sacrifice economic development to maintain cutting-edge military forces.

### 5. Policy Victory Strategy Categorization (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (line 4916-4919)

**Function:** `CvPolicyAI::WeighPolicy()` - Policy flavor to victory condition mapping

When evaluating policies, the AI categorizes flavor types to determine which victory conditions the policy supports.

```cpp
if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_OFFENSE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_DEFENSE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_CITY_DEFENSE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_MILITARY_TRAINING" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_MOBILE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_RANGED" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_ARCHER" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SIEGE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SKIRMISHER")
{
    iConquestValue += iFlavorValue;
}
```

**Interpretation:** FLAVOR_MILITARY_TRAINING is classified as a conquest-supporting flavor. Policies with this flavor contribute to the policy's perceived value for pursuing domination victory.

**Impact:** Leaders with high personal FLAVOR_MILITARY_TRAINING values will rate military training policies as more valuable, creating alignment between personality and grand strategy preferences. This reinforces conquest-oriented policy trees like Honor and Autocracy.

### 6. Technology Priority for Conquest Victory (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (lines 1253)

**Function:** Grand Strategy technology prioritization

When the AI is focusing on conquest victory, it evaluates technologies and increases priority for those with military-related flavors.

```cpp
if(bConquestFocus && (
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_OFFENSE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_MILITARY_TRAINING" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_MOBILE" ||
    // ... other military flavors
    ))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

**Interpretation:** When pursuing conquest, technologies with FLAVOR_MILITARY_TRAINING receive bonus priority. This includes technologies that unlock military training buildings or unit experience mechanics.

**Impact:** AI civilizations focused on conquest will prioritize researching technologies like:

- Archery (unlocks Barracks)
- Iron Working (military infrastructure)
- Steel (advanced military capabilities)
- Military Science (unlocks Military Academy)

This ensures conquest-focused civilizations maintain technological advancement in military training infrastructure.

## Database References

### Buildings with FLAVOR_MILITARY_TRAINING

The following buildings have FLAVOR_MILITARY_TRAINING values, indicating the AI will prioritize constructing them based on this flavor:

#### Standard Military Training Buildings

- **BUILDING_BARRACKS** - 20: Basic military training facility providing experience to new units
- **BUILDING_ARMORY** - 20: Advanced training facility for more experienced units
- **BUILDING_MILITARY_ACADEMY** - 25: Elite military training institution

#### Unique Building Replacements

- **BUILDING_IKANDA** (Zulu) - 30: Enhanced barracks replacement with additional military benefits
- **BUILDING_DOJO** (Japan) - 25: Enhanced armory replacement
- **BUILDING_BARBICAN** (Ottoman) - 25: Enhanced armory replacement
- **BUILDING_SCHUTZENSTAND** (Austria) - 50: Enhanced military academy with additional science
- **BUILDING_WEST_POINT** (America) - 80: Enhanced military academy providing significant production and science bonuses

#### Support Buildings with Training Elements

- **BUILDING_SIEGE_FOUNDRY** - 30: Siege weapon production and training
- **BUILDING_STABLE** - 6: Cavalry training facility
- **BUILDING_DUCAL_STABLE** (Poland) - 15: Enhanced stable replacement
- **BUILDING_HOMESTEAD** (Shoshone) - 6: Provides modest military training benefits

#### Civilization-Specific Buildings

- **BUILDING_TELPOCHCALLI** (Aztec) - 15: Culture and military training facility
- **BUILDING_RUNESTONE** (Denmark) - 20: Culture and military training
- **BUILDING_PITZ_COURT** (Maya) - 5: Minor military training element
- **BUILDING_TEOCALLI** (Aztec) - 15: Religious and military training

#### National Wonders

- **BUILDING_HEROIC_EPIC** - 35: National wonder requiring barracks, significantly boosts military production
- **BUILDING_FORNIX** (Rome) - 35: Enhanced Heroic Epic replacement
- **BUILDING_ROYAL_LIBRARY** (Assyria) - 20: Includes military training benefits

#### Corporation Buildings

- **BUILDING_HEXXON_REFINERY** - 50: Corporation building with military training
- **BUILDING_HEXXON_REFINERY_HQ** - 100: Headquarters with maximum military training emphasis
- **BUILDING_ULTICUR** - 20: Corporation building supporting military training
- **BUILDING_RECYCLING_CENTER** - 20: Includes military benefits

#### World Wonders

- **BUILDING_STATUE_ZEUS** - 20: Ancient wonder enhancing military training
- **BUILDING_KARLSTEJN** - 20: Medieval wonder with military benefits
- **BUILDING_BRANDENBURG_GATE** - 50: Industrial wonder providing free promotions to all units
- **BUILDING_KREMLIN** - 25: Modern wonder with military training benefits
- **BUILDING_PENTAGON** - 30: Atomic era wonder representing military-industrial complex
- **BUILDING_MOTHERLAND_CALLS** - 20: Modern monument with military significance

### Technologies with FLAVOR_MILITARY_TRAINING

Technologies that emphasize military training infrastructure and capabilities:

- **TECH_ARCHERY** - 15: Unlocks Barracks (primary military training building)
- **TECH_IRON_WORKING** - 10: Military infrastructure advancement
- **TECH_STEEL** - 15: Advanced metallurgy for better equipment and training
- **TECH_STEAM_POWER** - 5: Industrialization affecting military capabilities
- **TECH_MILITARY_SCIENCE** - 15: Unlocks Military Academy (elite training facility)

### Policies with FLAVOR_MILITARY_TRAINING

Social policies that support military training and unit experience:

#### Honor Tree

- **POLICY_HONOR** (Opener) - 7: Opening military-focused policy tree
- **POLICY_MILITARY_TRADITION** - 5: Policy emphasizing military heritage
- **POLICY_MILITARY_CASTE** - 5: Policy using military for civil purposes

#### Exploration Tree

- **POLICY_MARITIME_INFRASTRUCTURE** - 24: Naval and military infrastructure
- **POLICY_EXPLORATION_FINISHER** - 50: Completion bonus emphasizing trained explorers and military

#### Autocracy Tree

- **POLICY_ELITE_FORCES** - 60: Emphasizes highly trained elite military units
- **POLICY_MILITARISM** - 30: Promotes militaristic society with training emphasis

### Military Strategies Affected by FLAVOR_MILITARY_TRAINING

The AI's military strategies dynamically adjust FLAVOR_MILITARY_TRAINING during different war conditions:

#### Military AI Strategies

- **MILITARYAISTRATEGY_AT_WAR** - +15: Increases training priority during active warfare
- **MILITARYAISTRATEGY_WINNING_WARS** - +20 (first war), +10 (additional wars): Winning encourages continued training investment
- **MILITARYAISTRATEGY_LOSING_WARS** - -20 (first war), +5 (additional wars): Losing initially reduces training (emergency unit production), but recovering requires training

#### City Strategies

- **AICITYSTRATEGY_NEED_HAPPINESS_DEFENSE** - +30: Cities under happiness pressure prioritize defensive military training
- **AICITYSTRATEGY_IS_PUPPET** - +10: Puppet cities receive modest military training bonus

## Summary of Effects

### Military Infrastructure Investment

- **Direct building priority multiplier** for all military training facilities
- Leaders with high FLAVOR_MILITARY_TRAINING will construct barracks, armories, and military academies earlier and in more cities
- Creates a well-distributed network of training facilities across the empire
- Ensures new units start with experience bonuses

### Unit Quality Management

- **Aggressive unit upgrade behavior** through gold prioritization
- During wartime, upgrade priority increases by 50x, making it the AI's top financial priority
- Maintains technological parity or superiority in military forces
- Prevents obsolete units from remaining in service

### Strategic Alignment

- **Reinforces conquest grand strategy** through policy and building evaluation
- Leaders with high military training values naturally gravitate toward domination victory
- Creates coherent strategic decision-making across policies, buildings, and technologies
- Supports offensive military campaigns with quality forces

### Technology Research Prioritization

- **Accelerated research of military infrastructure technologies**
- Ensures timely access to training buildings and unit upgrades
- Balances technological advancement with military readiness
- Particularly important for conquest-focused strategies

### Policy Preference Alignment

- **Values military-focused policy trees** more highly
- Honor and Autocracy become more attractive to high FLAVOR_MILITARY_TRAINING leaders
- Elite Forces and Military Tradition policies receive significant value boosts
- Creates ideological consistency with military-focused governance

## Design Philosophy

FLAVOR_MILITARY_TRAINING represents the distinction between:

1. **Quantity:** Raw military unit production (controlled by FLAVOR_OFFENSE, FLAVOR_DEFENSE)
2. **Quality:** Unit experience, training infrastructure, and technological modernity (controlled by FLAVOR_MILITARY_TRAINING)
3. **Strategy:** Unit composition and tactical deployment (controlled by specialized flavors)

This allows for differentiated military AI personalities:

- **High TRAINING, High OFFENSE:** Elite aggressive military (Genghis Khan, Shaka)
- **High TRAINING, Low OFFENSE:** Professional defensive military (Bismarck)
- **Low TRAINING, High OFFENSE:** Quantity-over-quality approach (Barbarian hordes)
- **Moderate TRAINING, Balanced:** Flexible mixed-quality forces (Diplomatic leaders)

The flavor especially influences the AI's economic trade-offs during war. High FLAVOR_MILITARY_TRAINING leaders will sacrifice immediate economic growth to maintain cutting-edge military forces through upgrades, while low-training leaders may rely on numerical superiority with cheaper, obsolete units.

## Related Flavors

- **FLAVOR_OFFENSE:** General aggressive military behavior and unit production
- **FLAVOR_DEFENSE:** Defensive unit production and city defense priorities
- **FLAVOR_CITY_DEFENSE:** Specific focus on garrisoning and defending cities
- **FLAVOR_MOBILE:** Cavalry and mobile unit preferences
- **FLAVOR_RANGED:** Archer and ranged unit preferences
- **FLAVOR_EXPANSION:** Territory acquisition (affects military needs)
- **FLAVOR_PRODUCTION:** General production emphasis (affects building speed)

FLAVOR_MILITARY_TRAINING typically has higher values for conquest-oriented leaders and those with military training unique buildings (Zulu Ikanda, Japanese Dojo, Austrian Schützenstand). It acts as a force multiplier for other military flavors by ensuring units are well-trained and technologically current.
