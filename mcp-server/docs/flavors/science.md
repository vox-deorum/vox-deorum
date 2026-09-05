# FLAVOR_SCIENCE

## Overview

`FLAVOR_SCIENCE` is an AI personality flavor that controls how strongly a civilization's leader prioritizes scientific research and technology advancement. This flavor fundamentally shapes the AI's approach to technological progression, influencing everything from building construction priorities to technology research paths, trade route evaluation, and overall victory condition pursuit.

Unlike `FLAVOR_SPACESHIP` (which focuses specifically on the space race endgame), `FLAVOR_SCIENCE` broadly drives the AI's **commitment to science infrastructure and research throughout the entire game**, from libraries in the ancient era to research labs in the atomic era.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Science-focused leaders (science victory specialists): 8-10
  - Balanced/generalist leaders: 5-7
  - Diplomatic/cultural leaders: 3-5
  - Pure warmongers and production-focused leaders: 2-4

## Code References

### 1. City Site Evaluation - Science Yield Multiplier (CvSiteEvaluationClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvSiteEvaluationClasses.cpp` (lines 223-230)

**Function:** `CvCitySiteEvaluator::ComputeFlavorMultipliers()`

FLAVOR_SCIENCE is a primary factor in evaluating potential city settlement locations, directly affecting how the AI values science-generating tiles and features.

```cpp
else if(strFlavor == "FLAVOR_SCIENCE")
{
    // Doubled since only one flavor related to science
    m_iFlavorMultiplier[YIELD_SCIENCE] += pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(eFlavor) * 2;
    if(pkCitySpecializationEntry)
    {
        m_iFlavorMultiplier[YIELD_SCIENCE] += pkCitySpecializationEntry->GetFlavorValue(eFlavor) * 2;
    }
}
```

**Interpretation:** FLAVOR_SCIENCE directly increases the science yield multiplier used in city site evaluation, and is **doubled** because it is the only flavor associated with science output. A leader with FLAVOR_SCIENCE = 9 will weight science tiles 18 times more heavily when selecting settlement locations. This creates a strong preference for:

- Mountain ranges (for observatory placement)
- Jungle tiles (which provide science when worked with universities)
- Natural wonders that provide science yields
- Locations with science-boosting terrain features

The doubling mechanic reflects science's unique position as having fewer contributing flavors than other yields like production or gold.

### 2. Builder (Worker) Tasking - Science Improvement Priority (CvBuilderTaskingAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvBuilderTaskingAI.cpp` (lines 2704-2708)

**Function:** `CvBuilderTaskingAI::ScorePlot()`

FLAVOR_SCIENCE determines how workers prioritize building improvements that increase science yield.

```cpp
case YIELD_SCIENCE:
    if(GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_SCIENCE")
    {
        iYieldDifferenceWeight += iDeltaYield * pFlavorManager->GetPersonalityIndividualFlavor((FlavorTypes)iFlavorLoop)
            * /*2*/ GD_INT_GET(BUILDER_TASKING_PLOT_EVAL_MULTIPLIER_SCIENCE);
    }
    break;
```

**Interpretation:** When workers evaluate which tiles to improve, FLAVOR_SCIENCE multiplies the science yield improvement value by both the flavor value and a configurable multiplier (default 2). This means:

- A leader with FLAVOR_SCIENCE = 9 will value a +2 science improvement as: 2 × 9 × 2 = 36 points
- A leader with FLAVOR_SCIENCE = 4 will value it as: 2 × 4 × 2 = 16 points

**Practical Effect:** High-science leaders will prioritize:

- Clearing jungle tiles and replacing with trading posts (if beneficial)
- Building academies (great scientist improvements) on optimal tiles
- Improving tiles near mountains for observatory bonuses
- Prioritizing science-enhancing improvements over pure gold or food

### 3. City Specialization - Science Focus (CvCitySpecializationAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCitySpecializationAI.cpp` (lines 459-460)

**Function:** `CvCitySpecializationAI::LogSpecializationUpdate()`

FLAVOR_SCIENCE influences long-term city specialization decisions, determining whether cities should focus on scientific output.

```cpp
int iFlavorScience = 10 * m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_SCIENCE"));
if (iFlavorScience < 0) iFlavorScience = 0;
```

**Interpretation:** The science flavor is multiplied by 10 and combined with the active grand strategy to create a city specialization weight. This means:

