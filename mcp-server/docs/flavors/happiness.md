# FLAVOR_HAPPINESS

## Overview

FLAVOR_HAPPINESS is an AI personality flavor that controls how much a civilization prioritizes happiness and avoiding unhappiness penalties throughout the game. Leaders with higher FLAVOR_HAPPINESS values are more likely to build happiness-generating structures, adopt happiness-focused policies, and choose religious beliefs that provide happiness benefits. This flavor influences decision-making across multiple AI systems including city building, diplomacy, religion, policy selection, and city site evaluation.

## AI Behavior Impact

### Building Production

The happiness flavor directly influences building construction priorities through the Building Production AI system. Each building has a FLAVOR_HAPPINESS value assigned in the database, and the AI calculates building priorities by multiplying these flavor values with the leader's happiness flavor rating.

**Key Reference**: `CvBuildingProductionAI.cpp:98`

```cpp
m_BuildingAIWeights.IncreaseWeight(iBuilding, entry->GetFlavorValue(eFlavor) * iWeight);
```

Buildings with high FLAVOR_HAPPINESS values become proportionally more attractive to leaders who value happiness highly.

### City Site Evaluation

When founding new cities, the happiness flavor affects how the AI evaluates potential settlement locations. The flavor value is doubled (since it's the only flavor related to happiness) and influences the site evaluation multiplier for happiness considerations.

**Key Reference**: `CvSiteEvaluationClasses.cpp:232-239`

```cpp
else if(strFlavor == "FLAVOR_HAPPINESS")
{
    // Doubled since only one flavor related to Happiness
    m_iFlavorMultiplier[SITE_EVALUATION_HAPPINESS] += pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(eFlavor) * 2;
    if(pkCitySpecializationEntry)
    {
        m_iFlavorMultiplier[SITE_EVALUATION_HAPPINESS] += pkCitySpecializationEntry->GetFlavorValue(eFlavor) * 2;
    }
}
```

This means leaders with higher happiness flavor values will prefer settling locations that provide better happiness outcomes, such as areas with luxury resources.

### Grand Strategy AI

The happiness flavor is cached and used in Grand Strategy AI calculations, affecting long-term strategic priorities including Culture Victory pursuit.

**Key Reference**: `CvGrandStrategyAI.cpp:401`

```cpp
m_iFlavorHappiness = GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_HAPPINESS"));
```

The Grand Strategy AI uses this cached value when evaluating Culture Victory priorities. Buildings and policies with happiness flavor values contribute bonus priority points toward the Culture Victory strategy.

**Key References**: `CvGrandStrategyAI.cpp:922-925` and `959-962`

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_HAPPINESS")
{
    iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);  // From policies
    iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop);  // From buildings
}
```

### Policy AI

The happiness flavor contributes to policy selection weight calculations, making happiness-providing policies more attractive to leaders who value this flavor.

**Key Reference**: `CvPolicyAI.cpp:4948-4951`

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_HAPPINESS")
{
    iWeight += iFlavorValue;
}
```

Additionally, policy flavor values are dynamically adjusted based on the empire's current happiness state. If the empire is currently unhappy (happiness below current unhappiness level), the AI receives a +5 bonus to happiness flavor values when evaluating policies.

**Key Reference**: `CvPolicyClasses.cpp:6192-6195`

```cpp
else if (m_pPlayer->GetHappiness() < iCurrentUnhappiness && iFlavor == GC.getInfoTypeForString("FLAVOR_HAPPINESS"))
{
    iFlavorValue += 5;
}
```

### Religion System

The happiness flavor significantly influences two key aspects of religious decision-making:

#### 1. Pantheon and Belief Selection

When evaluating religious beliefs and pantheons, the happiness flavor factors into a "happiness multiplier" calculation that affects how beliefs providing happiness are valued.

**Key References**: `CvReligionClasses.cpp:8158` and `8620`

