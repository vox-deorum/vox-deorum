# FLAVOR_GOLD

## Overview

`FLAVOR_GOLD` is an AI personality flavor that controls how strongly a civilization's leader prioritizes gold generation and economic wealth accumulation. This flavor fundamentally shapes the AI's approach to economic development, influencing building construction, technology research, trade route establishment, policy selection, and diplomatic interactions with minor civilizations.

Unlike `FLAVOR_PRODUCTION` (which focuses on manufacturing capacity) or `FLAVOR_GROWTH` (which focuses on population), `FLAVOR_GOLD` specifically drives the AI's **commitment to accumulating wealth** through gold-generating buildings (markets, banks, stock exchanges), trade routes, economic tile improvements, and economic policies.

### Value Range

- **Scale:** 0-10 (integer values)
- **Typical Values:**
  - Trade/economic-focused leaders: 8-10
  - Balanced leaders: 5-7
  - Military/production-focused leaders: 3-5
  - Leaders during economic crises: Temporarily increased by 30-60

## Code References

### 1. Advisor Recommendation System (CvAdvisorRecommender.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvAdvisorRecommender.cpp` (lines 318-321)

**Function:** `CvAdvisorRecommender::GetRecommendationPriority()`

FLAVOR_GOLD has the highest priority weight among economic flavors for advisor recommendations.

```cpp
else if(strFlavorName == "FLAVOR_GOLD")
{
    return 23;
}
```

**Interpretation:** FLAVOR_GOLD receives a priority weight of 23, making it the absolute highest priority economic flavor in the advisor recommendation system (higher than production at 16, growth at 15, and infrastructure at 9). The economic advisor will strongly and frequently recommend gold-enhancing buildings, improvements, and strategies to civilizations with high gold flavors.

**Strategic Impact:** Gold-focused leaders will receive constant advisor recommendations to build markets, banks, stock exchanges, establish trade routes, and pursue economic technologies and policies.

### 2. Builder (Worker) Tasking - Gold Improvement Priority (CvBuilderTaskingAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvBuilderTaskingAI.cpp` (lines 2698-2703)

**Function:** `CvBuilderTaskingAI::ScorePlot()`

FLAVOR_GOLD determines how workers prioritize building improvements that increase gold yield.

```cpp
case YIELD_GOLD:
    if(GC.getFlavorTypes((FlavorTypes)iFlavorLoop) == "FLAVOR_GOLD")
    {
        iYieldDifferenceWeight += iDeltaYield * pFlavorManager->GetPersonalityIndividualFlavor((FlavorTypes)iFlavorLoop)
            * /*2*/ GD_INT_GET(BUILDER_TASKING_PLOT_EVAL_MULTIPLIER_GOLD);
    }
    break;
```

**Interpretation:** When workers evaluate which tiles to improve, FLAVOR_GOLD multiplies the gold yield improvement value by both the flavor value and a configurable multiplier (default 2). This means:

- A leader with FLAVOR_GOLD = 9 will value a +2 gold improvement as: 2 × 9 × 2 = 36 points
- A leader with FLAVOR_GOLD = 3 will value it as: 2 × 3 × 2 = 12 points

**Practical Effect:** High-gold leaders will prioritize building trading posts, plantations on luxury resources, and mines on gold/silver deposits over farms and other improvements. Workers will improve gold resources, jungle trading posts, and coastal luxury resources before food or production tiles when FLAVOR_GOLD is high.

### 3. City Specialization - Gold Focus (CvCitySpecializationAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvCitySpecializationAI.cpp` (lines 456-457)

**Function:** `CvCitySpecializationAI::LogSpecializationUpdate()`

FLAVOR_GOLD influences long-term city specialization decisions, determining whether cities should focus on gold generation.

```cpp
int iFlavorGold = 10 * m_pPlayer->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GOLD"));
if (iFlavorGold < 0) iFlavorGold = 0;
```

**Interpretation:** The gold flavor is multiplied by 10 and combined with the active grand strategy to create a city specialization weight. This means:

- FLAVOR_GOLD = 7 adds 70 weight toward gold-focused specialization
- Cities will prioritize buildings, specialists, and citizen assignments that maximize gold output
- Gold-specialized cities will work more gold tiles (trading posts, luxury resources, coastal tiles) while avoiding food and production tiles until economic goals are met

**Strategic Impact:** Gold-specialized cities become dedicated economic centers that generate substantial wealth for purchasing units, buildings, city-state influence, and maintaining large standing armies.

### 4. City-State Interaction - Economic Diplomacy (CvDiplomacyAI.cpp)

**Location:** `CvGameCoreDLL_Expansion2/CvDiplomacyAI.cpp` (line 32092)

**Function:** `CvDiplomacyAI::DoContactMinorCivs()`

FLAVOR_GOLD heavily influences city-state interaction strategies, particularly gold gifting and quest priorities.

```cpp
int iDiplomacyFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_DIPLOMACY"));
int iGoldFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_GOLD"));
int iTileImprovementFlavor = GetPlayer()->GetGrandStrategyAI()->GetPersonalityAndGrandStrategy(
    (FlavorTypes)GC.getInfoTypeForString("FLAVOR_TILE_IMPROVEMENT"));
```

**Interpretation:** FLAVOR_GOLD is one of three key flavors used in city-state interaction decisions. Leaders with high FLAVOR_GOLD will:

- Invest more gold in city-state gifting to secure alliances and bonuses
- Prioritize mercantile and trade city-states that provide gold bonuses
- Value city-states with trade route bonuses and economic benefits
- Complete gold-related quests from city-states more frequently
- Use accumulated wealth for diplomatic influence

**Strategic Impact:** Gold-focused leaders build diplomatic networks through economic investment, creating a network of allied city-states that provide additional economic bonuses, trade route slots, and luxury resources.

## Database Flavor Values

### Buildings with High FLAVOR_GOLD

Buildings are evaluated by the AI based on their FLAVOR_GOLD values. Higher values mean the AI prioritizes these buildings when gold-focused.

**Early Game (Ancient-Classical Era):**

- Market: 25 (core economic building)
- Bazaar (Arabian unique): 25
- Marae (Polynesian unique): 10
- Stone Works: 10
- Mud Pyramid Mosque (Tabya): 10
- Pitz Court: 5
- Lighthouse: 10
- Runestone (Danish unique): 10

**Mid Game (Medieval-Renaissance Era):**

- Caravansary: 15 (trade route enhancement)
- Gumey: 30
- Satrap's Court (Persian unique): 60 (exceptionally high gold focus)
- Mint (Customs House): 25
- Hanse (German unique): 25
- Pogost (Russian unique): 35
- Harbor: 20
- Ducal Stable: 10
- Bank: 25 (core mid-game economic building)
- Krepost (Russian unique): 20

**Late Game (Industrial-Modern Era):**

- Brewhouse (German unique): 10
- Agribusiness: 10
- Andelsbevaegelse (Danish unique): 20
- Coaling Station: 20
- Riad (Moroccan unique): 20
- Seaport: 20
- Bullring (Spanish unique): 20
- Embrapa (Brazilian unique): 10
- Stock Exchange: 40 (core late-game economic building)
- Chaebol (Korean unique): 60
- Tidal Plant: 10

**Religious Buildings:**

- Cathedral: 8
- Mandir: 2
- Order (religious building): 8

**Corporations:**

- Civilized Jewelers (Office): 40
- Civilized Jewelers (HQ): 80
- Trader Sid's (Office): 50
- Trader Sid's (HQ): 100 (highest gold-focused corporation)

**National Wonders:**

- Palace: 5
- Circus Maximus: 25
- Ulticur (Celtic unique): 30
- National Treasury (Chartered Company): 50
- Great Cothon (Carthaginian unique): 75

**World Wonders:**

