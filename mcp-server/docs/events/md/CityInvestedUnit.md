# Overview

The `CityInvestedUnit` event is triggered when a city invests in a specific unit class in Civilization V. Unit investment is a strategic production mechanic that allows cities to reduce the production cost of unit types through upfront investment, representing advanced preparation, training infrastructure, and resource allocation that makes unit production more efficient.

# Event Triggers

This event is triggered when the `SetUnitInvestment()` function is called on a city with a valid unit class and the investment value is set to true.

**Specific trigger conditions:**

- **Valid unit class**: The unit class must be valid and within the acceptable range of unit classes
- **Investment activation**: The `bNewValue` parameter must be true (indicating investment is being enabled)
- **Unit availability**: The player must have access to a unit type corresponding to the unit class
- **Investment decision**: Player or AI has chosen to invest in the unit class to reduce future production costs

**Related mechanics that can trigger unit investment:**

- Military planning strategies where players invest in key unit types before conflicts
- Economic optimization to reduce the cost of frequently produced units
- Preparation for large-scale military campaigns through unit class investment
- AI strategic decision-making based on military needs and economic efficiency
- Response to technological advances that unlock powerful new unit types
- Civilization or leader traits that make unit investments particularly beneficial

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city making the unit investment (from `getOwner()`) |
| `cityID` | integer | The unique identifier of the city where the unit investment is made (from `GetID()`) |
| `unitClassID` | integer | The unit class identifier for the type of units being invested in (`eUnitClass`) |
| `invested` | boolean | Whether the investment is being activated (true) or deactivated (false) (`bNewValue`) |

# Event Details

Unit investment represents a forward-thinking military and economic strategy where cities can reduce the production cost of specific unit classes by making advance investments. This system allows players to optimize their military production by reducing the future cost of important unit types through upfront planning and infrastructure development.

**Investment mechanics:**

- **Cost reduction**: Investments reduce the production cost required to train units of the invested class
- **Investment baseline**: Default investment provides significant percentage reduction in unit production cost
- **Trait modifiers**: Civilization or leader traits can modify the effectiveness of unit investments
- **Player modifiers**: Player-wide investment bonuses from policies, technologies, or other sources
- **Production overflow**: System handles cases where units are partially completed before investment

**Investment calculation process:**

- **Base discount**: Starting with a baseline percentage reduction (typically around 50%)
- **Trait bonuses**: Player trait investment modifiers are added to the base discount
- **Player bonuses**: Additional player-wide investment modifiers are applied
- **Minimum cost**: Units must still require at least 1 production hammer after investment
- **Overflow handling**: Special logic for units that are already partially completed when investment occurs

**Strategic applications:**

- **Military preparation**: Investing in unit classes before anticipated conflicts or expansion
- **Economic efficiency**: Reducing long-term production costs for frequently trained units
- **Specialized production**: Cities can focus on producing specific unit types more efficiently
- **Campaign readiness**: Preparing for large-scale military operations through advance investment
- **Technology transitions**: Investing in advanced unit classes when new technologies become available

**Investment benefits:**

- **Reduced training time**: Lower production costs mean faster unit completion
- **Resource efficiency**: Less hammers required overall for unit production
- **Military flexibility**: Ability to quickly produce needed units when circumstances change
- **Strategic depth**: Long-term military planning becomes more viable and rewarding

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 11607

**Function Context**: Called within `CvCity::SetUnitInvestment(UnitClassTypes eUnitClass, bool bNewValue)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityInvestedUnit`

**Preconditions**:

- `eUnitClass` must be >= 0 and less than the total number of unit class infos
- `bNewValue` must be true for the event to be triggered (investment activation only)
- City must belong to a valid player with access to units of the specified class
- Unit class must correspond to a valid unit type available to the player

**Event Flow**:

1. `SetUnitInvestment` is called with a valid unit class and investment flag
2. System validates that the unit class is within acceptable ranges
3. If `bNewValue` is true (investment activation), `GAMEEVENT_CityInvestedUnit` hook is invoked immediately
4. Investment state is stored in the city's unit investment array
5. If investment is being enabled (`bNewValue` is true), cost calculations begin
6. Specific unit type is retrieved based on the player's civilization and unit class
7. Base production needed for the unit is calculated
8. Discount percentage is calculated using baseline, trait modifiers, and player bonuses
9. Final production cost after investment is computed and validated
10. Special handling occurs for units that are already partially completed
11. Investment cost reduction is stored and made available to the city's production system
12. If investment is being disabled, cost reduction is reset to zero

**Cost Calculation Details**:

- Base production needed is calculated for the specific unit type
- Total discount = Baseline + Trait Modifier + Player Modifier
- Final cost = Original cost × (Total discount + 100) / 100
- Minimum cost of 1 production hammer is enforced
- For partially completed units: Special overflow logic ensures fair investment application

**Overflow Handling Logic**:

- System checks if the unit is already partially completed
- If completed production >= calculated investment cost, special adjustments are made
- Investment cost is reduced to account for one turn of production overflow
- This prevents investment from immediately completing units that are nearly finished

**Related Systems**:

- Unit production system that utilizes the investment cost reductions
- Player trait system that provides investment modifiers
- Technology system that unlocks new unit classes for investment
- Military planning systems that determine optimal investment strategies
- Economic planning systems that balance investment costs with production benefits
