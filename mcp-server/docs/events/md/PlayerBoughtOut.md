# Overview

The `PlayerBoughtOut` event is triggered when a major civilization successfully buys out a city-state (minor civilization), effectively removing the city-state from independent status. This event captures a significant diplomatic and economic action that eliminates a minor civilization from the game.

# Event Triggers

This event is triggered when a major civilization completes the buyout process of a minor civilization through the city-state interaction system. The trigger occurs within the `CvMinorCivAI` class when the buyout transaction is finalized and the minor civilization transitions from independent status to being controlled by the purchasing major civilization.

The buyout typically requires:

1. **Diplomatic Prerequisites**: Specific relationship levels or conditions with the city-state
2. **Economic Investment**: Substantial gold or resource expenditure
3. **Strategic Opportunity**: Appropriate game state conditions for buyout availability

# Parameters

The event passes two parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| BuyingPlayer | PlayerTypes | The ID of the major civilization that performed the buyout |
| MinorPlayer | PlayerTypes | The ID of the minor civilization (city-state) that was bought out |

# Event Details

The event provides essential information about the buyout transaction:

- **Economic Action**: Represents a significant investment by the major civilization to eliminate competition
- **Diplomatic Impact**: Removes an independent city-state from the diplomatic landscape
- **Strategic Consequences**: The buyout can affect trade routes, resources, and regional control
- **Player Context**: Both the purchasing civilization and the eliminated city-state are identified
- **Permanent Change**: Unlike other diplomatic actions, buyouts permanently alter the game state

The buyout represents one of the most decisive actions a major civilization can take regarding city-state relationships, effectively absorbing the minor civilization's territory and resources.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvMinorCivAI.cpp`

**Trigger Location**: Line 15806 within the minor civilization AI management system

**Event System**: Uses the game event system via `GAMEEVENTINVOKE_HOOK(GAMEEVENT_PlayerBoughtOut)`

**Minor Civilization Context**: City-state buyouts typically:

- Require substantial economic investment from the major civilization
- May have diplomatic prerequisites or relationship requirements
- Permanently remove the city-state from independent status
- Transfer the city-state's territory, resources, and strategic position to the buyer
- Can significantly alter regional balance of power and diplomatic relationships

**AI Integration**: The event occurs within the minor civilization AI system, indicating that buyout decisions and processing involve sophisticated diplomatic and economic calculations to determine feasibility and conditions.