- FLAVOR_SCIENCE = 8 adds 80 weight toward science-focused specialization
- Cities will prioritize buildings that provide science bonuses (libraries, universities, research labs)
- Science-specialized cities will assign specialists to scientist slots
- Citizen management will prioritize working science-generating tiles

**Strategic Impact:** Science-specialized cities become research hubs, generating the majority of the civilization's beaker output while other cities focus on production, gold, or military.

### 4. Victory Pursuit - Science Victory Preference (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (line 2403)

**Function:** `CvDiplomacyAI::DoUpdateVictoryPursuitScores()`

FLAVOR_SCIENCE directly contributes to the AI's preference for pursuing science victory.

```cpp
// Weight for science
VictoryScores[VICTORY_PURSUIT_SCIENCE] += GetLoyalty();
VictoryScores[VICTORY_PURSUIT_SCIENCE] += GetWarmongerHate();
VictoryScores[VICTORY_PURSUIT_SCIENCE] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_SCIENCE")) / 2;
VictoryScores[VICTORY_PURSUIT_SCIENCE] += pFlavorMgr->GetPersonalityFlavorForDiplomacy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GROWTH")) / 2;
```

**Interpretation:** FLAVOR_SCIENCE contributes half its value to science victory pursuit scoring. Combined with loyalty (peacekeeping tendency) and warmonger hate (dislike of aggressive behavior), this creates a profile of science-victory pursuers:

- FLAVOR_SCIENCE = 10 adds 5 points toward science victory
- High loyalty adds additional points (peaceful leaders prefer science)
- High warmonger hate adds points (science leaders avoid military conflicts)

**Victory Preference Pattern:** Leaders with high FLAVOR_SCIENCE typically pursue technology-based victories rather than military conquest, making them diplomatic and research-focused rather than aggressive.

### 5. Grand Strategy - Science Victory Priority (CvGrandStrategyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp` (lines 397, 1376-1379, 1442-1443, 1479-1480)

**Function:** Multiple grand strategy calculations

FLAVOR_SCIENCE is cached and used throughout the grand strategy system to influence overall strategic direction.

#### Flavor Caching

```cpp
m_iFlavorScience = GetPersonalityAndGrandStrategy((FlavorTypes)GC.getInfoTypeForString("FLAVOR_SCIENCE"));
```

**Interpretation:** Science flavor is stored as a member variable for fast access throughout grand strategy calculations, indicating its importance across multiple strategic subsystems.

#### Science Victory Priority Calculation

```cpp
int iFlavorScience = m_pPlayer->GetFlavorManager()->GetPersonalityIndividualFlavor(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_SCIENCE"));

// the later the game the greater the chance
iPriority += ((m_pPlayer->GetCurrentEra() * m_pPlayer->GetCurrentEra()) * max(1, iFlavorScience) * 300) / 100;
```

**Interpretation:** Science victory priority increases **quadratically** with era advancement, scaled by FLAVOR_SCIENCE:

- **Ancient Era (0):** 0 × 0 × max(1, 9) × 3 = 0 bonus
- **Classical Era (1):** 1 × 1 × 9 × 3 = 27 bonus
- **Medieval Era (2):** 2 × 2 × 9 × 3 = 108 bonus
- **Renaissance Era (3):** 3 × 3 × 9 × 3 = 243 bonus
- **Industrial Era (4):** 4 × 4 × 9 × 3 = 432 bonus
- **Modern Era (5):** 5 × 5 × 9 × 3 = 675 bonus
- **Atomic Era (6):** 6 × 6 × 9 × 3 = 972 bonus

**Strategic Impact:** Science victory becomes exponentially more attractive in later eras for high-science leaders, representing the momentum of technological advancement. A leader with FLAVOR_SCIENCE = 2 gets only 1/4 the bonus of a leader with FLAVOR_SCIENCE = 8, creating clear science specialists versus generalists.

#### Building Priority for Science Victory

```cpp
for(int iFlavorLoop = 0; iFlavorLoop < GC.getNumFlavorTypes(); iFlavorLoop++)
{
    if(GC.getFlavorTypes((FlavorTypes) iFlavorLoop) == "FLAVOR_SCIENCE")
    {
        iPriorityBonus += pkLoopBuilding->GetFlavorValue(iFlavorLoop);
    }
}
```

