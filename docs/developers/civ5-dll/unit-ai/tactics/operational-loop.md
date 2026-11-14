# Unit AI: Operational Loop

The **operational loop** coordinates combat and reinforcement across the map during a player's turn. It replaces the zone-by-zone combat pass of [military tactics](overview.md): estimate the available actions, check the highest-priority action, execute it, then update priorities from the resulting board. This developer guide describes the DLL (dynamic-link library) implementation. The `VOX_TACTICAL_OPERATIONAL_LOOP` mod option enables it for non-barbarian players and is off by default.

The loop organizes work around **battlefields** (enemy units, enemy cities and our own cities). Each battlefield has two **offers** (proposed actions with a priority and queue state): a fight and **Reinforce** (bringing distant units toward the center). A fight attacks an enemy or defends one of our cities. Both offer types compete in one queue, so the higher-priority action gets access to shared units first.

A ready offer must pass a **readiness check** (whether suitable units or city fire are available) before it executes as a **command** (one action in the turn's sequence). A fight can end after city fire or run an **engagement** (a tactical search and its execution, including retries). Reinforcement commands march the selected units toward the battlefield. Each offer executes at most once per turn, even when search finds no action.

The components fit together in this order:

| Component | Responsibility |
| --- | --- |
| [Turn integration](#turn-integration) | Run the loop between the native high-priority and deferred passes. |
| [Command loop](#command-loop) | Select offers, check readiness and update the queue after execution. |
| [Battlefields](#battlefields) | Identify the centers of combat and defense for this turn. |
| [Fight scoring](#value-and-stakes) | Rank fights by the assets at stake and the value of the surrounding zone. |
| [Reinforce](#reinforce) | Select distant units and rank the benefit of bringing them in. |
| [Readiness](#readiness-checks) and [execution](#execution) | Confirm that an offer can run, then recruit units and perform its actions. |
| [Overlap](#overlapping-offers) and [wake rules](#wake-rule) | Retire covered offers and retry waiting fights after useful board changes. |

[Records](#records), [settings](#settings) and the [source map](#code) provide implementation reference after the component descriptions. In this guide, “our” means the acting player, and “native” means the existing Vox Populi behavior.

## Turn integration

The loop's copy of `ProcessDominanceZones` keeps the surrounding native passes in order:

1. Global high priority: healing, operation armies and garrisons.
2. Emergency purchases in every zone.
3. The [command loop](#command-loop), through `RunCommandLoop`, for fights and Reinforce.
4. Deferred garrison holds, global middle and low priority passes, then the review of unassigned units.

Battlefield reinforcement replaces the regular zone reinforcement pass. The loop also omits zone posture routines and zone target extraction. Global passes still handle camps, civilians, improvements and other target types. Units left unprocessed can pass to Homeland AI (the system for remaining unit tasks) as usual. Barbarians keep native scheduling.

## Command loop

`RunCommandLoop` owns the turn's action queue. It builds the initial estimates, executes one ready offer at a time, and uses each command's result to update the remaining work:

1. **Build.** Resolve settings, mapped flavors (player preferences converted to the loop's military scales), weights (relative importance of benefits) and reference scales (normalization values). Build battlefields and threat maps (damage attributed to enemy units and cities).
2. **Estimate.** Score both offers at every battlefield in one [battlefield estimate](#battlefield-estimate). Positive estimates become ready; nonpositive estimates become inactive. Invalid targets drop both offers.
3. **Select.** Choose the highest ready estimate. Ties favor own-city fights, enemy-city fights, enemy-unit fights, then reinforcement offers. Further ties favor the lower plot index, then build order. End if no offer is ready, or record a stop if the command cap has been reached.
4. **Check.** Check only the selected offer. A failed fight check adds one failure and makes the fight waiting, or skipped at the failure limit. A failed reinforcement check makes the offer inactive or returns it to the queue at a reduced estimate. After a failed check, resume selection. A pass executes one command at its current estimate.
5. **Record and retire.** Mark the offer executed even if it ended before search or found no action. Rebuild threats and retire overlapping offers using the [overlap rules](#overlapping-offers).
6. **Refresh.** Compare the board before and after the command. Add a battlefield for each newly captured city. Re-estimate open offers, apply the [wake rule](#wake-rule) to waiting fights, then resume selection.

The command cap defaults to 64 executed commands. Failed readiness checks consume no command slots, and search retries belong to the same command. Every open offer is re-estimated after every command, including distant offers. These estimates issue no recruitment or readiness checks. An executed fight still refreshes its stake (the combined benefits of fighting there) for use by its reinforcement offer.

The loop separates facts fixed for the turn from values refreshed after commands:

| Fixed for the turn | Refreshed after each command |
| --- | --- |
| Weights (benefit priorities), reference scales (normalization values) and each battlefield's theater multiplier (zone asset value) and ground term (benefit of removing the target) | Threat maps (damage attributed to enemies), fight stakes (combined benefits), open-offer priorities and reinforcement selections |
| Original enemy battlefields and their zone and near-city flags | Surviving unit targets' plots and newly captured own-city battlefields |
| Readiness failure limit | Reinforcement check flags are cleared so reach can be checked again |

### Offer states

A fight offer uses these states:

| State | Enters when | Leaves when |
| --- | --- | --- |
| Ready | An opening or later estimate is positive, with any waiting requirement satisfied | It reaches the top and is checked. |
| Inactive | Its estimate is nonpositive | A later estimate is positive. |
| Waiting | A readiness check fails below the failure limit | A helpful command change wakes it and its new estimate is positive, or re-estimation drops its target. |
| Skipped | It reaches `readiness.maxFailures` failures, default 3 | The turn ends. |
| Retired | An executed unit fight covers it under the overlap rule | The turn ends. |
| Executed | It runs as a command | The turn ends. |
| Dropped | Re-estimation finds the target unit gone, or its city lost by its recorded owner or no longer ours | The turn ends. |

A Reinforce offer uses these states:

| State | Enters when | Leaves when |
| --- | --- | --- |
| Ready | An opening, later or reduced check estimate is positive | It reaches the top and is checked, then executes or turns inactive. |
| Inactive | Its estimate is nonpositive, or its check leaves no selected unit or reduces the estimate to 0 | A later estimate is positive. |
| Retired | An executed Reinforce that moved a unit counted this battlefield's target in its enemy strength | The turn ends. |
| Executed | It runs as a command | The turn ends. |
| Dropped | Re-estimation finds the target unit gone, or its city lost by its recorded owner or no longer ours | The turn ends. |

A waiting fight keeps its refreshed estimate and cumulative failure count. Waking it preserves the count and applies no priority discount. Readiness determines whether the fight can execute; the current estimate determines its priority. A reinforcement offer never waits or counts failures, so it is never skipped. When `EstimateFight` finds a target gone, both open offers at that battlefield drop together.

## Battlefields

`FindTacticalTargets` scores the native targets and merges the naval list. When the option is enabled, it copies that list into `m_OperationalTargets` (the turn's target snapshot) immediately before `SortTargetListAndDropUselessTargets` suppresses nearby enemy-unit targets. Native consumers continue to use the filtered list. `CleanUp` clears the snapshot.

`BuildBattlefields` reads the snapshot after the high-priority pass and emergency purchases. Each surviving hostile combat unit or enemy city supplies one battlefield. Unit targets use the plot's best defender, following native selection. Duplicate owner/unit IDs and duplicate city plots are removed. A city captured earlier in the turn gets no enemy battlefield. `GroundSide` determines hostility, including barbarians and players at war with us.

`AddOwnCityBattlefield` adds one battlefield per city of ours, including safe cities whose offers start inactive. It uses the city plot's land zone. If that zone is unknown, it uses the city's water zone, identified by the negative city ID. Zone data is read without refreshing because the zone map cannot be rebuilt mid-turn.

Fight and reinforcement offers keep separate states. Executing either offer refreshes the other's estimate along with the rest of the queue.

The battlefield stores its build-order ID, center type, target owner and unit or city ID, plot index and zone ID. It also fixes these facts for the turn:

| Fact | Rule |
| --- | --- |
| `θ` (theater multiplier) | `floor.theater` (minimum theater multiplier) plus city value divided by `Z_C` (city scale). Enemy fights use their target zone's city, which can be ours or an enemy's; a zone without a city gets the floor alone. An own-city fight uses its own city. |
| `ΔG(t)` (normalized ground recovered by removing target unit t) | Local ground score with the target present minus the score with it removed, divided by `B` (ground normalization base). |
| Near our city | Native `GetCityDistanceInPlots` is below 4 at build time. For major civilizations this means within 3 plots of our nearest city. Minors use half the plot distance to their capital, rounded down, so their exemption reaches 7 plots. |

The turn's enemy battlefields stay fixed. A newly revealed enemy can enter danger calculations, city strength and search geometry immediately; it receives an independent battlefield in the next turn's snapshot. Re-estimation follows a surviving target unit's current plot, while its original zone, theater, ground term and near-city flag stay fixed. A dead unit or a city lost by its recorded owner drops both open offers of that battlefield.

A city we capture during the turn becomes an own-city battlefield when the command that took it ends. It uses the city's current value and zone; the turn's weights, scales and other battlefields stay as they were. The captured city's enemy-city offer drops under the rule above.

## Value and stakes

Fight priority is **theater × stake**. The two factors answer separate questions:

| Factor | Question | Measured in |
| --- | --- | --- |
| **Theater multiplier** | How much does this place matter? | The value of the zone's city. A zone is centered on a city, so city value enters priority here and nowhere else. |
| **Stake** | What can this turn change at this center? | Shares of our army's value, for every kind of fight. |

Every fight in a zone shares one theater multiplier, so the stake alone decides whether the zone's city or the units around it go first. Unit fights combine the target's prize, recoverable ground and exposure (the value our units could lose to that target). The city-progress term is sized by the **city unit** (a fixed number of typical units) and scaled by the **fall share** (the part of the city's remaining health that this turn's damage can remove). It grows as capture becomes possible. Garrison damage and exposure contribute separately, so a city far from falling can still offer a valuable fight.

`BuildTurn` resolves the player's weights (relative importance of each benefit) and reference scales (normalization values) once per turn. After each command, `EstimateBattlefield` refreshes both offers of every battlefield from current health, garrisons, city danger, local units and threat shares.

Unit examples assume a maximum of 100 HP (hit points) unless specified.

### Battlefield estimate

`EstimateBattlefield` scores a battlefield's fight and its Reinforce in one pass, so both offers read the same units, health and damage:

1. **Scan.** Gather the battlefield's local set once.
2. **Fight.** `EstimateFight` computes the stake and the fight priority. At an enemy city it simulates the local attackers; at our city it reads native danger.
3. **Reinforce.** `EstimateReinforce` selects from the units beyond the local set and scores what they add to the numbers from step 2.

Step 2 still runs after the fight has executed, because an open Reinforce needs its baseline. Step 3 is skipped when the Reinforce offer is executed or retired, and it skips the roster when a [reinforcement gate](#reinforce-priority) closes the offer.

The **local set** holds our units that can take part at the center this turn. It uses plain plot distance and needs no pathfinding:

- Combat units in the battlefield's **domains**, within their **strike reach**: base moves, at least 1, plus range for a ranged unit.
- Aircraft whose range reaches the center from their base.

The domains follow the center. A city takes land units, and sea units too when it is coastal. A unit target takes the domain of its plot, so a land unit beside a water target stays out of the local set and a ship stays out of an inland one. Reinforce candidates use the same domains.

Two filters read the local set:

| Filter | Keeps | Feeds |
| --- | --- | --- |
| **Strength filter** | Land and sea units, including spent units and army members. Aircraft are left out. | `L` (local friendly strength) in the [own-city](#own-city-stake) and [Reinforce](#strength-tallies) tallies. |
| **Damage filter** | Units on the tactical roster that can still attack, including aircraft, and that pass the recruitment filters of `FindUnitsWithinStrikingDistance` needing no pathfinding: usable by the tactical AI now, not covering a civilian and not a fighter kept for interception. At a city, `CanStrikeCity` also drops units barred from capturing and ranged units whose expected damage misses native's minimum. Readiness can therefore recruit every unit the estimate counts. | [Local damage](#city-unit-and-fall-share) at an enemy city, and its local capturer test. |

A unit in those domains beyond its strike reach is a Reinforce candidate, so every unit counts as local or incoming and never as both. [City defense](#city-defense) recruits its defenders by the same strike reach, so a unit near our city always has one of the two offers open to it.

**Strike reach example.** An archer with 2 moves and range 2 stands 4 plots from an enemy city. It is local, and its shot counts toward local damage. A swordsman with 2 moves stands 3 plots away. It is incoming, and only Reinforce can count it. The same archer 4 plots from our own city is a defender in that city's fight; at 5 plots it is a Reinforce candidate.

### Fight priority

A stake is a sum of **terms**. Each term is a **quantity** already expressed as a share of our army's value, multiplied by a **weight** that reflects the player's preferences. `ResolveOperationalWeights` applies the [flavor weight curve](#weights-file) to the player's mapped flavors once per turn, and every battlefield gets those same weights. A weight is 1 at neutral preference, so a term then equals its quantity. Search flavors are resolved separately over each engagement's geometry.

| Quantity | Meaning | Weight |
| --- | --- | --- |
| Prize / `Z_U` | The value of pursuing an enemy unit, described under [prize](#prize-and-exposure), divided by `Z_U` (army scale). A city's garrison uses the same rule. | `w_A` (attrition) |
| `ΔG(t)` | Normalized [ground](#ground-value) recovered by removing target unit t. | `w_G` (hold ground) |
| `E / Z_U` | [Exposure](#prize-and-exposure): the value our units could lose to this target, divided by the army scale. `E_t` belongs to a unit target, `E_c` to a city and its garrison, and `E_def` to the [defenders of our city](#own-city-stake). | `w_R` (risk) |
| `C` | The [city unit](#city-unit-and-fall-share): the fixed size of a city fight, worth 3 typical units by default. | `w_O` (occupation) at an enemy city, `w_C` (hold city) at ours |
| `f_att`, `f_def` | The [fall share](#city-unit-and-fall-share): how close the city is to falling this turn, from 0 to 1. It scales the city terms and carries no weight of its own. | None |
| `f_g` | The [garrison damage share](#garrison-damage-share): the fraction of the current garrison's remaining health that local attacks can remove, or 1 when the city can be captured. | None |

| Fight | Stake before theater |
| --- | --- |
| Enemy unit | `w_A × prize / Z_U + w_G × ΔG(t) + w_R × E_t / Z_U` |
| Enemy city | `w_O × C × f_att + w_A × garrison prize / Z_U × f_g + w_R × E_c / Z_U` |
| Our city | `w_C × C × f_def + w_R × E_def / Z_U` |

An enemy-city fight has three separate terms: city progress, garrison damage and exposure. Native combat splits each hit between the city and its garrison. The city term uses the damage left after absorption and expected healing; the garrison term uses the absorbed damage. Capturing the city also kills its garrison. Exposure keeps its own term, so threats to our units can sustain a fight even when neither damage term is positive.

### City unit and fall share

The **city unit** `C` gives every city fight one size in army currency: `city.units` (default 3) × typical unit worth / `Z_U` (army scale). With typical unit worth at 10% of the army, `C` is 0.3. The city's own value stays in the theater multiplier.

The **fall share** measures how close a city is to falling this turn, as a share of its remaining hit points from 0 to 1. Remaining hit points count as at least 1. Both sides read native estimates that need no pathfinding, so `EstimateFight` can refresh them after every command.

| Fall share | Rule |
| --- | --- |
| `f_att` (attack fall share) | With `D_c` (local city damage after garrison absorption), `H` (the city's expected heal) and `R` (remaining city hit points): 1 when `D_c ≥ R` and an available local attacker can capture; otherwise `max(0, min(D_c, R − 1) − H) / R`. |
| `f_def` (defense fall share) | Native danger at our city (`GetPlotDanger` for the city), the damage visible enemies can deal to it before our next turn, divided by remaining hit points and capped at 1. |

The defense fall share subtracts no heal and asks for no capturer. Native danger is a worst case that does not separate capturing attackers, and the defender plans for that worst case.

**Local damage** is what the [damage filter](#battlefield-estimate) of the local set can deal to the city this turn. It comes from native quick attack simulations (`GetSimulatedDamageFromAttackOnCity`), following these rules:

- **Position.** Each unit attacks from its current plot, so the estimate assumes every counted unit reaches a firing position. Ranged units and aircraft count their ranged damage.
- **Order.** Units are simulated in ascending unit ID. Each simulation starts from the city and garrison damage accumulated by the earlier attackers, following `ComputeTotalExpectedDamage`.
- **Suicide test.** An attack is left out when it fails the test in `ComputeTotalExpectedDamage`: the attacker would take more damage than it deals to the city and garrison combined, with a looser limit for an attacker that stays above half health. The estimate and the [readiness check](#readiness-checks) then count the same attacks. A rejected attack leaves the simulated garrison untouched; native lets it still wound or kill the garrison.
- **Totals.** Sum the returned city damage into `D_c` and the separate `iGarrisonDamage` output into `D_g`. The helper has already deducted absorption from its returned city damage, so `D_c` enters the attack fall share directly.

Once a garrison is predicted to die, later hits use its replacement, if any, so it stops absorbing damage. A defender already predicted to die never returns as a replacement. `D_g` and the garrison prize refer to the garrison present at the start of the estimate; replacement defenders affect only the later city damage. Re-estimation after a real command reads the city's current garrison again.

The full attack fall share also requires a unit in the damage filter that passes `CanCapture`: a melee combat unit with moves and an attack left, and no capture prohibition. This uses the same distance approximation as local damage; search determines whether capture can actually be executed. Without such an attacker, useful city damage is capped at `R − 1`, because bombardment leaves the city at 1 HP and it can still heal.

**Expected heal** `H` is what the city would recover on its owner's next turn if our damage lands, following the heal in native `CvCity::doTurn`:

- 0 when the city is blockaded by both land and water.
- Otherwise the base city heal, plus its building defense bonus, plus its population under Vox Populi rules, plus the defense process bonus when the city runs one.
- The native tripling for an undisturbed city is left out, because a city we damaged this turn does not receive it.

Subtracting the heal makes the fall share the city-progress gate. Damage that cannot outpace the city's healing gives no city-progress term, but damaging its garrison can still make the fight worthwhile. A siege that can take the city this turn counts in full regardless of healing. The attack fall share also falls as our local units spend their attacks and rises as the city loses health, so city progress keeps its priority only while useful damage remains to deliver.

**Fall share example.** An enemy city has 250 maximum HP (hit points) and an expected heal of 20. At full health with 50 local damage, `f_att` is `30 / 250 = 0.12`. At 125 HP with the same units it is 0.24. At 40 HP it is 1 with an available local capturer, or `(39 − 20) / 40 = 0.475` without one. At 10 HP with 15 ranged damage and no capturer, it is 0 because healing exceeds the 9 HP that bombardment can remove. With 15 local damage it is also 0 at any health above 15.

### Garrison damage share

With absorption enabled, a hit's damage after flat city damage reduction is split using maximum health: garrison damage is `hit damage × (2 × garrison maximum HP) / (city maximum HP + 2 × garrison maximum HP)`, with native integer rounding. The city takes the remainder. `GetSimulatedDamageFromAttackOnCity` supplies both parts and respects the absorption setting.

For the current garrison with remaining health `G`, use `f_g = min(1, D_g / G)`. Use 0 when there is no living garrison, and 1 when a living garrison is present and `f_att` is 1 because an available local capturer can take the city. City healing applies only to the city-progress term; the garrison term uses expected absorbed damage and the current unit prize.

**Absorption example.** A city with 250 maximum HP and a garrison with 100 maximum HP splits a 45-damage hit into `D_c = 25` city damage and `D_g = 20` garrison damage. At full city health with an expected heal of 20, `f_att = (25 − 20) / 250 = 0.02`. If the garrison has 15 HP left, `f_g = 1`: it dies and earns its full prize even while the city remains healthy. With an expected city heal of 25 and no capture, the city-progress term is 0 while the garrison term remains positive.

### Prize and exposure

**Prize** estimates the value of pursuing an enemy unit. With `F` (unit worth), `floor.prize` (minimum prize share, default 0.6) and `s` (damage divided by maximum hit points, clamped to 0 to 1), it is `F × (floor.prize + (1 − floor.prize) × s)`. A knight worth 700 has prize 420 at full health and `700 × (0.6 + 0.4 × 0.7) = 616` at 30 of 100 HP (hit points). Damage raises the priority of pursuing the target, while our own units' living value falls with damage.

**Exposure share** assigns each threat part of the value our units stand to lose. `BuildThreats` reads every living, non-air combat unit of ours outside friendly cities and operation armies, including units that have spent their moves or were processed. `GetDangerByThreat` returns the native danger total and the damage attributed to each enemy unit or city. Fog, terrain and improvement damage stay in total danger without being assigned to an enemy.

For each exposed unit, a threat receives `E(u, danger)` (the value unit u would lose to total incoming danger) × threat damage / whole danger. The denominator is the greater of native total danger and the sum of positive attributed damage. This preserves the share of unattributed damage and prevents over-allocation. A city's `E_c` (exposure attributed to the city and its garrison) combines bombardment and garrison shares.

Positive threat entries identify **endangered units** (our units outside friendly cities and operation armies with damage attributed to an enemy threat) and exempt the attacker's fight from overlap retirement. Units that have already acted still count. Execution filters endangered recruits for availability.

**Exposure examples.** An archer at full health, worth 400, facing 30 damage exposes `400 × 0.4 × 30 / 100 = 48`. Three such archers expose 144. If a swordsman deals all of it, its exposure term at `Z_U` (army scale) = 4000 is 0.036. If a swordsman deals 25 damage to each and a scout 5, their terms are 0.030 and 0.006. If one archer instead faces 10 enemy damage and 30 from fog and terrain, its exposure is 64 and that enemy receives `64 × 10 / 40 = 16`, one quarter of the exposure. Attributed shares sum to total exposure when all damage is attributed.

**Endangered-unit example.** A knight at full health, worth 700, can kill our archer worth 400 at 40 HP (hit points) and deal 30 damage to our spearman worth 400 at full health. Nothing else threatens them. With neutral weights and `Z_U` (army scale) = 4000, the knight's prize term is 0.105, the archer's exposure term is `400 × (0.6 + 0.4 × 0.4) / 4000 = 0.076`, and the spearman's is 0.012. The stake is 0.193, giving priority 0.0386 in a cityless zone. Search can attack the knight, retreat the archer or hold the spearman according to its own scoring.

### Own-city stake

An own-city fight weighs how close the city is to falling and what our nearby units stand to lose. The [defense fall share](#city-unit-and-fall-share) covers the city; this section covers defensive exposure and the strength tallies that `EstimateFight` records for the city's [Reinforce](#reinforce) offer. Reinforce looks further ahead than the fight: its tallies count enemies up to two turns away, while the fall share counts only damage that can land before our next turn.

Strengths use native combat strength, scaled by 100, which already includes the damage modifier. Each strength is then multiplied by the unit's or city's remaining health share.

| Quantity | Rule |
| --- | --- |
| Unit strength | `UnitStrength`: native maximum attack strength, or ranged strength for a ranged unit, both from the quick estimate without adjacency. |
| Enemy strength against our city | `UnitStrengthAgainstCity`: the enemy's quick attack or ranged strength against the city plot, keeping city and terrain modifiers. |
| City strength | `CityStrength`: the city's strength value, which counts its garrison. |
| `L` (local friendly strength) | `LocalCityStrength`: the city's strength plus the [strength filter](#battlefield-estimate) of the local set, which counts spent units and army members and leaves aircraft out. |
| `T` (enemy strength against the city) | `EnemyCityStrength`: the union of the city's approach list (nearby hostiles assigned to this city) and visible units that native danger identifies as able to attack the city plot next turn. Each counts once, including ranged and siege units. |
| `E_def` (defensive exposure) | Sum `E(u, danger)` (the value unit u would lose to native danger at its plot) over endangered recruits, each once. A garrison whose city can fall faces damage beyond its remaining health, so it counts at its whole current value. |

`BuildThreats` rebuilds **approach lists** (hostile units assigned to the city they are approaching) after every command. Each visible hostile land or sea combat unit is assigned to our nearest city by path steps, using `GetClosestCityByPathLength`. It qualifies when the path is at most twice its base moves plus its range, or plus 1 for melee. Hidden units, such as undetected submarines, are excluded.

The native city-path cache routes around impassable plots and may embark, but ignores movement costs and intervening units. It can therefore exclude a knight 2 plots away behind mountains while including a spearman whose actual journey takes longer. Only major civilizations have this cache; city-states use plain plot distance to their nearest city. A unit that can directly attack a city also counts for that city, even when assigned to a nearer one.

`BuildThreats` also lists our **endangered units**: those outside friendly cities with positive attributed threat damage. A city's endangered recruits are available units within 4 plots of it that are on this list, or that stand in a friendly city with positive native danger. Endangered recruits make an own-city fight worth running even when the city itself faces no damage.

**Own-city example.** Our capital is worth 40, with `Z_C` (city scale) = 90 and `C` (city unit) = 0.3. It has 200 HP (hit points) left and native danger of 80, so `f_def` (defense fall share) is 0.4 and its city term is `0.3 × 0.4 = 0.12` at neutral weights. With no endangered recruit, its priority is `0.644444 × 0.12 ≈ 0.077333`. With danger of 200 or more the city term is 0.3 and the priority 0.193333. A city with no danger and no endangered recruit has stake 0 and an inactive offer.

### Shared values and scales

`CvTacticalOperationalValue.h` and `.cpp` define the values shared by loop priorities and the simulator's outcome grade (its assessment of the result). Pure functions calculate values from numbers; adapters read native units, cities and plots.

| Value | Rule |
| --- | --- |
| Base unit worth | Native unit-type power × production cost, with each input floored at 0. |
| `F` (unit worth) | Base worth × `1 + 0.1 × max(0, level − 1)`. Our units also receive the ready-upgrade premium below. Enemy prizes use base worth and level. |
| Living unit value | `F` (unit worth) × `(0.6 + 0.4 × health share)`, with health share (remaining hit points divided by maximum hit points) clamped to 0 to 1. The retained 0.6 is lost when the unit dies. |
| `E(u, d)` (value unit u loses to incoming damage d) | The unit's entire current value if the damage reaches its remaining health; otherwise `F` (unit worth) × `0.4 × d / maximum hit points`. Nonpositive incoming damage gives 0. |
| City value | `getEconomicValue` as seen by the acting player, or population when economic value is not positive. |
| Ready-upgrade premium | `0.5 × max(0, upgrade base worth − current base worth)` when `CanUpgradeRightNow(true)` passes: the unit is ready to upgrade and the upgrade's technology and project prerequisites are met. Gold, territory, embarkation and unit class limits are not checked. Add this to worth before applying the health share. |
| `Z_U` (army scale) | The greater of our living units' total current value and 3 times typical unit worth (the mean base worth of the reference types described below). The total includes all our units. |
| `Z_C` (city scale) | The greater of our cities' total value and 3 times their mean value. With no city of our own, use the mean city value of living, non-barbarian players at war with us for the floor. Only the theater multiplier uses it. |
| `C` (city unit) | `city.units` × typical unit worth / `Z_U` (army scale): the size of a city fight in army currency. |
| `B` (ground normalization base) | One per living military unit of ours, plus the ground weights of all plots we own. |

**Reference types** are the military unit types used to calculate typical unit worth. For each unit class, our civilization's own type qualifies if it has combat strength, its prerequisite technology is known, its obsolete technology is unknown, and it has a production cost. City-state gifts and policy-unlocked types are excluded. Supply, gold, cities and resources do not affect the list, so the army-scale floor still applies at the supply limit.

`OurUnitWorth` reads our units' worth, `ReferenceUnitScales` calculates typical unit worth, and `BuildTurn` assembles the turn's normalization scales. The log message "Operational loop scales" reports army scale and typical unit worth. With no reference type, typical unit worth is 0; with no own or qualifying enemy city, typical city value is 0. A stake term divided by a nonpositive scale contributes 0.

**Upgrade and scale example.** A level-3 unit with base worth 400 has worth 480. A ready upgrade to base worth 600 adds 100, making its worth 580 and its current value at half health 464. If our total unit value is 464 and the mean reference type has base worth 250, `Z_U` (army scale) is `max(464, 3 × 250) = 750`. Two cities worth 40 and 20 have total value 60, mean 30 and `Z_C` (city scale) = `max(60, 3 × 30) = 90`.

### Ground value

`GroundWeight` measures a plot's value for occupation and blockade. It starts at 1 and adds these contributions:

| Contribution | Weight |
| --- | --- |
| Plot defense | Defense divided by 100. City plots have defense 100; other plots use terrain and feature defense plus the nonnegative defense of an unpillaged improvement. |
| Revealed strategic or luxury resource | +1 |
| Ocean | −0.25 |
| Coast or lake | −0.2 |
| Improvement on a workable plot | +0.1, or +0.25 for a great person improvement, even when pillaged |
| Revealed bonus resource on a workable plot | +0.15 |

A **workable plot** is a city plot or a plot within its effective owning city's work range.

`GroundStake` sets the maximum contribution of each plot to the ground score. It uses the full weight for our plots and hostile cities; half the weight above 1, floored at 0, for other hostile land; and 0 for everything else. Plain hostile land and hostile water therefore have no stake. `AddGroundPlot` applies that stake to occupation and blockade:

| Plot | Ground score |
| --- | --- |
| Our plot or city occupied by a hostile holder | Its stake is lost. |
| Our plot blockaded by a hostile neighbor, with no friendly or neutral holder on the plot | Half its stake is lost. |
| Hostile land or city held by our side | Credit its stake. |
| Hostile land blockaded by our side, with no hostile or neutral holder on it | Credit half its stake. |

A city occupies its own plot, so a hostile city earns credit only after our side takes it. `GroundAround` reads live owners, so it never sees that case; the simulator's grade freezes owners when watching starts and credits a captured city its full weight.

`GroundSide` treats teammates, master/vassal teams and their allied minors as our side, with hostility taking precedence. `PlotPresence` counts cities and living military holders. Aircraft and embarked units supply no presence. A military unit blockades from a neighboring plot only on the same landmass, in its native domain and outside a city. Cities and garrisons supply no blockade.

`GroundAround` sums lost weight minus credited weight over plots with an owner at the target and its same-landmass neighbors. `TargetGround` compares this score with and without the target unit. Other units remain present, so a second hostile unit can keep a plot occupied or blockaded.

**Ground example.** An enemy spearman at full health, worth 400, occupies our iron mine on a workable hill. The plot's weight is `1 + 0.25 + 1 + 0.1 = 2.35`. The spearman alone also blockades three empty plots of ours, two open and one hill, losing another `0.5 × (1 + 1 + 1.25) = 1.625`. With `B` (ground normalization base) = 400, removing it recovers `ΔG(t)` (normalized ground recovered by removing target unit t) = `3.975 / 400 = 0.0099375`. At neutral weights and `Z_U` (army scale) = 4000, its prize stake of 0.060 rises to 0.0699375. An equal spearman on plain hostile land with no other ground effect has stake 0.060.

### Theater and worked priorities

`θ` (theater multiplier) scales the whole stake by the assets in the zone. With `floor.theater` (minimum theater multiplier, default 0.2) and `Z_C` (city scale), use `θ = floor.theater + zone city value / Z_C`. Cityless zones retain a positive multiplier. Operation-target and focus-area bonuses add no priority factor.

The following examples use `Z_U` (army scale) = 4000, typical unit worth 400 (so `C` (city unit) = 0.3) and `Z_C` (city scale) = 90, with neutral mapped flavors and default weights. Maximum health is 100 HP (hit points) for units and 250 for cities, and each city's expected heal is 20. Ground and exposure terms are 0 unless listed. City values, unit worths and local damage are supplied inputs; calculations retain full precision until the displayed result.

| Zone city | City value | Theater |
| --- | --- | --- |
| Our capital | 40 | `0.2 + 40 / 90 ≈ 0.644444` |
| Our town | 15 | `0.2 + 15 / 90 ≈ 0.366667` |
| Enemy border city | 20 | `0.2 + 20 / 90 ≈ 0.422222` |
| Large enemy city | 45 | `0.2 + 45 / 90 = 0.7` |
| No city | None | 0.2 |

| Offer | Stake | Priority |
| --- | --- | --- |
| Border city worth 20 at 5 HP (hit points), no garrison, 5 or more local damage and an available local capturer | `0.3 × 1 = 0.300` | 0.126667 |
| Large city worth 45 at full health, no garrison, 50 local damage | `0.3 × 30 / 250 = 0.036` | 0.025200 |
| Spearman at full health, worth 400, in our capital's zone | `400 × 0.6 / 4000 = 0.060` | 0.038667 |
| Knight worth 700 at 30 HP (hit points) in a cityless zone | `616 / 4000 = 0.154` | 0.030800 |
| Swordsman at full health, worth 600, threatening the three archers above in a cityless zone | `600 × 0.6 / 4000 + 144 / 4000 = 0.126` | 0.025200 |

The same spearman at half health has stake 0.080 and priority 0.051556 at the capital. The large city at half health with the same 50 local damage has stake `0.3 × 30 / 125 = 0.072` and priority 0.0504. Now give that half-health city a garrison at full health with 100 HP, worth 400, and suppose the simulations give 50 city damage after absorption and 40 garrison damage. The garrison share is 0.4, adding `0.060 × 0.4 = 0.024` to stake, or 0.0168 to priority, for a combined priority of `0.0504 + 0.0168 = 0.0672`. Exposure adds a further term when the city or garrison threatens our units.

Raising mapped ATTRITION (preference for damaging enemy forces) to 80 gives weight `2^0.6 ≈ 1.515717`. The capital spearman at full health rises to priority 0.058608; the swordsman rises to 0.034483 because only its prize term uses attrition. Raising OCCUPATION (preference for capturing cities) to 70 instead gives weight `2^0.4 ≈ 1.319508` and border-city priority 0.167138.

**City or units first.** In the large city's zone, a swordsman at full health, worth 600, has priority `0.7 × 0.09 = 0.063`. The ungarrisoned city at full health with 50 local damage has priority 0.0252, so the swordsman fight runs first. With 150 local damage the city's stake is `0.3 × 130 / 250 = 0.156` and its priority 0.1092, so the siege runs first and its search can still attack either target. With 20 local damage or less this ungarrisoned city has no city-progress term and its fight stays inactive unless it threatens our units. A larger army changes this balance little, because the city unit and unit prizes both shrink with `Z_U` (army scale).

## Reinforce

**Reinforce** (bringing distant units toward a battlefield) recruits for defense at our cities and for combat at enemy centers. It estimates the strength incoming units can add, ranks that benefit against other offers, checks that the selected units can reach the destination, then marches them. Estimates use plain plot distance; pathfinding waits until readiness.

### Strength tallies

Reinforcement uses native combat strength, scaled by 100 and multiplied by remaining health share, as own-city fights do.

| Tally | Rule |
| --- | --- |
| `L` (local friendly strength) | `LocalStrength`: the [strength filter](#battlefield-estimate) of the local set, which holds our combat units in the destination's domains within strike reach, including spent units and army members. At our city, `LocalCityStrength` adds the city's own strength. |
| Domains | The battlefield's [domains](#battlefield-estimate): land units at a city, sea units too when the city is coastal, and the plot's domain at a unit destination. `L`, `T` and the candidates all use them. |
| `T` (enemy strength) at our city | The same tally as the own-city fight: the city's approach list (hostiles assigned to this city) plus visible units that native danger identifies as able to attack the city plot, each counted once. Counted units are recorded for retirement. |
| `T` (enemy strength) at an enemy center | `EnemyCenterStrength` counts visible hostile non-air combat units within 4 plots in the destination's domains (land or sea), plus hostile cities within 4 plots. City strength is multiplied by remaining health share, counting at least 1 HP (hit point). A counted city's strength already includes its garrison, which is excluded from the unit tally. Counted units and cities are recorded for retirement. |

### Candidates and selection

`GatherReinforceCandidates` reads the tactical roster and keeps combat units the tactical AI can use now, outside armies and in the destination's domains (land or sea). Generals, admirals and civilian sappers fail the combat test. Candidates must be outside the [local set](#battlefield-estimate), beyond their strike reach by plain plot distance, but within `GetRecruitRange()` (native recruitment range). Each unit therefore counts as local or incoming, never both.

A **held garrison** (a garrison left unprocessed by the high-priority pass) qualifies only within 4 plots by plain distance, using `TACTICAL_COMBAT_MAX_TARGET_DISTANCE` (maximum target distance for search). It joins search but takes no path move, so readiness must confirm that the search can reach it. A unit rejected by this offer's reach check remains excluded from this offer for the rest of the turn. Other battlefields can still select it.

The remaining candidate filters follow native behavior:

- Exclude carriers.
- Exclude siege units entering an enemy-dominated zone at an enemy center. Our own cities have no dominance gate.
- Exclude units that should heal given the destination's territory.
- Preserve donor-zone safety, which keeps units in zones that need them.

**Travel turns** are plain plot distance divided by base moves, rounded up, with a minimum of 1 for both moves and turns. **Join turns** are travel turns minus one, with a minimum of 1. `IsCapturer` identifies a **capturer** (a land melee combat unit outside armies that may capture), whether or not it can act now.

`SelectReinforcement` computes **need** (the additional strength required) from `r` (desired strength ratio, set by `reinforce.strengthRatio`), `T` (enemy strength) and `L` (local friendly strength): `max(0, rT − L)`. It sorts candidates by join turns, then travel turns, then unit ID, and takes units until their full strength meets the need. There is no two-unit minimum.

At an enemy city, selection takes two more steps after the strength need is met:

1. **Role unit.** If neither a local nor a selected unit can capture, the nearest remaining capturer joins as the role unit (the extra unit needed for capture). Its strength divided by join turns is **role help**. If no capturer is available, the selection records a missing capture role.
2. **Damage extension.** Strength alone can pick units that add nothing to a siege, such as melee units that fail the suicide test. When the base fall share is below 1 and the selection so far raises neither [projected share](#reinforce-priority) above its base, `EstimateReinforce` walks the remaining candidates in the same order and adds each one that passes `CanStrikeCity` and whose simulated attack damages the city or its garrison. It stops as soon as a projected share rises. If the candidates run out first, the added units are dropped and stay free.

Units added by the extension are selected units in every later tally: help, arrival ratio, readiness and marching. The extension also runs when the need is 0 and nothing was selected.

**Extension example.** A city heals 20 per turn and our local units deal 15. Need is one unit, and the nearest candidate is a swordsman whose attack on the city would kill it, so it adds no damage and the projected fall share stays 0. The next candidate is a catapult 2 join turns away that simulates 30 city damage. It adds `30 / 2 = 15`, the total of 30 outpaces the heal, and the catapult joins the selection.

The candidate filters copy those of `CvTacticalAI::PlotReinforcementMoves` with these differences:

- Select per battlefield. A coastal city selects land and sea units together; native reinforces its land and water zones separately.
- Stop at the strength need, with no two-unit minimum. The capture role replaces native's melee-only mode, and the damage extension can add units past the need at an enemy city.
- Use plain-distance bounds for estimates. Run reachability, alternative-target and path checks at readiness.
- Leave units covering civilians out without native's skip and processing side effect.

### Reinforce priority

`H` (reinforcement help) is the sum of each selected unit's strength divided by its join turns. **Gain** measures that help against the strength required. Using `r` (desired strength ratio), `T` (enemy strength), need (additional strength required) and role help (the capture-role unit's strength divided by join turns), gain is `min(r / (1 + r), min(H, need + role help) / ((1 + r) T))`. Gain is 0 when enemy strength is nonpositive.

The **arrival ratio** compares combined local and incoming strength with the enemy. With `L` (local friendly strength) and `T` (enemy strength), it is `(L + selected full strength) / T`. **Odds** discount a force below the desired ratio: with `r` (desired strength ratio), use `min(1, arrival ratio / r)`. Arrival ratio and odds remain 0 when enemy strength is nonpositive.

Priority depends on the destination. `θ` is the theater multiplier, and the weights and `C` (city unit) are those of [fight priority](#fight-priority):

| Destination | Priority |
| --- | --- |
| Our city | `θ × w_C × C × gain` |
| Enemy unit | `θ × V × gain × odds`, where `V` is the unit fight's current stake, refreshed even after that fight executes |
| Enemy city | `θ × (w_O × C × (f_att⁺ − f_att) + w_A × garrison prize / Z_U × (f_g⁺ − f_g)) × odds` |

At **our city**, border, parity and odds checks do not apply.

At an **enemy city**, Reinforce is worth the fight it creates. `f_att⁺` and `f_g⁺` are the **projected shares**: the [fall share](#city-unit-and-fall-share) and [garrison damage share](#garrison-damage-share) once the selected units have joined. `EstimateReinforce` computes them by continuing the fight's local damage simulation:

1. Simulate the selected units, then the role unit, in selection order. Each attacks from its current plot under the local damage rules. A unit that fails `CanStrikeCity` adds no damage, though it still counts toward strength.
2. Divide each unit's city and garrison damage by its join turns, the discount that help uses, and add the results to `D_c` and `D_g`.
3. Apply the fight's share rules to the new totals, with the same remaining health, expected heal and garrison. Any local capturer, spent or not, a selected capturer or the role unit satisfies the capture requirement, because the march arrives after this turn.

`f_att` and `f_g` here are the **base shares**: the fight's local damage alone under that same capture rule. They equal the fight's own shares unless a spent local capturer would complete a lethal siege. The march then earns nothing for a capture its damage does not enable.

The share difference replaces gain at an enemy city, because it measures the benefit directly in damage. Gain is still recorded. Odds keep their role as the discount for arriving too weak. Exposure stays with the fight. The difference has three useful properties:

- It is at most `f_att⁺`, so a march never outranks the fight it sets up.
- It is 0 only when no candidate in recruit range, added to the local damage, can outpace the city's healing or hurt its garrison. The damage extension has already tried the candidates beyond the strength need, so units do not trickle into a hopeless siege and a viable one is not missed.
- With no local attacker, `f_att` is 0 and the march earns the whole projected share, so a siege can start from nothing.

At any **enemy center**, priority is 0 if any of these conditions holds:

- The zone is neither ours nor adjacent to one of ours, based on the turn's initial zone data.
- The zone's posture is Withdraw.
- The arrival ratio (combined local and incoming strength divided by enemy strength) is below 1.

These reinforcement gates leave the fight offer unchanged.

**Selection example.** Our town has `L` (local friendly strength) = 100 and `T` (enemy strength) = 150. At the default desired strength ratio of 2, need (additional strength required) is `2 × 150 − 100 = 200`:

| Candidate | Strength | Travel turns | Join turns | Help | Selected |
| --- | --- | --- | --- | --- | --- |
| Spearman | 100 | 2 | 1 | 100 | Yes |
| Horseman | 50 | 2 | 1 | 50 | Yes |
| Knight | 100 | 3 | 2 | 50 | Yes, full strength reaches 250 |
| Second knight | 100 | 3 | 2 | 50 | No |

Selected help (strength discounted by join turns) is 200, gain (the normalized reinforcement benefit) is `200 / 450 ≈ 0.444444`, and the second knight stays free. With the sample town value 15, `Z_C` (city scale) = 90 and `C` (city unit) = 0.3, priority is `(0.2 + 15 / 90) × 0.3 × 0.444444 ≈ 0.048889`.

**Enemy-city example.** Take the large enemy city from the [worked priorities](#theater-and-worked-priorities): theater 0.7, `C` (city unit) = 0.3, 250 HP (hit points) at full health, expected heal 20, no garrison and 50 local damage, so `f_att` is 0.12. Two selected units each simulate 40 city damage, and odds are 1 at neutral weights:

| Case | `D_c` with incoming damage | `f_att⁺` | Reinforce priority |
| --- | --- | --- | --- |
| Both join in 1 turn | `50 + 80 = 130` | `110 / 250 = 0.44` | `0.7 × 0.3 × 0.32 = 0.0672` |
| Both join in 2 turns | `50 + 40 = 90` | `70 / 250 = 0.28` | `0.7 × 0.3 × 0.16 = 0.0336` |

The city fight itself has priority 0.0252 now and `0.7 × 0.3 × 0.44 = 0.0924` once both units stand beside the city, so the march ranks between the two. Incoming units that simulate only 10 city damage each leave `D_c` at 70 or less, `f_att⁺` at 0.2 or less, and the priority at 0.0168 or less.

### Reinforce readiness

`CheckReinforce` validates reach without issuing orders. A selection already checked since the last command passes immediately. Otherwise, a native step-finder flood (a reachability scan from the destination) uses the army-mixed path type and recruitment range.

A **held garrison** (a garrison left unprocessed by the high-priority pass) takes no path move, so it must be within search reach: 4 steps from the destination in its own domain (land or sea). `SearchReachPlots` uses the distance rules of `TacticalAIHelpers::UpdatePlotDistanceToTarget`. A land garrison across water fails this check before its player can embark. Other selected units must pass all of these checks:

- Its plot is in the flood.
- Native's alternative-target filter (`TacticalAIHelpers::GetTargetsInRange`) finds no target more than 4 plots from the destination. This filter runs at readiness because it scans each unit's reach.
- `CanMarch` finds a path with `MarchFlags` within recruit range, with safe embark for land units.
- Danger at the path's first-turn stop stays within native's limit: half the unit's remaining HP (hit points) for attackers that are not siege units, otherwise 0.

A failing unit is excluded from this offer's selection for the rest of the turn. Selection and scoring repeat until every selected unit passes. If none remain, the result is `NO_REACHABLE` (no reachable recruits) and the offer becomes inactive. A lower estimate returns `REDUCED` (priority lowered by reach checks), and the offer returns to the queue at that estimate, becoming inactive if it is 0. Otherwise the check passes. Check flags clear after every command.

### Marching execution

`ExecuteReinforce` labels unit actions with `AI_TACTICAL_REINFORCE` and uses the checked selection that remains available. It calls `PositionUnitsAroundTarget` to perform these steps:

1. Move a spotter (a unit used to improve visibility), excluding held garrisons (garrisons left unprocessed by the high-priority pass).
2. Run `ExecuteEngagement` for the units still available. Gather search geometry and resolve search preferences and aggression after the spotter move. Keep target distance relevant to search scoring, and use the target's owner as the counterpart (the player used for civilization modifiers), or none at our city.
3. Move distant units along paths through `CanMarch` and `MarchFlags`, then run the safety pass for army members.

The command record keeps the selection, whether the search ran, and whether a selected unit moved, meaning it changed plot or died.

## Readiness checks

`CheckFight` validates a fight without issuing orders. Enemy fights use native recruitment and expected damage. For a unit fight, a living best defender must remain on the target plot; an eligible city strike then passes immediately. Otherwise, both unit and city fights require recruits from `FindUnitsWithinStrikingDistance` and must pass the **damage test**: positive expected damage from `ComputeTotalExpectedDamage`. For a city fight, that function also reports the garrison damage of its counted attacks, and positive city damage or positive garrison damage passes. [Execution](#execution) applies the same damage test, so a fight that passes readiness is not ended there for lack of damage. A city at 1 HP (hit point) or less also needs a recruit able to capture it or positive expected damage to its garrison. Reinforcement has a separate [readiness check](#reinforce-readiness).

City fights need no further progress check here. The [attack fall share](#city-unit-and-fall-share) already removes the city-progress term when local damage cannot outpace healing; the separate garrison term can still justify attacking.

An own-city fight has no offensive damage check. It gathers its [recruits](#city-defense) and passes when one is endangered, or when it has a defender and a visible enemy combat unit stands within 5 plots, the reach of the search's geometry. City danger can come from fast or long-range enemies outside the search area with nothing there to act on; waiting then leaves the recruits free for other commands.

Each check records `passed`, or the first failed condition in this order. The Reinforce results come from its [readiness check](#reinforce-readiness):

| Result | Condition |
| --- | --- |
| Target gone | The plot is missing, a unit target's plot has no living best defender, for example after the target died or left, or our city's plot is no longer ours. |
| No recruits | Native recruitment finds no eligible unit of ours that can still act within striking distance. |
| No damage | The recruited units have no positive expected damage to the target unit, or to either the city or its garrison for a city fight. |
| No capturer | A city at 1 HP (hit point) or less has neither positive expected garrison damage nor a recruited combat unit that is melee, has moves and an attack left, and has no capture prohibition. |
| No defenders | Our city has no defender and no endangered recruit. |
| No nearby enemy | Our city has defenders but no endangered recruit, and no visible enemy combat unit within 5 plots. |
| No reachable | Reinforce: no selected unit is left after the reach checks, so the offer turns inactive. |
| Reduced | Reinforce: a reach check shrank the selection and lowered its estimate; the offer returns at that estimate. |
| Passed | The applicable checks pass, including the immediate city-strike pass for a unit fight. |

Native recruitment reads the current tactical roster and its eligibility rules. **Available** means the unit passes `canUseNow`: moves left, unprocessed and not dying. Recruitment can include ranged units that can reach a firing position but only shoot next turn, and nearby units within 2 plots even when blocked. A pass can therefore lead to positioning. Support recruits such as generals contribute no damage. Endangered units added only during execution cannot make readiness pass; an endangered unit already in offensive recruitment contributes normally.

City fights use this damage check regardless of zone posture, native zone dominance or the native 13-turn siege-viability check. Their search aggression uses the separate posture-based risk blend. The capture-role test applies to the offensive recruits before endangered additions.

**City-strike-only command.** A spearman stands within bombard range of our city and no unit can join. Readiness passes because the city can strike. The command fires, then ends when recruitment fails or expected damage is 0. A city-fire kill also ends the command. Both consume one command slot and retire no overlapping offers.

**Capture-role wait.** An ungarrisoned city at 1 HP (hit point) has ranged recruits with positive simulated city damage and no recruit able to capture. Its city-progress term is 0. If exposure keeps the fight's estimate positive, readiness records `no capturer` and the fight waits. A later command that moves an available melee capturer into recruitment distance can wake it. It must pass recruitment, positive damage and the capture-role check on its next try. A garrisoned city whose recruits can damage the garrison passes without a capturer.

## Execution

`ExecuteFight` follows the native attack path, adding endangered recruits and the loop's search flavors (preferences used to score tactical plans). It first sets a **move label** (the action category recorded in tactical move and kill statistics). The zone's posture chooses the same label as its native routine, such as `AI_TACTICAL_STEAMROLL` in a Steamroll zone.

With no zone posture, fallback move labels (categories used in tactical statistics) are `AI_TACTICAL_SURGICAL_STRIKE` for enemy-city fights, `AI_TACTICAL_HEDGEHOG` for own-city fights and `AI_TACTICAL_ATTRITION` for enemy-unit fights. Own-city fights then continue in [city defense](#city-defense). Enemy fights follow this sequence:

1. **City strike**, for a unit target. Eligible cities fire first. A kill ends the command.
2. **Offensive recruitment.** Re-run native recruitment and the readiness [damage test](#readiness-checks) against the surviving target. With no recruit or a failed damage test, end the command after city fire.
3. **Endangered recruitment.** Add available units outside armies from the target's threat map. A city fight includes units threatened by the city and its garrison. Deduplicate both the endangered list and the combined search candidates. Units marked unnecessary by native's offensive estimate are initially left out of that candidate list; eligible endangered units can still enter through their threat entry.
4. **Spotter move.** Try to improve visibility using the candidates, excluding held garrisons. If the target stays unseen, skip search.
5. **Aircraft.** With air search enabled, add recruited sweepers and available carriers of recruited aircraft, then plan them with the other units. Otherwise run native greedy sweeps and air strikes first. An air kill of a unit target skips search.
6. **Final search group and flavors.** Keep candidates still available after spotter and air actions, with aircraft included only under air search. A nonempty group runs `ExecuteEngagement`: gather geometry, blend flavors with the unit-fight or city-fight row, derive aggression, then search and execute with up to four attempts. Empty groups end without search.
7. **City follow-up.** After reaching the attack path for a city, delete its focus area if captured, then find embarked recruits within 4 plots and run the native landing operation when any are found.

A **held garrison** is a garrison the high-priority pass left unprocessed. Offensive recruitment can include it and search can move it; the preliminary spotter move excludes it.

### City defense

`ExecuteCityDefense` runs an own-city fight as one engagement. Its recruits come from the tactical roster under native's eligibility rule, `canUseForTacticalAI`, so operation and army units stay out. `GatherCityEndangered` collects the endangered recruits, and `GatherCityDefenders` collects the rest, skipping any unit already endangered:

| Recruit | Rule |
| --- | --- |
| Endangered | A non-air unit within 4 plots of the city that is on the turn's endangered list, or stands in a friendly city with positive native danger. |
| Defender | A land combat unit, or a sea one at a coastal city, within its [strike reach](#battlefield-estimate) by plain distance, including the held garrison on the city plot. This is the boundary where Reinforce candidates begin. Units covering a friendly civilian are left out, as native recruitment leaves them out. |
| Aircraft | Under air search, an aircraft whose range reaches the city from its base or from a plot its carrier can reach this turn, plus that carrier when it is available. Defenders need no ability to attack the city. |

All recruits join the search, and the endangered ones are recorded for [dispositions](#search-dispositions). The engagement uses the own-city kind row, no counterpart (native gives no civ modifier in our own zone) and native's `bTargetDistanceRelevant` set to false in both the search and the geometry gathering. With that flag off, the search scores no penalty for ending farther from the city, so a healthy spearman can hold while a wounded archer retreats. Enemy fights keep it on. There is no city fire, spotter move, separate air attack or capture follow-up; native high-priority fire, enemy-unit commands and the end-of-turn review keep those strikes.

### Flavors and aggression

The search resolves five [military flavors](../flavors/overview.md) (preferences on a 0 to 100 scale): RISK (willingness to accept danger), OCCUPATION (capturing cities), ATTRITION (damaging enemy forces), HOLD_CITY (defending cities) and HOLD_GROUND (controlling territory). Priority weights use the turn's mapped preferences. Each engagement uses the geographic blend below, so a civilization modifier can change search behavior without changing queue priority.

#### Mapped flavors

`OPERATIONAL_VP_TERMS` maps Vox Populi flavors into the five military slots. Each term adds its weight times the input's deviation from neutral 50. Results are rounded and clamped to 0 to 100. A missing required flavor makes all five slots fall back to 50; any unmapped slot also gets 50.

| Input layer | What it reads |
| --- | --- |
| Active | The flavor as the flavor manager holds it now, mapped to the 0 to 100 scale. |
| Personality | The leader's base value, or the active custom value. |
| Intent | Neutral 50 plus the grand strategy's contribution, or the active custom value. |
| Strategy | The active strategies' contribution, centered on 50. |

Vox Deorum custom flavors enter these readings, allowing strategists to steer the mapped preferences. For RISK (willingness to accept danger), a leader without `FLAVOR_RISK` (a dedicated native risk flavor) falls back to `FLAVOR_OFFENSE` (the native offense flavor). An active custom risk value supplies the player's own preference.

#### Geographic blend

`GatherSearchPlotZones` gathers the search geometry for the available candidates before the participant cap: visible plots around the target, extra room around enemies and the surroundings of accepted non-air units. Remote aircraft bases add no plots. Zone IDs 0 and −1 are omitted from the blend.

`BlendEngagementFlavors` retains the mapped search vector and resolves it in this order:

1. In each contributing zone, apply native civ, operation and zone modifiers to the mapped flavors, without search-intent defaults, then add that zone's posture row.
2. Average these vectors by their plot counts. With no contributing zone, start with the mapped flavors.
3. Add the command's kind row, clamp to 0 to 100 and round once.
4. Choose the **representative zone**, the zone with the most plots; ties go to the lower zone ID.

The function also calculates **aggression RISK** (the separate score used to choose search aggression). Each contributing zone starts at neutral 50, receives the same tactical modifiers using the game's flavor-scale conversion, then its posture's risk offset. Average these scores by plot count, including None and Withdraw zones, and add the command kind's risk offset before clamping and rounding once. With no valid zones, use 50 plus the kind offset. Player preferences still steer search scoring and priority; this separate calculation chooses aggression.

RISK (willingness to accept danger) always counts as set for danger scoring. With its mapped value at 50 and no modifiers, a unit fight covering 60% Hedgehog and 40% Steamroll plots gets an aggression score of `50 + 0.6 × (−15) + 0.4 × 10 = 45`. A city fight over the same plots gets 55. A unit fight wholly in a Withdraw zone gets 20 and can still run. An own-city defense wholly in Hedgehog plots gets 35 and searches at Low aggression. Posture supplies preference offsets; readiness determines whether the fight can execute.

#### Aggression levels

`AggressionFromRisk` maps aggression RISK (the posture-based score for search aggression) to a search level using the thresholds below. Retries keep that level and the original search flavors (preferences used to score tactical plans).

With default rows and no modifiers, single-zone unit fights resolve to Low for Attrition and Hedgehog, Medium for Exploit Flanks and Counterattack, and High for Steamroll. City fights and Reinforce still receive their kind offsets. Native city assaults choose aggression by melee count, and native positioning searches always use Low. The loop uses the same posture and kind calculation for these searches.

| Aggression RISK (score used to select search aggression) | Level with default thresholds |
| --- | --- |
| Below 40 | Low |
| 40 to 59 | Medium |
| 60 to 89 | High |
| 90 and above | Braveheart |

### Search dispositions

Each endangered recruit of an enemy or own-city fight receives a **disposition** from the rows counted as run across search attempts. `MarkDispositions` applies the same rule to both:

| Disposition | Rule |
| --- | --- |
| Placed | A move, attack, pillage or other action row counted as run. Finish, temporary finish, heal and wait rows count only in an attempt that completed. |
| Free | No qualifying row ran. Initial, restart and blocked rows do not place a unit; planned rows beyond a stopped attempt do not count. |

The native row counter includes a row whose precondition passed even when its outcome stopped replay. A unit omitted by the search or cut by its participant cap remains free under this rule. The native cap is 13, or 19 with air search enabled. Disposition records search placement; `canUseNow` independently determines whether a later command can recruit the unit. Spotter and greedy air effects precede search-row accounting.

**Stopped-attempt example.** A plan moves a spearman before an archer. Execution stops after the spearman and retries never reach the archer's move. The spearman is placed; the archer is free. A successfully completed hold also places a unit, including a spearman left available to heal on its hill.

Native replay processing (marking units finished after executing a plan) still applies. A successful replay processes finished ground and naval units unless they should heal and still have moves. Aircraft finishes process only aircraft that attacked and exhausted their attacks. Blocked units and units never reached by a plan remain available when their state permits.

Free endangered units (recruits with no qualifying search action) can join later commands. Units left unprocessed after the tactical turn pass to Homeland AI (the system for remaining unit tasks). Its `PlotMovesToSafety` normally moves military units when danger reaches remaining health, with a separate earlier border-clearing rule for siege units. The loop issues no withdrawal command of its own.

## Overlapping offers

A search centered on one enemy can attack surrounding enemies. After an enemy-unit command runs its search with at least one candidate, `RetiresFight` retires open enemy-unit fights within 2 plots of its target in compatible zones. Opposite zone-ID signs are incompatible: positive land zones and negative water zones do not overlap. Different zones of the same domain can overlap.

These offers are exempt:

- A fight whose target has positive threat damage against our units outside friendly cities and armies. Its own search can recruit those endangered units. Spent units still sustain this exemption.
- A fight marked near our city at build time, using the [native city-distance rule](#battlefields).
- Every enemy-city and own-city fight. These commands also retire no unit fights.

The loop rebuilds threats after execution and before retirement, so a unit moved into danger by the command can protect its attacker's offer. Ready, inactive and waiting offers can be retired; executed, retired, skipped and dropped offers are left alone. Retirement requires the search to have been called with a nonempty group, regardless of whether search found or completed a plan. Commands ending after city fire, visibility failure or greedy air retire nothing.

**Reinforce retirement** uses the enemies counted in the executed offer's last estimate. If at least one selected unit changed plot or died, retire the open reinforcement offer of every other enemy battlefield whose target contributed to `T` (enemy strength). Ready and inactive offers can be retired. Our cities' reinforcement offers are exempt; a command with no such unit change retires nothing.

Retiring an offer leaves its battlefield's other offer intact. Reinforcement commands retire only reinforcement offers, and fights retire only fights.

**Near-city example.** In our town's zone, use theater multiplier `0.2 + 15 / 90` and `Z_U` (army scale) = 4000. A scout worth 100 and catapult worth 500 each have 20 HP (hit points), making their prize share 0.92. With no ground or exposure term, their priorities are 0.008433 and 0.042167. The catapult competes first. If its search runs, a surviving scout 2 plots from our town still keeps its own fight, even when within 2 plots of the catapult.

**Waiting-offer example.** In a cityless zone, a catapult at full health, worth 500, has priority 0.015 and a spearman at full health, worth 400, has priority 0.012. They stand 1 plot apart, far from our cities, and threaten none of our units. If the catapult fight fails readiness and the spearman fight then runs a search, the catapult fight is retired for the turn. A waiting offer can lose its later try when another search covers it.

## Wake rule

`SnapshotBoard` and `DiffBoard` compare visible hostile-unit identities and plots, city-battlefield owners and our living units' plots before and after each command. `WakesFight` wakes a waiting offer after these helpful changes:

| Change | Distance test |
| --- | --- |
| A visible enemy unit disappears, moves or becomes visible | Its old or new plot is within the turn's largest land/sea striking-distance scan of the target, or within 5 plots of our city. |
| A city battlefield changes owner | Its plot is within that same reach. |
| A unit of ours arrives at a new plot and remains available | It is within its own striking distance of the target, or within its [strike reach](#battlefield-estimate) of our city. Aircraft and port-changing ships pass this distance test automatically. |
| Our city's re-estimate finds an endangered recruit | Always wakes that own-city fight. |

The scan is the largest `baseMoves(false) × 4` among our living land and sea units at turn build. Our moved unit's distance test uses its own `baseMoves(false) × 4`, or its strike reach for our city. These are distance tests; waking returns a positive-estimate fight to ready so its full readiness check can run again.

Damage to an enemy or city still standing, and our units merely spent, damaged or lost, do not wake fights. Enemy disappearance from visibility also counts as a snapshot change. A helpful change leaves the offer waiting if its refreshed estimate is nonpositive. Other commands add no failures while a fight waits.

**Blocker example.** In a cityless zone, a catapult worth 500 at 50 HP (hit points) has priority `0.2 × 500 × 0.8 / 4000 = 0.020`. A spearman worth 400 at full health blocks the only approach and has priority 0.012. Place them 3 plots apart, beyond overlap retirement. The catapult fails recruitment once and waits. Commands that only spend or damage our units leave it waiting. When the spearman fight kills the blocker within the scan, the catapult wakes and can pass if the newly open path permits recruitment. If it instead fails after helpful wakeups, its third failed check skips it for the turn.

## Records

`RunCommandLoop` can fill an `SOperationalTurnRecord` (the turn's ordered commands and readiness checks). When no record is supplied and both game logging and AI logging are enabled, it writes tactical messages for checks, executed commands and a command-cap stop. Check messages name the result. Command messages identify the command, battlefield and plot, whether search ran, and separate counts of retired fight and reinforcement offers.

Captured search requests carry a **purpose** (a label describing the command and territory). City requests use `CityAttack` (enemy-city fight), `CityDefense` (own-city fight) or `Reinforce` (reinforcement). Unit battles use `BattleFriendly` (our team's zone), `BattleNeutral` (unowned territory or a zone outside our team whose owner is not at war with us) or `BattleEnemy` (enemy territory). Retries retain the purpose. Search preferences still come from the geographic blend and command-kind offset.

| Turn field | Content |
| --- | --- |
| `commands` | Executed command records, in order. |
| `checks` | Every readiness check: `iBattlefield`, `eResult` and `bReinforce`, which marks a Reinforce check, including passed checks and the first failed condition. |
| `vSkipped` | Battlefield IDs skipped at the readiness failure limit. |
| `bCommandCap` | True when the cap stops selection while a ready offer remains. |

Each `SOperationalCommandRecord` contains:

| Field | Content |
| --- | --- |
| `iCommand` | Zero-based command position in this turn. |
| `iBattlefield`, `iPlotIndex` | Battlefield ID and target plot at execution. |
| `eKind`, `eOwner` | Unit-fight, city-fight, Reinforce or own-city-fight kind, and the target's owner, which is us for our city. |
| `fEstimate` | The command's single priority field: the estimate it ran at, after any reach checks. Readiness supplies a pass/fail result. |
| `iFailuresBefore` | Cumulative readiness failures before execution. A Reinforce keeps 0 here because it never counts failures. |
| `bSearchRan` | Execution called the engagement search with a nonempty group. |
| `vRetired` | IDs of fights this command retired. |
| `vEndangered` | Endangered recruit IDs paired with a boolean: true for placed, false for free. |
| `vSelected` | Reinforce: the checked selection by unit ID. |
| `bMoved` | Reinforce: a selected unit changed plot or died. |
| `vRetiredReinforce` | Battlefield IDs whose Reinforce this command retired. |

Supporting structures hold the values used during execution:

| Structure | Content |
| --- | --- |
| `SOperationalStake` (fight score components) | Weighted and scaled prize, ground, exposure, city-progress and garrison terms, plus their sum, and the fall share and garrison damage share behind the city terms. |
| `SOperationalReinforce` (reinforcement selection and score) | Strength tallies, selected units, help, gain, arrival ratio, odds, base and projected shares at an enemy city, counted enemies, rejections and check flag. |
| Own-city battlefield | Last `L` (local friendly strength), `T` (enemy strength) and whether an endangered recruit was present. |
| `SOperationalTurn` (working turn state) | Mapped preferences, resolved weights, fixed scales, threat maps, endangered units, approach lists and battlefields. |
| `SOperationalEngagementReport` (search execution report) | Zone plot counts, representative zone (the zone contributing the most search plots), final preferences, aggression RISK (the score choosing search aggression), resolved aggression level and overall success. |
| Search attempt | Planned action rows, rows counted as run and completion status. `ExecuteFight` derives dispositions (whether endangered recruits were placed or left free) from these reports. |

## Settings

`GetOperationalSettings` fills a settings struct for the player from game defines and constant tables. The DLL runs those defaults. The simulator can replace settings per player. Table changes require editing their source and rebuilding; the row tables have compile-time size checks.

| Setting | Default | Source |
| --- | --- | --- |
| `VOX_TACTICAL_OPERATIONAL_LOOP` | 0 | `NewCustomModOptions.xml` |
| Command cap, `iMaxCommands` | 64 | `VOX_OPERATIONAL_MAX_COMMANDS` |
| Medium, High, Braveheart aggression RISK (score choosing search aggression) thresholds | 40, 60, 90 | `VOX_OPERATIONAL_AGGRESSION_MEDIUM_RISK`, `VOX_OPERATIONAL_AGGRESSION_HIGH_RISK`, `VOX_OPERATIONAL_AGGRESSION_BRAVEHEART_RISK` |
| Posture and kind offsets | Tables below | `CvTacticalOperationalLoop.cpp` |
| Priority weights, slopes and constants | [Weights file](#weights-file) | `CvTacticalOperationalWeights.cpp` |

The game defines are in `(1) Community Patch/Database Changes/Defines/CoreDefineChanges.sql`. The mod option is in `(1) Community Patch/Database Changes/NewCustomModOptions.xml`, both under `civ5-dll/`.

### Posture rows and kind rows

**Posture rows** (offsets for a zone's tactical stance) are applied before the geographic average. **Kind rows** (offsets for the active command type) are added afterward. All entries are flavor points.

| Posture | RISK (accept danger) | OCCUPATION (capture cities) | ATTRITION (damage enemies) | HOLD_CITY (defend cities) | HOLD_GROUND (control territory) |
| --- | --- | --- | --- | --- | --- |
| None | 0 | 0 | 0 | 0 | 0 |
| Withdraw | −30 | −20 | 0 | +10 | −10 |
| Attrition | −20 | 0 | +20 | 0 | 0 |
| Exploit flanks | −10 | 0 | +10 | 0 | 0 |
| Steamroll | +10 | +5 | +15 | −10 | −10 |
| Surgical city strike | 0 | +15 | −5 | −10 | −10 |
| Hedgehog | −15 | −15 | +10 | +20 | 0 |
| Counterattack | −10 | −10 | +15 | 0 | +20 |

| Active command kind | RISK (accept danger) | OCCUPATION (capture cities) | ATTRITION (damage enemies) | HOLD_CITY (defend cities) | HOLD_GROUND (control territory) |
| --- | --- | --- | --- | --- | --- |
| Unit fight | 0 | 0 | 0 | 0 | 0 |
| City fight | +10 | +15 | −25 | −5 | −5 |
| Reinforce | −15 | −10 | −10 | +10 | +20 |
| Own-city fight | 0 | 0 | 0 | 0 | 0 |

The own-city kind row adds no offset. Posture rows follow native values except that Hedgehog uses −15 for RISK (willingness to accept danger), compared with native's −10. Enemy-city and reinforcement kind rows are derived from native's CityAssault and Reinforce rows by subtracting the mean of their posture rows and rounding to multiples of 5. Withdraw zones contribute their posture offsets to fights and reinforcement; the loop has no separate withdrawal command.

### Weights file

`CvTacticalOperationalWeights.h` and `.cpp` hold the tunable numbers. Names in the tables are also the names for simulator overrides. `ResolveOperationalWeights` turns base weights and mapped flavors into the turn's weights through `FlavorWeight` in the value file.

| Setting | Default | Scaling or use |
| --- | --- | --- |
| `weight.attrition` | 1 | Increases with ATTRITION (damaging enemy forces); scales target and garrison prizes. |
| `weight.occupation` | 1 | Increases with OCCUPATION (capturing cities); scales the city unit at an enemy city. |
| `weight.holdCity` | 1 | Increases with HOLD_CITY (defending cities); scales the city unit at our city. |
| `weight.holdGround` | 1 | Increases with HOLD_GROUND (controlling territory); scales unit-target ground. |
| `weight.risk` | 1 | Decreases with RISK (willingness to accept danger); scales exposure. |
| `slope.RISK`, `slope.OCCUPATION`, `slope.ATTRITION`, `slope.HOLD_CITY`, `slope.HOLD_GROUND` | 1 each | Exponent slope for each flavor's weight. |
| `floor.theater` | 0.2 | Theater in a zone without a city. |
| `city.units` | 3 | Size of a city fight in typical units; sets `C` (city unit). |
| `floor.prize` | 0.6 | Share of unit worth in a target's prize at full health. |
| `readiness.maxFailures` | 3 | Truncated to an integer and floored at 1 for the failure limit. |
| `reinforce.strengthRatio` | 2 | `r` (desired strength ratio): with `T` (enemy strength) and `L` (local friendly strength), need is `max(0, rT − L)`. Gain caps at `r / (1 + r)`, and odds are `min(1, arrival ratio / r)`, where arrival ratio is combined local and incoming strength divided by enemy strength. |

Enemy-fight stakes use attrition, occupation, hold-ground and risk weights; own-city stakes use hold-city and risk. Reinforcement uses the strength ratio, and the simulator's settings template rejects values of 0 or below. Simulator overrides must use the supported table names.

The weight curve uses base (the configured weight at neutral preference), slope (sensitivity to preference) and flavor (the mapped preference from 0 to 100): `base × 2^(slope × (flavor − 50) / 50)`. For RISK (willingness to accept danger), replace `flavor − 50` with `50 − flavor`. A preference of 50 returns the base exactly. With the default slope, a 50-point increase doubles an ordinary weight and halves the risk weight. Multiplying all stake weights by the same positive factor preserves ordering.

The value parameters are separate constants in `CvTacticalOperationalValue.h`:

| Parameter | Default |
| --- | --- |
| `unitKillShare` (share of unit worth retained until death) | 0.6 |
| `gradeSeniorityPerLevel` (worth premium per level above the first) | 0.1 |
| `gradeUpgradeDiscount` (share of a ready upgrade's worth gain) | 0.5 |
| `gradeUnitScaleFloorUnits` (army-scale floor in typical units) | 3 |
| `gradeCityScaleFloorCities` (city-scale floor in typical cities) | 3 |
| `groundUnitWeight` (ground-base contribution per military unit) | 1 |
| `groundResourceWeight` (strategic or luxury resource weight) | 1 |
| `groundOceanWeight` (ocean weight adjustment) | −0.25 |
| `groundShallowWaterWeight` (coast and lake weight adjustment) | −0.2 |
| `groundImprovementWeight` (ordinary improvement's work value) | 0.1 |
| `groundGreatPersonImprovementWeight` (great person improvement's work value) | 0.25 |
| `groundBonusResourceWeight` (bonus resource's work value) | 0.15 |
| `groundBlockadeShare` (plot stake lost or credited through blockade) | 0.5 |
| `groundCreditShare` (share of excess weight credited for hostile land) | 0.5 |
| `groundCreditFloor` (weight threshold for crediting hostile land) | 1 |

These parameters affect both the shared value functions and the simulator's grade. `floor.prize` (minimum prize share for an enemy unit) belongs to priority settings and can change independently of the living-unit value floor.

## Code

The source is in `civ5-dll/CvGameCoreDLL_Expansion2`.

| Source | Owns |
| --- | --- |
| `CvTacticalOperationalLoop.h` and `.cpp` | Turn integration and scales; settings, mapped flavors and posture and kind offsets; battlefields, threats, offer scoring and selection; readiness, execution, geographic preference blending, aggression and records. |
| `CvTacticalOperationalWeights.h` and `.cpp` | Named weight and constant tables and `ResolveOperationalWeights`. |
| `CvTacticalOperationalValue.h` and `.cpp` | Shared unit, city, exposure and ground values, reference scales, upgrade premium and flavor weight curve. |
| `CvTacticalSearchShared.h` | Declarations exposing the native search globals used by the copies. |

`EstimateBattlefield` calls `GatherLocalSet`, which applies `StrikeReach` and `CanStrikeCity` and fills an `SOperationalLocalSet` with both filters, then calls `EstimateFight` and `EstimateReinforce` for one battlefield. At an enemy city, `StartCityDamage` and `SimulateCityAttack` run the local damage simulation in an `SOperationalCityDamage`, `ExpectedCityHeal` supplies the heal, and the pure functions `AttackFallShare` and `GarrisonShare` turn the totals into shares. `LocalStrength` and `LocalCityStrength` read the strength filter. The command loop's select step ranks ready offers through the pure functions `OfferRank` and `OfferOutranks`.

The Reinforce code sits in the same loop files. `EstimateReinforce` scores an offer, `GatherReinforceCandidates` applies the filters, `SelectReinforcement` fills the selection, `ProjectCityShares` projects the shares at an enemy city and runs the damage extension, `ScoreReinforcement` computes gain, arrival ratio and odds for a selection, `CheckReinforce` runs the reach checks, `ExecuteReinforce` marches the group and `RetiresReinforce` applies the overlap rule. `TravelTurns`, `EnemyCenterStrength`, `IsCapturer`, `CanMarch` and `MarchFlags` are helpers. `SOperationalCandidate` and `SOperationalReinforce` hold a candidate and a battlefield's Reinforce.

Native integration consists of the branch at the top of `CvTacticalAI::ProcessDominanceZones`, the target snapshot in `FindTacticalTargets` and its cleanup, the optional executed-row counter in `TacticalAIHelpers::ExecuteUnitAssignments`, the optional garrison-damage output of `CvTacticalAI::ComputeTotalExpectedDamage` (the garrison damage of every counted attack, kept across a garrison's death), friend access in `CvTacticalAI.h` and `CvDangerPlots.h`, and the non-const `CvPlayer::GetDangerPlots` accessor.

The tactical simulator extracts the loop, weights and value source from the DLL. Three host-specific members have DLL definitions here and separate simulator definitions: `GroundPlotWeight`, `BeginCommand` and `EndCommand`. The simulator also defines its own `SearchAndExecute`, which routes the engagement to its provider with the given flavors, aggression and target distance flag. The DLL reads revealed resource types for `GroundPlotWeight`. The command boundary members are empty in the DLL; the header defines them as the simulator's per-command work boundaries in the battlefield's zone.

### Copies of native functions

Each copy's source comment names its native original so a Vox Populi update can be compared against it. Copies need explicit upkeep when upstream behavior changes.

| Copy | Native original | Change |
| --- | --- | --- |
| `ProcessDominanceZones` | `CvTacticalAI::ProcessDominanceZones` | The turn order described above. |
| `ExecuteEngagement` and `SearchAndExecute` | `TacticalAIHelpers::FindAndExecuteBestUnitAssignments` | Gather geometry, blend flavors and derive aggression before calling native `FindBestUnitAssignments`. Pass the caller's target distance flag. Keep flavors across up to four attempts and report rows counted as run. |
| `GatherSearchPlotZones` | Plot gathering in `FindBestUnitAssignments` | Count geometry by zone, leaving out remote air bases and zone IDs 0 and −1. Take the caller's target distance flag. |
| `ExecuteFight` | `ExecuteDestroyEnemyUnits`, `ExecuteAttackWithUnits`, and the capture follow-up of `ExecuteCaptureCityMoves` | Add endangered recruits, exclude held garrisons from spotting and use the loop's engagement flavors. City fights use the shared offensive readiness rules. Own-city fights branch to `ExecuteCityDefense` after the move label. |
| `RetiresFight` | Suppression geometry in `SortTargetListAndDropUselessTargets` | Apply distance and zone compatibility after execution, with exposure and near-city exemptions. |
| `ExpectedCityHeal` | City heal in `CvCity::doTurn` | Estimate the heal without applying it, assume the city took damage this turn (no tripling), and ignore whether it is currently damaged. |
| `SimulateCityAttack` | City case of `CvTacticalAI::ComputeTotalExpectedDamage`, for one attacker | Use the quick estimate, keep the counted totals in the loop's simulation, count hits on a replacement garrison as city damage only, and skip native's expected-damage bookkeeping on the move list. A suicidal attack changes no garrison state, and a defender predicted to die is not met again. |
| `GetDangerByThreat` | Unit overload of `CvDangerPlotContents::GetDanger` | Preserve the danger total and list each enemy unit's and city's damage contribution. |
| `GatherReinforceCandidates` | Candidate filters in `CvTacticalAI::PlotReinforcementMoves` | Per battlefield instead of per zone, plain-distance bounds at estimate time, no two-unit minimum, enemy-center dominance gates only, and civilian-cover units left out without native's skip and processing. |
| `CanMarch` and `MarchFlags` | Far-out path flags and danger limit in `CvTacticalAI::PositionUnitsAroundTarget` | Safe embark for land units in place of native's two no-embark rules; first-stop danger at half remaining HP (hit points) for attacking non-siege units, otherwise 0. |
| `SearchReachPlots` | One domain of `TacticalAIHelpers::UpdatePlotDistanceToTarget` | The flood stops at 4 steps. |
| `PositionUnitsAroundTarget` | `CvTacticalAI::PositionUnitsAroundTarget` | Called by `ExecuteReinforce`. Run the search through `ExecuteEngagement` after the spotter move, exclude held garrisons from spotting and path moves, and send path moves through `CanMarch` and `MarchFlags`. |
