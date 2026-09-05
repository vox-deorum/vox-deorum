# Overview

The `CityPrepared` event is triggered during end-of-turn processing when a city's specialists generate Great Person Points (GPP) toward the creation of Great People in Civilization V. This event represents the ongoing accumulation of expertise and progress toward birthing Great People through the work of specialists in the city, tracking the incremental progress that specialists make each turn toward their respective Great Person thresholds.

# Event Triggers

This event is triggered during the `DoSpecialists()` function execution when specialists in a city generate Great Person Points at the end of each turn.

**Specific trigger conditions:**

- **Active specialists**: The city must have at least one specialist of a particular type working
- **Positive GPP generation**: The specialist must generate a non-zero amount of Great Person Points
- **Turn processing**: Event occurs during end-of-turn specialist processing
- **MOD_EVENTS_CITY enabled**: The event is only triggered when city events are enabled in the game configuration

**Related mechanics that generate Great Person Points:**

- Specialists working in buildings (Scientists in Libraries, Engineers in Workshops, etc.)
- Building effects that provide specialist slots and GPP generation
- Civilization or leader traits that modify Great Person Point generation rates
- Social policies that affect specialist effectiveness and GPP production
- Wonders and buildings that provide percentage bonuses to Great Person generation
- City population and specialist allocation determining overall GPP output

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city generating Great Person Points (from `GetCity()->getOwner()`) |
| `cityPtr` | CvCity* | Pointer to the city object where specialists are generating GPP (from `GetCity()`) |
| `specialistType` | integer | The type of specialist generating the Great Person Points (`eSpecialist`) |
| `gppChange` | integer | The amount of Great Person Points being generated this turn (`iGPPChange`) |
| `gppThreshold` | integer | The total GPP required to spawn a Great Person of this type (`iGPThreshold`) |

# Event Details

The CityPrepared event represents the ongoing development and accumulation of Great Person Points that eventually lead to the birth of Great People. Specialists working in cities contribute their expertise toward various fields, gradually building up the knowledge, culture, faith, or engineering prowess that manifests as Great People who can significantly impact civilization development.

**Great Person Point mechanics:**

- **Specialist contribution**: Each specialist type contributes to specific Great Person types
- **Accumulative progress**: GPP accumulates over multiple turns until threshold is reached
- **Threshold scaling**: Great Person thresholds increase with each Great Person spawned
- **City-specific progress**: Each city tracks GPP progress independently for each specialist type
- **Rate modifiers**: Various game elements can modify the rate of GPP generation

**Specialist types and their Great People:**

- **Scientists**: Generate Great Scientist points through research and discovery
- **Engineers**: Generate Great Engineer points through technological innovation
- **Merchants**: Generate Great Merchant points through trade and commerce
- **Artists**: Generate Great Artist points through cultural expression
- **Musicians**: Generate Great Musician points through musical composition
- **Writers**: Generate Great Writer points through literary works

**GPP calculation factors:**

- **Base specialist yield**: Each specialist type has a base GPP generation rate
- **Building bonuses**: Buildings can provide percentage bonuses to GPP generation
- **Policy modifiers**: Social policies can affect specialist effectiveness
- **Trait bonuses**: Civilization traits may provide GPP generation bonuses
- **Wonder effects**: Certain wonders provide empire-wide or city-specific GPP bonuses
- **Puppet city effects**: Player traits may provide bonuses based on puppet cities

**Progress tracking:**

- **Turn-by-turn accumulation**: GPP accumulates incrementally each turn
- **Threshold monitoring**: System tracks progress toward the next Great Person
- **Specialist management**: Players can allocate specialists to optimize GPP generation
- **City specialization**: Cities can focus on specific types of Great People through specialist allocation

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCityCitizens.cpp`, line 2961

**Function Context**: Called within `CvCityCitizens::DoSpecialists()` during end-of-turn processing

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityPrepared`

**Preconditions**:

- `MOD_EVENTS_CITY` must be enabled for the event to be triggered
- City must have active specialists of the specified type
- Specialist must be generating non-zero GPP (`iGPPChange != 0`)
- City must belong to a valid player (non-null owner)

**Event Flow**:

1. `DoSpecialists()` is called during end-of-turn processing for the city
2. Function iterates through all specialist types in the game
3. For each specialist type, `GetSpecialistRate()` calculates GPP generation
4. If GPP generation is non-zero, specialist info is retrieved from game database
5. GPP threshold is calculated using `GetSpecialistUpgradeThreshold()`
6. `ChangeSpecialistGreatPersonProgressTimes100()` updates the accumulated progress
7. If city events are enabled, `GAMEEVENT_CityPrepared` hook is invoked with full context
8. System checks if accumulated GPP has reached the threshold for Great Person spawning
9. If threshold is reached and player is not a minor civ, Great Person creation process begins
10. GPP progress is reset and the Great Person unit is spawned

**GPP Threshold Calculation**:

- Thresholds increase with each Great Person spawned to maintain game balance
- Different Great Person types may have different base thresholds
- Game speed and difficulty settings can affect threshold calculations
- Player traits and game modifications can influence threshold requirements

**Great Person Spawning Logic**:

- Only major civilizations (non-minor civs) can spawn Great People from specialists
- Progress is reset by the threshold amount after spawning
- The specific unit type is determined by the specialist's Great Person class
- Great People spawn in the city that generated the required GPP

**Related Events**:

- Unit creation events when Great People are actually spawned
- Various specialist and building events that affect GPP generation rates
- Policy adoption events that might modify Great Person generation
