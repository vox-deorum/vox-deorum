# Overview

The `CitySoldBuilding` event is triggered when a player sells a building in one of their cities in Civilization V. Building selling is an economic mechanic that allows players to demolish existing buildings in exchange for gold, providing a way to free up space, reduce maintenance costs, or generate immediate revenue when buildings are no longer needed or useful.

# Event Triggers

This event is triggered through the network message system when the `ResponseSellBuilding()` function processes a player's request to sell a building.

**Specific trigger conditions:**

- **Player action**: A human or AI player has chosen to sell a specific building in a city
- **Valid building**: The building must exist in the city and be eligible for sale
- **Network processing**: The sell building command has been validated and is being processed
- **Game state validation**: The game is properly initialized and the player is valid

**Related mechanics that can trigger building sales:**

- Player interface actions where the player manually sells buildings through the city screen
- Economic optimization strategies where players sell obsolete or unnecessary buildings
- AI decision-making algorithms that sell buildings to improve economic efficiency
- Emergency financial measures when players need immediate gold income
- City management optimization to reduce maintenance costs or free building slots
- Strategic decisions to remove buildings that provide negative effects

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who is selling the building (`ePlayer`) |
| `cityID` | integer | The unique identifier of the city where the building is being sold (`iCityID`) |
| `buildingType` | integer | The building type identifier for the specific building being sold (`eBuilding`) |

# Event Details

Building selling represents an economic management tool that allows players to liquidate constructed infrastructure for immediate financial benefit while simultaneously reducing ongoing maintenance costs. This mechanism provides flexibility in city development by allowing players to adapt their city composition to changing strategic needs.

**Building sale mechanics:**

- **Gold generation**: Selling buildings provides immediate gold income based on the building's value
- **Maintenance reduction**: Sold buildings no longer contribute to the city's or empire's maintenance costs
- **Space management**: Selling buildings can free up building slots for more useful constructions
- **Strategic adaptation**: Players can modify city composition to match evolving game conditions
- **Economic emergency**: Building sales can provide quick cash flow during financial crises

**Sale value considerations:**

- **Building cost**: Sale price is typically a percentage of the original building construction cost
- **Depreciation**: Buildings may sell for less than their construction cost, representing depreciation
- **Strategic value**: Some buildings may be more valuable to keep than sell despite maintenance costs
- **Replacement difficulty**: Consider whether the building can be easily rebuilt if needed later

**Strategic reasons for building sales:**

- **Obsolescence**: Buildings rendered obsolete by technological or policy changes
- **Economic pressure**: Need for immediate gold to fund other priorities
- **Maintenance optimization**: Reducing ongoing costs to improve net income
- **City specialization**: Removing buildings that don't align with a city's intended role
- **Resource reallocation**: Converting building investments into liquid assets for other uses

**Buildings typically eligible for sale:**

- **Economic buildings**: Markets, Banks, Stock Exchanges when not needed
- **Military buildings**: Barracks, Armories when military production is not prioritized
- **Specialist buildings**: Libraries, Universities when specialist focus changes
- **Infrastructure**: Buildings that become less useful due to changed city circumstances

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvDllNetMessageHandler.cpp`, line 1113 (GAMEEVENT hook) or line 1125 (Lua hook)

**Function Context**: Called within `CvDllNetMessageHandler::ResponseSellBuilding(PlayerTypes ePlayer, int iCityID, BuildingTypes eBuilding)`

**Script System Integration**: Uses either `GAMEEVENTINVOKE_HOOK` with `GAMEEVENT_CitySoldBuilding` (when `MOD_EVENTS_CITY` is enabled) or `LuaSupport::CallHook` with "CitySoldBuilding" (fallback)

**Preconditions**:

- Game must be fully initialized (`GC.getGame().isFinalInitialized()`)
- Player ID must be valid (not `PlayerInvalid(ePlayer)`)
- City must exist and belong to the specified player
- Building must exist in the city and be eligible for sale

**Event Flow**:

1. Network message system receives a sell building request from the client
2. `ResponseSellBuilding` function validates game state and player
3. Target city is retrieved using player ID and city ID
4. If city exists, `pCity->GetCityBuildings()->DoSellBuilding(eBuilding)` is called
5. Building sale transaction is processed (building removed, gold added, maintenance reduced)
6. Event system checks if `MOD_EVENTS_CITY` is enabled
7. If MOD_EVENTS_CITY is enabled, `GAMEEVENT_CitySoldBuilding` hook is invoked
8. If MOD_EVENTS_CITY is not enabled, Lua script hook "CitySoldBuilding" is called instead
9. Arguments (player ID, city ID, building type) are passed to the appropriate event system
10. Event handlers can respond to the building sale for additional game logic

**Network Integration**:

- Building sales are processed through the network message system for multiplayer compatibility
- Client requests are validated server-side before processing
- Events are triggered after the sale transaction is completed successfully

**Conditional Event Systems**:

- Modern event system (GAMEEVENT) is used when `MOD_EVENTS_CITY` is compiled and enabled
- Legacy Lua event system is used as fallback when modern events are not available
- Both systems provide the same information but through different interfaces

**Building Sale Processing**:

- `DoSellBuilding` function handles the actual removal of the building from the city
- Gold income is calculated and added to the player's treasury
- Building maintenance costs are removed from ongoing calculations
- City yields and statistics are updated to reflect the building's removal

**Related Events**:

- Economic events related to gold income changes from building sales
- City yield events that may be triggered by removing buildings that affect production
- Maintenance cost events that reflect reduced ongoing expenses
- UI events that update city displays to reflect the sold building's removal
