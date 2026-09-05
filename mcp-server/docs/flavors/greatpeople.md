# FLAVOR_GREAT_PEOPLE

## Overview

FLAVOR_GREAT_PEOPLE is an AI flavor in Civilization V that controls how much an AI leader values Great People generation and related game mechanics. This flavor influences AI decisions across multiple systems including building construction, policy selection, technology research, wonder prioritization, and city specialization.

Great People are special units that provide powerful one-time abilities or improvements. The FLAVOR_GREAT_PEOPLE flavor directly impacts the AI's strategy for generating and utilizing these crucial units through specialist assignment, Great Person Point (GPP) rate modifiers, and infrastructure development.

## AI Systems Affected

### 1. Building Production AI

The flavor influences building construction priorities through the Building Production AI system (`CvBuildingProductionAI.cpp`). Buildings with FLAVOR_GREAT_PEOPLE values are weighted more heavily by AI leaders who prioritize Great People generation.

**Key buildings valued by this flavor:**

#### Ancient Era

- **Forge** (2) - Provides Great Engineer specialist slots
- **Market** (2) - Provides Great Merchant specialist slots
- **Walls of Babylon** (2) - Unique Babylonian building with science and GPP benefits

#### Classical Era

- **Amphitheater** (2) - Provides Great Writer specialist slots
- **Gymnasion** (2) - Greek unique with Great Writer slots
- **Iziko** (2) - Zulu unique amphitheater
- **Library** (2) - Provides Great Scientist specialist slots
- **Telpochcalli** (2) - Aztec unique library
- **Satraps Court** (10) - Persian unique courthouse with significant GPP boost

#### Medieval Era

- **Examination Hall** (30) - Chinese unique building with major GPP focus
- **Ceilidh Hall** (4) - Celts unique circus
- **Customs House/Mint** (2) - Provides Great Merchant specialist slots
- **Hanse** (2) - German unique customs house
- **Pogost** (2) - Russian unique customs house
- **Garden** (30) - Critical building providing +25% Great Person rate
- **Candi** (30) - Indonesian unique garden with religious benefits
- **University** (2) - Provides Great Scientist specialist slots
- **Seowon** (2) - Korean unique university
- **Bimaristan** (2) - Arabian unique university
- **Workshop** (2) - Provides Great Engineer specialist slots
- **Elephant Camp** (2) - Indian unique workshop

#### Renaissance Era

- **Bank** (2) - Provides Great Merchant specialist slots
- **Doelen** (5) - Dutch unique constabulary
- **Gallery** (2) - Provides Great Artist specialist slots
- **Salon** (10) - French unique gallery with enhanced GPP
- **Observatory** (4) - Provides Great Scientist specialist slots
- **Opera House** (2) - Provides Great Musician specialist slots
- **Kabuki Theater** (10) - Japanese unique opera house
- **Windmill** (2) - Provides Great Engineer specialist slots
- **Brewhouse** (2) - German unique windmill

#### Industrial Era

- **Factory** (2) - Provides Great Engineer specialist slots
- **Steam Mill** (10) - English unique factory with major GPP boost
- **Museum** (10) - Provides Great Artist specialist slots

#### Modern Era

- **Research Lab** (2) - Provides Great Scientist specialist slots
- **Embrapa** (2) - Brazilian unique research lab
- **Stock Exchange** (2) - Provides Great Merchant specialist slots
- **Chaebol** (2) - Korean unique stock exchange

#### Information Era

- **Nuclear Plant** (50) - Provides major GPP generation boost

#### Corporations

- **Civilized Jewelers** (40) / **HQ** (80) - Corporation buildings focused on Great People

### 2. National Wonders

National Wonders are particularly important for Great People strategies:

- **National Epic** (50) - The primary Great People wonder, provides +25% GPP rate
- **Piazza San Marco** (100) - Venetian unique with massive GPP boost
- **Etemenanki** (50) - Babylonian unique national monument
- **Murano Glassworks** (30) - Venetian unique providing GPP benefits

### 3. World Wonders

