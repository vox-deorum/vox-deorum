# Overview

The PlayerPlunderedTradeRoute event is triggered when a unit successfully plunders (pillages) a trade route in Civilization V. This event captures the details of the plundering action, including information about the attacking unit, the affected trade route, and the amount of gold gained from the plundering.

# Event Triggers

This event is triggered when:

- A military unit successfully pillages/plunders an active trade route
- The plundering results in gold gain for the attacking player
- The MOD_EVENTS_TRADE_ROUTE_PLUNDERED mod setting is enabled

The event fires immediately after the plunder calculation and achievement processing but before any plot modifications are made to the trade route path.

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `pUnit->getOwner()` | PlayerID | The player ID of the unit that performed the plundering |
| `pUnit->GetID()` | UnitID | The unique identifier of the unit that plundered the trade route |
| `iPlunderGoldValue` | Integer | The amount of gold gained from plundering the trade route |
| `pOriginCity->getOwner()` | PlayerID | The player ID who owns the origin city of the plundered trade route |
| `pOriginCity->GetID()` | CityID | The unique identifier of the origin city |
| `pDestCity->getOwner()` | PlayerID | The player ID who owns the destination city of the plundered trade route |
| `pDestCity->GetID()` | CityID | The unique identifier of the destination city |
| `eConnectionType` | TradeConnectionType | The type of trade connection that was plundered |
| `eDomain` | DomainType | The domain of the trade route (land or sea) |

# Event Details

The PlayerPlunderedTradeRoute event provides comprehensive information about trade route plundering incidents. When a unit successfully pillages a trade route, this event captures both the perpetrator information (attacking unit and owner) and victim information (trade route cities and owners).

The event includes the economic impact through the `iPlunderGoldValue` parameter, which represents the gold gained by the plundering player. The trade route details include both origin and destination cities with their respective owners, allowing for complete tracking of the affected trade relationship.

The `eConnectionType` and `eDomain` parameters provide additional context about the nature of the plundered route, distinguishing between different types of trade connections and whether the route was land-based or sea-based.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvTradeClasses.cpp` (Line 5152)

**Conditional Compilation**: This event is only available when `MOD_EVENTS_TRADE_ROUTE_PLUNDERED` is defined and enabled.

**Execution Context**: The event is invoked after:

- Gold plunder value calculation
- Achievement processing (for land domain plundering)
- Notification system updates

**Game State**: The event fires before any modifications are made to the trade route's plot list, ensuring that the trade route information passed to the event represents the state at the time of plundering.
