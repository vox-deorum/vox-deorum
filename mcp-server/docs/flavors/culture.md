# FLAVOR_CULTURE

## Overview

`FLAVOR_CULTURE` is an AI personality flavor that controls how strongly a civilization's leader prioritizes cultural development, policy advancement, and cultural victory pursuit. This flavor fundamentally shapes the AI's approach to social policies, cultural buildings, great works, tourism generation, and ideology selection. It influences both the strategic priority given to culture-generating improvements and how the AI allocates resources toward cultural dominance.

Unlike `FLAVOR_WONDER` which focuses on constructing prestigious buildings, `FLAVOR_CULTURE` directly drives the AI's **desire for cultural output and influence** through policies, buildings, great works, and tourism. This flavor creates the classic "cultural civilizations" that pursue social policy trees, generate great artists/writers/musicians, and seek cultural or diplomatic victories through soft power.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Culture-focused builders: 7-10
  - Balanced culturally-oriented leaders: 5-7
  - Pragmatic/military leaders: 3-5
  - Culture-indifferent leaders: 0-2

## Code References

### 1. City Specialization - Culture Production Weight (CvCitySpecializationAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCitySpecializationAI.cpp` (lines 465-466)

**Function:** `CvCitySpecializationAI::LogSpecializationUpdate()`

FLAVOR_CULTURE directly influences city specialization toward culture generation.

```cpp
int iFlavorCulture = 10 * m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_CULTURE"));
if (iFlavorCulture < 0) iFlavorCulture = 0;
```

**Interpretation:** The culture flavor value is multiplied by 10 and retrieved through the Grand Strategy AI system, which combines base personality with active grand strategy modifiers. This amplified value (0-100 for flavor values 0-10) is used in city specialization calculations to determine how much a city should focus on cultural output.

- **FLAVOR_CULTURE = 10:** 100 points toward culture specialization
- **FLAVOR_CULTURE = 5:** 50 points toward culture specialization
- **FLAVOR_CULTURE = 0:** No culture specialization priority

This ensures cities owned by culture-focused leaders prioritize cultural buildings (Amphitheaters, Opera Houses, Museums, Broadcast Towers) and great work slots over pure production or military infrastructure.

### 2. Grand Strategy - Culture Victory Priority (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 398, 828)

**Function:** Grand Strategy flavor caching and culture victory priority calculation

FLAVOR_CULTURE is cached as a core strategic value and directly influences culture victory pursuit.

```cpp
// Cached during grand strategy updates
m_iFlavorCulture = GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_CULTURE"));

// Used in GetCulturePriority() calculation
int iFlavorCulture = m_pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_CULTURE"));

int iEra = m_pPlayer->GetCurrentEra();
if(iEra <= 0)
{
    iEra = 1;
}
iPriority += ((iEra * iFlavorCulture * 150) / 100);
```

**Interpretation:** This is one of the most important FLAVOR_CULTURE calculations:

1. **Era-scaled priority:** Culture priority increases with game era, reflecting how culture victory becomes more viable in later eras when tourism mechanics activate
   - Ancient Era (1): FLAVOR_CULTURE = 8 → 8 × 1 × 150 / 100 = 12 priority points
   - Renaissance Era (3): FLAVOR_CULTURE = 8 → 8 × 3 × 150 / 100 = 36 priority points
   - Modern Era (5): FLAVOR_CULTURE = 8 → 8 × 5 × 150 / 100 = 60 priority points

2. **Base personality influence:** The personality flavor (not grand strategy modified) is used, ensuring the leader's fundamental cultural inclination drives this strategic choice

3. **Multiplier of 150:** Each point of culture flavor is worth 1.5× its value per era, creating strong scaling for culture-focused leaders

This calculation ensures culture-oriented leaders increasingly prioritize culture victory as the game progresses and cultural mechanics (tourism, archaeology, great works, theming bonuses) become more important.

### 3. Grand Strategy - Policy Flavor Bonus (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 914-917, 947-950)

**Function:** Grand strategy priority based on adopted policies and constructed buildings

When a player adopts social policies or constructs buildings with FLAVOR_CULTURE values, it increases culture-focused grand strategy priority.

