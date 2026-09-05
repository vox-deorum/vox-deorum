# Overview

The `CityExtendsWLTKD` event is triggered when a city's "We Love The King Day" (WLTKD) celebration is extended while already active in Civilization V. This event occurs when additional WLTKD turns are added to a city that is already celebrating, representing the prolongation of the happiness and growth bonuses rather than the initiation of a new celebration period.

# Event Triggers

This event is triggered when the `ChangeWeLoveTheKingDayCounter()` function is called on a city that already has an active WLTKD celebration.

**Specific trigger conditions:**

- **Active WLTKD**: The city must already be celebrating WLTKD (WLTKD counter > 0)
- **Positive change**: The iChange parameter must be positive (> 0)
- **Duration extension**: Additional turns are being added to an existing celebration period
- **Resource maintenance**: The city continues to have access to its demanded luxury resource or other WLTKD sources

**Related mechanics that can extend WLTKD:**

- Continued access to a city's demanded luxury resource while already celebrating
- Buildings that grant additional WLTKD turns during active celebrations
- Policies that provide ongoing WLTKD bonuses to celebrating cities
- Great Person actions that extend WLTKD duration
- Projects completed during active WLTKD that provide additional celebration turns
- Unique abilities or traits that extend WLTKD celebrations

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city extending WLTKD (from `getOwner()`) |
| `cityX` | integer | The X coordinate of the city on the game map (from `getX()`) |
| `cityY` | integer | The Y coordinate of the city on the game map (from `getY()`) |
| `change` | integer | The number of turns being added to the existing WLTKD counter (`iChange`) |

# Event Details

WLTKD extension represents the continuation and prolongation of a city's happiness celebration when conditions remain favorable or additional sources of celebration are activated. This differs from beginning WLTKD in that the city is already experiencing the benefits and the extension maintains rather than initiates the celebration state.

**WLTKD extension mechanics:**

- **Cumulative duration**: Extension adds to existing WLTKD counter rather than replacing it
- **Instant yields**: Extensions still trigger instant yield bonuses from certain buildings and effects
- **Persistent benefits**: All WLTKD benefits continue uninterrupted during the extension period
- **Stacking sources**: Multiple sources of WLTKD can contribute to extending the celebration
- **Resource dependency**: Extensions may still require the presence of demanded luxury resources

**Behavioral distinctions from other WLTKD events:**

- **CityBeginsWLTKD**: Fired only when WLTKD starts from an inactive state (counter <= 0)
- **CityExtendsWLTKD**: Fired when WLTKD duration is extended while already active (current event)
- **CityEndsWLTKD**: Fired when WLTKD counter reaches zero (separate termination event)

**Extension sources and triggers:**

- **Resource continuity**: Maintaining access to demanded luxury resources during active WLTKD
- **Building effects**: Buildings with `WLTKDTurns` property that activate during celebrations
- **Policy bonuses**: Social policies that extend WLTKD celebrations under specific conditions
- **Great Person actions**: Great People abilities that can extend existing celebrations
- **Event outcomes**: City events or choices that grant additional WLTKD turns
- **Trait bonuses**: Civilization or leader traits that extend WLTKD under certain conditions

**Extension benefits:**

- **Continued growth**: Extended food bonuses for population growth
- **Ongoing yields**: Maintained yield bonuses from buildings and effects during WLTKD
- **Happiness maintenance**: Sustained happiness benefits throughout the extended period
- **Building synergies**: Buildings continue providing WLTKD-related bonuses

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 22042

**Function Context**: Called within `CvCity::ChangeWeLoveTheKingDayCounter(int iChange, bool bUATrigger)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityExtendsWLTKD`

**Preconditions**:

- `iChange` parameter must be positive (> 0)
- City's current WLTKD counter must be > 0 (already celebrating)
- City must be valid and have a proper owner
- The `bNewWLTKD` flag must be false (indicating an extension rather than initiation)

**Event Flow**:

1. Game logic calls `ChangeWeLoveTheKingDayCounter` with positive change
2. Function checks if change is positive; returns early if not
3. Instant yield processing occurs via `doInstantYield(INSTANT_YIELD_TYPE_WLTKD_START)`
4. Function checks current WLTKD counter status (`m_iWeLoveTheKingDayCounter <= 0`)
5. Since counter > 0, `bNewWLTKD` remains false (indicating extension)
6. WLTKD counter is updated via `SetWeLoveTheKingDayCounter` with the extended total
7. Since `bNewWLTKD` is false, `GAMEEVENT_CityExtendsWLTKD` is invoked instead of begins event
8. If `bUATrigger` flag is set, additional trait-based permanent yield changes are applied
9. Extended celebration continues with accumulated duration

**Counter Logic**:

- **Extension detection**: Extension occurs when counter > 0 before the change
- **Accumulation**: New turns are added to existing counter value
- **Minimum duration**: Extensions maintain at least the existing celebration period
- **Maximum limits**: Extensions are subject to any game-imposed maximum limits

**Related Events**:

- `CityBeginsWLTKD`: When WLTKD starts from an inactive state
- `CityEndsWLTKD`: When WLTKD counter reaches zero and celebration ends
- Various instant yield events that may be triggered during extension