**Interpretation:** When evaluating science victory pursuit, the AI sums the FLAVOR_SCIENCE values of all buildings it has constructed. Each science-focused building increases the appeal of continuing toward science victory.

**Feedback Loop Effect:** Building libraries (FLAVOR_SCIENCE: 40), universities (FLAVOR_SCIENCE: 50), and research labs (FLAVOR_SCIENCE: 75) creates momentum toward science victory, with cumulative priority bonuses making it harder to switch strategies mid-game.

### 6. Technology Research - Science Focus Priority (CvTechClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTechClasses.cpp` (line 1278)

**Function:** `CvPlayerTechs::GetResearchPriority()`

FLAVOR_SCIENCE increases research priority for technologies when pursuing a science-focused grand strategy.

```cpp
if(bScienceFocus && (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SCIENCE" ||
    GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SPACESHIP"))
{
    m_piGSTechPriority[iTechLoop]++;
}
```

**Interpretation:** When the AI's grand strategy is science-focused, technologies with FLAVOR_SCIENCE or FLAVOR_SPACESHIP flavors receive bonus research priority. This creates a beeline effect where science leaders rapidly advance through the technology tree toward key science-enhancing technologies.

**Technology Beeline Examples:**

- Ancient: Writing (libraries) → Philosophy
- Medieval: Education (universities)
- Renaissance: Astronomy → Scientific Theory
- Industrial: Scientific Theory (public schools) → Biology
- Modern: Corporations → Plastic → Satellites
- Atomic: Nuclear Fusion → Particle Physics

### 7. Trade Route Evaluation - Science Route Scoring (CvTradeClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvTradeClasses.cpp` (lines 6280, 6284, 6957)

**Function:** `CvPlayerTrade::GetTradeConnectionValue()`

FLAVOR_SCIENCE influences how the AI values trade routes that generate science yields.

```cpp
int iFlavorScience = m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_SCIENCE"));

int iScienceScore = (iTechDelta * iFlavorScience);

//add it all up
int iScore = iGoldScore + iScienceScore + iCultureScore + iReligionScore;
```

**Interpretation:** Trade route value is calculated by weighing each yield type (gold, science, culture, religion) by the corresponding flavor. Science yields from trade routes are multiplied directly by FLAVOR_SCIENCE:

- A trade route generating +3 science with FLAVOR_SCIENCE = 9 scores: 3 × 9 = 27 science points
- The same route with FLAVOR_SCIENCE = 3 scores: 3 × 3 = 9 science points

**Trade Route Priority:**

- High FLAVOR_SCIENCE leaders prefer research agreements and internal trade routes to science-producing cities
- External trade routes to more advanced civilizations become highly valued (they provide more science)
- Maritime trade routes to city-states with science bonuses are prioritized

**Strategic Impact:** Science-focused civilizations will establish trade networks that maximize technology transfer, creating an economic strategy aligned with their research goals.

### 8. Religion Founding - Scientist Generation (CvReligionClasses.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvReligionClasses.cpp` (line 8099)

**Function:** `CvReligionAI::ScoreBeliefForPlayer()`

FLAVOR_SCIENCE heavily influences which religious beliefs the AI selects when founding or enhancing religions, particularly those that generate science yields.

```cpp
case YIELD_SCIENCE:
    iPersonFlavor = pFlavorManager->GetPersonalityIndividualFlavor(
        (FlavorTypes)GC.getInfoTypeForString("FLAVOR_SCIENCE")) * 80;
    break;
```

**Interpretation:** When evaluating religious beliefs that grant science yields, FLAVOR_SCIENCE is multiplied by 80, creating the **highest multiplier of any yield type except faith (110)**. This massive weighting creates enormous differences:

- FLAVOR_SCIENCE = 9: Science-granting beliefs score 720 points
- FLAVOR_SCIENCE = 3: Science-granting beliefs score 240 points

**Affected Beliefs:**

- Jesuit Education (may purchase any type of building with Faith)
- Religious Idols (+1 culture and science from every mine)
- Religious Community (science from following cities)
- Monasteries (religious buildings providing science)
- Pagodas (science from religion spread)

**Strategic Impact:** Science-focused leaders will almost always select beliefs that enhance scientific research, particularly those providing science from religious buildings or allowing faith-purchase of science buildings. This creates a synergy between religious spread and technological advancement.

### 9. Policy Selection - Science Policy Weighting (CvPolicyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp` (lines 4968-4975)

