# FLAVOR_RELIGION

## Overview

`FLAVOR_RELIGION` is an AI personality flavor that controls how strongly a civilization's leader prioritizes founding, spreading, and enhancing religions. This flavor fundamentally shapes the AI's approach to faith generation, religious unit production, belief selection, religious diplomacy, and the integration of religious strategy into overall gameplay.

Unlike other flavors that focus on specific victory conditions or military strategies, `FLAVOR_RELIGION` is primarily concerned with **establishing and maintaining religious dominance** throughout the game, from founding pantheons in the ancient era to spreading enhanced religions globally in later eras.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Religious specialists (theocratic leaders): 8-10
  - Balanced leaders with religious leanings: 5-7
  - Diplomatic/cultural leaders: 4-6
  - Pure warmongers and production-focused leaders: 2-4
  - Atheistic or secular leaders: 0-2

## Code References

### 1. City Site Evaluation - Faith Yield Multiplier (CvSiteEvaluationClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvSiteEvaluationClasses.cpp` (lines 241-247)

**Function:** `CvCitySiteEvaluator::ComputeFlavorMultipliers()`

FLAVOR_RELIGION directly affects how the AI values faith-generating tiles and features when selecting city settlement locations.

```cpp
else if(strFlavor == "FLAVOR_RELIGION")
{
    // Doubled since only one flavor related to faith
    m_iFlavorMultiplier[YIELD_FAITH] += pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(eFlavor) * 2;
    if (pkCitySpecializationEntry)
    {
        m_iFlavorMultiplier[YIELD_FAITH] += pkCitySpecializationEntry->GetFlavorValue(eFlavor) * 2;
    }
}
```

**Interpretation:** FLAVOR_RELIGION increases the faith yield multiplier used in city site evaluation, and is **doubled** because it is the only flavor associated with faith output. A leader with FLAVOR_RELIGION = 8 will weight faith tiles 16 times more heavily when selecting settlement locations. This creates a strong preference for:

- Natural wonders that provide faith yields (Mount Sinai, Mount Kailash, Uluru, etc.)
- Desert tiles with Desert Folklore pantheon potential
- Mountain ranges for religious sites
- Oasis and salt deposits
- Stone and marble resources
- Wine and incense luxury resources

The doubling mechanic reflects faith's unique position as having only one primary flavor influencing it, similar to science.

### 2. City Yield Evaluation - Faith Value Weight (CvCityStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCityStrategyAI.cpp` (lines 4318-4332)

**Function:** `CvCityStrategyAI::GetYieldValue()`

FLAVOR_RELIGION determines how cities value faith yields relative to other yields when making production and citizen management decisions.

```cpp
case YIELD_FAITH:
{
    int iFlavorReligion = kPlayer.GetFlavorManager()->GetPersonalityIndividualFlavor(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));

    if (kPlayer.GetPlayerTraits()->IsReligious())
    {
        iFlavorReligion *= 3;
        iFlavorReligion /= 2;
    }
    else
    {
        iFlavorReligion *= 4;
        iFlavorReligion /= 3;
    }
    // Additional calculations...
}
```

**Interpretation:** Faith yield value is calculated using FLAVOR_RELIGION with multipliers based on whether the civilization has religious traits:

- **Religious trait civilizations:** Flavor value increased by 50% (multiplied by 3/2)
- **Non-religious civilizations:** Flavor value increased by 33% (multiplied by 4/3)

**Practical Effect:** A leader with FLAVOR_RELIGION = 9 and religious traits will value faith as: 9 × 1.5 = 13.5 effective flavor points. This heavily influences:

- Citizen tile assignments toward faith-generating tiles
- Building priorities for faith-producing structures
- Policy selection favoring religious bonuses
- Wonder construction (Stonehenge, Hagia Sophia, etc.)

### 3. City Specialization - Faith Focus (CvCitySpecializationAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCitySpecializationAI.cpp` (lines 468-469)

**Function:** `CvCitySpecializationAI::LogSpecializationUpdate()`

FLAVOR_RELIGION influences long-term city specialization decisions, determining whether cities should focus on faith generation and religious building construction.

