# Unit AI: Command Value and Priorities

The [command loop](overview.md) ranks fight offers by **priority**, a dimensionless score. Fight priority is **theater × stake**. Higher priority gets the next readiness check. The code calls this score an offer's **estimate** and stores a fight's priority in `fEstimate`. To audit a score, follow these stages:

| Stage | Meaning | Example: a full-health enemy worth 700 |
| --- | --- | --- |
| Raw value | Worth, prize and exposure use power × production cost as their underlying unit. | Prize is `700 × 0.6 = 420`. |
| Normalized quantity | Divide unit values by army scale `Z_U`; divide recovered ground by ground base `B`. | With `Z_U = 4000`, prize contributes `420 / 4000 = 0.105`. |
| Weighted term | Multiply each quantity by the player's preference weight. Add the terms to get **stake**. | At neutral preferences, the prize weight is 1. With no other terms, stake is 0.105. |
| Queue priority | Multiply stake by **theater** `θ`, which reflects the zone city's value. | In a cityless zone, `θ = 0.2`, so priority is `0.2 × 0.105 = 0.021`. |

A normalized prize of 0.105 means 10.5% of the army reference value. A final priority of 0.021 is a ranking score. Priorities and stakes have no overall cap of 1, and neither is a probability. Ground contributes a separately normalized measure of territorial control.

Every fight in the same zone shares its theater multiplier. City value enters that multiplier; the city-progress term instead uses a fixed allowance of typical unit worth. This lets the loop compare capturing a city, damaging a garrison, pursuing a unit and protecting our units on common scoring scales.

Reference scales and weights stay fixed for the turn. Each battlefield's theater multiplier and ground term `ΔG(t)` stay fixed from the moment it is built. Health, damage, garrisons, threats and open-offer priorities refresh after each command. The examples below use supplied inputs, not measured gameplay averages. HP means hit points.

## Shared values and scales

`CvTacticalOperationalValue.h` and `.cpp` define the values shared by loop priorities and the simulator's outcome grade (its assessment of the result). Pure functions calculate values from numbers; adapters read native units, cities and plots.

| Value | Rule |
| --- | --- |
| Base unit worth | Native unit-type power × production cost, with each input floored at 0. |
| `F` (unit worth) | Base worth × `1 + 0.1 × max(0, level − 1)`. Our units also receive the ready-upgrade premium below. Enemy prizes use base worth and level. |
| Living unit value | `F × (0.6 + 0.4 × health share)`, with health share clamped to 0 to 1. Full health gives `F`; half health gives `0.8F`; near death approaches `0.6F`. Death removes the unit and its retained value. |
| `E(u, d)` (value unit u loses to incoming damage d) | The unit's entire current value if the damage reaches its remaining health; otherwise `F` (unit worth) × `0.4 × d / maximum hit points`. Nonpositive incoming damage gives 0. |
| City value | `getEconomicValue` as seen by the acting player, or population when economic value is not positive. |
| Ready-upgrade premium | `0.5 × max(0, upgrade base worth − current base worth)` when `CanUpgradeRightNow(true)` passes: the unit is ready to upgrade and the upgrade's technology and project prerequisites are met. Gold, territory, embarkation and unit class limits are not checked. Add this to worth before applying the health share. |
| `Z_U` (army scale) | The greater of our living units' total current value and 3 times typical unit worth (the mean base worth of the reference types described below). The total includes all our units. |
| `Z_C` (city scale) | The greater of our cities' total value and 3 times their mean value. With no city of our own, use the mean city value of living, non-barbarian players at war with us for the floor. Only the theater multiplier uses it. |
| `C` (city allowance) | `city.units` × typical unit worth / `Z_U` (army scale): the size of a city fight in army currency. |
| `B` (ground normalization base) | One per living military unit of ours, plus the ground weights of all plots we own. |

**Reference types** are the military unit types used to calculate typical unit worth. For each unit class, our civilization's own type qualifies if it has combat strength, its prerequisite technology is known, its obsolete technology is unknown, and it has a production cost. City-state gifts and policy-unlocked types are excluded. Supply, gold, cities and resources do not affect the list, so the army-scale floor still applies at the supply limit.

