# Overview

The `CityConstructed` event is triggered when a city completes construction of a building through various methods including normal production, gold purchase, or faith purchase.

# Event Triggers

This event is triggered in three distinct scenarios:

1. **Normal Production Completion**: When a city finishes constructing a building through regular production queue processing
2. **Gold Purchase**: When a player purchases a building using gold currency
3. **Faith Purchase**: When a player purchases a building using faith points

All triggers occur within the `CvCity` class in the Community Patch DLL.

# Parameters

The event passes five parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| Owner | PlayerTypes | The ID of the player who owns the city |
| CityID | int | The unique identifier of the city |
| BuildingType | BuildingTypes | The type of building that was constructed |
| bGold | bool | Whether the building was purchased with gold (true) or produced normally/with faith (false) |
| bFaithCulture | bool | Whether the building was purchased with faith (true) or produced normally/with gold (false) |

# Event Details

The event provides comprehensive information about building construction circumstances:

- **Production Method Tracking**: The `bGold` and `bFaithCulture` parameters allow event handlers to distinguish between different acquisition methods
- **City Context**: The owner and city ID parameters provide full context for the construction event
- **Building Information**: The building type parameter identifies exactly what was constructed

The event occurs immediately after the building is successfully created in the city, ensuring that the game state reflects the completed construction when handlers execute.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvCity.cpp`

**Trigger Locations**:

- Line 29627: Normal production completion in `CvCity::produce(BuildingTypes, bool)`
- Line 30856: Gold purchase completion in `CvCity::PurchaseBuilding(BuildingTypes, YieldTypes)` when `ePurchaseYield == YIELD_GOLD`
- Line 30907: Faith purchase completion in `CvCity::PurchaseBuilding(BuildingTypes, YieldTypes)` when `ePurchaseYield == YIELD_FAITH`

**Event System**: Uses the Lua scripting hook system via `LuaSupport::CallHook()`

**Conditional Compilation**: The event uses both MOD_EVENTS_CITY conditional compilation blocks and direct Lua hook calls for backward compatibility.

The event is fired after all internal game state updates are complete, including building creation, cost deduction, and any special building effects activation.
