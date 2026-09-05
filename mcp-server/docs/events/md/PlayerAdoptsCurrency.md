# Overview

The `PlayerAdoptsCurrency` event is triggered when a player changes their active currency system. This event captures both the adoption of a new currency and the abandonment of a previous one, providing insights into a player's economic strategic decisions and trade relationships.

# Event Triggers

This event is triggered whenever a player's currency changes through the `SetCurrency` function in the `CvPlayer` class. The event is called with different previous currency values depending on the player's current state:

1. **First Currency Adoption**: When a player adopts a currency for the first time (HasCurrency() returns false), the event is triggered with -1 as the previous currency
2. **Currency Change**: When a player already has a currency and switches to a different one, the event is triggered with the current currency as the previous currency

Both scenarios occur within the same `SetCurrency` function, ensuring that all currency changes are properly tracked and communicated to the game systems.

# Parameters

The event passes three parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| PlayerID | PlayerTypes | The ID of the player whose currency changed |
| NewCurrency | int | The ID of the currency being adopted |
| PreviousCurrency | int | The ID of the previous currency (-1 if no previous currency existed) |

# Event Details

The event provides comprehensive information about currency transitions:

- **Currency Transition Tracking**: The event distinguishes between adopting a new currency and abandoning an old one
- **Player Context**: The player ID identifies which civilization made the currency change
- **Currency Information**: Both new and previous currency values provide complete transition context
- **Economic Implications**: Currency changes can affect trade relationships and economic bonuses
- **Strategic Indicator**: Currency adoption often reflects diplomatic and trade strategy decisions

The event captures the dynamic nature of currency systems where players may change their monetary approach based on economic needs or strategic considerations.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`

**Trigger Locations**:

- Line 29733: First currency adoption (previous currency set to -1, indicating no previous currency)
- Line 29737: Currency change (includes both new currency and current currency as previous)

**Event System**: Uses the game event system via `GAMEEVENTINVOKE_HOOK(GAMEEVENT_PlayerAdoptsCurrency)`

**Currency Context**: Currency systems in the game typically:

- Provide economic bonuses and trade advantages
- Influence diplomatic relationships with other civilizations
- Can be tied to specific technologies, policies, or trade agreements
- May have requirements or restrictions based on civilization traits or game state

**Parameter Pattern**: The dual-call pattern allows event handlers to track both the departure from one currency system and the adoption of another, providing complete visibility into currency transitions.