- Parthenon: 15
- Huey Teocalli: 20
- University of Coimbra: 15
- White Tower: 10
- Rialto District: 30
- Printing Press: 12
- Ballhausplatz: 20
- International Finance Center: 60
- Mausoleum of Halicarnassus: 5
- Petra: 20
- Colossus: 25
- Forbidden Palace: 50
- Machu Picchu: 40
- Notre Dame: 10
- Summer Palace: 10
- Neuschwanstein: 20
- Big Ben: 20
- Slater Mill: 50
- Empire State Building: 50
- The Motherland Calls: 30
- CN Tower: 20
- Grand Canal: 15

### Technologies with High FLAVOR_GOLD

**Ancient Era:**

- Horseback Riding: 25 (Trade units, Market building, Petra wonder, +1 Trade Route)

**Classical Era:**

- Currency: 15 (Caravansary, Angkor Wat, Wealth process, Village improvement, +1 Trade Route, Merchant +1 gold)
- Metal Casting: 15 (Economic infrastructure)

**Medieval Era:**

- Guilds: 15 (Customs House, Artists' Guild, East India Company, Karlstejn wonder, Camp & Village +1 gold)

**Renaissance Era:**

- Banking: 15 (Bank building, Constabulary, Town +3 gold, Pioneer units)
- Economics: 5 (Windmill, Uffizi wonder, +1 Trade Route, Merchant & Plantation +1 gold)
- Navigation: 5 (Trading ships, Servant +1 gold, Boats +1 food)

**Industrial Era:**

- Railroad: 10 (Trade infrastructure, movement efficiency)
- Steam Power: 5 (Industrial economic infrastructure)
- Fertilizer: 10 (Pasture +2 gold)

**Modern Era:**

- Electricity: 15 (Stock Exchange building, Empire State Building, +1 Trade Route)
- Corporations: 30 (Corporate franchises providing gold bonuses - major economic technology)

**Information Era:**

- Internet: 15 (Tourism boost, Writers +2 culture, Merchants +3 gold, Servants +1 culture)

### Policies with High FLAVOR_GOLD

**Early Policies (Ancient-Classical Era):**

- Landed Elite (Tradition): 5
- Liberty: 7
- Republic (Liberty): 5
- Discipline (Honor): 5
- Professional Army (Honor): 5
- Piety: 13

**Medieval-Renaissance Policies:**

- Patronage: 13
- Cultural Diplomacy (Patronage): 18
- Merchant Confederacy (Patronage): 10
- Artistic Genius (Aesthetics): 12
- Commerce: 27 (core economic policy tree)
- Entrepreneurship (Commerce): 24
- Trade Unions (Commerce): 24
- Caravans (Commerce): 24
- Mercantilism (Commerce): 24
- Wagon Trains (Commerce): 24
- Protectionism (Commerce): 24

**Advanced Policies:**

- Secularism (Rationalism): 24
- Imperialism (Exploration): 24
- Free Market (Exploration): 24
- Trade Missions (Exploration): 24

**Ideology Policies (Industrial Era+):**

**Freedom:**

- Economic Union: 40
- Capitalism: 40
- New Deal: 50
- Civil Society: 60 (highest gold-focused freedom policy)

**Order:**

- Academy of Sciences: 40
- Double Agents: 30

**Autocracy:**

- Third Alternative: 40

### Units with FLAVOR_GOLD

**Trade Units:**

- Caravan: 10 (land trade routes)
- Cargo Ship: 20 (sea trade routes - higher value reflects greater gold potential)

**Great People:**

- Merchant: 1 (Great Merchant for trade missions and customs houses)

**Unique Units:**

- Venetian Merchant: 100 (exceptional gold focus for Venice's unique playstyle)
- Portuguese Nau: 10 (exploration and trade ship)

### Processes with FLAVOR_GOLD

**City Production Processes:**

- Wealth: 5 (convert production into gold)
- Treasure Fleet: 25 (naval economic process)
- Wargames: 25 (military training with economic benefits)
- United Nations: 30 (diplomatic process with economic investment)

## City Strategy Adjustments

### Happiness Crisis - Gold Strategy (StrategyChanges.sql)

**Location:** `(2) Vox Populi/Database Changes/AI/StrategyChanges.sql` (lines 44-46)

**Function:** City-level strategy adjustments during happiness crises

FLAVOR_GOLD temporarily **increases dramatically** during happiness crisis strategies, causing the AI to build gold infrastructure to purchase happiness solutions.

```sql
('AICITYSTRATEGY_NEED_HAPPINESS_GOLD', 'FLAVOR_GOLD', 60),
('AICITYSTRATEGY_NEED_HAPPINESS_GOLD', 'FLAVOR_GROWTH', 30),
('AICITYSTRATEGY_NEED_HAPPINESS_GOLD', 'FLAVOR_I_LAND_TRADE_ROUTE', 30),
('AICITYSTRATEGY_NEED_HAPPINESS_GOLD', 'FLAVOR_I_SEA_TRADE_ROUTE', 30),
```

**Interpretation:**

- **Need Happiness (Gold):** +60 FLAVOR_GOLD - Massive economic boost to generate gold for purchasing happiness buildings and luxuries
- **Growth Synergy:** +30 FLAVOR_GROWTH - Grow cities to generate more gold from population
- **Trade Route Synergy:** +30 to both land and sea trade route flavors - Establish trade routes to generate additional gold income

**Strategic Response:** When cities face happiness crises requiring economic solutions, FLAVOR_GOLD increases by 60 points. This represents the AI's recognition that it must:

- Build markets, banks, and stock exchanges to generate gold
- Establish trade routes for additional income
- Purchase happiness buildings (theaters, stadiums, zoos) with accumulated gold
- Buy luxuries from other civilizations through trade deals
- Generate enough income to maintain economic stability

**Practical Effect:** Cities in happiness crisis will prioritize economic infrastructure over military or production buildings, working gold tiles and establishing trade routes to generate the wealth needed to purchase happiness solutions.

## Summary of Effects

### Strategic Planning

- **Victory focus:** Supports diplomatic victory (buying city-state alliances) and economic stability for all victory types
- **Grand strategy:** Creates economic engine that funds military expansion, wonder purchases, and diplomatic influence
- **City placement:** Values locations near luxury resources, coastal trade routes, and gold-producing tiles

### City Development

- **Building priority:** Prioritizes markets, banks, stock exchanges, and trade-enhancing buildings over military or production structures
- **Specialization:** Designates cities as economic centers, working gold tiles and luxury resources over food and production tiles
- **Tile improvements:** Workers prioritize trading posts, luxury resource improvements, and coastal economic improvements
- **Citizen assignment:** Cities work gold tiles, merchant specialist slots, and trading post improvements

### Economic Strategy

- **Technology research:** Beelines gold-enhancing technologies (Currency, Banking, Electricity, Corporations)
- **Policy selection:** Strongly favors Commerce policy tree and economic ideology policies (Economic Union, Capitalism, Civil Society)
- **Trade routes:** Establishes maximum number of trade routes, prioritizing gold-generating routes over food/production routes
- **City-states:** Invests heavily in mercantile city-states and uses gold to secure diplomatic alliances

### Great People

- **Great Merchants:** Uses trade missions for gold injections or builds customs houses for long-term gold generation
- **Customs House Placement:** Places customs houses on high-gold tiles near economic centers
- **Great Engineer/Scientist Strategy:** More likely to rush purchases with great people due to available gold reserves

### Dynamic Adjustments

- **Happiness crisis:** FLAVOR_GOLD temporarily increases by 60 during economic happiness emergencies
- **Trade route strategies:** Adjusts trade route priorities based on gold flavor and current economic needs
- **Grand strategy shifts:** Gold flavor interacts with active grand strategy (higher during Diplomatic Victory pursuit)

## Design Philosophy

FLAVOR_GOLD represents the AI's fundamental approach to wealth accumulation and economic power:

1. **Economic Infrastructure:** What to build (markets, banks, trade buildings vs military/production buildings)
2. **Trade Strategy:** How aggressively to establish and protect trade routes
3. **Diplomatic Investment:** How much to invest in city-state alliances and diplomatic relationships
4. **Purchase Strategy:** Whether to save gold for emergency purchases or maintain reserves

This creates a spectrum of AI economic development strategies:

- **High GOLD (8-10):** Economic powerhouses who maximize gold generation, build extensive trade networks, dominate diplomatic relationships through wealth, and can purchase armies or buildings as needed
- **Moderate GOLD (5-7):** Balanced leaders who maintain healthy economies while also investing in production, military, and science
- **Low GOLD (2-4):** Military or production-focused leaders who accept lower gold income to prioritize hammers or conquest
- **Economic Crisis (temporarily increased):** All leaders temporarily become more gold-focused during happiness crises to purchase solutions

## Related Flavors

- **FLAVOR_I_TRADE_ORIGIN:** Synergizes with gold (establishing outgoing trade routes)
- **FLAVOR_I_TRADE_DESTINATION:** Synergizes with gold (receiving incoming trade routes)
- **FLAVOR_I_LAND_TRADE_ROUTE:** Land-based trade route establishment
- **FLAVOR_I_SEA_TRADE_ROUTE:** Sea-based trade route establishment
- **FLAVOR_DIPLOMACY:** Uses gold for city-state influence and diplomatic relationships
- **FLAVOR_PRODUCTION:** Alternative development path focusing on hammers over gold
- **FLAVOR_GROWTH:** Synergizes with gold (larger cities generate more gold from specialists and buildings)
- **FLAVOR_TILE_IMPROVEMENT:** Infrastructure focus that includes trading posts and luxury improvements

**Typical Combinations:**

- **High Gold + High Diplomacy:** Classic diplomatic victory strategy (Venice, Netherlands, Arabia)
- **High Gold + High Trade Routes:** Trade-focused empires that dominate economic networks (Portugal, Morocco)
- **High Gold + Low Production:** Economic civilizations that purchase what they can't build (Venice, Arabia)
- **Low Gold + High Production:** Self-sufficient military civilizations that build rather than buy (Germany, Rome)

## Interaction with Game Mechanics

### Trade Route Management

FLAVOR_GOLD heavily influences trade route decisions:

- Leaders with FLAVOR_GOLD ≥ 7 will maximize trade route capacity
- Trade routes are redirected toward gold-generating destinations over food/production
- Cargo ships are prioritized over caravans when coastal trade routes are available
- Trade route protection becomes high military priority

### City-State Diplomacy

Gold-focused leaders excel at city-state relationships:

- Willing to spend 30-50% of gold reserves on city-state influence
- Prioritize mercantile city-states for additional gold and luxuries
- Complete economic quests from city-states more frequently
- Establish protective pacts with economically valuable city-states

### Purchase Strategy

High gold flavor enables aggressive purchase strategy:

- Purchase units for immediate military needs during warfare
- Purchase buildings in newly founded cities to accelerate development
- Purchase great people improvements when opportunities arise
- Maintain gold reserves for emergency defensive purchases

### Happiness Management

FLAVOR_GOLD provides alternative happiness solutions:

- Purchase happiness buildings (theaters, stadiums, zoos) rather than building them
- Buy luxuries from other civilizations through trade agreements
- Generate wealth to support larger military forces (unit maintenance costs)
- Fund cultural buildings and wonders that provide happiness

### Corporate Strategy

In late-game, FLAVOR_GOLD influences corporate strategy:

- Gold-focused leaders prioritize Trader Sid's and Civilized Jewelers corporations
- Corporate offices and headquarters with high FLAVOR_GOLD values are built in economic centers
- Corporate franchises are valued based on gold bonuses they provide
- Trade routes between corporate franchises maximize economic output

This creates a comprehensive economic strategy where gold-focused civilizations build economic empires that fund diplomatic influence, military power, and rapid infrastructure development through purchasing rather than production.
