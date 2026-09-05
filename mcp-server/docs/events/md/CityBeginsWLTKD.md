# Overview

The `CityBeginsWLTKD` event is triggered when a city begins a "We Love The King Day" (WLTKD) celebration in Civilization V. WLTKD is a happiness mechanic where cities celebrate when their demanded resource is provided, resulting in increased growth and yields for a limited time period.

# Event Triggers

This event is triggered when the `ChangeWeLoveTheKingDayCounter()` function is called on a city and the city transitions from having no WLTKD turns to having active WLTKD turns.

**Specific trigger conditions:**

- **Resource fulfillment**: A city's demanded luxury resource becomes available in the empire
- **Counter transition**: The city's WLTKD counter changes from 0 or negative to a positive value
- **New celebration**: This event only fires when WLTKD begins, not when it extends
- **Positive change**: The iChange parameter must be positive (> 0)

**Related mechanics that can trigger WLTKD:**

- Trading for or acquiring a city's demanded luxury resource
- Buildings that grant WLTKD turns (via `WLTKDTurns` building property)
- Policies that provide WLTKD bonuses
- Great Person actions that grant WLTKD
- Projects that provide WLTKD turns (via `WLTKDFromProject` building property)

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city beginning WLTKD |
| `cityX` | integer | The X coordinate of the city on the game map |
| `cityY` | integer | The Y coordinate of the city on the game map |
| `change` | integer | The number of turns being added to the WLTKD counter |

# Event Details

WLTKD is a key happiness and growth mechanic in Civilization V that provides significant benefits to cities when their citizens are satisfied with luxury resources. The celebration period brings increased food growth and various yield bonuses depending on the city's buildings and civilization bonuses.

**WLTKD mechanics:**

- **Growth bonus**: Cities receive increased food during WLTKD periods
- **Yield bonuses**: Various buildings provide additional yields during WLTKD
- **Instant yields**: Starting WLTKD triggers instant yield bonuses from certain buildings
- **Duration tracking**: The counter decreases each turn until the celebration ends
- **Resource dependency**: WLTKD typically requires the presence of a demanded luxury resource

**Behavioral distinctions:**

- **CityBeginsWLTKD**: Fired only when a city starts its first WLTKD celebration from a non-active state
- **CityExtendsWLTKD**: Fired when WLTKD duration is extended while already active
- **CityEndsWLTKD**: Fired when WLTKD counter reaches zero (separate event)

**Building interactions:**

- Buildings with `InstantYieldFromWLTKDStart` provide immediate yields when WLTKD begins
- Buildings with `YieldFromWLTKD` provide ongoing yield bonuses during the celebration
- Buildings with `WLTKDTurns` can directly grant WLTKD duration

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 22038

**Function Context**: Called within `CvCity::ChangeWeLoveTheKingDayCounter(int iChange, bool bUATrigger)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityBeginsWLTKD`

**Preconditions**:

- `iChange` parameter must be positive (> 0) - function returns early if <= 0
- City's current WLTKD counter must be <= 0 (not currently celebrating)
- City must be valid and have a proper owner

**Event Flow**:

1. Game logic calls `ChangeWeLoveTheKingDayCounter` with change value
2. Function checks if change is positive (> 0); returns early if not
3. Instant yield processing occurs via `doInstantYield(INSTANT_YIELD_TYPE_WLTKD_START)`
4. Function determines if this is a new WLTKD (counter was <= 0)
5. WLTKD counter is updated via `SetWeLoveTheKingDayCounter`
6. If new WLTKD, `GAMEEVENT_CityBeginsWLTKD` is invoked
7. If extending existing WLTKD, `GAMEEVENT_CityExtendsWLTKD` is invoked instead
8. Additional processing occurs if `bUATrigger` flag is set

**Related Events**:

- `CityExtendsWLTKD`: When WLTKD duration is extended during active celebration
- `CityEndsWLTKD`: When WLTKD counter reaches zero and celebration ends