```cpp
// For adopted policies
else if(GC.getFlavorTypes((FlavorTypes) iFlavorLoop) == "FLAVOR_CULTURE")
{
    iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
}

// For constructed buildings
else if(GC.getFlavorTypes((FlavorTypes) iFlavorLoop) == "FLAVOR_CULTURE")
{
    iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop);
}
```

**Interpretation:** This creates strategic feedback loops that reinforce cultural playstyles:

**Policy Example - Aesthetics Tree:**

- Adopting Aesthetics opener (FLAVOR_CULTURE = 25) adds +25 to culture victory priority
- Cultural Exchange policy adds its culture flavor value
- Fine Arts policy adds its culture flavor value
- Result: +50-75 total culture victory priority from the tree

**Building Example:**

- Amphitheater (FLAVOR_CULTURE = 8) × number of cities = +40 for 5 cities
- Opera House (FLAVOR_CULTURE = 10) × number of cities = +50 for 5 cities
- Museum (FLAVOR_CULTURE = 12) × number of cities = +60 for 5 cities
- Broadcast Tower (FLAVOR_CULTURE = 15) × number of cities = +75 for 5 cities
- Cumulative effect: +225 culture victory priority

This **commitment mechanism** ensures that once a leader invests in cultural infrastructure, they increasingly commit to culture victory rather than pivoting to conquest or science victory. It rewards strategic consistency and prevents erratic AI behavior.

### 4. Victory Pursuit - Culture Victory Score (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (lines 2396-2397)

**Function:** `CvDiplomacyAI::DoUpdateVictoryPursuitScores()` - Victory type prioritization

FLAVOR_CULTURE directly contributes to the AI's preference for culture victory.

```cpp
// Weight for culture
VictoryScores[VICTORY_PURSUIT_CULTURE] += GetDoFWillingness();
VictoryScores[VICTORY_PURSUIT_CULTURE] += GetWonderCompetitiveness();
VictoryScores[VICTORY_PURSUIT_CULTURE] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_WONDER")) / 2;
VictoryScores[VICTORY_PURSUIT_CULTURE] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_CULTURE")) / 2;
```

**Interpretation:** FLAVOR_CULTURE contributes half its value to culture victory pursuit score, combining with:

- **DoF Willingness:** Preference for peaceful diplomacy (culture victories benefit from open borders and trade routes)
- **Wonder Competitiveness:** Desire to build wonders (many provide culture and tourism)
- **FLAVOR_WONDER:** Wonder-building preference (half value)

**Example Calculation:**

- Leader with FLAVOR_CULTURE = 10 → +5 to culture victory score
- FLAVOR_WONDER = 8 → +4 to culture victory score
- DoF Willingness = 7 → +7 to culture victory score
- Wonder Competitiveness = 6 → +6 to culture victory score
- **Total: +22 culture victory score**

This makes culture-focused leaders significantly more likely to pursue policies, technologies, buildings, and diplomatic strategies that support cultural dominance and tourism generation.

### 5. City Strategy - Minor Civ Interaction (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (lines 32225-32226)

**Function:** City-state gift and bullying decision-making

FLAVOR_CULTURE influences how the AI values cultural city-states and their bonuses.

```cpp
int iCultureFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_CULTURE"));
```

**Interpretation:** When evaluating city-state interactions, culture flavor determines:

1. **Cultural City-State Priority:** Higher flavor increases the value of allying with cultural city-states
   - Cultural city-states provide flat culture bonuses when allied
   - High FLAVOR_CULTURE leaders prioritize gold gifts to cultural city-states over maritime or militaristic ones

2. **Gift Targeting:** Leaders with high culture flavor are more likely to:
   - Send gold gifts to cultural city-states
   - Complete cultural city-state quests
   - Protect cultural city-states from conquest
   - Avoid bullying cultural city-states (even if they have bullying bonuses)

3. **Opportunity Cost:** Leaders with low culture flavor may bully cultural city-states for immediate benefits, while high-culture leaders preserve these relationships for long-term cultural bonuses

This ensures culture-focused leaders build strong relationships with cultural city-states, creating a network of cultural support that compounds their cultural output.

