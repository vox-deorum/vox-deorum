# Unit AI: Acquisition

**Acquisition** spends gold or faith to obtain a unit immediately. A caller establishes the need, concrete candidate, and city. The city then checks legality and executes the purchase. [Production](production/overview.md) covers queue selection. For military formation demand, first read [formation requests and commitments](production/military.md#formation-requests-and-commitments): a weighted request can select a queue order without committing a formation slot, while city commitment and direct purchases have separate effects.

The main implementation is in `civ5-dll/CvGameCoreDLL_Expansion2/CvEconomicAI.cpp`, `CvCityStrategyAI.cpp`, `CvReligionClasses.cpp`, `CvMilitaryAI.cpp`, `CvAIOperation.cpp`, `CvTacticalAI.cpp`, `CvCity.cpp`, and `CvUnitProductionAI.cpp`. See the [unit AI overview](overview.md) for related responsibilities.

## Common purchase path

Most unit routes follow the same sequence: select a city and candidate, apply the route's funding and suitability policy, pass the city gate, and execute. The outcome can be a purchase, a gold investment, a queued production fallback, or no action. The route table below identifies the outcomes available to each caller.

```mermaid
flowchart LR
    R[Purchase route] --> C[Candidate and city]
    C --> F{Route policy permits spending?}
    F -->|no| X[[Skip, save, or use production]]
    F -->|yes| S{Candidate suitable?}
    S -->|no| X
    S -->|yes| G{City purchase gate}
    G -->|no| X
    G -->|yes| P[PurchaseUnit]
    P --> I{Gold investment applies?}
    I -->|yes| V[[Record investment and spend gold]]
    I -->|no| U[[Create and initialize unit]]
```

`CvEconomicAI::CanWithdrawMoneyForPurchase` grants gold permission after higher-priority savings reservations. It does not spend gold. `CvUnitProductionAI::CheckUnitBuildSanity` applies strategy rules and, in purchase mode, a gold purchase precheck. `CvCity::IsCanPurchase` validates the specific unit and yield; `CvCity::PurchaseUnit` rechecks it, finds placement before payment, creates and initializes an immediate-purchase unit, spends the currency, and updates cooldowns. Immediate gold and faith purchases fire the city-trained hook with their purchase reason. Gold investments record investment state instead.

Purchased units receive the applicable experience and damage rules and normally lose movement for the turn, unless the unit entry permits post-purchase movement. Faith purchases also initialize unit religion and update faith-purchased Great Person counters.

## Purchase routes

Routes run in this order: Economic AI, Military AI, Religion AI, City AI, then Tactical AI. Earlier routes can change the treasury, resources, cooldowns, or placement that a later route sees. A **savings request** gives a category priority and can reserve gold in Economic AI's ledger.

| Route | Purpose and candidate | Currency and route policy |
| --- | --- | --- |
| Ordinary hurry | `CvEconomicAI::DoHurry` ranks each eligible city's leading flavor-weighted candidate and special diplomat candidates. | Gold. It keeps a game-speed and era-adjusted treasury cushion and respects savings requests. |
| Final operation slot | `CvMilitaryAI::MakeEmergencyPurchases` fills the only remaining uncommitted slot in a recruiting persistent operation. | The military helper tries gold when permitted, then faith when no gold unit was obtained. |
| City operation or army need | `CvCity::CheckForOperationUnits` selects a role through `CvUnitProductionAI::RecommendUnit`. | Gold. A suitable production candidate can replace a purchase candidate when training finishes soon. |
| Tactical defense | `CvTacticalAI::PlotEmergencyPurchases` responds to a threatened land zone or besieged city. | The military helper chooses a ranged unit for an ungarrisoned city when appropriate, otherwise a defensive unit, then tries gold and faith. |
| Religious priority | `CvReligionAI::DoFaithPurchases` and `DoFaithPurchasesInCities` prioritize religious units, Great People, buildings, and eligible leftover units. | Faith. Higher-priority choices may reserve faith for a later turn. |
| Religious defense | `CvReligionAI::DoReligionDefenseInCities` reacts to a nearby foreign prophet. | Faith purchases an inquisitor in a city with the chosen religion. |

Final-slot purchases require a player outside the at-war strategy or [winning every active war](concepts.md#war-states). Tactical emergencies exclude water zones and cities likely to fall. City operation purchases exclude razing, automated, minor-civilization, barbarian, and ordinary puppet cities; they wait when average income is negative or a military unit is already queued.

Direct military paths start from a required [UnitAI role](concepts.md#unitai-roles), resolve a trainable type with `RecommendUnit`, then apply suitability and city execution. `CvAIOperation::BuyFinalUnit` assigns a successful final-slot purchase to its formation slot. `CvMilitaryAI::BuyEmergencyUnit` requests gold permission and tries faith if gold execution yields no unit. Its purchase-mode suitability still uses the gold purchase precheck. See [formation requests and commitments](production/military.md#formation-requests-and-commitments) for when `CheckForOperationUnits` commits a slot, queues production, or assigns a purchase directly.

## Savings and investment

Economic AI stores one savings request per purchase type. A newer request for that type replaces the previous one. Gold permission subtracts higher-priority reserved amounts before testing the caller's cost.

| Request | Priority | Reserved amount |
| --- | --- | --- |
| Major-civilization trade deal | 1 | Planned deal gold |
| Tile purchase | 2, replaced by the plot score at each check | Tile cost |
| Minor-civilization gift | 150 plus 25 per diplomacy-flavor point; 350 for buyout or marriage | Planned gift, buyout, or marriage cost |
| Defensive building | 250 | None |
| Unit | 500 | None |
| Unit upgrade | 500 plus 100 per military-training-flavor point; at war the flavor counts fifty-fold | First deferred [upgrade price](upgrade.md#ranking-and-reservation) |

Unit and defensive-building requests set priority but reserve no gold. Trade, tile, gift, and upgrade requests do reserve it. `DoHurry` also requires gold above twice the total reserved amount, excluding the zero-reservation categories. A wartime upgrade request with a positive military-training flavor outranks every other request in the table; a zero flavor ties the ordinary unit request.

An **investment** spends gold and records city unit-class investment state instead of creating a unit. Economic AI uses it for spaceship-project units and, when `MOD_BALANCE_UNIT_INVESTMENTS` is active, ordinary units. It skips the execution-time `IsCanPurchase` recheck and the city-trained hook. Some direct routes can add the invested unit to the production queue. Successful operation and settler purchases reset their respective skip counters.

## Faith priority and legality

Religion AI's **priority result** controls whether lower-priority faith spending runs. `DoFaithPurchases` returns true to stop that work. A purchase can either continue or stop the flow, depending on the branch.

### Priority flow

Eligible priority paths run in the order shown below. An ineligible path continues to the next check.

```mermaid
flowchart TD
    P[Priority paths in order<br/>enhancement, desired Great Person,<br/>domestic conversion, foreign spread] --> R{DoFaithPurchases result}
    R -->|Continue| D{Religious defense purchase attempt?}
    R -->|Stop| S[[Stop lower-priority work]]
    D -->|yes| X[[Stop lower-priority purchases]]
    D -->|no| F{Saving to found?}
    F -->|yes| S
    F -->|no| L[Ranked leftover cities]
```

| Priority, in order | Purchase succeeds | Desired purchase fails or must wait |
| --- | --- | --- |
| 1. Enhance the religion | Continue | Stop |
| 2. Buy a desired faith Great Person within its wait threshold | Continue | Stop |
| 3. Convert domestic cities, including puppets | Continue | Stop |
| 4. Spread abroad, personality religion flavor at least 10 | Stop | Stop |
| 4. Spread abroad, other branch | Continue | Stop |

Priority 2 reserves faith only once the projected wait is below its religion-flavor threshold. A longer wait continues to later priorities. Failed desired purchases can reflect availability as well as insufficient faith.

A stop result skips religious defense and leftover spending for this turn. When all priority checks continue, `DoTurn` checks religious defense, then saving to found a religion, then city-ranked leftovers. The defense helper reports a purchase attempt, which also stops leftover spending.

### Leftover cities

Leftover spending skips cities in resistance or under siege. It ranks the others by faith output, halving puppet output and doubling holy-city output. Within each city, it considers faith-enabled buildings before generic units. The caller visits every ranked city, regardless of the previous city's return value.

### Legality

The generic unit branch requires positive player gold income and supply capacity. Every non-puppet city must share the purchase city's majority religion. It excludes missionaries and inquisitors, which use dedicated demand, as well as special units and units without a positive base faith cost.

| Legality layer | Gold | Faith |
| --- | --- | --- |
| City and placement | Valid city state, placement, and trainability are required. | The same evaluation applies, with the applicable faith-building exception for puppets. |
| Unlocks | Normal unit, resource, instance-limit, and required-building checks apply. | Religion, belief, policy, era, domain, and trait rules apply. Air units need their specific faith route; naval units need the applicable trait route. |
| Currency and cooldown | Treasury gold and local combat or civilian cooldowns apply. | Faith and global or local faith cooldowns apply, including local combat and civilian tracking. |

The generic faith unit path calls `ChooseHurry` in unit-only faith mode, but its purchase-mode sanity check uses the gold form of `IsCanPurchase`. This **gold legality check** can reject a faith-legal unit when the city cannot buy it with gold. Dedicated religious purchases use the faith gate directly.

With AI logging enabled, city hurry logs show `PRE` candidates after entry and duration adjustment and `POST` candidates after suitability. `HurryCityPriorities.csv` records the empire `BUY` list; Homeland, Tactical, and Religion logs record direct purchases. For a candidate that disappears after `POST`, inspect earlier spending, savings reservations, strategic resources, and placement.
