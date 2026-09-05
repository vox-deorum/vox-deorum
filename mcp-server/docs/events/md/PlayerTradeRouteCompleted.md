# Overview

The PlayerTradeRouteCompleted event is triggered when a trade route successfully completes its journey and reaches its destination in Civilization V. This event captures the completion of a trade connection between two cities, providing detailed information about the route that has finished its cycle.

# Event Triggers

This event is triggered when:

- A trade route successfully reaches its destination city
- Both origin and destination cities are valid and accessible
- The trade connection is about to be cleared from the system
- A new trade unit is about to be created to replace the completed route

The event fires just before the trade route is wiped from the active connections and before the replacement trade unit is generated.

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `pOriginCity->getOwner()` | PlayerID | The player ID who owns the origin city of the completed trade route |
| `pOriginCity->GetID()` | CityID | The unique identifier of the origin city where the trade route started |
| `pDestCity->getOwner()` | PlayerID | The player ID who owns the destination city of the completed trade route |
| `pDestCity->GetID()` | CityID | The unique identifier of the destination city where the trade route ended |
| `eDomain` | DomainType | The domain of the completed trade route (land or sea) |
| `pTradeConnection->m_eConnectionType` | TradeConnectionType | The type of trade connection that was completed |

# Event Details

The PlayerTradeRouteCompleted event marks the successful completion of a trade route cycle in Civilization V. When a trade unit reaches its destination, this event captures all the essential information about the completed route before the game system cleans up the connection and prepares for the next cycle.

Key information provided by this event:

- **Route Participants**: Both origin and destination cities with their respective owners
- **Route Characteristics**: The domain (land/sea) and connection type of the completed route
- **Economic Context**: Information about which players benefited from the trade relationship

This event is particularly valuable for tracking economic relationships between civilizations, monitoring trade route efficiency, and analyzing the flow of commerce across the game world. It provides a complete picture of successful trade connections at the moment of their completion.

The event occurs at a critical transition point - after the route has delivered its benefits but before the connection is cleared and a new trade unit is created for potential future routes.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvTradeClasses.cpp` (Line 2587)

**Execution Context**: The event is invoked:

- After successful destination validation (both cities exist and are accessible)
- Before the trade route is cleared (`pTrade->ClearTradeRoute(ui)`)
- Before a new trade unit is created to replace the completed route
- Within the trade route processing cycle

**Game State**: The event fires at the moment of route completion, ensuring that all trade connection information is still intact and accurate when passed to the event handlers.