```cpp
int iFlavorHappiness = pFlavorManager->GetPersonalityIndividualFlavor((FlavorTypes)GC.getInfoTypeForString("FLAVOR_HAPPINESS"));
```

The happiness multiplier is calculated using the formula:

```cpp
iHappinessMultiplier = min(15, max(6, iFlavorOffense * 2 + iFlavorHappiness - iFlavorDefense));
```

This formula means:

- Base range: 6-15 (clamped)
- Aggressive leaders (high offense, low defense) with high happiness flavor will maximize happiness needs
- Defensive leaders will have reduced happiness priorities
- The multiplier directly impacts how happiness-providing beliefs are scored

### Diplomacy AI

The happiness flavor is retrieved and used in diplomacy calculations, particularly when evaluating gift-giving and city-state interaction strategies.

**Key Reference**: `CvDiplomacyAI.cpp:32228`

```cpp
int iHappinessFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_HAPPINESS"));
```

While the specific usage in this context relates to bullying vs. gift-giving decisions, the happiness flavor likely influences whether the AI prioritizes actions that would maintain empire happiness during diplomatic maneuvering.

### Advisor System

The happiness flavor has a specific weight assigned in the advisor recommendation system, allowing it to influence what recommendations are presented to the player.

**Key Reference**: `CvAdvisorRecommender.cpp:326-329`

```cpp
else if(strFlavorName == "FLAVOR_HAPPINESS")
{
    return 9;
}
```

The advisor weight value of 9 (on a scale relative to other flavors) indicates moderate-high priority in the advisor recommendation algorithm.

## Dynamic Flavor Adjustments

The happiness flavor is dynamically modified by active AI strategies, reflecting changing empire circumstances:

### War Strategies

**At War**: `-5` to FLAVOR_HAPPINESS

- When at war, the AI reduces its happiness focus to prioritize military needs
- **Reference**: `CoreStrategyChanges.sql:205`

**Winning Wars**: `+20` to FLAVOR_HAPPINESS

- Successful military campaigns increase happiness focus, possibly to manage war weariness
- **Reference**: `CoreStrategyChanges.sql:231`

**Losing Wars**: `-10` to FLAVOR_HAPPINESS

- Desperate military situations further reduce happiness priorities in favor of survival
- **Reference**: `CoreStrategyChanges.sql:257`

These modifiers stack with the leader's base happiness flavor value, creating dynamic behavior that responds to war conditions.

## Database Flavor Assignments

The following sections detail which game elements have FLAVOR_HAPPINESS values assigned, indicating that leaders with higher happiness flavors will prioritize these options.

### Buildings

Buildings are assigned happiness flavor values in `BuildingFlavorSweeps.sql`. Notable examples:

#### Essential Buildings

- **Courthouse**: 150 (extremely high priority for conquered cities)
- **Satrap's Court**: 150 (Persia's unique courthouse replacement)

#### Happiness-Specific Buildings

- **Circus**: 25 (requires horses luxury resource)
- **Ceilidh Hall**: 30 (Celtic unique building)
- **Grocer**: 25 (provides happiness from spices/sugar)

#### Advanced Buildings

- **Police Station**: 50 (late-game happiness/security)
- **Intelligence Agency**: 50 (national wonder)

#### Corporations

- **Two-Kay Foods**: 25 (franchise)
- **Two-Kay Foods HQ**: 50 (headquarters)

#### Wonders

- **Chichen Itza**: 50 (strong happiness wonder)
- **Prora Resort**: 50 (ideology wonder)
- **Notre Dame**: 20
- **CN Tower**: 30
- **Neuschwanstein**: 10/60 (different values in patches)
- **Circus Maximus**: 20 (national wonder)
- **Globe Theatre**: 10
- **Uffizi**: 10
- **Motherland Calls**: 20
- **Menin Gate**: 35
- **Olympic Village**: 30

### Technologies