### 6. Ideology Selection and Opinion (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (lines 17938-17948, 47468-47479)

**Function:** Ideology importance and diplomatic opinion based on ideology alignment

FLAVOR_CULTURE determines how much the AI cares about ideologies and ideological alignment with other civilizations.

```cpp
// Ideology importance calculation
int iFlavorCulture = m_pPlayer->GetFlavorManager()->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_CULTURE"));
int iIdeologueScore = max(iFlavorCulture, GC.getEraInfo((EraTypes)iGameEra)->getDiploEmphasisLatePolicies());

if (iFlavorCulture < 5)
{
    iIdeologueScore = max(0, iIdeologueScore - 2);
}
else if (iFlavorCulture > 7)
{
    iIdeologueScore += 2;
}

// Ideology opinion weight calculation
int iEraMod = GC.getEraInfo(GC.getGame().getCurrentEra())->getDiploEmphasisLatePolicies();

// Weight increases or decreases based on flavors
if (iFlavorCulture < 5)
{
    iEraMod = max(0, iEraMod - 1);
}
else if (iFlavorCulture > 7)
{
    iEraMod++;
}
```

**Interpretation:** FLAVOR_CULTURE creates sophisticated ideological behavior:

1. **Low Culture (<5):** Pragmatic leaders who don't care much about ideology
   - Reduced ideology importance score (-2)
   - Lower diplomatic penalty for different ideologies
   - More willing to align with any ideology based on practical benefits
   - Example: Military leaders who choose ideology based on military tenets

2. **Moderate Culture (5-7):** Standard ideological commitment
   - Base ideology importance from era
   - Normal diplomatic modifiers for ideology alignment
   - Balanced between ideological principles and pragmatism

3. **High Culture (>7):** Ideological zealots who deeply care about cultural/political alignment
   - Increased ideology importance (+2)
   - Higher diplomatic bonus for same ideology
   - Higher diplomatic penalty for different ideologies
   - More resistant to ideology pressure
   - Example: Cultural leaders who strongly prefer Freedom for culture bonuses or Autocracy for specific policy synergies

**Strategic Impact:**

- Culture-focused leaders form strong ideological blocs
- High FLAVOR_CULTURE + same ideology = significant diplomatic bonus
- High FLAVOR_CULTURE + different ideology = significant diplomatic penalty
- Creates late-game Cold War dynamics where cultural leaders become ideological allies or enemies

This ensures culture-focused civilizations take ideologies seriously, creating meaningful diplomatic consequences for ideology choices rather than treating them as purely mechanical decisions.

### 7. Archaeological Dig Agreements (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (lines 43082-43086, 44707-44712)

**Function:** Willingness to allow archaeological digs in player's territory

FLAVOR_CULTURE affects how protective the AI is about archaeological sites in their territory.

```cpp
// In promise evaluation
int iFlavorCulture = m_pPlayer->GetFlavorManager()->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_CULTURE"));
bool bCultural = iFlavorCulture > 6;
bCultural |= IsCultural() || IsSecondaryCultural();
bCultural |= IsCompetingForVictory() && IsGoingForCultureVictory();
bCultural = GetPlayer()->GetPlayerTraits()->IsTourism();

// In no-digging evaluation
if (iFlavorCulture > 4 && GetPlayer()->GetPlayerTraits()->IsTourism())
{
    return false;  // Won't agree to no-digging promises
}

if (iFlavorCulture < 7)
{
    return true;  // Will agree to no-digging promises
}
```

**Interpretation:** This creates nuanced archaeological diplomacy:

1. **Low Culture (<4):** Indifferent to archaeology
   - Easily agrees to no-digging promises
   - Doesn't care if others extract artifacts from their territory
   - Won't break promises about archaeology

2. **Moderate Culture (4-6):** Somewhat protective
   - May agree to no-digging promises if relationship is good
   - Moderately annoyed by promise breaks
   - Considers archaeological sites valuable but not critical

3. **High Culture (7-10) or Tourism Trait:** Highly protective of cultural heritage
   - Refuses to agree to no-digging promises
   - Wants to excavate all artifacts in their territory for tourism bonuses
   - Strongly annoyed by broken promises about archaeology
   - Views archaeological sites as strategic resources for culture victory