```cpp
int iFlavorFaith = 10 * m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));
if (iFlavorFaith < 0) iFlavorFaith = 0;
```

**Interpretation:** The religion flavor is multiplied by 10 and combined with the active grand strategy to create a city specialization weight. This means:

- FLAVOR_RELIGION = 8 adds 80 weight toward faith-focused specialization
- Cities will prioritize religious buildings (shrines, temples, monasteries)
- Faith-specialized cities will become holy cities or missionary production centers
- Citizen management will prioritize working faith-generating tiles
- Great prophet points accumulate faster in specialized cities

**Strategic Impact:** Faith-specialized cities become religious centers, generating the majority of the civilization's faith output while producing missionaries, inquisitors, and great prophets.

### 4. Missionary Production and Religious Spread (CvReligionClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (lines 6931, 8105)

**Function:** `CvReligionAI::GetDesiredFaithGreatPerson()` and `CvReligionAI::ScoreBeliefForPlayer()`

FLAVOR_RELIGION directly controls missionary production, great prophet usage, and the desire to spread religion.

#### Missionary Production Decision

```cpp
//Let's see about our religious flavor...
CvFlavorManager* pFlavorManager = m_pPlayer->GetFlavorManager();
int iFlavorReligion = pFlavorManager->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));

// Do we get benefits from spreading our religion?
int iDesireToSpread = (eReligionWeFounded != NO_RELIGION) ? GetSpreadScore() : 0;
```

**Interpretation:** FLAVOR_RELIGION is a primary factor in determining:

- How many missionaries to produce
- When to purchase missionaries with faith
- Whether to use great prophets for conversion vs. holy sites
- How aggressively to spread religion to foreign cities

**Missionary Production Threshold:** Leaders with FLAVOR_RELIGION ≥ 6 will actively produce missionaries even in the early game. Leaders with FLAVOR_RELIGION ≥ 8 will purchase missionaries with faith aggressively.

#### Faith Yield Belief Scoring

```cpp
case YIELD_FAITH:
    iPersonFlavor = pFlavorManager->GetPersonalityIndividualFlavor(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION")) * 110;
    break;
```

**Interpretation:** When evaluating religious beliefs that grant faith yields, FLAVOR_RELIGION is multiplied by **110**, the **highest multiplier of any yield type in the game**. This massive weighting creates enormous differences in belief selection:

- FLAVOR_RELIGION = 9: Faith-granting beliefs score 990 points
- FLAVOR_RELIGION = 4: Faith-granting beliefs score 440 points
- FLAVOR_RELIGION = 2: Faith-granting beliefs score 220 points

**Affected Beliefs:**

- Pantheons providing faith from resources, terrain, or buildings
- Follower beliefs granting faith from buildings or population
- Enhancer beliefs increasing faith pressure
- Reformation beliefs providing faith bonuses

**Strategic Impact:** High-religion leaders will almost always select beliefs that maximize faith generation, creating a positive feedback loop where faith enables more missionaries, which spread religion faster, which generates more faith.

### 5. Great Prophet Decision Making (CvPlayerAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPlayerAI.cpp` (lines 1823-1828)

**Function:** `CvPlayerAI::GreatPeopleDirectiveForGreatProphet()`

FLAVOR_RELIGION determines whether great prophets are used for holy site improvements or religious conversion.

```cpp
// CASE 1: I have an enhanced religion.
if (pMyReligion && pMyReligion->m_bEnhanced)
{
    ImprovementTypes eHolySite = (ImprovementTypes)GC.getInfoTypeForString("IMPROVEMENT_HOLY_SITE");
    int iFlavor = GetFlavorManager()->GetPersonalityIndividualFlavor(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));
    iFlavor -= GetNumUnitsWithUnitAI(UNITAI_PROPHET,false);

    //Let's use our prophets for improvements instead of wasting them on conversion.
    int iNumImprovement = getImprovementCount(eHolySite);
    if (iNumImprovement <= iFlavor || GetReligionAI()->ChooseProphetConversionCity(pUnit) == NULL
        || GetPlayerTraits()->IsProphetFervor())
```

**Interpretation:** Great prophet usage follows a sophisticated decision tree based on FLAVOR_RELIGION:

- **High flavor (≥ 8):** Build holy sites up to the flavor value, then convert cities
- **Moderate flavor (5-7):** Balance between holy sites and conversions
- **Low flavor (≤ 4):** Prioritize conversion over improvements

**Holy Site Strategy:** A leader with FLAVOR_RELIGION = 9 will build up to 9 holy sites before using prophets for conversion, creating a network of faith-generating tiles that provide long-term benefits. Lower-religion leaders will use prophets for immediate conversion and enhancement.

### 6. Technology Research - Religious Tech Priority (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (lines 1289-1293)

**Function:** `CvPlayerTechs::GetResearchPriority()`

FLAVOR_RELIGION increases research priority for technologies that unlock religious units, buildings, and beliefs when the player has religious traits.

```cpp
if (m_pPlayer->GetPlayerTraits()->IsReligious() && (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_RELIGION" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_GREAT_PEOPLE"))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

**Interpretation:** Religious trait civilizations with high FLAVOR_RELIGION receive research priority bonuses for technologies with FLAVOR_RELIGION or FLAVOR_GREAT_PEOPLE values. This creates a beeline effect where religious leaders rapidly advance toward key religious technologies.

**Religious Technology Beeline:**

- Ancient: Pottery → Shrine → Theology (Great Mosque, Sistine Chapel)
- Classical: Philosophy (temples, national college) → Theology
- Medieval: Theology (enhancing religion) → Acoustics (religious music)
- Renaissance: Printing Press (enhancing beliefs)

### 7. Trade Route Evaluation - Religious Spread Value (CvTradeClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTradeClasses.cpp` (lines 6281, 6286, 6958, 6963)

**Function:** `CvPlayerTrade::GetTradeConnectionValue()`

FLAVOR_RELIGION influences how the AI values trade routes that spread religious pressure.

```cpp
int iFlavorReligion = m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));

int iReligionScore = (iReligionDelta * (iFlavorReligion / 2));

//add it all up
int iScore = iGoldScore + iScienceScore + iCultureScore + iReligionScore;
```

**Interpretation:** Trade route value includes a religious component weighted by half the FLAVOR_RELIGION value:

- A trade route with +6 religious pressure with FLAVOR_RELIGION = 8 scores: 6 × (8/2) = 24 religion points
- The same route with FLAVOR_RELIGION = 2 scores: 6 × (2/2) = 6 religion points

**Trade Route Strategy:**

- High FLAVOR_RELIGION leaders prioritize trade routes to foreign cities to spread their religion
- Internal trade routes to holy cities are valued for maintaining religious pressure
- Trade routes are used as a passive religious spread tool alongside missionaries

**Strategic Impact:** Religious civilizations create trade networks that double as religious missionary networks, spreading faith passively while generating economic benefits.

### 8. Grand Strategy - Faith Value Caching (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 400, 1117-1120, 1154-1157)

**Function:** Multiple grand strategy calculations

FLAVOR_RELIGION is cached and used throughout the grand strategy system to influence overall strategic direction.

#### Flavor Caching

```cpp
m_iFlavorFaith = GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));
```

**Interpretation:** Faith flavor is stored as a member variable for fast access throughout grand strategy calculations, indicating its importance across multiple strategic subsystems.

#### Policy Priority for Religious Strategies

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_RELIGION")
{
    iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
}
```

**Interpretation:** When evaluating grand strategy, religious social policies receive priority bonuses equal to their FLAVOR_RELIGION values. This creates a preference for:

- Piety policy tree (religious infrastructure)
- Tradition + religious buildings synergy
- Order ideology (religious production bonuses)

#### Building Priority for Religious Strategies

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_RELIGION")
{
    iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop);
}
```

**Interpretation:** Religious buildings accumulate priority bonuses that influence grand strategy decisions. Leaders who build many religious buildings (shrines, temples, cathedrals) become more committed to religious strategies over time.

### 9. Diplomacy - Religious Opinion Modifiers (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (lines 16117, 32226, 43068, 44611, 47316)

**Function:** Multiple diplomatic opinion and decision functions

FLAVOR_RELIGION heavily influences diplomatic attitudes toward religious conversion, shared religions, and religious conflict.

