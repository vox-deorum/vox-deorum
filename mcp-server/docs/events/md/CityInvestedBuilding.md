# Overview

The `CityInvestedBuilding` event is triggered when a city invests in a specific building type in Civilization V. Building investment is a strategic mechanic that allows players to reduce the production cost of buildings by making upfront investments, representing pre-construction planning, resource allocation, and preparation that makes the building more efficient to construct.

# Event Triggers

This event is triggered when the `SetBuildingInvestment()` function is called on a city with a valid building class and the investment value is set to true.

**Specific trigger conditions:**

- **Valid building class**: The building class must be valid and available to the city's civilization
- **Investment activation**: The `bNewValue` parameter must be true (indicating investment is being enabled)
- **Building existence**: The civilization must have a building available for the specified building class
- **Investment decision**: Player or AI has chosen to invest in the building to reduce its production cost

**Related mechanics that can trigger building investment:**

- Strategic city development planning where players invest in key buildings early
- Economic optimization strategies to reduce long-term production costs
- Preparation for wonder construction through building class investment
- AI decision-making algorithms that invest in buildings based on city development priorities
- Policy or trait bonuses that make building investments more attractive
- Response to specific game conditions that make certain buildings particularly valuable

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city making the building investment (from `getOwner()`) |
| `cityID` | integer | The unique identifier of the city where the building investment is made (from `GetID()`) |
| `buildingClassID` | integer | The building class identifier for the type of building being invested in (`eBuildingClass`) |
| `invested` | boolean | Whether the investment is being activated (true) or deactivated (false) (`bNewValue`) |

# Event Details

Building investment represents a forward-thinking economic strategy where cities can reduce the production cost of specific building types by making advance investments. This system allows players to optimize their long-term development by reducing the future cost of important buildings through upfront planning and resource allocation.

**Investment mechanics:**

- **Cost reduction**: Investments reduce the production cost required to complete buildings
- **Investment baseline**: Default investment provides significant percentage reduction in building cost
- **Trait modifiers**: Civilization or leader traits can modify the effectiveness of building investments
- **Player modifiers**: Player-wide investment bonuses from policies, technologies, or other sources
- **Wonder scaling**: World Wonders typically receive reduced investment benefits (half effectiveness)

**Investment calculation process:**

- **Base discount**: Starting with a baseline percentage reduction (typically around 50%)
- **Trait bonuses**: Player trait investment modifiers are added to the base discount
- **Player bonuses**: Additional player-wide investment modifiers are applied
- **Wonder adjustment**: World Wonder investments receive reduced effectiveness
- **Minimum requirement**: Buildings must still require at least one turn of production after investment
- **Cost validation**: Investment cannot make buildings more expensive than their original cost

**Strategic considerations:**

- **Early investment**: Investing early in building types that will be built multiple times across the empire
- **Wonder preparation**: Investing in wonder classes before attempting construction
- **Economic efficiency**: Balancing upfront investment costs with long-term production savings
- **City specialization**: Investing in buildings that align with a city's intended role
- **Resource management**: Ensuring sufficient resources are available for both investment and construction

**Investment benefits:**

- **Reduced production time**: Lower production costs mean faster building completion
- **Resource efficiency**: Less hammers required overall for building construction
- **Strategic flexibility**: Ability to quickly construct key buildings when needed
- **Economic planning**: Long-term development strategy implementation

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 11547

**Function Context**: Called within `CvCity::SetBuildingInvestment(BuildingClassTypes eBuildingClass, bool bNewValue)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityInvestedBuilding`

**Preconditions**:

- `eBuildingClass` must be greater than `NO_BUILDINGCLASS` and less than total building class count
- City must have a valid building available for the specified building class
- `bNewValue` must be true for the event to be triggered (investment activation)
- City must belong to a valid player

**Event Flow**:

1. `SetBuildingInvestment` is called with a valid building class and investment flag
2. System validates that the building class is within acceptable ranges
3. Building type is retrieved based on the city's civilization and building class
4. If no valid building exists for the class, investment is cancelled (`bNewValue` set to false)
5. Investment state is stored in the city's building investment array
6. If investment is being disabled (`bNewValue` is false), cost reduction is reset and function returns
7. `GAMEEVENT_CityInvestedBuilding` hook is invoked with player ID, city ID, building class, and investment status
8. Production cost calculations begin for the invested building
9. Discount percentage is calculated using baseline, trait modifiers, and player bonuses
10. World Wonder discount adjustment is applied if applicable (typically halved effectiveness)
11. Final production cost after investment is calculated and validated
12. Minimum production requirement is enforced (at least one turn from completion)
13. Investment cost reduction is stored and made available to the city's building system

**Cost Calculation Formula**:

- Base production needed is calculated for the specific building
- Discount percentage = Baseline + Trait Modifier + Player Modifier
- For World Wonders: Discount percentage is halved
- Final cost = Original cost × (100 + Discount percentage) / 100
- Investment reduction = max(0, Original cost - Final cost)

**Related Systems**:

- Building production system that utilizes the investment cost reductions
- Player trait system that provides investment modifiers
- Policy system that may grant investment bonuses
- Economic planning systems that determine optimal investment strategies