**Function:** Social policy selection priority

FLAVOR_SCIENCE adds weight to social policies that provide science bonuses, particularly those in the Rationalism tree.

```cpp
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SCIENCE")
{
    iScienceValue += iFlavorValue;
}
else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_SPACESHIP")
{
    iScienceValue += iFlavorValue;
}
```

**Interpretation:** Policies with FLAVOR_SCIENCE values are prioritized by science-focused leaders. The flavor value from the policy is accumulated into a science value score that influences policy selection.

**Science-Focused Policies:**

- Rationalism Tree (FLAVOR_SCIENCE: 30) - Primary science policy tree
  - Secularism (FLAVOR_SCIENCE: 24) - Science from specialists
  - Sovereignty (FLAVOR_SCIENCE: 24) - Science from Golden Ages
  - Free Thought (FLAVOR_SCIENCE: 24) - Science from trading posts
  - Humanism (FLAVOR_SCIENCE: 24) - Science from great scientists
  - Scientific Revolution (FLAVOR_SCIENCE: 24) - Research agreements
  - Rationalism Finisher (FLAVOR_SCIENCE: 50) - Massive completion bonus
- Order Ideology
  - Young Pioneers (FLAVOR_SCIENCE: 60) - Science from workers
  - Academy of Sciences (FLAVOR_SCIENCE: 60) - Scientist generation
  - Workers' Faculties (FLAVOR_SCIENCE: 60) - Science from factories
  - Mobilization (FLAVOR_SCIENCE: 60) - Science during Golden Ages
- Aesthetics (FLAVOR_SCIENCE: 12) - Culture-science synergy
  - Cultural Centers (FLAVOR_SCIENCE: 12)
- Exploration
  - Mercantilism (FLAVOR_SCIENCE: 24) - City-state science bonuses
  - Naval Tradition (FLAVOR_SCIENCE: 24) - Naval science
- Freedom Ideology
  - Capitalism (FLAVOR_SCIENCE: 30) - Economic science
  - Nationalization (FLAVOR_SCIENCE: 30)

**Policy Tree Priority:** Leaders with FLAVOR_SCIENCE ≥ 7 will strongly favor the Rationalism policy tree, often opening it immediately after completing their opening tree (Tradition/Liberty/Honor). The Rationalism finisher bonus (FLAVOR_SCIENCE: 50) makes completing the tree extremely attractive.

**Ideology Selection:** High FLAVOR_SCIENCE leaders favor Order ideology for its massive science bonuses from infrastructure and workers, though Freedom's Capitalism policy also provides science benefits for gold-focused science players.

### 10. City-State Interaction - Science Gift Priorities (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (line 32224)

**Function:** City-state gift and alliance priority calculation

FLAVOR_SCIENCE influences which city-states the AI values and how much to invest in them.

```cpp
int iScienceFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_SCIENCE"));
```

**Interpretation:** This flavor value is retrieved when calculating city-state alliance priorities. Leaders with high FLAVOR_SCIENCE will value:

- Science city-states (which provide direct science yields when allied)
- City-states near mountains or jungles (useful for observatory/university bonuses)
- City-states that request scientific quests (technology sharing, research agreements)
- City-states in strategic research hub locations

**Strategic Investment:** Science-focused leaders will invest more gold in science city-states and prioritize their protection from aggressive neighbors, creating a network of research-producing allies that supplement the civilization's own science output.

### 11. Advisor Recommendation System (CvAdvisorRecommender.cpp & CvAdvisorCounsel.cpp)

**Location:**