#### Religious Vengeance Weight

```cpp
int iFlavorReligion = m_pPlayer->GetFlavorManager()->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));
```

**Interpretation:** This flavor value is retrieved when calculating diplomatic approach scores. Religious leaders (FLAVOR_RELIGION ≥ 6) become hostile toward civilizations that:

- Spread different religions to their cities
- Attack their missionaries or inquisitors
- Denounce their religion
- Break no-convert promises

#### City-State Faith Priority

```cpp
int iFaithFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));
```

**Interpretation:** When evaluating city-state alliances, FLAVOR_RELIGION influences how much the AI values:

- Religious city-states (which provide faith bonuses when allied)
- City-states that request religious quests (spread religion, religious settlement)
- City-states with faith-generating natural wonders in their territory

#### Religious Promise Trustworthiness

```cpp
int iFlavorReligion = m_pPlayer->GetFlavorManager()->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));
bool bReligious = iFlavorReligion > 6;
bReligious |= GetPlayer()->GetPlayerTraits()->IsReligious();
```

**Interpretation:** Leaders with FLAVOR_RELIGION > 6 or religious traits are considered "religious" for diplomatic purposes. Religious leaders:

- Take broken no-convert promises very seriously (20 opinion penalty if religious, 10 if not)
- Take ignored no-convert promises seriously (10 opinion penalty if religious, 5 if not)
- Are less likely to agree to stop converting (requires FLAVOR_RELIGION < 7)

#### No-Convert Agreement Decisions

```cpp
int iFlavorReligion = m_pPlayer->GetFlavorManager()->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));

if (iFlavorReligion > 4 && GetPlayer()->GetPlayerTraits()->IsReligious())
{
    return false; // Never agree to stop converting
}

if (iFlavorReligion < 7)
{
    // May consider stopping conversion
}
```

**Interpretation:** The AI's willingness to stop religious conversion depends heavily on FLAVOR_RELIGION:

- **FLAVOR_RELIGION ≥ 7:** Will not agree to stop converting
- **FLAVOR_RELIGION > 4 with religious traits:** Absolutely refuses to stop
- **FLAVOR_RELIGION ≤ 4:** May agree if diplomatic relationship is strong

#### Religious Opinion Weight

```cpp
int iFlavorReligion = m_pPlayer->GetFlavorManager()->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_RELIGION"));
int iEraMod = GC.getEraInfo(GC.getGame().getCurrentEra())->getDiploEmphasisReligion();

// Weight increases or decreases based on flavors
if (iFlavorReligion < 5)
{
    iEraMod = max(0, iEraMod - 1);
}
else if (iFlavorReligion > 7)
{
    iEraMod = min(5, iEraMod + 1);
}
```

**Interpretation:** Religious opinion modifiers scale with both FLAVOR_RELIGION and game era:

- **Low religion (< 5):** Era modifier decreased by 1 (cares less about religion)
- **High religion (> 7):** Era modifier increased by 1 (cares more about religion)
- **Era scaling:** Religion becomes more important diplomatically in later eras

**Diplomatic Effects:**

- Shared religions provide friendship bonuses (+opinion)
- Different religions in your cities create friction (-opinion)
- Spreading religions to other civilizations creates hostility
- Religious conflicts can lead to wars and denunciations

### 10. Advisor Recommendation System (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (lines 451-453)

**Function:** Religious advisor recommendation priority

FLAVOR_RELIGION determines the priority weight for religion-related advisor recommendations.

```cpp
else if(strFlavorName == "FLAVOR_RELIGION")
{
    return 13;
}
```

**Interpretation:** FLAVOR_RELIGION receives a priority weight of 13 in the religious advisor's recommendation system. This is moderate priority, equal to science (13) but lower than spaceship (17) and diplomacy (17), reflecting that religion is important throughout the game but not necessarily victory-critical.

**Advisor Behavior:** The religious advisor will recommend:

- Building shrines and temples
- Founding pantheons and religions
- Enhancing religions with additional beliefs
- Producing missionaries and inquisitors
- Spreading religion to foreign cities
- Purchasing religious buildings with faith
- Constructing religious wonders (Stonehenge, Hagia Sophia)