`OurUnitWorth` reads our units' worth, `ReferenceUnitScales` calculates typical unit worth, and `BuildTurn` assembles the turn's normalization scales. The log message "Operational loop scales" reports army scale and typical unit worth. With no reference type, typical unit worth is 0; with no own or qualifying enemy city, typical city value is 0. A stake term divided by a nonpositive scale contributes 0.

**Separate upgrade and scale example.** This example has its own inputs. Use a level-3 unit with base worth 400, a ready upgrade to base worth 600, and half health:

| Value | Calculation | Result |
| --- | --- | --- |
| Worth with level premium | `400 × (1 + 0.1 × (3 − 1))` | 480 |
| Ready-upgrade premium | `0.5 × (600 − 400)` | 100 |
| Full-health worth | `480 + 100` | 580 |
| Current living value | `580 × (0.6 + 0.4 × 0.5)` | 464 |
| Army scale, if this is our only unit and typical worth is 250 | `max(464, 3 × 250)` | `Z_U = 750` |
| City scale for two cities worth 40 and 20 | `max(40 + 20, 3 × ((40 + 20) / 2))` | `Z_C = 90` |

## Running example inputs

Unless a section supplies its own inputs, the numerical examples use these settings. Ground and exposure are 0 unless listed. Calculations retain full precision until the displayed result.

| Input | Value |
| --- | --- |
| Army scale `Z_U` | 4000 |
| Typical unit worth | 400 |
| City allowance `C` | `3 × 400 / 4000 = 0.3` |
| Our cities | Values 40, 15 and 35: total 90, mean 30. |
| City scale `Z_C` | `max(90, 3 × 30) = 90` |
| Preference weights | All 1: neutral mapped flavors, default bases and slopes. |
| Maximum HP | Units 100; cities 250. |
| Expected city heal `H` | 20 HP. |

## Fight priority

A **term** is a normalized quantity multiplied by a preference weight. A **stake** is the sum of those terms. These are the inputs to the three fight formulas:

