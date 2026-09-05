# Overview

The `CityPuppeted` event is triggered when a city is converted into a puppet state in Civilization V. Puppet cities are a special governance form applied to captured cities, where the city operates with limited player control and reduced unhappiness penalties, representing a hands-off administrative approach that allows conquered populations to largely govern themselves while still contributing to the empire.

# Event Triggers

This event is triggered when the `SetPuppet()` function is called on a city with the puppet value set to true.

**Specific trigger conditions:**

- **Puppet status change**: The city's puppet status is being changed from false to true
- **Status validation**: The city's current puppet status must be different from the new value
- **City capture**: Most commonly occurs when cities are captured and the player chooses to puppet them
- **Administrative decision**: Player explicitly chooses to puppet a city through the interface

**Related mechanics that can trigger city puppeting:**

- City capture during war where the player chooses to puppet rather than annex or raze
- Player decision to convert an occupied city to puppet status through the city management interface
- AI decision-making systems that automatically puppet captured cities based on strategic considerations
- Diplomatic consequences of city capture that require puppet status for reduced warmonger penalties
- Policy or trait effects that may automatically puppet captured cities under certain conditions

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city being converted to puppet status (from `getOwner()`) |
| `cityID` | integer | The unique identifier of the city being converted to puppet status (from `GetID()`) |

# Event Details

City puppeting represents a governance strategy for managing conquered territories with minimal direct control while reducing the administrative burden and unhappiness penalties associated with occupation. Puppet cities operate semi-independently, focusing on economic growth while contributing resources to the empire without requiring detailed micromanagement.

**Puppet city characteristics:**

- **Limited control**: Players cannot directly control production choices in puppet cities
- **Automated production**: Cities automatically select production based on AI priorities
- **Reduced unhappiness**: Puppet cities generate less unhappiness from occupation
- **Economic focus**: Puppet cities prioritize gold and growth over military or specialist production
- **No policy costs**: Puppet cities do not contribute to social policy costs or technology costs
- **Trade benefits**: Puppet cities can still conduct trade and provide trade route connections

**Puppet vs. other city states:**

- **Annexed cities**: Full control with full unhappiness penalties and policy costs
- **Occupied cities**: Temporary status with maximum unhappiness until permanent decision is made
- **Razed cities**: Cities completely destroyed rather than incorporated into the empire
- **Puppet cities**: Limited control with reduced penalties and automated management

**Strategic considerations for puppeting:**

- **Warmonger reduction**: Puppeting cities generates less diplomatic penalty than full annexation
- **Administrative efficiency**: Puppets require less micromanagement than fully controlled cities
- **Economic benefits**: Puppets still contribute gold and population to the empire
- **Happiness management**: Reduced unhappiness makes puppets easier to integrate
- **Late-game expansion**: Puppeting allows territorial expansion without overwhelming management

**Puppet city limitations:**

- **Production control**: Cannot directly choose what puppet cities build
- **Specialist assignment**: Cannot manually assign citizens to specialist slots
- **Building construction**: Cannot prioritize specific buildings or infrastructure
- **Military units**: Puppets may not efficiently produce military units when needed

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 19566

**Function Context**: Called within `CvCity::SetPuppet(bool bValue)` when puppet status is being enabled

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityPuppeted`

**Preconditions**:

- City's current puppet status (`m_bPuppet`) must be different from the new value
- `bValue` parameter must be true for the event to be triggered
- City must belong to a valid player
- City must not be in a razing state (for `DoCreatePuppet()` function)

**Event Flow**:

1. `SetPuppet` is called with `bValue` set to true
2. System validates that the city's puppet status is actually changing
3. City's puppet status is updated (`m_bPuppet = bValue`)
4. If enabling puppet status, `GAMEEVENT_CityPuppeted` hook is invoked immediately
5. Warmonger penalty processing begins if the city was recently captured
6. Previous owner information is checked for diplomatic consequences
7. Warmonger penalties are applied through `CvDiplomacyAIHelpers::ApplyWarmongerPenalties`
8. City's "No Warmonger" flag is disabled to prevent future penalty avoidance
9. All non-plot yields are updated to reflect the new puppet status
10. Additional puppet-specific configurations are applied (via `DoCreatePuppet` if called separately)

**Puppet Configuration Process** (if `DoCreatePuppet()` is called):

- Happiness processing is normalized (`SetIgnoreCityForHappiness(false)`)
- Puppet status is enabled via `SetPuppet(true)`
- Production is set to automated mode (`setProductionAutomated(true, true)`)
- Building validation occurs to remove buildings incompatible with puppet status
- Buildings with "NoOccupiedUnhappiness" are processed for removal if inappropriate

**Warmonger Penalty Integration**:

- System checks if the city has the "No Warmonger Yet" flag set
- Previous owner information is retrieved to determine diplomatic impact
- Appropriate warmonger penalties are calculated and applied based on city capture context
- Future warmonger immunity is disabled for this city

**Yield and Economic Integration**:

- `UpdateAllNonPlotYields(true)` recalculates city yields under puppet status
- Economic bonuses and penalties specific to puppet cities are applied
- Trade route capabilities and economic contributions are maintained

**Related Events**:

- City capture events that may precede puppeting decisions
- Warmonger penalty events that occur as a result of city puppeting
- Economic and yield events triggered by puppet status changes
- Diplomatic events related to territory acquisition and warmonger penalties
