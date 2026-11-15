# Unit AI: Commands

The **operational loop** coordinates combat and reinforcement across the map during a player's turn. It replaces the zone-by-zone combat pass of [military tactics](../tactics/overview.md): estimate the available actions, check the highest-priority action, execute it, then update priorities from the resulting board. This developer guide describes the DLL (dynamic-link library) implementation. The `VOX_TACTICAL_OPERATIONAL_LOOP` mod option enables it for non-barbarian players and is off by default.

The loop organizes work around **battlefields** (enemy units, enemy cities and our own cities). Each battlefield has two **offers** (proposed actions with a priority and queue state): a fight and **Reinforce** (bringing distant units toward the center). A fight attacks an enemy or defends one of our cities. Both offer types compete in one queue, so the higher-priority action gets access to shared units first.

A ready offer must pass a **readiness check** (whether suitable units or city fire are available) before it executes as a **command** (one action in the turn's sequence). A fight can end after city fire or run an **engagement** (a tactical search and its execution, including retries). Reinforcement commands march the selected units toward the battlefield. Each offer executes at most once per turn, even when search finds no action.

An offer's **estimate** is its queue priority. In these guides, “our” means the acting player, “native” means existing Vox Populi behavior, and HP means hit points.

Start with the command loop below, then follow the part you need to audit:

| Guide | Question it answers |
| --- | --- |
| [Value and priorities](value.md) | What does each formula mean, what are its units and bounds, and how large are its terms? |
| [Recruitment](recruitment.md) | Which units count as local or incoming, how is strength measured, and who gets selected? |
| [Reinforcement priorities](reinforcement.md) | How much does bringing the selected units add, and how does travel reduce that benefit? |
| [Readiness and execution](execution.md) | Can the offer run, what orders does it issue, and how are search preferences chosen? |
| [Settings and reference](reference.md) | Where are the defaults, records, source files and copies of native functions? |

The implementation is primarily in `civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalOperationalLoop.h` and `.cpp`, with shared scoring in `CvTacticalOperationalValue` and weight settings in `CvTacticalOperationalWeights`.

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
2. **Estimate.** Score both offers at every battlefield in one [battlefield estimate](recruitment.md#battlefield-estimate). Positive estimates become ready; nonpositive estimates become inactive. Invalid targets drop both offers.
3. **Select.** Choose the highest ready estimate. Ties favor own-city fights, enemy-city fights, enemy-unit fights, then reinforcement offers. Further ties favor the lower plot index, then build order. End if no offer is ready, or record a stop if the command cap has been reached.
4. **Check.** Check only the selected offer. A failed fight check adds one failure and makes the fight waiting, or skipped at the failure limit. A failed reinforcement check makes the offer inactive or returns it to the queue at a reduced estimate. After a failed check, resume selection. A pass executes one command at its current estimate.
5. **Record and retire.** Mark the offer executed even if it ended before search or found no action. Rebuild threats and retire overlapping offers using the [overlap rules](#overlapping-offers).
6. **Refresh.** Compare the board before and after the command. Add a battlefield for each newly captured city. Re-estimate open offers, apply the [wake rule](#wake-rule) to waiting fights, then resume selection.

The command cap defaults to 64 executed commands. Failed readiness checks consume no command slots, and search retries belong to the same command. Every open offer is re-estimated after every command, including distant offers. These estimates run no native recruitment, path or readiness checks. An executed fight still refreshes its stake (the combined benefits of fighting there) for use by its reinforcement offer.

The loop separates facts fixed for the turn from values refreshed after commands:

| Fixed for the turn | Refreshed after each command |
| --- | --- |
| Weights and reference scales | Fight stakes and open-offer priorities |
| Each battlefield's theater importance and ground term | Theater contest, threat maps and reinforcement selections |
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
| Retired | Another battlefield's executed Reinforce moved a unit, and its enemy-strength tally `T` counted this battlefield's target | The turn ends. |
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
| Theater importance | City value divided by `Z_C` (city scale), capped at 1. Enemy fights use their target zone's city, which can be ours or an enemy's; a zone without a city has none. An own-city fight uses its own city. The [theater multiplier](value.md#theater-multiplier) `θ` combines it with the city's contest, which is refreshed after every command. |
| `ΔG(t)` (normalized ground recovered by removing target unit t) | Local ground score with the target present minus the score with it removed, divided by `B` (ground normalization base). |
| Near our city | Native `GetCityDistanceInPlots` is below 4 at build time. For major civilizations this means within 3 plots of our nearest city. Minors use half the plot distance to their capital, rounded down, so their exemption reaches 7 plots. |

The turn's enemy battlefields stay fixed. A newly revealed enemy can enter danger calculations, city strength and search geometry immediately; it receives an independent battlefield in the next turn's snapshot. Re-estimation follows a surviving target unit's current plot, while its original zone, theater importance, ground term and near-city flag stay fixed. A dead unit or a city lost by its recorded owner drops both open offers of that battlefield.

A city we capture during the turn becomes an own-city battlefield when the command that took it ends. It uses the city's current value and zone; the turn's weights, scales and other battlefields stay as they were. The captured city's enemy-city offer drops under the rule above.

## Overlapping offers

A search centered on one enemy can attack surrounding enemies. After an enemy-unit command runs its search with at least one candidate, `RetiresFight` retires open enemy-unit fights within 2 plots of its target in compatible zones. Opposite zone-ID signs are incompatible: positive land zones and negative water zones do not overlap. Different zones of the same domain can overlap.

These offers are exempt:

- A fight whose target has positive threat damage against our units outside friendly cities and armies. Its own search can recruit those endangered units. Spent units still sustain this exemption.
- A fight marked near our city at build time, using the [native city-distance rule](#battlefields).
- Every enemy-city and own-city fight. These commands also retire no unit fights.

The loop rebuilds threats after execution and before retirement, so a unit moved into danger by the command can protect its attacker's offer. Ready, inactive and waiting offers can be retired; executed, retired, skipped and dropped offers are left alone. Retirement requires the search to have been called with a nonempty group, regardless of whether search found or completed a plan. Commands ending after city fire, visibility failure or greedy air retire nothing.

**Reinforce retirement** uses the enemies counted in the executed offer's last estimate. If at least one selected unit changed plot or died, retire the open reinforcement offer of every other enemy battlefield whose target contributed to `T` (enemy strength). Ready and inactive offers can be retired. Our cities' reinforcement offers are exempt; a command with no such unit change retires nothing.

Retiring an offer leaves its battlefield's other offer intact. Reinforcement commands retire only reinforcement offers, and fights retire only fights.

The examples below use the [value guide's running inputs](value.md#running-example-inputs): town value 15, city scale `Z_C = 40`, typical unit worth `Z_T = 400`, 100 maximum unit HP and neutral weights. Killing a unit earns its [destroyed value](value.md#destroyed-value): its whole living value, 60% of full-health worth plus 40% scaled by remaining HP.

**Near-city example.** Our town is at full health and the enemy matches our local strength, so its theater is `0.2 + 0.8 × (15 / 40) × 0.5 = 0.35`. A scout worth 100 and a catapult worth 500 each have 20 HP, and local units can kill both. Their living values are 68 and 340, and with no ground, relief or exposure term their priorities are `0.35 × 68 / 400 = 0.0595` and `0.35 × 340 / 400 = 0.2975`. The catapult competes first. If its search runs, a surviving scout 2 plots from our town still keeps its own fight, even when within 2 plots of the catapult.

**Waiting-offer example.** In a cityless zone, local units can kill a catapult at full health, worth 500, for priority `0.2 × 500 / 400 = 0.25`, and a spearman at full health, worth 400, for priority 0.2. They stand 1 plot apart, far from our cities, and threaten none of our units. If the catapult fight fails readiness and the spearman fight then runs a search, the catapult fight is retired for the turn. A waiting offer can lose its later try when another search covers it.

## Wake rule

`SnapshotBoard` and `DiffBoard` compare visible hostile-unit identities and plots, city-battlefield owners and our living units' plots before and after each command. `WakesFight` wakes a waiting offer after these helpful changes:

| Change | Distance test |
| --- | --- |
| A visible enemy unit disappears, moves or becomes visible | Its old or new plot is within the turn's largest native land/sea striking-distance scan (`base moves × 4`) of the target, or within 5 plots of our city. |
| A city battlefield changes owner | Its plot is within that same reach. |
| A unit of ours arrives at a new plot and remains available | It is within its own native striking distance (`base moves × 4`) of the target, or within its [strike reach](recruitment.md#battlefield-estimate), base moves plus ranged attack range, of our city. Aircraft and port-changing ships pass this distance test automatically. |
| Our city's re-estimate finds an endangered recruit | Always wakes that own-city fight. |

Native striking distance uses `baseMoves(false) × 4`. The turn's scan takes the largest value among our living land and sea units at turn build. A moved unit uses its own native striking distance at an enemy target and its strike reach at our city. These are distance tests; waking returns a positive-estimate fight to ready so its full readiness check can run again.

Damage to an enemy or city still standing, and our units merely spent, damaged or lost, do not wake fights. Enemy disappearance from visibility also counts as a snapshot change. A helpful change leaves the offer waiting if its refreshed estimate is nonpositive. Other commands add no failures while a fight waits.

**Blocker example.** In a cityless zone, a catapult worth 500 at 50 HP has priority `0.2 × 500 × 0.8 / 4000 = 0.020`. A spearman worth 400 at full health blocks the only approach and has priority 0.012. Place them 3 plots apart, beyond overlap retirement. The catapult fails recruitment once and waits. Commands that only spend or damage our units leave it waiting. When the spearman fight kills the blocker within the scan, the catapult wakes and can pass if the newly open path permits recruitment. If it instead fails after helpful wakeups, its third failed check skips it for the turn.
