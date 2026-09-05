# FLAVOR_NUKE

## Overview

`FLAVOR_NUKE` is an AI personality flavor that controls a civilization's priority for **acquiring and maintaining nuclear weapons**. This flavor determines how many nuclear weapons the AI will attempt to build and maintain in its arsenal, as well as influencing support for nuclear non-proliferation treaties in the World Congress.

Unlike `FLAVOR_USE_NUKE` (which controls the willingness to actually deploy nuclear weapons), `FLAVOR_NUKE` specifically governs the **production priority and desired quantity** of nuclear weapons in the AI's military composition.

### Value Range

- **Scale:** 0-20 (integer values, with personality typically ranging 1-10)
- **Modified by:** Grand Strategy adjustments can push effective values beyond base personality ranges
- **Typical Values:**
  - Base personality range: 1-10 for most leaders
  - Gandhi (Nuclear Gandhi): 12 base value
  - Dynamic adjustments: Can reach 0-20 based on strategic circumstances

### Relationship with FLAVOR_USE_NUKE

These two flavors work together to create differentiated nuclear doctrines:

- **FLAVOR_NUKE:** "How many nukes should I build?"
- **FLAVOR_USE_NUKE:** "How willing am I to use them?"

This separation allows for personality archetypes like:

- **Defensive Deterrence:** High NUKE, Low USE_NUKE (build large arsenal but rarely use)
- **Aggressive Nuclear Power:** High NUKE, High USE_NUKE (build arsenal and willing to first strike)
- **Opportunistic User:** Low NUKE, High USE_NUKE (won't prioritize building but will use available nukes)
- **Nuclear Pacifist:** Low NUKE, Low USE_NUKE (minimal nuclear investment and usage)

## Code References

### 1. Nuclear Arsenal Strategy (CvMilitaryAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvMilitaryAI.cpp` (lines 3979-3996)

**Function:** `MilitaryAIHelpers::IsTestStrategy_NeedANuke(CvPlayer* pPlayer)`

This function determines whether the AI should prioritize building additional nuclear weapons.

#### Target Arsenal Size Formula

```cpp
int iFlavorNuke = pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_NUKE"));
int iNumNukes = pPlayer->getNumNukeUnits();

return (iNumNukes < iFlavorNuke / 3);
```

**Interpretation:** The AI desires a nuclear arsenal equal to `FLAVOR_NUKE / 3` nuclear units.

| FLAVOR_NUKE | Target Arsenal Size | Effect on Production                    |
| ----------- | ------------------- | --------------------------------------- |
| 3           | 1 nuke              | Minimal nuclear capability              |
| 6           | 2 nukes             | Small deterrent force                   |
| 9           | 3 nukes             | Standard nuclear arsenal                |
| 12          | 4 nukes             | Substantial nuclear capability (Gandhi) |
| 15          | 5 nukes             | Large nuclear arsenal                   |
| 18          | 6 nukes             | Major nuclear power                     |

#### Nuclear Gandhi Override

The infamous "Nuclear Gandhi" behavior is implemented with special handling:

```cpp
if (pPlayer->GetDiplomacyAI()->IsNuclearGandhi(true))
{
    return true;  // Always need more nukes!
}
```

When a player qualifies as "Nuclear Gandhi," the normal arsenal size limits are bypassed, and the AI will continuously prioritize nuclear weapon production regardless of current stockpile.

#### Game Rule Check

```cpp
if(GC.getGame().isNoNukes())
{
    return false;
}
```

Nuclear production is completely disabled if the game has the "No Nukes" rule enabled.

### 2. Nuclear Unit Production Priority (CvUnitProductionAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvUnitProductionAI.cpp` (lines 471-484)

**Context:** Unit production scoring within the `CvUnitProductionAI::CheckUnitBuildSanity()` function

This code applies bonuses when evaluating whether to produce nuclear-capable units.

#### Nuke Production Bonus

```cpp
if(pkUnitEntry->IsSuicide())
{
    // Nukes!!!
    if(pkUnitEntry->GetNukeDamageLevel() > 0)
    {
        iBonus += 100;
    }
    // Cruise Missiles? Only if we don't have any nukes lying around...
    else if(pkUnitEntry->GetRangedCombat() > 0 && kPlayer.getNumNukeUnits() > 0)
    {
        iBonus -= 50;
    }
    else
    {
        iBonus += 25;
    }
}
```

**Interpretation:**

- **Nuclear weapons** (units with `NukeDamageLevel > 0`) receive a massive +100 production bonus
- **Cruise missiles** (suicide ranged units) are **deprioritized by -50** if the player already has nuclear weapons in their arsenal, as nukes are considered superior
- **Other suicide units** receive a modest +25 bonus

While this code doesn't directly reference FLAVOR_NUKE, it works in conjunction with the military strategy system. When `IsTestStrategy_NeedANuke()` returns true (based on FLAVOR_NUKE), the production priorities push nuclear-capable units to the front of the build queue.

### 3. World Congress Voting - Nuclear Non-Proliferation (CvVotingClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvVotingClasses.cpp` (lines 12883-12921)

**Context:** AI evaluation of Nuclear Non-Proliferation Treaty proposals

This code determines how the AI votes on proposals to ban nuclear weapon construction.

#### Voting Logic

```cpp
// Protect against a modder setting this to zero - base Nuke flavor ranges from 1 to 10 normally,
// except Gandhi who is always 12
int iNukeFlavor = 8;
for (int iFlavorLoop = 0; iFlavorLoop < GC.getNumFlavorTypes(); iFlavorLoop++)
{
    if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_NUKE")
    {
        iNukeFlavor = range(GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
            (FlavorTypes)iFlavorLoop), 0, 20);
        break;
    }
}
iExtra += (8 - iNukeFlavor) * iDislikedNeighbours * 20;

// Speaking of Gandhi, he's very nuke happy!
if (GetPlayer()->GetDiplomacyAI()->IsNuclearGandhi(true))
{
    iExtra -= 1000;
}
```

**Interpretation:**

The formula calculates support/opposition to nuclear non-proliferation based on:

1. **Base calculation:** `(8 - iNukeFlavor) × iDislikedNeighbours × 20`
   - `8` is the middle value (neutral stance)
   - When `FLAVOR_NUKE > 8`: Negative score (oppose the ban)
   - When `FLAVOR_NUKE < 8`: Positive score (support the ban)
   - Score is amplified by the number of disliked neighbors with land disputes

2. **Disliked neighbors factor:**
   - Counts neighbors with strong land disputes (`DISPUTE_LEVEL_STRONG`)
   - With hostile diplomatic approaches (worse than `CIV_APPROACH_DECEPTIVE`)
   - Each disliked neighbor amplifies the stance

3. **Nuclear Gandhi override:**
   - Applies a massive -1000 penalty (strongly opposes any nuclear ban)
   - Overrides all other considerations

#### Voting Examples

**Leader with FLAVOR_NUKE = 4 (low nuclear interest) and 2 disliked neighbors:**

- Score: `(8 - 4) × 2 × 20 = +160` (supports the ban)
- Reasoning: Low nuclear interest + hostile neighbors = prefer disarmament

**Leader with FLAVOR_NUKE = 12 (high nuclear interest) and 3 disliked neighbors:**

- Score: `(8 - 12) × 3 × 20 = -240` (opposes the ban)
- Reasoning: High nuclear interest + hostile neighbors = wants nuclear capability

**Nuclear Gandhi (any neighbors):**

- Score: `-1000` (automatically opposes)
- Reasoning: Nuclear Gandhi always opposes nuclear restrictions

### 4. Policy Preference Weighting (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4988-4991)

**Function:** `CvPolicyAI::WeighPolicy(CvPlayer* pPlayer, PolicyTypes ePolicy)`

When evaluating social policies, the AI maps policy flavors to victory condition preferences.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_USE_NUKE" ||
         GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_NUKE")
{
    iConquestValue += iFlavorValue;
}
```

**Interpretation:**

- Policies with FLAVOR_NUKE contribute to their perceived value for **Conquest victory strategy**
- Leaders with high FLAVOR_NUKE will value policies supporting aggressive military expansion
- Nuclear weapons are viewed as tools for domination and conquest
- This links nuclear arsenal development to grand strategic preference for military victory

For example, policies in the Autocracy ideology tree or military-focused policy branches that have FLAVOR_NUKE will be more attractive to leaders with high nuclear interest.

### 5. Advisor Recommendations (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (lines 389-392, 459-462, 497-500)

**Context:** Weighting system for advisor recommendations to human players

This code assigns importance weights to FLAVOR_NUKE when the advisor system recommends units, buildings, technologies, or policies.

#### Advisor Weighting by Type

**Military Advisor (line 389):**

```cpp
else if(strFlavorName == "FLAVOR_NUKE")
{
    return 10;
}
```

Weight: **10** - Moderate-high importance for military recommendations

**Foreign Advisor (line 459):**

```cpp
else if(strFlavorName == "FLAVOR_NUKE")
{
    return 5;
}
```

Weight: **5** - Moderate importance for diplomatic recommendations (nuclear capabilities affect diplomacy)

**Science Advisor (line 497):**

```cpp
else if(strFlavorName == "FLAVOR_NUKE")
{
    return 3;
}
```

Weight: **3** - Low importance for science recommendations (though nuclear tech is science-based)

**Interpretation:**

The advisor system recognizes that nuclear weapons are primarily a **military concern** (weight 10), secondarily a **diplomatic factor** (weight 5), and only minimally a **scientific consideration** (weight 3). When recommending actions to human players, items with FLAVOR_NUKE will be most strongly highlighted by the Military Advisor.

## Summary of Effects

### Nuclear Arsenal Management

- **Defines target stockpile size:** AI maintains `FLAVOR_NUKE / 3` nuclear weapons
- **Production trigger:** Strategy activates when arsenal falls below target
- **Continuous production:** Nuclear Gandhi ignores limits and always produces
- **Massive production priority:** +100 bonus to nuclear-capable unit production
- **Cruise missile deprioritization:** -50 penalty when nukes already exist

### World Congress Diplomacy

- **Nuclear Non-Proliferation stance:** `(8 - FLAVOR_NUKE) × DislikedNeighbors × 20`
- **High FLAVOR_NUKE:** Strongly opposes nuclear bans
- **Low FLAVOR_NUKE:** Supports nuclear disarmament
- **Neighbor influence:** More hostile neighbors amplify the stance
- **Gandhi exception:** -1000 score (absolute opposition to bans)

### Grand Strategy Integration

- **Conquest victory alignment:** Nuclear-focused policies support domination strategy
- **Policy tree preference:** Values military and aggressive policy branches
- **Long-term planning:** Nuclear capability integrated into conquest grand strategy

### Advisor System

- **Military recommendations:** High weight (10) for nuclear-related suggestions
- **Diplomatic recommendations:** Moderate weight (5) for nuclear diplomacy factors
- **Science recommendations:** Low weight (3) for nuclear technology

## Design Philosophy

FLAVOR_NUKE implements a comprehensive nuclear deterrence and proliferation model:

1. **Arsenal Size Proportionality:** Leaders maintain nuclear arsenals proportional to their personality
2. **Diplomatic Consequences:** Nuclear ambitions affect World Congress voting and international relations
3. **Strategic Integration:** Nuclear capability is linked to conquest-oriented grand strategy
4. **Special Personalities:** "Nuclear Gandhi" creates memorable and distinctive AI behavior
5. **Production Focus:** Nuclear weapons receive dramatic production priority when strategy is active

## Dynamic Adjustments

The effective FLAVOR_NUKE value is retrieved through:

```cpp
GetGrandStrategyAI()->GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_NUKE"))
```

This means the flavor can be modified by:

- **Base personality value** (from leader XML definition)
- **Grand Strategy modifiers** (conquest strategy increases, diplomacy decreases)
- **Economic strategies** (financial constraints may reduce)
- **Military strategies** (war situations may increase)
- **Temporary flavor boosts** (from strategic circumstances)

These modifiers allow the AI to adapt nuclear priorities based on game circumstances while maintaining core personality traits.

## Interaction with Related Systems

### Manhattan Project

- When another civilization builds the Manhattan Project, it triggers global nuclear capability
- AI with high FLAVOR_NUKE will immediately begin nuclear weapon production
- Espionage AI may sabotage enemy Manhattan Project construction based on diplomatic relations

### Nuclear Strategy Activation

The `IsTestStrategy_NeedANuke()` function is called by the military AI strategy system each turn. When it returns true:

1. Nuclear-capable units receive production priority
2. Cities may switch production to nuclear weapons
3. Purchase considerations favor nuclear units
4. Tech research may prioritize nuclear technologies

### Diplomatic Implications

- Other civilizations assess nuclear threat based on arsenal size and FLAVOR_USE_NUKE
- Nuclear capability affects diplomatic approach calculations (AFRAID, GUARDED)
- World Congress proposals regarding nuclear weapons are heavily influenced
- Espionage operations may target nuclear programs

## Related Flavors

- **FLAVOR_USE_NUKE:** Controls willingness to deploy nuclear weapons in warfare
- **FLAVOR_OFFENSE:** General aggressive military behavior
- **FLAVOR_MILITARY_TRAINING:** Investment in military units overall
- **FLAVOR_SCIENCE:** Technology research including nuclear technologies
- **FLAVOR_SPACESHIP:** Competing late-game priority (science victory vs. military dominance)

## Notable Implementation Details

### Nuclear Gandhi

The "Nuclear Gandhi" mechanic is a deliberate reference to the urban legend from earlier Civilization games. The implementation includes:

- Hardcoded checks for `IsNuclearGandhi()`
- Base FLAVOR_NUKE value of 12 (higher than typical leaders)
- Unlimited nuclear production override
- -1000 penalty to supporting nuclear non-proliferation
- Special diplomatic considerations for nuclear threat assessment

### Arsenal Size Scaling

The `/3` divider in the target arsenal calculation creates reasonable stockpile sizes:

- Prevents runaway nuclear production overwhelming other military needs
- Maintains approximately 3-6 nukes for high-nuclear leaders
- Scales with personality while remaining manageable
- Allows meaningful distinctions between nuclear doctrines

### Integration with Combat AI

While FLAVOR_NUKE controls **production**, the actual **deployment** is handled by:

- `FLAVOR_USE_NUKE` for strike probability
- `CvMilitaryAI::DoNuke()` for targeting and launch decisions
- Diplomatic AI for threat assessment and deterrence calculations
- War state evaluation for desperation nuclear use

This separation ensures that nuclear weapons serve both strategic (deterrence, stockpiling) and tactical (actual use) purposes in the AI's military planning.