Several world wonders provide significant Great People benefits:

- **Pyramids** (20) - Ancient era wonder providing worker efficiency and GPP
- **Great Wall** (10) - Classical era wonder with defensive and GPP benefits
- **Hanging Gardens** (25) - Classical era wonder with growth and GPP boost
- **Roman Forum** (10) - Classical era wonder for diplomatic and GPP benefits
- **University of Sankore** (25) - Medieval era wonder combining science, culture, and GPP
- **Leaning Tower of Pisa** (100) - Renaissance era wonder with massive GPP focus
- **Porcelain Tower** (25) - Renaissance era science and GPP wonder
- **Red Fort** (10) - Renaissance era defensive wonder with GPP
- **Taj Mahal** (20) - Renaissance era culture and GPP wonder
- **Uffizi** (25) - Renaissance era culture wonder with GPP benefits
- **Brandenburg Gate** (25) - Industrial era military and GPP wonder
- **Louvre** (25) - Industrial era culture wonder with significant GPP
- **Palace of Westminster** (20) - Industrial era diplomatic wonder with GPP
- **Broadway** (25) - Modern era culture wonder with GPP boost
- **Empire State Building** (50) - Modern era wonder focused on GPP and gold
- **Hubble Space Telescope** (25) - Information era spaceship wonder with GPP

### 4. Policy Selection (CvPolicyAI.cpp)

In the Policy AI system (line 4940), FLAVOR_GREAT_PEOPLE contributes to the "Culture Value" calculation when evaluating policies. This means AI leaders with high FLAVOR_GREAT_PEOPLE will prioritize policies that support Great People generation alongside cultural development.

**Key policies valued by this flavor:**

#### Tradition Tree

- **Tradition Opener** (7) - Emphasizes capital growth and Great People
- **Monarchy** (5) - Provides specialist food benefits and GPP in capital

#### Aesthetics Tree

- **Aesthetics Opener** (12) - Major focus on culture and Great People
- **Artistic Genius** (12) - Provides free Great Person and GPP benefits

#### Commerce Tree

- **Entrepreneurship** (24) - Provides Great Merchant benefits

### 5. Technology Research (CvTechClasses.cpp)

The flavor affects technology prioritization in multiple ways:

**Culture Focus Boost** (line 1273): When an AI is pursuing a Culture Victory (Culture Focus active), technologies with FLAVOR_GREAT_PEOPLE receive bonus priority alongside FLAVOR_CULTURE and FLAVOR_WONDER.

**Religious Trait Synergy** (line 1290): AI leaders with the Religious trait (defined by `IsReligious()`) give extra priority to technologies with FLAVOR_GREAT_PEOPLE, recognizing the synergy between religious play and Great Person generation.

**Key technologies valued by this flavor:**

- **Drama and Poetry** (10) - Unlocks Writers' Guild and Parthenon
- **Theology** (10) - Unlocks Garden and Grand Temple
- **Biology** (25) - Major GPP technology unlocking Hospital and Statue of Liberty

### 6. Grand Strategy AI (CvGrandStrategyAI.cpp)

In the Grand Strategy system (lines 910-913, 951-954), FLAVOR_GREAT_PEOPLE contributes to priority calculations for Culture Victory pursuit. The AI aggregates FLAVOR_GREAT_PEOPLE values from:

- Adopted policies (each policy's FLAVOR_GREAT_PEOPLE flavor value is added)
- Constructed buildings across all cities (each building's FLAVOR_GREAT_PEOPLE flavor value is summed)

This creates a feedback loop where adopting Great People-focused policies and constructing related buildings reinforces the AI's commitment to a Culture Victory strategy.

### 7. Religion AI (CvReligionClasses.cpp)

**Founder Belief Evaluation** (line 8191): The flavor is used when evaluating beliefs that provide Great People benefits. The base value is `FLAVOR_GREAT_PEOPLE / 4`, but this is multiplied by 1.5x if:

- The player has the Tourism trait (`IsTourism()`)
- The player has unlocked the Tradition policy tree

This reflects the strong synergy between Great People generation and both tourism-focused civilizations and the Tradition policy tree.

**Happiness Calculation** (line 8621): The flavor is retrieved as `iFlavorGP` and used in calculations for religious belief selection, though the specific usage varies by belief type.

### 8. City Specialization

Cities can be assigned specializations that focus their development:

**Culture Specialization** (100): Cities with Culture specialization receive a massive +100 to FLAVOR_GREAT_PEOPLE, making them prioritize all Great People-generating buildings and specialists. This is the primary specialization for Great People focused cities.

### 9. City Focus (CvCityCitizens.cpp)

**CITY_AI_FOCUS_TYPE_GREAT_PEOPLE** (line 3610): When a city is set to Great People focus, the citizen management AI evaluates specialist slots and tile assignments to maximize Great Person Point generation. The focus is automatically activated when:

- A player manually sets it (line 333)
- The AI determines it's optimal for the city's role (line 1034)

### 10. Advisor Recommendations (CvAdvisorRecommender.cpp)

The flavor is mapped to category 5 (line 443-445) in the advisor recommendation system, which helps inform players about AI behavior and provides appropriate suggestions.

## AI Leader Personality Types

Different AI leader personality archetypes have varying FLAVOR_GREAT_PEOPLE values:

### Conquerors (4)

Military-focused leaders (Attila, Genghis Khan, Montezuma, Napoleon, etc.) have low Great People priority, focusing on conquest over infrastructure.

**Leaders:** Ashurbanipal, Askia, Attila, Augustus, Darius, Genghis Khan, Gustavus Adolphus, Harald, Montezuma, Napoleon, Oda Nobunaga, Shaka

### Expansionists (5)

Growth and territory-focused leaders (Alexander, Catherine, Hiawatha, etc.) have moderate Great People priority, balancing expansion with development.

**Leaders:** Alexander, Boudicca, Catherine, Dido, Gajah Mada, Hiawatha, Isabella, Pachacuti, Pocatello, Suleiman, Wu Zetian

### Diplomats (7)

Diplomatic and scientific leaders (Gandhi, Sejong, Maria Theresa, etc.) have higher Great People priority, valuing cultural and scientific development.

**Leaders:** Ahmad al-Mansur, Bismarck, Enrico Dandolo, Gandhi, Maria I, Maria Theresa, Pedro II, Ramkhamhaeng, Sejong, Theodora, William

### Coalitionists (8)

Balanced leaders focused on defensive play and development (Elizabeth, Washington, Ramesses, etc.) have the highest Great People priority among standard archetypes.

**Leaders:** Casimir III, Elizabeth, Haile Selassie, Harun al-Rashid, Kamehameha, Nebuchadnezzar II, Pacal, Ramesses II, Washington

## Strategic Impact

### High FLAVOR_GREAT_PEOPLE Value (7-8+)

AI leaders with high values will:

- Prioritize constructing Gardens, National Epic, and other GPP-boosting buildings
- Build specialist buildings (guilds, universities, workshops) even when other priorities exist
- Adopt Tradition and Aesthetics policy trees more readily
- Pursue wonder construction for wonders with GPP benefits
- Specialize cities for Culture production with heavy specialist emphasis
- Research technologies that unlock Great People infrastructure earlier
- Maintain higher specialist population in cities
- Compete aggressively for Great People-focused wonders like Leaning Tower and National Epic

### Low FLAVOR_GREAT_PEOPLE Value (4-5)

AI leaders with low values will:

- Only build specialist buildings when they provide other significant benefits
- Delay or skip Gardens and National Epic construction
- Focus specialists on immediate yield benefits rather than long-term GPP accumulation
- Pursue alternative victory paths that don't rely on Great People
- Prioritize military, production, or expansion buildings over GPP infrastructure

### Synergies

The flavor creates powerful synergies with:

- **FLAVOR_CULTURE**: Great People are essential for Culture Victory
- **FLAVOR_WONDER**: Many wonders provide GPP benefits
- **FLAVOR_SCIENCE**: Great Scientists are crucial for scientific development
- **Tradition Policy Tree**: Provides significant GPP bonuses in capital
- **Tourism Trait**: Great People (especially Musicians and Artists) generate tourism
- **Religious Trait**: Great Prophets and religious synergies
- **Gardens**: +25% GPP rate building that becomes high priority
- **Golden Ages**: The game provides +100% GPP during Golden Ages (GD_INT_GET(GOLDEN_AGE_GREAT_PEOPLE_MODIFIER))

## Technical Details

### Code Integration Points

1. **Building Weight Calculation** (`CvBuildingProductionAI.cpp:98`)

   ```cpp
   m_BuildingAIWeights.IncreaseWeight(iBuilding, entry->GetFlavorValue(eFlavor) * iWeight);
   ```

2. **Policy Priority Calculation** (`CvPolicyAI.cpp:4940-4942`)

   ```cpp
   else if (GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_GREAT_PEOPLE")
   {
       iCultureValue += iFlavorValue;
   }
   ```

3. **Tech Priority for Culture Victory** (`CvTechClasses.cpp:1271-1276`)

   ```cpp
   if(bCultureFocus && (
       GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_CULTURE" ||
       GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_GREAT_PEOPLE" ||
       GC.getFlavorTypes((FlavorTypes)iFlavor) == "FLAVOR_WONDER"))
   {
       m_piGSTechPriority[iTechLoop]++;
   }
   ```

4. **Grand Strategy Culture Priority** (`CvGrandStrategyAI.cpp:910-913`)

   ```cpp
   if(GC.getFlavorTypes((FlavorTypes) iFlavorLoop) == "FLAVOR_GREAT_PEOPLE")
   {
       iPriorityBonus += pkPolicyInfo->GetFlavorValue(iFlavorLoop);
   }
   ```

5. **Religion Belief Evaluation** (`CvReligionClasses.cpp:8191-8194`)
   ```cpp
   int iGPValue = pFlavorManager->GetPersonalityIndividualFlavor((FlavorTypes)GC.getInfoTypeForString("FLAVOR_GREAT_PEOPLE")) / 4;
   if (pPlayerTraits->IsTourism() || m_pPlayer->GetPlayerPolicies()->IsPolicyBranchUnlocked(eTradition))
   {
       iGPValue *= 3;
       iGPValue /= 2;
   }
   ```

### Game Constants

- **GOLDEN_AGE_GREAT_PEOPLE_MODIFIER**: 100 (doubles GPP generation during Golden Ages)
- **MOD_BALANCE_GREAT_PEOPLE_ERA_SCALING**: Custom mod option for scaling GPP requirements by era

### Enumerations

- **CITY_AI_FOCUS_TYPE_GREAT_PEOPLE**: City focus type for maximizing GPP generation
- **GREAT_PEOPLE_DIRECTIVE_X**: Various directives controlling how Great People are used
  - GOLDEN_AGE
  - USE_POWER
  - CONSTRUCT_IMPROVEMENT
  - SPREAD_RELIGION
  - CULTURE_BLAST
  - TOURISM_BLAST
  - FIELD_COMMAND

## Summary

FLAVOR_GREAT_PEOPLE is a fundamental AI flavor that shapes long-term strategic development in Civilization V. It primarily drives the AI's infrastructure investment in specialist buildings, GPP-boosting wonders, and policy choices that accelerate Great People generation. The flavor has strong synergies with culture-focused and religious gameplay, making it essential for AI personalities pursuing Culture Victory or religious dominance.

AI leaders with high FLAVOR_GREAT_PEOPLE (7-8+) will aggressively pursue a Great People strategy, constructing Gardens early, specializing cities for GPP generation, and competing for relevant wonders. Lower values (4-5) indicate leaders who view Great People as a secondary benefit rather than a strategic priority, focusing instead on military conquest, expansion, or immediate economic development.

The flavor's integration across building production, policy selection, technology research, and city specialization creates a cohesive AI behavior pattern that players can recognize and anticipate when facing different AI opponents.