Technologies have happiness flavor assignments in `TechFlavorSweeps.sql`:

- **Machinery**: 10 (enables happiness buildings)
- **Chemistry**: 10 (unlocks happiness improvements)
- **Electronics**: 15 (Police Station, Recycling Center)
- **Future Tech**: 10 (provides empire-wide happiness bonus)

### Policies

Policies with happiness flavor values in `PolicyFlavorSweeps.sql`:

#### Tradition Tree

- **Legalism**: 5
- **Representation**: 5

#### Honor Tree

- **Warrior Code**: 5

#### Piety Tree

- **Mandate of Heaven**: 12
- **Theocracy**: 12
- **Free Religion**: 12

#### Patronage Tree

- **Merchant Confederacy**: 15

#### Aesthetics Tree

- **Aesthetics** (opener): 11
- **Fine Arts**: 12

#### Rationalism Tree

- **Rationalism** (opener): 20
- **Sovereignty**: 24
- **Humanism**: 24

#### Ideology Policies (Freedom)

- **Capitalism**: 60
- **Universal Suffrage**: 60
- **Universal Healthcare**: 60

#### Ideology Policies (Order)

- **Dictatorship of Proletariat**: 60
- **Universal Healthcare**: 60

#### Ideology Policies (Autocracy)

- **Police State**: 60

Note that ideology-tier policies have very high happiness flavor values (60), making them extremely attractive to happiness-focused leaders.

### Projects

From `ProjectFlavorChanges.sql`:

- **Public Works**: 25 (project that provides happiness)

### Processes

From `ProcessFlavorSweeps.sql`:

- **World Games**: 50 (World Congress process)
- **United Nations**: 50 (World Congress process)

These very high values indicate that happiness-focused leaders will strongly support happiness-providing international initiatives.

### Events

Player and city events with happiness flavor assignments guide event choice selection:

#### Player Events (`EventFlavorChanges.sql`)

- **Comet Choices 1 & 2**: 20
- **Eclipse Choice 1**: 20
- **War Weariness Choice 1**: 20
- **War Weariness Choice 3**: 30
- **Baths Decision Choice 2**: 20

#### City Events (`CityEventFlavorChanges.sql`)

- **Temple Concerns Choice 3**: 20
- **Hospital Overcrowding Choice 1**: 20
- **Hospital Overcrowding Choice 3**: 15
- **Stadium Local Event Choice 5**: 20
- **Corruption Choice 4**: 20
- **Hurricane Choice 1**: 30

Leaders with high happiness flavors will preferentially choose these event options when available.

### Leader Personalities

From `LeaderFlavorSweeps.sql`, different leaders have varying base happiness flavor values:

- **Standard Range**: 5-8 (most leaders)
- **High Priority**: 10 (Pedro II - reflects Brazil's tourism/happiness UA)
- **Low Priority**: 5 (Isabella, adjusted for naval focus)

Example adjustments documented in the SQL files:

- Casimir: Updated from 5 to 7 (noted as "literally no one has this low")
- Elizabeth: Updated from 5 to 7 (primary focus: domination)
- Harun al-Rashid: Updated from 5 to 7 (primary focus: culture)
- Isabella: Reduced from 8 to 5 (naval focus)
- Kamehameha: Updated from 5 to 7 (primary focus: culture)
- Pedro II: Increased to 10 (matches Brazil's UA mechanics)

The comments in the database indicate that happiness flavor 5 is considered unusually low, with most generalist leaders having at least 7.

## City Strategies

The City Strategy AI includes multiple happiness-related strategies that trigger under specific unhappiness conditions:

- `AICITYSTRATEGY_NEED_HAPPINESS_CULTURE`: Unhappiness from culture needs
- `AICITYSTRATEGY_NEED_HAPPINESS_SCIENCE`: Unhappiness from science needs
- `AICITYSTRATEGY_NEED_HAPPINESS_DEFENSE`: Unhappiness from defense needs
- `AICITYSTRATEGY_NEED_HAPPINESS_GOLD`: Unhappiness from gold needs
- `AICITYSTRATEGY_NEED_HAPPINESS_CONNECTION`: Unhappiness from isolation (not connected to capital)
- `AICITYSTRATEGY_NEED_HAPPINESS_PILLAGE`: Unhappiness from pillaged tiles
- `AICITYSTRATEGY_NEED_HAPPINESS_RELIGION`: Unhappiness from religious unrest
- `AICITYSTRATEGY_NEED_HAPPINESS_STARVE`: Unhappiness from famine

**Reference**: `CvCityStrategyAI.cpp:1596-1611` and `3370-3400`

When these strategies activate, they influence building choices and other city-level decisions, with the happiness flavor affecting how aggressively the AI responds to these conditions.

## Strategic Implications

### For Understanding AI Behavior

Leaders with high FLAVOR_HAPPINESS values will:

1. Aggressively build courthouses in conquered cities
2. Prioritize luxury resource connections
3. Build Circuses and other happiness buildings earlier
4. Adopt Rationalism and Ideology policies that provide happiness
5. Choose religious beliefs with happiness bonuses
6. Construct happiness-focused wonders like Chichen Itza
7. Support World Congress happiness initiatives
8. Prefer settling near luxury resources
9. Respond more strongly to unhappiness emergencies

Leaders with low FLAVOR_HAPPINESS values will:

1. Tolerate lower happiness levels longer
2. Skip optional happiness buildings
3. Delay courthouse construction
4. Prioritize other yields over luxury resource connections
5. Choose policies focused on their other flavor priorities
6. Be more willing to endure war weariness

### War Behavior Patterns

The dynamic adjustments during war create interesting behavior:

- Happiness-focused leaders will significantly increase happiness priorities when winning wars (+20 modifier)
- This may reflect managing war weariness while maintaining expansion
- During defensive wars, happiness priorities drop (-10 when losing), suggesting survival takes precedence
- The base -5 penalty when at war indicates general reprioritization toward military needs

### Cultural Victory Synergy

The Grand Strategy AI code explicitly includes happiness flavor values when calculating Culture Victory priorities. This creates a natural synergy where happiness-focused leaders:

- Are more likely to pursue Culture Victory
- Build culture + happiness buildings like Ceilidh Hall
- Adopt Aesthetics policies that provide both culture and happiness
- Value wonders that provide both yields

This aligns with the historical/thematic concept that culturally influential civilizations often had higher quality of life and happiness.

## Related Flavors

FLAVOR_HAPPINESS often interacts with other flavors in AI calculations:

- **FLAVOR_OFFENSE**: Higher offense flavors increase the happiness multiplier in religion calculations
- **FLAVOR_DEFENSE**: Higher defense flavors decrease the happiness multiplier
- **FLAVOR_GROWTH**: Often paired in building/policy evaluations, as growth increases happiness needs
- **FLAVOR_CULTURE**: Many culture-focused buildings and policies also provide happiness
- **FLAVOR_GOLD**: Economic policies often provide both gold and happiness benefits

## Technical Notes

1. The happiness flavor value is accessed through multiple systems:
   - Direct flavor query: `GC.getInfoTypeForString("FLAVOR_HAPPINESS")`
   - Cached in Grand Strategy AI: `m_iFlavorHappiness`
   - Retrieved with personality + grand strategy modifiers: `GetPersonalityAndGrandStrategy()`

2. Database flavor values act as multipliers in AI weight calculations, not absolute priorities.

3. The happiness flavor is one of the "doubled" flavors in site evaluation because it's the only flavor specifically related to the happiness yield.

4. Dynamic strategy modifiers stack with base personality values, creating context-sensitive behavior.

5. The happiness multiplier formula in religion calculations creates interesting non-linear behavior where aggressive, happiness-focused leaders have the highest happiness needs.