| Symbol | Stage | Meaning | Scale or range |
| --- | --- | --- | --- |
| `P`, `P_g` | Raw value | [Prize](#prize-and-exposure) of the target unit or current garrison. | Raw worth units; default `0.6F` to `F` for worth `F`. |
| `Z_U` | Reference scale | [Army scale](#shared-values-and-scales), fixed for the turn. | Raw worth units; at least 3 typical units' worth by default. |
| `ΔG(t)` | Normalized quantity | [Ground recovered](#ground-value) by removing target `t`, divided by `B`. | Dimensionless territorial benefit; no explicit cap at 1. |
| `E_t`, `E_c`, `E_def` | Raw value | [Exposure](#prize-and-exposure) attributed to the target unit, city plus garrison, or [our city's endangered recruits](#own-city-stake). | Raw worth units, nonnegative. Divide by `Z_U` before weighting. |
| `C` | Normalized quantity | [City allowance](#city-allowance-and-fall-share): `city.units × typical unit worth / Z_U`. | Dimensionless; 0 to 1 with default settings. The running example uses 0.3. |
| `f_att`, `f_def` | Share | Attack or defense [fall share](#city-allowance-and-fall-share). | 0 to 1; scales city progress or urgency. |
| `f_g` | Share | [Garrison damage share](#garrison-damage-share). | 0 to 1; scales garrison prize. |
| `w_A`, `w_G`, `w_R`, `w_O`, `w_C` | Weight | Attrition, hold-ground, risk, occupation and hold-city weights. | Default 1 at preference 50; 0.5 to 2 over preferences 0 to 100 with default bases and slopes. Risk runs in reverse. |
| `θ` | Multiplier | [Theater](#theater-multiplier): `floor.theater + zone city value / Z_C`. | Default minimum 0.2; no universal upper cap. |

| Fight      | Stake before theater                                        |
| ---------- | ----------------------------------------------------------- |
| Enemy unit | `w_A × P / Z_U + w_G × ΔG(t) + w_R × E_t / Z_U`             |
| Enemy city | `w_O × C × f_att + w_A × P_g / Z_U × f_g + w_R × E_c / Z_U` |
| Our city   | `w_C × C × f_def + w_R × E_def / Z_U`                       |

Multiply the chosen row by `θ` to get queue priority. A term divided by a nonpositive scale contributes 0. `ResolveOperationalWeights` supplies the same weights to every battlefield through the [flavor weight curve](reference.md#weights-file). For each weight, the [curve](reference.md#weights-file) is `base × 2^(slope × (flavor − 50) / 50)`, reversing the flavor offset to `50 − flavor` for risk. Search preferences are resolved separately for each engagement.

The enemy-city formula keeps city progress, garrison damage and exposure separate. Native combat splits hits between city and garrison. Healing reduces city progress; absorbed damage earns garrison prize. Capture earns the whole city term and kills the garrison. Threats to our units can sustain a fight even when neither damage term is positive.

## City allowance and fall share

The **city allowance** `C` sets the maximum unweighted city-progress term: `C = city.units × typical unit worth / Z_U`. The code stores it as `fCityUnit`. It defaults to 3 typical units' worth. For typical worth 400 and `Z_U = 4000`, `C = 3 × 400 / 4000 = 0.3`. The army-scale floor keeps `C ≤ 1` at default settings. City economic value enters theater separately.

The **fall share** scales that allowance from 0 to 1. Attack share measures useful progress after healing, with full credit for a possible capture. Defense share measures incoming damage relative to the city's remaining health. Neither share is a probability of capture.

| Input | Meaning | Unit or range |
| --- | --- | --- |
| `R` | City HP remaining, floored at 1. | HP, at least 1. |
| `D_c` | Local attackers' total simulated city damage, after garrison absorption. | HP, nonnegative. |
| `H` | Expected heal on the city's next turn. | HP, nonnegative. Used only for attack share. |
| Available capturer | A local attacker in the damage filter that passes `CanCapture`. | Yes or no; readiness and search still check whether the attack can run. |
| City danger | Native `GetPlotDanger` damage visible enemies can deal before our next turn. | HP, nonnegative. Used only for defense share. |

| Case | Fall share | Interpretation |
| --- | --- | --- |
| Attack: `D_c ≥ R` and an available capturer | `f_att = 1` | Capture is possible; healing no longer reduces the benefit. |
| Attack: all other cases | `f_att = max(0, min(D_c, R − 1) − H) / R` | Cap damage at leaving 1 HP, subtract healing, then divide by remaining HP. Damage at or below healing earns 0. |
| Defense | `f_def = min(1, city danger / R)` | 1 means danger reaches the city's remaining HP. |

The defense fall share subtracts no heal and asks for no capturer. Native danger is a worst case that does not separate capturing attackers, and the defender plans for that worst case.

**Local damage** is what the [damage filter](recruitment.md#battlefield-estimate) of the local set can deal to the city this turn. It comes from native quick attack simulations (`GetSimulatedDamageFromAttackOnCity`), following these rules:

- **Position.** Each unit attacks from its current plot, so the estimate assumes every counted unit reaches a firing position. Ranged units and aircraft count their ranged damage.
- **Order.** Units are simulated in ascending unit ID. Each simulation starts from the city and garrison damage accumulated by the earlier attackers, following `ComputeTotalExpectedDamage`.
- **Suicide test.** An attack is left out when it fails the test in `ComputeTotalExpectedDamage`: the attacker would take more damage than it deals to the city and garrison combined, with a looser limit for an attacker that stays above half health. The estimate and the [readiness check](execution.md#readiness-checks) then count the same attacks. A rejected attack leaves the simulated garrison untouched; native lets it still wound or kill the garrison.
- **Totals.** Sum the returned city damage into `D_c` and the separate `iGarrisonDamage` output into `D_g`. The helper has already deducted absorption from its returned city damage, so `D_c` enters the attack fall share directly.

Once a garrison is predicted to die, later hits use its replacement, if any, so it stops absorbing damage. A defender already predicted to die never returns as a replacement. `D_g` and the garrison prize refer to the garrison present at the start of the estimate; replacement defenders affect only the later city damage. Re-estimation after a real command reads the city's current garrison again.

The full attack fall share also requires a unit in the damage filter that passes `CanCapture`: a melee combat unit with moves and an attack left, and no capture prohibition. This uses the same distance approximation as local damage; search determines whether capture can actually be executed. Without such an attacker, useful city damage is capped at `R − 1`, because bombardment leaves the city at 1 HP and it can still heal.

**Expected heal** `H` is what the city would recover on its owner's next turn if our damage lands, following the heal in native `CvCity::doTurn`:

- 0 when the city is blockaded by both land and water.
- Otherwise the base city heal, plus its building defense bonus, plus its population under Vox Populi rules, plus the defense process bonus when the city runs one.
- The native tripling for an undisturbed city is left out, because a city we damaged this turn does not receive it.

Subtracting the heal makes the fall share the city-progress gate. Damage that cannot outpace the city's healing gives no city-progress term, but damaging its garrison can still make the fight worthwhile. A siege that can take the city this turn counts in full regardless of healing. The attack fall share also falls as our local units spend their attacks and rises as the city loses health, so city progress keeps its priority only while useful damage remains to deliver.

**Attack-share examples.** All rows use expected heal `H = 20` and city allowance `C = 0.3`, with neutral occupation weight. Damage is after garrison absorption.

| Remaining city HP `R` | Local damage `D_c` | Available capturer | `f_att` calculation | City-progress term `C × f_att` |
| --- | --- | --- | --- | --- |
| 250 | 50 | Either | `(50 − 20) / 250 = 0.12` | 0.036 |
| 125 | 50 | Either | `(50 − 20) / 125 = 0.24` | 0.072 |
| 40 | 50 | Yes | 1, capture possible | 0.300 |
| 40 | 50 | No | `(39 − 20) / 40 = 0.475` | 0.1425 |
| 10 | 15 | No | `max(0, 9 − 20) / 10 = 0` | 0 |
| 250 | 15 | Either | `max(0, 15 − 20) / 250 = 0` | 0 |

## Garrison damage share

With absorption enabled, a hit's damage after flat city damage reduction is split using maximum health: garrison damage is `hit damage × (2 × garrison maximum HP) / (city maximum HP + 2 × garrison maximum HP)`, with native integer rounding. The city takes the remainder. `GetSimulatedDamageFromAttackOnCity` supplies both parts and respects the absorption setting.

The garrison term is `w_A × P_g / Z_U × f_g`:

| Input | Meaning | Unit or range |
| --- | --- | --- |
| `P_g` | Current garrison's prize, using the [unit prize formula](#prize-and-exposure). | Raw worth units. |
| `G` | Current garrison's remaining health. | HP; no living garrison gives share 0. |
| `D_g` | Simulated damage absorbed by that garrison. | HP, nonnegative. Replacement defenders do not add to this total. |
| `f_g` | `min(1, D_g / G)` for a living garrison; 1 if the city can be captured. | 0 to 1. At 1 the term earns the full normalized garrison prize. |

City healing reduces only city progress. It does not reduce credit for damaging or killing the garrison.

**Absorption example.** A city with 250 maximum HP and a garrison with 100 maximum HP splits a 45-damage hit into `D_c = 25` city damage and `D_g = 20` garrison damage. At full city health with an expected heal of 20, `f_att = (25 − 20) / 250 = 0.02`. If the garrison has 15 HP left, `f_g = 1`: it dies and earns its full prize even while the city remains healthy. With an expected city heal of 25 and no capture, the city-progress term is 0 while the garrison term remains positive.

## Prize and exposure

**Prize** `P` is the raw value assigned to pursuing an enemy unit. It rises as the target loses health, encouraging the loop to finish damaged enemies:

`P = F × (p + (1 − p) × s)`

| Part | Meaning | Default or range |
| --- | --- | --- |
| `F` | Target's full-health worth: native unit-type power × production cost × level multiplier. Enemy worth includes no ready-upgrade premium. | Nonnegative, with no fixed upper bound. The example assumes 700; it is not a database value for all knights. |
| `p` | `floor.prize`, the minimum share of worth credited as prize. | Default 0.6. The ranges below assume that default. |
| `s` | Damage already taken / maximum HP, clamped to 0 to 1. | 0 at full health; 0.7 at 30/100 HP. |
| `p + (1 − p) × s` | Share of worth credited as prize. | 0.6 at full health, 0.8 at half health, approaching 1 near death. |
| `P` | Raw prize before normalization or preference weighting. | Formula bounds: `0.6F ≤ P ≤ F`. A living target with positive HP stays below `F`; a dead target's offers are dropped. |
| `w_A × P / Z_U` | Prize term added to stake. | With neutral weight and `F / Z_U = 0.1`, about 0.06 to 0.10. |

**Expected scale relative to our army.** Raw prize has no universal nominal range because power, cost and level vary. With positive typical unit worth, express our army scale as `n = Z_U / typical unit worth` and the target's worth as `k = F / typical unit worth`. Then `F / Z_U = k / n`, and the default prize term at neutral weight runs from `0.6 × k / n` at full health toward `k / n` near death.

| Army reference size `n` | Full-health prize term for a typical-worth target (`k = 1`) | Near-death limit |
| --- | --- | --- |
| 3 typical units, the default floor | 0.200 | 0.333333 |
| 10 typical units | 0.060 | 0.100 |
| 30 typical units | 0.020 | 0.033333 |

These are scale examples, not a measured distribution of gameplay scores. Stronger targets multiply the terms by `k`; preference weight and theater multiply them afterward. In the running example, `Z_U = 4000` and typical worth 400 mean `n = 10`. The illustrative knight worth 700 is `k = 1.75`, so its prize term runs from 0.105 toward 0.175.

**One target through all scoring stages.** Use `F = 700`, maximum HP 100, `Z_U = 4000`, `w_A = 1` and cityless theater `θ = 0.2`. Ground and exposure are 0.

| Target HP | Damage share `s` | Prize share | Raw prize `P` | Prize term `P / Z_U` | Priority `θ × P / Z_U` |
| --- | --- | --- | --- | --- | --- |
| 100 | 0 | 0.600 | 420 | 0.1050 | 0.02100 |
| 50 | 0.5 | 0.800 | 560 | 0.1400 | 0.02800 |
| 30 | 0.7 | 0.880 | 616 | 0.1540 | 0.03080 |
| 1 | 0.99 | 0.996 | 697.2 | 0.1743 | 0.03486 |

Our own units' [living value](#shared-values-and-scales) falls with damage: a unit worth 700 at 30/100 HP retains `700 × (0.6 + 0.4 × 0.3) = 504`. Prize and living value use opposite health trends. Their two 0.6 defaults are separate settings.

**Exposure** measures the value our units could lose to incoming danger. For one friendly unit, first compute its value at risk, then assign that value among the threats:

| Part | Meaning | Rule or range |
| --- | --- | --- |
| `F_u`, `M`, `R_u` | Our unit's worth, maximum HP and remaining HP. | Worth includes any ready-upgrade premium; `M` and `R_u` are HP. |
| `d` | Native total incoming danger to that unit. | Damage in HP. |
| `E(u, d)` | Value lost if that danger lands. | 0 for nonpositive damage; `F_u × 0.4 × d / M` if nonlethal; the whole current living value if `d ≥ R_u`. |
| `d_t` | Positive damage attributed to one enemy threat. | HP. Fog, terrain and improvements have no enemy entry. |
| `D` | Denominator used to allocate exposure. | `max(d, sum of positive attributed damage)`. |
| Threat's allocation | Exposure credited to this threat from this unit. | `E(u, d) × d_t / D`, between 0 and `E(u, d)`. |
| `E_t` or `E_c` | Allocations summed over our exposed units. | A city combines its bombardment and its garrison's allocations. Divide by `Z_U` and multiply by `w_R` for its stake term. |

For a single unit, an enemy's normalized exposure allocation cannot exceed `F_u / Z_U` at neutral weight. One threat can receive allocations from several units.

Lethal damage loses the retained 60% as well as the health-dependent value, so exposure jumps at the kill threshold. Extra damage beyond a kill earns no extra exposure. The allocation denominator preserves unattributed danger and prevents the threats from receiving more than the unit's value at risk.

`BuildThreats` scans our living, non-air combat units outside friendly cities and armies, including spent and processed units. `GetDangerByThreat` supplies the native total danger and attributed damage.

Positive threat entries identify these units as **endangered units** and exempt the attacker's fight from overlap retirement. Units that have already acted still count. Execution filters endangered recruits for availability.

**Exposure examples.** Each archer is worth 400 with 100 maximum HP. Use `Z_U = 4000` and neutral risk weight.

| Situation | Raw value exposed | Allocation and normalized exposure term |
| --- | --- | --- |
| Full-health archer faces 30 damage from a swordsman. | `400 × 0.4 × 30 / 100 = 48` | Swordsman receives 48; term `48 / 4000 = 0.012`. |
| Three such archers each face 30 damage from that swordsman. | `3 × 48 = 144` | Swordsman's term is `144 / 4000 = 0.036`. |
| Each of the three faces 25 damage from the swordsman and 5 from a scout. | Still 144 total. | Swordsman receives 120, term 0.030; scout receives 24, term 0.006. |
| One full-health archer faces 10 enemy damage plus 30 unattributed damage. | `400 × 0.4 × 40 / 100 = 64` | Enemy receives `64 × 10 / 40 = 16`, term 0.004. |
| An archer at 40 HP faces at least 40 damage from one enemy. | Its whole living value: `400 × (0.6 + 0.4 × 0.4) = 304`. | Enemy receives 304, term 0.076. |

**Combined prize and exposure.** A full-health knight worth 700 can kill our archer worth 400 at 40 HP and deal 30 damage to our full-health spearman worth 400. Nothing else threatens them. Use neutral weights and `Z_U = 4000`:

| Stake component               | Calculation                      | Term   |
| ----------------------------- | -------------------------------- | ------ |
| Knight's prize                | `700 × 0.6 / 4000`               | 0.105  |
| Archer's lethal exposure      | `400 × (0.6 + 0.4 × 0.4) / 4000` | 0.076  |
| Spearman's nonlethal exposure | `400 × 0.4 × 30 / 100 / 4000`    | 0.012  |
| Total stake                   | `0.105 + 0.076 + 0.012`          | 0.193  |
| Cityless priority             | `0.2 × 0.193`                    | 0.0386 |

The search can attack the knight, retreat the archer or hold the spearman according to its own scoring.

## Ground value

`GroundWeight` measures a plot's value for occupation and blockade. It starts at 1 and adds these contributions:

| Contribution | Weight |
| --- | --- |
| Plot defense | Defense divided by 100. City plots have defense 100; other plots use terrain and feature defense plus the nonnegative defense of an unpillaged improvement. |
| Revealed strategic or luxury resource | +1 |
| Ocean | −0.25 |
| Coast or lake | −0.2 |
| Improvement on a workable plot | +0.1, or +0.25 for a great person improvement, even when pillaged |
| Revealed bonus resource on a workable plot | +0.15 |

A **workable plot** is a city plot or a plot within its effective owning city's work range. `GroundWeight` applies no overall minimum; the terrain and feature defense contribution can be negative.

At default settings, `B` grows by 1 per military unit and by each owned plot's weight, about 1 for ordinary land. Recovering one such plot contributes roughly `1 / B`; ending its blockade contributes roughly `0.5 / B`, before preference weighting.

`GroundStake` sets the maximum contribution of each plot to the ground score. It uses the full weight for our plots and hostile cities; half the weight above 1, floored at 0, for other hostile land; and 0 for everything else. Plain hostile land and hostile water therefore have no stake. `AddGroundPlot` applies that stake to occupation and blockade:

| Plot | Ground score |
| --- | --- |
| Our plot or city occupied by a hostile holder | Its stake is lost. |
| Our plot blockaded by a hostile neighbor, with no friendly or neutral holder on the plot | Half its stake is lost. |
| Hostile land or city held by our side | Credit its stake. |
| Hostile land blockaded by our side, with no hostile or neutral holder on it | Credit half its stake. |

A city occupies its own plot, so a hostile city earns credit only after our side takes it. `GroundAround` reads live owners, so it never sees that case; the simulator's grade freezes owners when watching starts and credits a captured city its full weight.

`GroundSide` treats teammates, master/vassal teams and their allied minors as our side, with hostility taking precedence. `PlotPresence` counts cities and living military holders. Aircraft and embarked units supply no presence. A military unit blockades from a neighboring plot only on the same landmass, in its native domain and outside a city. Cities and garrisons supply no blockade.

`TargetGround` computes `ΔG(t) = (ground score with target − ground score without target) / B`:

| Part | Meaning | Scale |
| --- | --- | --- |
| Ground score | `GroundAround`: lost weight minus credited weight over owned plots at the target and its same-landmass neighbors. | Raw plot-weight units. |
| Difference | How much removing this target reduces loss or increases credit. All other units remain present. | Raw plot-weight units; can be 0 when another hostile unit maintains occupation or blockade. |
| `B` | Our living military-unit count plus the ground weights of all our owned plots, at default settings. | Positive normalization base; a nonpositive base gives ground term 0. |
| `ΔG(t)` | Local recovery divided by the turn's ground base. | Dimensionless; no explicit cap at 1. A recovery of 4 against `B = 400` contributes 0.01 before weighting. |

**Ground example.** A full-health enemy spearman worth 400 occupies our iron mine on a workable hill. It alone also blockades three empty plots of ours, two open and one hill. Use neutral weights, `B = 400` and `Z_U = 4000`.

| Step | Calculation | Result |
| --- | --- | --- |
| Recover the mine | Base 1 + hill defense 0.25 + iron 1 + improvement 0.1 | 2.35 |
| End the three blockades | `0.5 × (1 + 1 + 1.25)` | 1.625 |
| Normalize total recovery | `(2.35 + 1.625) / 400` | `ΔG(t) = 0.0099375` |
| Add prize | `400 × 0.6 / 4000 + 0.0099375` | Stake 0.0699375 |

An equal spearman on plain hostile land with no other ground effect has only its 0.060 prize term.

## Theater multiplier

Theater scales the whole stake: `θ = floor.theater + zone city value / Z_C`.

| Part | Meaning | Default or range |
| --- | --- | --- |
| `floor.theater` | Priority multiplier retained even without a city. | 0.2. |
| Zone city value | Economic value of the zone's city as seen by us, falling back to population. Enemy fights can be in our city's zone or an enemy city's zone. | Nonnegative raw city-value units. An own-city battlefield uses its own city. |
| `Z_C` | [City scale](#shared-values-and-scales), fixed for the turn. | Same units as city value. If nonpositive, the city contribution is 0. |
| `θ` | Floor plus the city's normalized value; no city gives just the floor. | Default minimum 0.2, with no universal upper cap. A city worth one third of `Z_C` gives about 0.533333. |

An original own city cannot exceed our total city value at turn build, so its initial theater is at most 1.2 with default settings. Enemy cities and newly captured cities can exceed that bound because `Z_C` stays fixed. Operation-target and focus-area bonuses add no priority factor.

## Own-city stake

An own-city fight weighs how close the city is to falling and what our nearby units stand to lose. The [defense fall share](#city-allowance-and-fall-share) covers the city; defensive exposure covers nearby units at risk.

The defensive exposure term `E_def` sums [value at risk](#prize-and-exposure) over the city's [endangered recruits](recruitment.md#city-defense-recruits), each once. A garrison whose city can fall counts at its whole living value. Recruitment also records [local and enemy strength](recruitment.md#strength-tallies) for Reinforce; those tallies look up to two turns ahead, while the defense fall share uses damage before our next turn.

**Own-city example.** Our capital is worth 40, with `Z_C = 90`, so theater is `0.2 + 40 / 90 ≈ 0.644444`. Use `C = 0.3`, neutral weights and no exposed recruits.

| City HP remaining | Native danger | Defense fall share `f_def` | City term `C × f_def` | Priority `θ × stake` |
| --- | --- | --- | --- | --- |
| 200 | 0 | 0 | 0 | 0, inactive |
| 200 | 80 | `80 / 200 = 0.4` | 0.12 | 0.077333 |
| 200 | 200 or more | 1 | 0.30 | 0.193333 |

Endangered recruits add their normalized exposure to stake, even when city danger is 0.

## Worked priorities

| Zone city         | City value | Theater                    |
| ----------------- | ---------- | -------------------------- |
| Our capital       | 40         | `0.2 + 40 / 90 ≈ 0.644444` |
| Our town          | 15         | `0.2 + 15 / 90 ≈ 0.366667` |
| Enemy border city | 20         | `0.2 + 20 / 90 ≈ 0.422222` |
| Large enemy city  | 45         | `0.2 + 45 / 90 = 0.7`      |
| No city           | None       | 0.2                        |

| Offer | Stake calculation | Theater `θ` | Priority `θ × stake` |
| --- | --- | --- | --- |
| Border city worth 20 at 5 HP, no garrison, at least 5 local damage and an available capturer | `0.3 × 1 = 0.300` | 0.422222 | 0.126667 |
| Large city worth 45 at full health, no garrison, 50 local damage | `0.3 × (50 − 20) / 250 = 0.036` | 0.7 | 0.025200 |
| Full-health spearman worth 400 in our capital's zone | `400 × 0.6 / 4000 = 0.060` | 0.644444 | 0.038667 |
| Knight worth 700 at 30 HP in a cityless zone | `616 / 4000 = 0.154` | 0.2 | 0.030800 |
| Full-health swordsman worth 600, threatening the three archers in a cityless zone | `600 × 0.6 / 4000 + 144 / 4000 = 0.126` | 0.2 | 0.025200 |

The same spearman at half health has stake 0.080 and priority 0.051556 at the capital. The large city at half health with the same 50 local damage has stake `0.3 × 30 / 125 = 0.072` and priority 0.0504. Now give that half-health city a garrison at full health with 100 HP, worth 400, and suppose the simulations give 50 city damage after absorption and 40 garrison damage. The garrison share is 0.4, adding `0.060 × 0.4 = 0.024` to stake, or 0.0168 to priority, for a combined priority of `0.0504 + 0.0168 = 0.0672`. Exposure adds a further term when the city or garrison threatens our units.

Raising mapped ATTRITION (preference for damaging enemy forces) to 80 gives weight `2^0.6 ≈ 1.515717`. The capital spearman at full health rises to priority 0.058608; the swordsman rises to 0.034483 because only its prize term uses attrition. Raising OCCUPATION (preference for capturing cities) to 70 instead gives weight `2^0.4 ≈ 1.319508` and border-city priority 0.167138.

**City or units first.** In the large city's zone, a swordsman at full health, worth 600, has priority `0.7 × 0.09 = 0.063`. The ungarrisoned city at full health with 50 local damage has priority 0.0252, so the swordsman fight runs first. With 150 local damage the city's stake is `0.3 × 130 / 250 = 0.156` and its priority 0.1092, so the siege runs first and its search can still attack either target. With 20 local damage or less this ungarrisoned city has no city-progress term and its fight stays inactive unless it threatens our units. Changing only `Z_U` leaves this ordering unchanged: city allowance, unit prize and exposure all scale by `1 / Z_U`. Ground uses its separate base `B`.