**Tourism Trait Override:** Leaders with tourism-focused traits (Brazil, France, etc.) are protective of archaeological sites even with moderate culture flavor (>4), reflecting their strategic need for great works and artifacts.

**Promise Breaking Consequences:**

- Breaking archaeological promises with high-FLAVOR_CULTURE leaders: -10 to -20 diplomatic penalty (doubled compared to low-culture leaders)
- Cultural leaders remember broken promises longer
- Creates diplomatic costs for aggressive archaeological expansion

This ensures culture-focused civilizations treat their cultural heritage as strategically valuable, creating meaningful decisions about archaeological agreements and preventing exploitation of cultural sites.

### 8. Technology Priority - Culture Focus (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (lines 1272-1277)

**Function:** `CvPlayerTechs::SetLocalePriorities()` - Technology research prioritization

FLAVOR_CULTURE influences technology selection when pursuing culture-focused grand strategies.

```cpp
if(bCultureFocus && (
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_CULTURE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_GREAT_PEOPLE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_WONDER"))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

**Interpretation:** When the AI's grand strategy is culture-focused, technologies with FLAVOR_CULTURE values receive increased research priority. This ensures culture-builders research the technologies needed for cultural infrastructure:

**Early Game (Ancient-Classical):**

- Drama and Poetry (Amphitheaters, Writers' Guilds)
- Philosophy (National College, allows educated Great People generation)
- Calendar (Plantation improvements for luxury resources → happiness → culture)

**Mid Game (Medieval-Renaissance):**

- Acoustics (Opera Houses, Musicians' Guilds)
- Printing Press (significant culture boost, Leaning Tower of Pisa)
- Archaeology (Museums, archaeological digs for artifacts)

**Late Game (Industrial-Information):**

- Radio (Broadcast Towers, massive culture generation)
- Computers (Internet wonder, CN Tower)
- Globalization (cultural output bonuses)

This creates a **coherent research path** where culture-focused leaders don't get sidetracked researching military or economic technologies at the expense of cultural infrastructure unlocks. The priority bonus ensures cultural techs are researched in timely fashion to maintain cultural momentum.

### 9. Advisor Recommendation Priority (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (likely in flavor weight calculations)

**Function:** Advisor recommendation system

FLAVOR_CULTURE influences which buildings, units, and technologies the Economic and Foreign advisors recommend.

**Interpretation:** The Economic Advisor uses FLAVOR_CULTURE when evaluating:

- **Cultural buildings:** Amphitheaters, Opera Houses, Museums, Broadcast Towers
- **Wonder recommendations:** Cultural wonders like Sistine Chapel, Louvre, Broadway
- **Infrastructure:** Buildings that provide culture as secondary benefits

The Foreign Advisor uses FLAVOR_CULTURE when evaluating:

- **Diplomatic buildings:** Hotels, Airports (tourism-related)
- **City-state interactions:** Cultural city-state alliances
- **Wonder recommendations:** Diplomatic wonders with cultural components

This ensures that when the player asks for advisor recommendations, culture-focused leaders receive suggestions aligned with their cultural strategy rather than generic military or economic advice.

## Summary of Effects

### Strategic Planning

- **Victory focus:** Significantly increases preference for culture victory over domination or conquest paths
- **Grand strategy:** Creates strong feedback loops with culture-focused grand strategies
- **Technology path:** Prioritizes research of culture-enabling technologies when pursuing culture strategies
- **Ideology importance:** High culture flavor makes leaders deeply care about ideological alignment (>7) or indifferent (<5)

### Production and Development

- **City specialization:** Drives cities to focus on culture generation (up to 100 weight for FLAVOR_CULTURE = 10)
- **Building priority:** Determines how aggressively the AI builds cultural infrastructure (Amphitheaters, Museums, etc.)
- **Great work management:** Influences desire to generate Great Artists, Writers, and Musicians for great works
- **Wonder selection:** Works synergistically with FLAVOR_WONDER for culture-generating wonders

### Diplomatic Strategy

- **City-state focus:** Highly values cultural city-states and their alliance bonuses
- **Ideology alignment:** Creates strong preferences for ideological allies and opposition to ideological rivals
- **Archaeological protection:** Makes leaders protective of archaeological sites (FLAVOR_CULTURE > 6) for tourism
- **Cultural competition:** Increases sensitivity to other civilizations' cultural progress and tourism

### Adaptive Behavior

- **Policy commitment:** Building cultural infrastructure reinforces culture-focused strategies through feedback loops
- **Era scaling:** Culture priority increases with game era as cultural mechanics become more important
- **Tourism trait synergy:** Leaders with tourism traits are more protective of cultural assets even at moderate flavor values

## Design Philosophy

FLAVOR_CULTURE represents the AI's fundamental approach to soft power and cultural influence:

1. **Cultural Ambition:** The desire to achieve dominance through ideas, art, and cultural output rather than military force
2. **Long-term Investment:** Willingness to invest in cultural infrastructure that provides compounding benefits over time
3. **Ideological Commitment:** How deeply the AI cares about political/cultural ideology and alignment with similar civilizations
4. **Heritage Protection:** The value placed on archaeological sites, great works, and cultural landmarks

This creates a spectrum of AI personalities:

- **High CULTURE (8-10):** Classic culture-builders like France, Brazil, Polynesia - pursue culture victory, protect heritage, ideological zealots
- **Moderate CULTURE (5-7):** Balanced leaders who value culture but don't obsess over it - build cultural infrastructure opportunistically
- **Low CULTURE (2-4):** Pragmatic leaders who view culture as a means to an end - focus on happiness and policy unlocks rather than victory
- **Culture-indifferent (0-1):** Leaders who virtually ignore culture, focusing entirely on military or science

## Typical Leader Examples

Based on the AI flavor system, typical FLAVOR_CULTURE values for leader archetypes:

- **Napoleon (France):** 9-10 - Historical cultural powerhouse with tourism bonuses
- **Pedro II (Brazil):** 8-9 - Culture-focused with tourism from golden ages
- **Gandhi (India):** 7-8 - Peaceful builder with strong cultural inclinations
- **Augustus Caesar (Rome):** 5-6 - Balanced leader who values culture but prioritizes expansion
- **Washington (America):** 4-5 - Practical leader who uses culture for policy benefits
- **Alexander (Greece):** 2-3 - Conquest-focused with minimal culture interest
- **Attila (Huns):** 0-1 - Pure warmonger with no cultural focus

## Related Flavors

- **FLAVOR_WONDER:** Wonder construction; highly correlated with FLAVOR_CULTURE (wonders provide culture and great work slots)
- **FLAVOR_GREAT_PEOPLE:** Great People generation; works synergistically (Great Artists, Writers, Musicians drive culture victory)
- **FLAVOR_DIPLOMACY:** Diplomatic approach; moderately correlated (culture victory benefits from peaceful relations)
- **FLAVOR_HAPPINESS:** Citizen happiness; moderate correlation (happiness enables golden ages, which boost culture and tourism)
- **FLAVOR_GROWTH:** Population growth; moderate correlation (larger cities generate more culture)
- **FLAVOR_OFFENSE:** Military aggression; inversely correlated (culture-builders tend to be peaceful)
- **FLAVOR_SCIENCE:** Science focus; competing priority (science victory vs. culture victory trade-off)

FLAVOR_CULTURE typically correlates strongly with FLAVOR_WONDER, FLAVOR_GREAT_PEOPLE, and FLAVOR_DIPLOMACY, creating the "peaceful culture victory builder" archetype. It inversely correlates with FLAVOR_OFFENSE and FLAVOR_EXPANSION, as cultural development requires stability and focused development rather than aggressive military expansion.

## Interaction with Game Systems

### Culture Generation Mechanics

The effectiveness of FLAVOR_CULTURE is amplified by:

- **Civilization traits:** France (+2 culture from chateaux), Brazil (tourism from golden ages), Polynesia (+1 culture from moai)
- **Policy bonuses:** Aesthetics tree, Tradition tree, Freedom ideology
- **Religious beliefs:** Beliefs providing culture bonuses (Religious Art, Sacred Sites)
- **Golden Ages:** +20% culture and tourism during golden ages
- **Theming bonuses:** Museums and wonders with themed great works provide bonus culture and tourism

### Tourism and Cultural Influence

FLAVOR_CULTURE directly influences tourism strategy:

- **Great work creation:** Generating Great Artists, Writers, and Musicians for great works
- **Archaeological focus:** Excavating artifacts for archaeological museums
- **Wonder selection:** Building tourism-generating wonders (Eiffel Tower, Cristo Redentor, Broadway)
- **Open borders:** Establishing open borders for tourism transmission
- **Trade routes:** International trade routes increase tourism influence

### Ideology Mechanics

High FLAVOR_CULTURE creates strong ideology dynamics:

- **Ideological pressure:** Culture-focused leaders are more resistant to ideological pressure
- **Public opinion:** Care deeply about ideology-related happiness penalties
- **Diplomatic alignment:** Form strong ideological blocs with like-minded civilizations
- **World Congress:** Support ideology-related proposals that benefit their chosen path

### Policy Tree Selection

FLAVOR_CULTURE influences policy tree preferences:

- **Tradition (FLAVOR_CULTURE = 8):** Strong preference for culture-focused leaders
- **Aesthetics (FLAVOR_CULTURE = 25):** Extremely attractive to high-culture leaders
- **Patronage (FLAVOR_CULTURE = 5):** Moderate attraction for cultural city-state bonuses
- **Freedom ideology (FLAVOR_CULTURE high):** Preferred by culture victory pursuers for tourism bonuses

## Configuration and Tuning

The culture flavor interacts with several key game constants:

**Era-based scaling multiplier:**

```cpp
iPriority += ((iEra * iFlavorCulture * 150) / 100);
```

- The 150 multiplier determines how strongly culture flavor influences victory pursuit
- Increasing to 175 or 200 would make culture-focused leaders more committed to culture victory
- Decreasing to 125 or 100 would make them more flexible in victory approach

**City specialization weight:**

```cpp
int iFlavorCulture = 10 * m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(...);
```

- The 10× multiplier determines city specialization toward culture generation
- Increasing this multiplier makes culture-focused cities more specialized
- Decreasing makes specialization more subtle and gradual

**Ideology thresholds:**

- Low culture threshold: `< 5` (pragmatic about ideology)
- High culture threshold: `> 7` (ideological zealot)
- Adjusting these thresholds changes how many leaders care about ideology

## Strategic Implications

### Early Game

High FLAVOR_CULTURE leaders:

- Build Monuments in all cities quickly
- Research Philosophy and Drama and Poetry early
- Adopt Tradition policy tree for culture bonuses
- Prioritize cultural city-states for alliance
- Build cultural wonders (Stonehenge, Temple of Artemis)

### Mid Game

High FLAVOR_CULTURE leaders:

- Construct Amphitheaters and Opera Houses in all cities
- Generate Great Writers and Artists for great works
- Build cultural wonders (Sistine Chapel, Uffizi, Globe Theatre)
- Establish cultural heritage sites for theming bonuses
- Research Archaeology for museums

### Late Game

High FLAVOR_CULTURE leaders:

- Choose ideology based on culture/tourism bonuses (often Freedom)
- Build Hotels and Airports for tourism multipliers
- Construct late cultural wonders (Eiffel Tower, Cristo Redentor, Sydney Opera House, Broadway)
- Excavate archaeological sites aggressively
- Form ideological alliances with like-minded civilizations
- Push for culture victory through tourism dominance

### Victory Conditions

FLAVOR_CULTURE is the primary driver for:

- **Culture Victory:** Direct pursuit through tourism and cultural influence
- **Diplomatic Victory:** Supporting factor (culture leaders tend to be diplomatic and befriend city-states)
- **Science Victory:** Competing priority (high culture often means lower science focus)
- **Domination Victory:** Inverse correlation (culture-builders avoid military conflict)

High FLAVOR_CULTURE leaders will strongly commit to culture victory once they've invested in cultural infrastructure, making them predictable but formidable cultural opponents who must be countered through military pressure, ideological competition, or faster tourism generation.