- `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (lines 489-492)
- `CvGameCoreDLL_Expansion2/CvAdvisorCounsel.cpp` (lines 195-204)

**Function:** Science advisor recommendation priority and counsel system

FLAVOR_SCIENCE determines the priority weight for science-related advisor recommendations.

#### Advisor Recommendation Priority

```cpp
else if(strFlavorName == "FLAVOR_SCIENCE")
{
    return 13;
}
```

**Interpretation:** FLAVOR_SCIENCE receives a priority weight of 13 in the science advisor's recommendation system. This is moderate priority, higher than military flavors (7-10) but lower than spaceship (17), reflecting that science is important throughout the game but becomes critical only when approaching space victory.

**Advisor Behavior:** The science advisor will recommend:

- Building libraries, universities, and research labs
- Researching science-enhancing technologies
- Establishing research agreements with other civilizations
- Placing academies with great scientists
- Working scientist specialist slots

#### Science Advisor Counsel Detection

```cpp
// find flavor science
FlavorTypes eFlavorScience = NO_FLAVOR;
for(int iFlavorLoop = 0; iFlavorLoop < GC.getNumFlavorTypes(); iFlavorLoop++)
{
    if(GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_SCIENCE")
    {
        eFlavorScience = (FlavorTypes)iFlavorLoop;
        break;
    }
}
```

**Interpretation:** The advisor counsel system specifically searches for FLAVOR_SCIENCE to customize its advice. This lookup is used to provide targeted recommendations about technology paths and science infrastructure based on the player's flavor profile.

## Database Flavor Values

### Buildings with High FLAVOR_SCIENCE

Buildings are evaluated by the AI based on their FLAVOR_SCIENCE values. Higher values mean the AI prioritizes these buildings when science-focused.

#### Core Science Buildings

**Early Game (Ancient-Classical Era):**

- Library: 40 (fundamental science building)
- Telpochcalli (Aztec unique library): 50 (enhanced science focus)
- Council: 35 (unique building)
- Marae: 35 (Polynesian unique)

**Mid Game (Medieval-Renaissance Era):**

- University: 50 (critical science infrastructure)
- Seowon (Korean unique university): 70 (extreme science focus)
- Bimaristan (Arabian unique hospital): 70 (science + healing)
- Wat (Siamese unique university): 30 (culture-science hybrid)
- Observatory: 35 (mountain bonus building)
- Salon: 20 (culture-science building)

**Late Game (Industrial-Atomic Era):**

- Public School: 80 (highest regular science building)
- Research Lab: 75 (late-game science powerhouse)
- Embrapa (Brazilian unique research lab): 75 (food-science combo)
- Spaceship Factory: 50 (space race preparation)
- Hospital: 15 (minor science contribution)

**Economic Buildings with Science:**

- Bazaar: 10 (market with science)
- Hanse: 25 (bank with science)
- Bank: 10 (economic science bonus)
- Chaebol: 20 (Korean unique stock exchange)

**Military Buildings with Science:**

- Walls of Babylon: 40 (defensive science building)
- Siege Foundry: 25 (military science research)
- Dojo: 15 (Japanese military training)

**Power Plants:**

- Solar Plant: 50 (clean science-focused energy)
- Hydro Plant: 30 (renewable science energy)
- Wind Plant: 30 (sustainable energy)
- Tidal Plant: 10 (coastal renewable)

#### National Wonders

- National College: 100 (highest science priority building in the game)
- Royal Library: 150 (imperial college, extreme priority)
- Oxford University: 50 (free technology wonder)
- University of Coimbra: 60 (Portuguese colonial wonder)
- Palace (Science Specialization): 60
- Intelligence Agency: 50 (spy network + science)
- Nobel Committee: 50 (great person science focus)

#### World Wonders

- Great Library: 75 (ancient science wonder)
- Porcelain Tower: 100 (medieval science powerhouse)
- Etemenanki: 20 (Babylonian science wonder)
- Stonehenge: 20 (early science + faith)
- Oracle: 25 (classical era science)
- Parthenon: 15 (Greek science-culture)
- Petra: 20 (desert science-gold)
- Angkor Wat: 20 (jungle science-culture)
- Alhambra: 10 (military science)
- Leaning Tower: 40 (great person science)
- Hubble Space Telescope: 100 (space race science)
- Apollo Program: 100 (space race prerequisite)

#### Religious Buildings

- Monastery: 15 (Buddhist science building)
- Mosque: 10 (Islamic science building)
- Synagogue: 4 (Jewish learning)
- Mandir: 2 (Hindu temple)

#### Corporations

- Firaxite Materials: 50 (corporate science resource)
- Firaxite Materials HQ: 100 (headquarters)
- Centaurus Extractors: 30 (science resource extraction)
- Centaurus Extractors HQ: 60 (headquarters)

### Technologies with High FLAVOR_SCIENCE

Technologies with FLAVOR_SCIENCE values guide research priorities for science-focused leaders.

**Ancient Era:**

- The Wheel: 10 (roads and infrastructure)
- Writing: 15 (libraries, embassies, Great Library)
- Philosophy: 10 (philosophical research)

**Medieval Era:**

- Education: 25 (universities, research agreements - **highest ancient-medieval tech**)

**Renaissance Era:**

- Steel: 5 (industrial science)
- Banking: 5 (economic science)
- Astronomy: 5 (navigation and stars)

**Industrial Era:**

- Scientific Theory: 30 (public schools, tech trade - **second highest in game**)
- Replaceable Parts: 10 (industrialization)

**Modern Era:**

- Corporations: 30 (corporate research - **tied second highest**)
- Plastic: 20 (modern materials)

**Atomic Era:**

- Penicillin: 5 (medical science)
- Satellites: 20 (Apollo Program, Hubble, map reveal)
- Nuclear Fusion: 15 (future tech foundation)

**Technology Beeline Strategy:** High FLAVOR_SCIENCE leaders will prioritize Education (25) → Scientific Theory (30) → Corporations (30) as the core science progression path, with Satellites (20) and Nuclear Fusion (15) for space race preparation.

### Processes

**Science Processes:**

- Research (Convert production to science): 4
- International Space Station: 50 (space race mega-project)

**Interpretation:** The massive flavor value for International Space Station (50) means science-focused civilizations will dedicate cities to this process when approaching science victory, converting raw production into space race progress.

### Units

**Scientist Units:**

- Great Scientist: 1 (baseline for great person generation)

### Policies (Detailed Breakdown)

**Opening Trees:**

- Legalism (Tradition): 5
- Liberty: 7
- Collective Rule (Liberty): 5

**Aesthetics:**

- Aesthetics Opener: 12
- Cultural Centers: 12

**Exploration:**

- Mercantilism: 24
- Naval Tradition: 24

**Rationalism (Primary Science Tree):**

- Rationalism Opener: 30
- Secularism: 24
- Sovereignty: 24
- Free Thought: 24
- Humanism: 24
- Scientific Revolution: 24
- Rationalism Finisher: 50

**Order Ideology:**

- Young Pioneers: 60
- Academy of Sciences: 60
- Workers' Faculties: 60
- Nationalization: 30
- Mobilization: 60

**Freedom Ideology:**

- Capitalism: 30

### Game Events

**Player Events (with FLAVOR_SCIENCE = 20 modifier):**

- Comet Observation Choice
- Meteor Strike Choice
- Eclipse Scientific Study Choice
- University Policy Choice
- Advisor Debate (Science Path)
- Factory Partnership (Research Division)

**City Events:**

- Hospital Overcrowding (Medical Research): 20
- Stadium Event (Research Facility): 20
- Flooding (Science Prevention): -1 (negative, avoiding science)
- Wanderer (Scholar): 20

**Interpretation:** Events that offer scientific research opportunities or involve scholars, universities, and research facilities receive a +20 flavor bonus for science-focused leaders, making them much more likely to choose science-oriented event outcomes.

## Strategy Modifiers

### City Strategies

**Happiness-Related Strategies:**

- Need Happiness (Science): 60 (build science buildings for happiness)

**Interpretation:** When cities need happiness, FLAVOR_SCIENCE increases by 60, encouraging construction of science buildings that provide happiness (universities, public schools, research labs with policies).

### Leader Flavor Examples

Different leaders have varying FLAVOR_SCIENCE values that shape their playstyle:

**High Science Leaders (8-10):**

- Gandhi: 9 (primary science focus)
- Pachacuti: 9 (science + infrastructure)
- Sejong: ~10 (implied from Seowon building, science specialist)
- Wu Zetian: 8 (science-culture balance)
- Suleiman: 8 (science-diplomacy)

**Balanced Leaders (5-7):**

- Generic Default: 5-8 (moderate science investment)
- Casimir: 8 (generalist with science lean)
- Gustavus Adolphus: 7 (science + military balance)
- Washington: 7 (science-culture balance)
- William: 7 (diplomatic science)
- Harun al-Rashid: 8 (culture-science synergy)
- Kamehameha: 8 (naval-science)

**Lower Science Leaders (3-5):**

- Bismarck: 7 (gold-production focus, reduced from 8)
- Elizabeth: 7 (naval-domination focus, reduced from 9)
- Isabella: 5 (domination focus, reduced from 7)
- Ramesses: 7 (wonder focus, reduced from 9)

**Interpretation:** Most leaders have FLAVOR_SCIENCE values between 5-9, reflecting that science is important for all civilizations. The differences are subtle but impactful:

- 9-10: Will sacrifice military and economy for science
- 7-8: Balanced approach with science emphasis
- 5-6: Adequate science for competitiveness
- 3-4: Minimum science, other priorities dominate

## Summary of Effects

### Strategic Planning

- **Victory focus:** Directly increases preference for science victory, with exponential scaling in later eras
- **Grand strategy:** Creates positive feedback loops with science buildings and policies
- **City placement:** Prioritizes mountain ranges for observatories and jungle regions for university bonuses
- **Technology path:** Beelines science-enhancing technologies (Writing → Education → Scientific Theory → Corporations)

### City Development

- **Building priority:** Libraries (40) → Universities (50) → Public Schools (80) → Research Labs (75)
- **National wonders:** National College (100) and Royal Library (150) become top priorities
- **Specialization:** Designates cities as science-focused, assigning citizens to scientist specialists
- **Tile improvements:** Workers prioritize academies and science-generating improvements

### Economic Strategy

- **Technology research:** Aggressive beelining of science technologies with exponential era scaling
- **Trade routes:** Heavily weights science yields when evaluating trade route value
- **Policy selection:** Strongly favors Rationalism tree (30-50 flavor values) and Order ideology (60 flavor policies)
- **Religion:** Selects science-granting beliefs with 80x multiplier (highest except faith)
- **City-states:** Invests heavily in science city-state alliances

### Great People

- **Great Scientists:** Primary great person focus, planted as academies or used for technology boosts
- **Specialist assignment:** Cities prioritize scientist specialist slots in libraries, universities, and public schools
- **Great person generation:** Science buildings typically provide great scientist points

### Dynamic Adjustments

- **Grand strategy synergy:** Science flavor works with active grand strategy for compound effects
- **Era scaling:** Science victory priority increases quadratically with era (0 in ancient → 972 in atomic for FLAVOR_SCIENCE = 9)
- **Event responses:** +20 flavor bonus for science-related event choices

## Design Philosophy

FLAVOR_SCIENCE represents the AI's fundamental approach to technology and research:

1. **Research Priority:** How aggressively to pursue technological advancement
2. **Infrastructure Investment:** Whether to build expensive science buildings or focus on military/economy
3. **Long-term Planning:** Whether to pursue science victory or diversify victory approaches

This creates a spectrum of AI technological strategies:

- **High SCIENCE (8-10):** Technology specialists who maximize science output, beeline key technologies, and pursue space race victory. Often peaceful and diplomatic.
- **Moderate SCIENCE (5-7):** Balanced leaders who maintain technological competitiveness while investing in military, culture, or economy. Flexible victory approaches.
- **Low SCIENCE (3-4):** Production or military-focused leaders who build science infrastructure only when necessary. Prefer domination or diplomatic victories.
- **Minimal SCIENCE (0-2):** Pure warmongers or highly specialized leaders who treat science as secondary to their primary focus.

## Related Flavors

- **FLAVOR_SPACESHIP:** Science victory endgame focus (works with FLAVOR_SCIENCE in late game)
- **FLAVOR_GROWTH:** Synergizes with science (larger cities = more science from population)
- **FLAVOR_CULTURE:** Complements science for cultural-scientific hybrid strategies
- **FLAVOR_PRODUCTION:** Alternative development path, sometimes conflicts with science infrastructure investment
- **FLAVOR_GREAT_PEOPLE:** Synergizes with science through great scientist generation
- **FLAVOR_DIPLOMACY:** Science leaders tend toward peaceful diplomacy, allowing uninterrupted research
- **FLAVOR_GOLD:** Economic science strategies using wealth to purchase science buildings and research agreements

**Typical Combinations:**

- **High Science + High Growth:** Classic science victory strategy (Korea, Babylon) - tall empire with massive cities generating huge science
- **High Science + High Diplomacy:** Peaceful researcher who maintains alliances and research agreements
- **High Science + High Culture:** Cultural-scientific hybrid pursuing either victory type based on circumstances
- **High Science + Low Offense:** Pure researcher who avoids military conflicts to maximize science investment
- **Moderate Science + High Production:** Balanced civilization that can switch between science and production based on needs

FLAVOR_SCIENCE directly influences grand strategy calculations and interacts with military strategies, but unlike FLAVOR_GROWTH, it is not heavily penalized during warfare. Science leaders may slow their research during wars but do not abandon science infrastructure entirely, reflecting the historical reality that technological advancement continues even during conflicts.