## Summary of Effects

### Strategic Planning

- **Religious founding:** Leaders with FLAVOR_RELIGION ≥ 7 prioritize founding religions early
- **Grand strategy:** Creates positive feedback loops with religious buildings and policies
- **City placement:** Prioritizes natural wonders, desert tiles, and faith-generating resources
- **Missionary production:** Scales directly with flavor value (more missionaries with higher flavor)

### City Development

- **Building priority:** Shrines → Temples → Monasteries → Cathedrals → Grand Temple
- **Holy cities:** Specialized cities focus on faith generation and religious unit production
- **Specialization:** Designates cities as faith-focused, maximizing prophet point generation
- **Tile improvements:** Holy sites placed strategically based on flavor value

### Religious Strategy

- **Belief selection:** 110x multiplier for faith-granting beliefs (highest in game)
- **Prophet usage:** Balance between holy sites (FLAVOR_RELIGION value determines maximum) and conversions
- **Religious spread:** Trade routes and missionaries used aggressively to spread religion
- **Religious pressure:** Maintains religious dominance in owned cities through inquisitors

### Diplomatic Strategy

- **Religious conflicts:** FLAVOR_RELIGION > 6 leaders become hostile when religion is challenged
- **Shared religion:** Positive diplomatic modifier with civilizations sharing the same religion
- **No-convert promises:** Refuses to agree if FLAVOR_RELIGION ≥ 7
- **City-state alliances:** Values religious city-states highly

### Great People

- **Great Prophets:** Primary religious great person, used for founding/enhancing religions and holy sites
- **Holy site balance:** Number of holy sites scales with FLAVOR_RELIGION value
- **Faith purchases:** Can purchase great people with faith in later game

### Dynamic Adjustments

- **Grand strategy synergy:** Religion flavor works with active grand strategy for compound effects
- **Era scaling:** Religious diplomacy becomes more important in later eras
- **Religious traits:** Religious civilizations multiply flavor effects

## Design Philosophy

FLAVOR_RELIGION represents the AI's fundamental approach to faith and religious dominance:

1. **Religious Priority:** How aggressively to found and spread religions
2. **Faith Infrastructure:** Whether to invest heavily in religious buildings
3. **Diplomatic Strategy:** How religion influences relationships with other civilizations
4. **Great Prophet Usage:** Balance between long-term improvements and immediate conversions

This creates a spectrum of AI religious strategies:

- **High RELIGION (8-10):** Religious zealots who prioritize founding religions early, spreading them aggressively, and building extensive religious infrastructure. Will fight religious wars to maintain dominance.
- **Moderate RELIGION (5-7):** Balanced leaders who maintain religious presence without obsessing over it. May found religions opportunistically and spread them selectively.
- **Low RELIGION (3-4):** Secular leaders who treat religion as a secondary concern. May skip founding religions entirely or adopt others' religions pragmatically.
- **Minimal RELIGION (0-2):** Atheistic leaders who largely ignore religion, building religious structures only when necessary for other benefits.

## Related Flavors

- **FLAVOR_CULTURE:** Often synergizes with religion (religious buildings provide culture)
- **FLAVOR_DIPLOMACY:** Religious leaders often pursue diplomatic strategies
- **FLAVOR_GREAT_PEOPLE:** Synergizes through great prophet generation
- **FLAVOR_HAPPINESS:** Religious buildings often provide happiness bonuses
- **FLAVOR_GOLD:** Can purchase religious units and buildings with gold
- **FLAVOR_SCIENCE:** Sometimes conflicts with religion (rationalism vs. piety)

**Typical Combinations:**

- **High Religion + High Culture:** Theocratic cultural empire using religious tourism
- **High Religion + High Diplomacy:** Peaceful religious spread through alliances
- **High Religion + High Growth:** Large cities maximizing faith from population
- **High Religion + Low Offense:** Passive religious expansion without military conquest
- **Moderate Religion + Moderate Everything:** Pragmatic religious adoption for bonuses

FLAVOR_RELIGION creates distinct religious personalities in AI civilizations, from zealous theocracies that aggressively spread their faith to secular empires that treat religion as a tool rather than a priority.
