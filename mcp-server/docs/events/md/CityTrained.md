# Overview

The `CityTrained` event is triggered when a city completes the training, purchase, or recruitment of a military or civilian unit in Civilization V. This event encompasses all methods of unit acquisition in cities, including standard production-based training, gold-based purchasing, and faith-based recruitment, representing the successful creation of new units to serve the player's civilization.

# Event Triggers

This event is triggered through three different unit acquisition methods, each with distinct parameter combinations to indicate the acquisition type.

**Specific trigger conditions:**

- **Production training**: Unit completed through standard city production (bGold=false, bFaith=false)
- **Gold purchase**: Unit acquired through gold purchase (bGold=true, bFaith=false)
- **Faith purchase**: Unit recruited using faith points (bGold=false, bFaith=true)
- **Successful creation**: Unit has been successfully created and placed in the game world

**Related mechanics that can trigger unit training:**

- Standard city production focusing on unit construction over multiple turns
- Immediate unit purchase using accumulated gold reserves
- Faith-based unit recruitment through religious mechanics
- AI automated production and purchasing decisions
- Emergency military recruitment during wartime
- Strategic unit positioning and army building initiatives

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city creating the unit (from `getOwner()`) |
| `cityID` | integer | The unique identifier of the city where the unit is being trained (from `GetID()`) |
| `unitID` | integer | The unique identifier of the newly created unit (from `pUnit->GetID()`) |
| `purchasedWithGold` | boolean | Whether the unit was purchased with gold rather than produced (`bGold`) |
| `purchasedWithFaith` | boolean | Whether the unit was recruited with faith points (`bFaith`) |

# Event Details

Unit training represents the fundamental military and civilian development mechanism in Civilization V, enabling players to build armies, establish workers for improvement, create settlers for expansion, and deploy specialists for various strategic purposes. The event distinguishes between different acquisition methods to provide context about resource allocation and strategic decisions.

**Unit acquisition methods:**

- **Production training**: Traditional multi-turn construction using city production output
- **Gold purchasing**: Immediate acquisition using accumulated wealth reserves
- **Faith recruitment**: Religious unit creation using accumulated faith points
- **Emergency acquisition**: Quick unit deployment during critical situations

**Training method characteristics:**

- **Production training**: Typically takes multiple turns, uses city hammers, no immediate resource cost
- **Gold purchase**: Immediate acquisition, expensive, bypasses production queues
- **Faith purchase**: Religious units and some military units, uses faith currency, often has cooldowns

**Unit types and training:**

- **Military units**: Combat units for warfare, defense, and territorial control
- **Civilian units**: Workers, Settlers, Great People, and non-combat specialists
- **Religious units**: Missionaries, Inquisitors, Great Prophets recruited with faith
- **Unique units**: Civilization-specific units with special capabilities

**Strategic implications:**

- **Military buildup**: Creating armies for conquest, defense, or deterrence
- **Economic development**: Training workers to improve terrain and resources
- **Territorial expansion**: Building settlers to found new cities
- **Religious spread**: Creating missionary units to spread religious influence
- **Emergency response**: Rapid unit deployment during crises or opportunities

**Resource management:**

- **Production efficiency**: Standard training optimizes long-term resource allocation
- **Gold reserves**: Purchasing provides immediate capability but depletes treasury
- **Faith accumulation**: Religious recruitment requires strategic faith management
- **Opportunity cost**: Each training method has different strategic trade-offs

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCity.cpp`, lines 29541, 30591, and 30651

**Function Context**: Called within various unit creation functions:

- Production training: Standard unit completion processing
- Gold purchase: `purchaseUnit()` or similar gold-based acquisition functions
- Faith purchase: Religious unit recruitment and faith-based purchasing

**Script System Integration**: Uses either `GAMEEVENTINVOKE_HOOK` with `GAMEEVENT_CityTrained` (when `MOD_EVENTS_CITY` is enabled) or `LuaSupport::CallHook` with "CityTrained" (fallback)

**Preconditions**:

- City must exist and belong to a valid player
- Unit must be successfully created and have a valid unit ID
- Required resources (production, gold, or faith) must be available and consumed
- Unit placement location must be valid and available

**Event Flow - Production Training (bGold=false, bFaith=false)**:

1. City completes standard unit production through accumulated hammers
2. Unit object is created and assigned a unique ID
3. Unit is placed at the city location or nearby valid tile
4. Production costs are consumed and overflow is calculated
5. Event system checks if `MOD_EVENTS_CITY` is enabled
6. `GAMEEVENT_CityTrained` hook is invoked with (player, city, unit, false, false)
7. Instant yield bonuses are processed for military unit production
8. City production queue advances to the next item

**Event Flow - Gold Purchase (bGold=true, bFaith=false)**:

1. Player initiates gold purchase of a unit through the interface
2. Gold cost is calculated based on unit type and game conditions
3. Player treasury is validated for sufficient funds
4. Unit is immediately created and placed
5. Gold cost is deducted from player treasury
6. `GAMEEVENT_CityTrained` hook is invoked with (player, city, unit, true, false)
7. Purchase cooldowns are applied to prevent immediate repeated purchases
8. Logging occurs for economic tracking and analysis

**Event Flow - Faith Purchase (bGold=false, bFaith=true)**:

1. Player initiates faith recruitment of a religious or special unit
2. Faith cost is calculated based on unit type and religious conditions
3. Player faith reserves are validated for sufficient points
4. Unit is created with appropriate religious affiliation
5. Faith cost is deducted from player faith total
6. `GAMEEVENT_CityTrained` hook is invoked with (player, city, unit, false, true)
7. Faith purchase cooldowns are applied based on unit type and game speed
8. Religious strength and properties are assigned to faith-recruited units

**Conditional Event Systems**:

- Modern event system (GAMEEVENT) provides typed parameters when available
- Legacy Lua event system maintains compatibility for older mod systems
- Both systems receive identical information through different interfaces

**Unit Post-Creation Processing**:

- Units receive appropriate experience, promotions, and special properties
- Religious units are assigned faith and religious affiliation
- Military units may trigger instant yield bonuses
- Civilian units are prepared for their intended specialized functions

**Related Events**:

- Unit creation and placement events that may follow unit training
- Economic events related to resource consumption (gold, faith, production)
- Military events that may be triggered by new combat unit availability
- Religious events related to faith-based unit recruitment and deployment
