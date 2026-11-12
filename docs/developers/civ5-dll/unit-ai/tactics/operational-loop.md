# Unit AI: Operational Loop

The **operational loop** replaces the zone-by-zone combat pass of [military tactics](overview.md) with one command loop per player turn. It is behind the `VOX_TACTICAL_OPERATIONAL_LOOP` mod option, which is off by default, and runs for non-barbarian players. This guide describes its DLL behavior for developers.

Each enemy unit or enemy city target supplies a **battlefield**, a turn-local center with one fight **offer**. An offer holds an estimated priority and a queue state. The loop checks the highest ready offer and, on a pass, executes it as a **command**. A command can end after city fire or run one **engagement**, a tactical search with its retries. Shared units go to the higher-priority fight first. Each offer executes at most once per turn, even when its search finds no action.

The current loop runs enemy fights. Own-city fights and Reinforce commands are outside this implementation.

## Turn under the flag

The loop's copy of `ProcessDominanceZones` keeps the surrounding native passes in order:

1. Global high priority: healing, operation armies and garrisons.
2. Emergency purchases in every zone.
3. The [command loop](#command-loop), through `RunCommandLoop`.
4. Deferred garrison holds, global middle and low priority passes, then the review of unassigned units.

Zone posture routines, zone target extraction and the regular zone reinforcement pass are omitted. Other target types, such as camps, civilians and improvements, remain work for the global passes. Units left unprocessed can pass to Homeland AI as usual. Barbarians keep native scheduling.

## Battlefields

`FindTacticalTargets` scores the native targets and merges the naval list. Under the flag it copies that list into the **target snapshot**, `m_OperationalTargets`, immediately before `SortTargetListAndDropUselessTargets` suppresses nearby enemy-unit targets. Native consumers continue to use the filtered list. `CleanUp` clears the snapshot.

`BuildBattlefields` reads the snapshot after the high-priority pass and emergency purchases. Each surviving hostile enemy combat unit or enemy city supplies one battlefield. A unit target is the plot's best defender, as native reads it; duplicate owner/unit IDs and duplicate city plots are removed. A city captured earlier in the turn gets no battlefield. Hostility follows `GroundSide`, which includes barbarians and players at war with us.

The battlefield stores its build-order ID, center type, target owner and unit or city ID, plot index and target zone ID. It also fixes these facts for the turn:

| Fact | Rule |
| --- | --- |
| Theater `θ` | `floor.theater` plus the target zone city's value divided by our city scale `Z_C`. The zone city can be ours or an enemy's. A zone without a city gets the floor alone. |
| Ground `ΔG(t)` | For a unit target, the local ground score with that unit present less the score with it removed, divided by ground base `B`. |
| Near our city | Native `GetCityDistanceInPlots` is below 4 at build time. For major civilizations this means within 3 plots of our nearest city. Minors use half the plot distance to their capital, rounded down, so their exemption reaches 7 plots. |

The turn's battlefield set stays fixed. A newly revealed enemy can enter danger calculations and search geometry immediately; it receives an independent battlefield in the next turn's snapshot. Re-estimation follows a surviving target unit's current plot, while its original zone, theater, ground term and near-city flag stay fixed. A dead unit or a city lost by its recorded owner has its open offer dropped.

## Value and stakes

Priority is **theater × stake**. A **stake** adds prize, ground and exposure terms for a unit fight, or siege, garrison prize and exposure terms for a city fight. `BuildTurn` resolves the player's weights and reference scales once. `EstimateFight` refreshes open fights from current HP, city values, garrisons and threat shares after each command.

### Value file

`CvTacticalOperationalValue.h` and `.cpp` hold the value functions shared with the simulator's outcome grade. Pure functions take numbers; adapters read native units, cities and plots. Here, HP means hit points, `F` means unit worth, and `s` means damage divided by maximum HP, clamped to 0 to 1. Unit examples use maximum 100 HP unless specified.

| Value | Rule |
| --- | --- |
| Base unit worth | Native unit-type power × production cost, with each input floored at 0. |
| Unit worth `F` | Base worth × `1 + 0.1 × max(0, level − 1)`. Our units also receive the ready-upgrade premium below. Enemy prizes use base worth and level. |
| Living unit value | `F × (0.6 + 0.4 × HP share)`, with HP share clamped to 0 to 1. The retained 0.6 is lost when the unit dies. |
| Exposure `E(u, d)` | The unit's entire current value if incoming damage `d` reaches its remaining HP; otherwise `F × 0.4 × d / max HP`. Nonpositive incoming damage gives 0. |
| City value | `getEconomicValue` as seen by the acting player, or population when economic value is not positive. |
| Ready-upgrade premium | `0.5 × max(0, upgrade base worth − current base worth)` when `CanUpgradeRightNow(true)` passes: the unit is ready to upgrade and the upgrade's tech and project prerequisites are met. Gold, territory, embarkation and unit class limits are not checked. Add this to worth before applying the HP share. |
| Army scale `Z_U` | The greater of our living units' total current value and 3 times the mean base worth of military unit types any of our cities could buy with gold. A type counts when a non-puppet city can train it; gold on hand, the purchase cooldown and building purchase requirements are not checked. The total includes all our units; ground base counts military units separately. |
| City scale `Z_C` | The greater of our cities' total value and 3 times their mean value. With no city of our own, use the mean city value of living, non-barbarian players at war with us for the floor. |
| Ground base `B` | One per living military unit of ours, plus the ground weights of all plots we own. |

`OurUnitWorth`, `TypicalUnitBaseWorth` and `BuildTurn` connect these rules to the board. With no buyable type, typical unit worth is 0; with no own or qualifying enemy city, typical city value is 0. A stake term divided by a nonpositive scale contributes 0.

**Upgrade and scale example.** A level-3 unit with base worth 400 has worth 480. A ready upgrade to base worth 600 adds 100, making its worth 580 and its current value at half HP 464. If our total unit value is 464 and the mean buyable military type has base worth 250, `Z_U` is `max(464, 3 × 250) = 750`. Two cities worth 40 and 20 have total value 60, mean 30 and `Z_C = max(60, 3 × 30) = 90`.

### Ground value

`GroundWeight` starts at 1 and adds plot defense divided by 100. A city plot has defense 100; other plots use terrain and feature defense plus the nonnegative defense of an unpillaged improvement. A revealed strategic or luxury resource adds 1. Ocean subtracts 0.25; coast and lakes subtract 0.2. A city plot or a plot in its effective owning city's work range also adds 0.1 for an improvement, or 0.25 for a great person improvement, and 0.15 for a revealed bonus resource. The improvement's work value applies even when pillaged.

`AddGroundPlot` scores occupation and blockade:

| Plot | Ground score |
| --- | --- |
| Our plot occupied by a hostile holder | Its full weight is lost. |
| Our plot blockaded by a hostile neighbor, with no friendly or neutral holder on the plot | Half its weight is lost. |
| Hostile land without a city, held by our side | Credit half its weight above 1, floored at 0. |
| The same hostile land blockaded by our side, with no hostile or neutral holder on it | Half that credit. |

`GroundSide` treats teammates, master/vassal teams and their allied minors as our side, with hostility taking precedence. `PlotPresence` counts cities and living military holders. Aircraft and embarked units supply no presence. A military unit blockades from a neighboring plot only on the same landmass, in its native domain and outside a city. Cities and garrisons supply no blockade.

`GroundAround` sums lost weight less credit over the owned plots among the target plot and its same-landmass neighbors. Other units remain present when `TargetGround` removes the target for comparison, so a second hostile unit can keep a plot occupied or blockaded.

**Ground example.** A full-HP enemy spearman worth 400 occupies our iron mine on a workable hill. Its weight is `1 + 0.25 + 1 + 0.1 = 2.35`. The spearman alone also blockades three empty plots of ours, two open and one hill, losing another `0.5 × (1 + 1 + 1.25) = 1.625`. With `B = 400`, removing it recovers `ΔG(t) = 3.975 / 400 = 0.0099375`. At neutral weights and `Z_U = 4000`, its prize stake of 0.060 rises to 0.0699375. An equal spearman on plain hostile land with no other ground effect has stake 0.060.

### Fight priority

`ResolveOperationalWeights` applies the [flavor weight curve](#weights-file) to the player's mapped flavors once per turn. Every battlefield gets those same priority weights. Search flavors are resolved separately over each engagement's geometry.

| Fight | Stake before theater |
| --- | --- |
| Enemy unit | `w_A × prize / Z_U + w_G × ΔG(t) + w_R × E_t / Z_U` |
| Enemy city | `w_O × S_c × (floor.siege + s_c) + w_A × garrison prize / Z_U + w_R × E_c / Z_U` |

Here `w_A`, `w_O`, `w_G` and `w_R` are the attrition, occupation, hold-ground and risk weights. City stake `S_c` is city value divided by `Z_C`; `s_c` is its current damage share. An enemy city uses the same city-value scale as our cities. Its garrison uses the unit prize rule.

**Prize** is `F × (floor.prize + (1 − floor.prize) × s)`. The default floor is 0.6. A full-HP knight worth 700 has prize 420; at 30 of 100 HP its prize is `700 × (0.6 + 0.4 × 0.7) = 616`. Damage raises the priority of pursuing the same target. Our units' current value falls with damage under the separate living-value rule.

**Exposure share** assigns each threat part of the value our units stand to lose. `BuildThreats` reads every living, non-air combat unit of ours outside friendly cities and operation armies, including units that have spent their moves or were processed. `GetDangerByThreat` returns the native danger total and the damage attributed to each enemy unit or city. Fog, terrain and improvement damage stay in total danger without being assigned to an enemy.

For each exposed unit, a threat receives `E(u, danger) × threat damage / whole danger`. The implementation uses the greater of whole danger and the sum of positive attributed damage as the denominator. This preserves unattributed damage's share and bounds the assigned total. A city's `E_c` combines its bombardment share and its current garrison's share. Positive threat entries also supply endangered-unit IDs and the overlap exemption, including IDs of units that have already acted. Only execution filters endangered recruits for availability.

**Exposure examples.** A full-HP archer worth 400 facing 30 damage exposes `400 × 0.4 × 30 / 100 = 48`. Three such archers expose 144. If a swordsman deals all of it, its exposure term at `Z_U = 4000` is 0.036. If a swordsman deals 25 damage to each and a scout 5, their terms are 0.030 and 0.006. If one archer instead faces 10 enemy damage and 30 from fog and terrain, its exposure is 64 and that enemy receives `64 × 10 / 40 = 16`, one quarter of the exposure. Attributed shares sum to total exposure when all damage is attributed.

**Endangered-unit example.** A full-HP knight worth 700 can kill our 40-HP archer worth 400 and deal 30 damage to our full-HP spearman worth 400. Nothing else threatens them. With neutral weights and `Z_U = 4000`, the knight's prize term is 0.105, the archer's exposure term is `400 × (0.6 + 0.4 × 0.4) / 4000 = 0.076`, and the spearman's is 0.012. The stake is 0.193, giving priority 0.0386 in a cityless zone. A search can attack the knight, retreat the archer or hold the spearman according to its own scoring.

### Theater and worked priorities

Theater is `floor.theater + zone city value / Z_C`, with default floor 0.2. It scales the whole stake by the assets in the zone. Cityless zones retain positive theater. Operation-target and focus-area bonuses add no priority factor.

The following variations use sample reference scales `Z_U = 4000` and `Z_C = 90`, neutral mapped flavors and default weights. Units have maximum 100 HP, cities 250 HP, and ground and exposure terms are 0 unless listed. The city values and unit worths are supplied inputs; calculations retain full precision until the displayed result.

| Zone city | City value | Theater |
| --- | --- | --- |
| Our capital | 40 | `0.2 + 40 / 90 ≈ 0.644444` |
| Our town | 15 | `0.2 + 15 / 90 ≈ 0.366667` |
| Enemy border city | 20 | `0.2 + 20 / 90 ≈ 0.422222` |
| Large enemy city | 45 | `0.2 + 45 / 90 = 0.7` |
| No city | None | 0.2 |

| Offer | Stake | Priority |
| --- | --- | --- |
| Border city worth 20 at 5 HP, no garrison | `(20 / 90) × (0.2 + 0.98) ≈ 0.262222` | 0.110716 |
| Large city worth 45 at full HP, no garrison | `(45 / 90) × 0.2 = 0.100` | 0.070000 |
| Full-HP spearman worth 400 in our capital's zone | `400 × 0.6 / 4000 = 0.060` | 0.038667 |
| Knight worth 700 at 30 HP in a cityless zone | `616 / 4000 = 0.154` | 0.030800 |
| Full-HP swordsman worth 600 threatening the three archers above, in a cityless zone | `600 × 0.6 / 4000 + 144 / 4000 = 0.126` | 0.025200 |

The same spearman at half HP has stake 0.080 and priority 0.051556 at the capital. The large city at half HP has stake 0.350 and priority 0.245. Adding a full-HP garrison worth 400 to that city adds 0.060 to stake, or 0.042 to priority. Its exposure share adds a further term when it threatens our units.

Raising mapped ATTRITION to 80 gives weight `2^0.6 ≈ 1.515717`. The full-HP capital spearman rises to priority 0.058608; the swordsman rises to 0.034483 because only its prize term uses attrition. Raising OCCUPATION to 70 instead gives weight `2^0.4 ≈ 1.319508` and border-city priority 0.146091.

The siege floor gives an undamaged city a stake even when recruitment would make little progress. In the large city's zone, that full-HP city has priority 0.070 and a nearby full-HP swordsman worth 600 has priority 0.063. With positive expected damage, the city fight can run first and its search can attack either target. Setting `floor.siege` to 0.1 would lower the city's priority to 0.035. Expected damage and attack cost enter readiness and search; the priority formula uses the stakes above.

## Command loop

`RunCommandLoop` performs these steps:

1. Build the turn's settings, mapped flavors, weights and reference scales; build battlefields and threat maps.
2. Estimate every fight once. Positive estimates become ready; zero or negative estimates become inactive; invalid targets are dropped.
3. Select the highest ready estimate, with ties going to enemy cities, then lower plot index, then build order. If no offer is ready, end. If the command cap has been reached, record that stop and end.
4. Check only that offer's readiness. A failure adds one to its failure count and makes it waiting, or skipped at the failure limit. Resume selection. A pass executes one command at its current estimate.
5. Mark the offer executed even if it ended before search or found no action. Rebuild threats from the resulting board and retire overlapping fights.
6. Compare board snapshots, re-estimate every open fight and apply the wake rule to waiting fights. Resume selection.

The command cap defaults to 64 executed commands. A failed readiness check consumes no command slot. Search retries belong to one command. Every open fight is re-estimated after every command, including distant ones; these estimate passes issue no recruitment or readiness checks. Weights, reference scales, theater and ground stay fixed for the turn.

### Offer states

| State | Enters when | Leaves when |
| --- | --- | --- |
| Ready | An opening or later estimate is positive, with any waiting requirement satisfied | It reaches the top and is checked. |
| Inactive | Its estimate is nonpositive | A later estimate is positive. |
| Waiting | A readiness check fails below the failure limit | A helpful command change wakes it and its new estimate is positive, or re-estimation drops its target. |
| Skipped | It reaches `readiness.maxFailures` failures, default 3 | The turn ends. |
| Retired | An executed unit fight covers it under the overlap rule | The turn ends. |
| Executed | It runs as a command | The turn ends. |
| Dropped | Re-estimation finds the target unit gone or its city lost by its recorded owner | The turn ends. |

A waiting fight keeps its refreshed estimate and cumulative failure count. Waking it preserves that count. The readiness result only passes or fails the offer; its estimate is the priority it executes at. The loop applies no retry discount to that estimate.

## Readiness checks

`CheckFight` uses native recruitment and expected damage without issuing orders. For a unit fight, a living best defender must remain on the target plot. An eligible city strike passes immediately. Otherwise both unit and city fights require `FindUnitsWithinStrikingDistance` to find recruits and `ComputeTotalExpectedDamage` to return a positive total. A city at 1 HP or less also needs a capture-capable recruit.

Each check records `passed`, or the first failed condition in this order:

| Result | Condition |
| --- | --- |
| Target gone | The plot is missing, or a unit target's plot has no living best defender, for example after the target died or left. |
| No recruits | Native recruitment finds no eligible unit of ours that can still act within striking distance. |
| No damage | The recruited units have no positive total expected damage. |
| No capturer | A city at 1 HP or less has no recruited combat unit that is melee, has moves and an attack left, and has no capture prohibition. |
| Passed | The applicable checks pass, including the immediate city-strike pass for a unit fight. |

Native recruitment reads the current tactical roster and its eligibility rules. **Available** means the unit passes `canUseNow`: moves left, unprocessed and not dying. Recruitment can include ranged units that can reach a firing position but only shoot next turn, and nearby units within 2 plots even when blocked. A pass can therefore lead to positioning. Support recruits such as generals contribute no damage. Endangered units added only during execution cannot make readiness pass; an endangered unit already in offensive recruitment contributes normally.

City fights use this damage check regardless of zone posture, native zone dominance or the native 13-turn siege-viability check. Their search aggression comes from RISK. The capture-role test applies to the offensive recruits before endangered additions.

**City-strike-only command.** A spearman stands within bombard range of our city and no unit can join. Readiness passes because the city can strike. The command fires, then ends when recruitment fails or expected damage is 0. A city-fire kill also ends the command. Both consume one command slot and retire no overlapping offers.

**Capture-role wait.** A city at 1 HP has ranged recruits with positive expected damage and no recruit able to capture. Its fight records `no capturer` and waits. A later command that moves an available melee capturer into recruitment distance can wake it. It must pass recruitment, positive damage and the capture-role check on its next try.

## Execution

`ExecuteFight` follows the native attack path with endangered recruits and the loop's search flavors. It first sets the **move label** that native records on each unit the fight finishes, so tactical move and kill statistics read as they do in native rather than carrying over the garrison pass's label. The label is the one native's routine for the battlefield zone's posture sets, for example `AI_TACTICAL_STEAMROLL` in a Steamroll zone. A zone with no posture falls back to `AI_TACTICAL_SURGICAL_STRIKE` for a city fight and `AI_TACTICAL_ATTRITION` for a unit fight.

1. **City strike**, for a unit target. Eligible cities fire first. A kill ends the command.
2. **Offensive recruitment.** Re-run native recruitment and expected damage against the surviving target. With no recruit or no expected damage, end the command after city fire.
3. **Endangered recruitment.** Add available units outside armies from the target's threat map. A city fight includes units threatened by the city and its garrison. Deduplicate both the endangered list and the combined search candidates. Units marked unnecessary by native's offensive estimate are initially left out of that candidate list; eligible endangered units can still enter through their threat entry.
4. **Spotter move.** Try to improve visibility using the candidates, excluding held garrisons. If the target stays unseen, skip search.
5. **Aircraft.** With air search enabled, add recruited sweepers and available carriers of recruited aircraft, then plan them with the other units. Otherwise run native greedy sweeps and air strikes first. An air kill of a unit target skips search.
6. **Final search group and flavors.** Keep candidates still available after spotter and air actions, with aircraft included only under air search. A nonempty group runs `ExecuteEngagement`: gather geometry, blend flavors with the unit-fight or city-fight row, derive aggression, then search and execute with up to four attempts. Empty groups end without search.
7. **City follow-up.** After reaching the attack path for a city, delete its focus area if captured, then find embarked recruits within 4 plots and run the native landing operation when any are found.

A **held garrison** is a garrison the high-priority pass left unprocessed. Offensive recruitment can include it and search can move it; the preliminary spotter move excludes it.

### Flavors and aggression

The search resolves five [military flavors](../flavors/overview.md), each on a 0 to 100 scale: RISK, OCCUPATION, ATTRITION, HOLD_CITY and HOLD_GROUND. Priority weights use the turn's mapped flavors; an engagement's search uses the geographic blend below. A civ modifier can change how a fight searches without changing its place in the queue.

#### Mapped flavors

`OPERATIONAL_VP_TERMS` maps Vox Populi flavors into the five military slots. Each term adds its weight times the input's deviation from neutral 50. Results are rounded and clamped to 0 to 100. A missing required flavor makes all five slots fall back to 50; any unmapped slot also gets 50.

| Input layer | What it reads |
| --- | --- |
| Active | The flavor as the flavor manager holds it now, mapped to the 0 to 100 scale. |
| Personality | The leader's base value, or the active custom value. |
| Intent | Neutral 50 plus the grand strategy's contribution, or the active custom value. |
| Strategy | The active strategies' contribution, centered on 50. |

Vox Deorum custom flavors enter these readings, so strategists steer the mapped flavors. A leader without its own `FLAVOR_RISK` reads RISK from `FLAVOR_OFFENSE`. An active custom RISK supplies the player's own value.

#### Geographic blend

`GatherSearchPlotZones` gathers the search geometry for the available candidates before the participant cap: visible plots around the target, extra room around enemies and the surroundings of accepted non-air units. Remote aircraft bases add no plots. Zone IDs 0 and −1 are omitted from the blend.

`BlendEngagementFlavors` resolves flavors in this order:

1. In each contributing zone, apply native civ, operation and zone modifiers to the mapped flavors, without search-intent defaults, then add that zone's posture row.
2. Average these vectors by their plot counts. With no contributing zone, start with the mapped flavors.
3. Add the command's kind row, clamp to 0 to 100 and round once.
4. Choose the **representative zone**, the zone with the most plots; ties go to the lower zone ID.

RISK always counts as set for danger scoring. With mapped RISK 50 and no modifiers, a unit fight covering 60% Hedgehog and 40% Steamroll plots gets `50 + 0.6 × (−15) + 0.4 × 10 = 45`. A city fight over the same plots gets 55. A unit fight wholly in a Withdraw zone gets 20 and can still run. Posture supplies flavor offsets while readiness determines whether the fight can execute.

#### Aggression from RISK

`AggressionFromRisk` maps blended RISK to the search's aggression level. Retries keep the engagement's resolved flavors and aggression.

| RISK with default thresholds | Level |
| --- | --- |
| Below 40 | Low |
| 40 to 59 | Medium |
| 60 to 89 | High |
| 90 and above | Braveheart |

### Search dispositions

Each endangered recruit receives a **disposition** from the rows counted as run across search attempts:

| Disposition | Rule |
| --- | --- |
| Placed | A move, attack, pillage or other action row counted as run. Finish, temporary finish, heal and wait rows count only in an attempt that completed. |
| Free | No qualifying row ran. Initial, restart and blocked rows do not place a unit; planned rows beyond a stopped attempt do not count. |

The native row counter includes a row whose precondition passed even when its outcome stopped replay. A unit omitted by the search or cut by its participant cap remains free under this rule. The native cap is 13, or 19 with air search enabled. Disposition records search placement; `canUseNow` independently determines whether a later command can recruit the unit. Spotter and greedy air effects precede search-row accounting.

**Stopped-attempt example.** A plan moves a spearman before an archer. Execution stops after the spearman and retries never reach the archer's move. The spearman is placed; the archer is free. A successfully completed hold also places a unit, including a spearman left available to heal on its hill.

Native replay processing still applies. A successful replay processes finished ground and naval units unless they should heal and still have moves. Aircraft finishes process only aircraft that attacked and used up their attacks. Blocked units and units never reached by a plan stay available when their unit state permits. Free endangered units can join later commands; units left unprocessed after the tactical turn pass to Homeland AI. Its `PlotMovesToSafety` normally moves military units when danger reaches remaining HP, with a separate earlier border-clearing rule for siege units. The loop issues no withdrawal command of its own.

## Overlapping offers

A search centered on one enemy can attack surrounding enemies. After an enemy-unit command runs its search with at least one candidate, `RetiresFight` retires open enemy-unit fights within 2 plots of its target in compatible zones. Opposite zone-ID signs are incompatible: positive land zones and negative water zones do not overlap. Different zones of the same domain can overlap.

These offers are exempt:

- A fight whose target has positive threat damage against our units outside friendly cities and armies. Its own search can recruit those endangered units. Spent units still sustain this exemption.
- A fight marked near our city at build time, using the [native city-distance rule](#battlefields).
- Every city fight. City commands also retire no unit fights.

The loop rebuilds threats after execution and before retirement, so a unit moved into danger by the command can protect its attacker's offer. Ready, inactive and waiting offers can be retired; executed, retired, skipped and dropped offers are left alone. Retirement requires the search to have been called with a nonempty group, regardless of whether search found or completed a plan. Commands ending after city fire, visibility failure or greedy air retire nothing.

**Near-city example.** In our town's zone, use theater `0.2 + 15 / 90` and `Z_U = 4000`. A scout worth 100 and catapult worth 500 each have 20 HP, making their prize share 0.92. With no ground or exposure term, their priorities are 0.008433 and 0.042167. The catapult competes first. If its search runs, a surviving scout 2 plots from our town still keeps its own fight, even when within 2 plots of the catapult.

**Waiting-offer example.** In a cityless zone, a full-HP catapult worth 500 has priority 0.015 and a full-HP spearman worth 400 has priority 0.012. They stand 1 plot apart, far from our cities, and threaten none of our units. If the catapult fight fails readiness and the spearman fight then runs a search, the catapult fight is retired for the turn. A waiting offer can lose its later try when another search covers it.

## Wake rule

`SnapshotBoard` and `DiffBoard` compare visible hostile-unit identities and plots, city-battlefield owners and our living units' plots before and after each command. `WakesFight` wakes a waiting offer after these helpful changes:

| Change | Distance test |
| --- | --- |
| A visible enemy unit disappears, moves or becomes visible | Its old or new plot is within the turn's largest land/sea striking-distance scan of the target. |
| A city battlefield changes owner | Its plot is within that same scan. |
| A unit of ours arrives at a new plot and remains available | It is within its own striking distance of the target. Aircraft and port-changing ships pass this distance test automatically. |

The scan is the largest `baseMoves(false) × 4` among our living land and sea units at turn build. Our moved unit's distance test uses its own `baseMoves(false) × 4`. These are distance tests; waking returns a positive-estimate fight to ready so its full readiness check can run again.

Damage to an enemy or city still standing, and our units merely spent, damaged or lost, do not wake fights. Enemy disappearance from visibility also counts as a snapshot change. A helpful change leaves the offer waiting if its refreshed estimate is nonpositive. Other commands add no failures while a fight waits.

**Blocker example.** In a cityless zone, a 50-HP catapult worth 500 has priority `0.2 × 500 × 0.8 / 4000 = 0.020`. A full-HP spearman worth 400 blocks the only approach and has priority 0.012. Place them 3 plots apart, beyond overlap retirement. The catapult fails recruitment once and waits. Commands that only spend or damage our units leave it waiting. When the spearman fight kills the blocker within the scan, the catapult wakes and can pass if the newly open path permits recruitment. If it instead fails after helpful wakeups, its third failed check skips it for the turn.

## Records

`RunCommandLoop` can fill an `SOperationalTurnRecord`. When no record is supplied and both game logging and AI logging are enabled, it writes tactical messages for checks, executed commands and a command-cap stop. Each check message names its result. Command messages identify the command, battlefield and plot, whether search ran and how many fights were retired.

| Turn field | Content |
| --- | --- |
| `commands` | Executed command records, in order. |
| `checks` | Every readiness check: `iBattlefield` and `eResult`, including passed checks and the first failed condition. |
| `vSkipped` | Battlefield IDs skipped at the readiness failure limit. |
| `bCommandCap` | True when the cap stops selection while a ready offer remains. |

Each `SOperationalCommandRecord` contains:

| Field | Content |
| --- | --- |
| `iCommand` | Zero-based command position in this turn. |
| `iBattlefield`, `iPlotIndex` | Battlefield ID and target plot at execution. |
| `eKind`, `eOwner` | Unit-fight or city-fight kind and target owner. |
| `fEstimate` | The command's single priority field: the estimate it ran at. Readiness supplies a pass/fail result. |
| `iFailuresBefore` | Cumulative readiness failures before execution. |
| `bSearchRan` | Execution called the engagement search with a nonempty group. |
| `vRetired` | IDs of fights this command retired. |
| `vEndangered` | Endangered recruit IDs paired with a boolean: true for placed, false for free. |

`SOperationalStake` keeps the weighted and scaled prize, ground, exposure, siege and garrison-prize components and their sum on the battlefield. `SOperationalTurn` holds mapped flavors, resolved weights, fixed scales, threat maps and battlefields during execution. The local `SOperationalEngagementReport` holds zone plot counts, representative zone, final flavors, aggression and overall success. Each attempt holds its planned rows, rows counted as run and completion status. `ExecuteFight` uses the attempt report to derive the command's dispositions.

## Settings

`GetOperationalSettings` fills a settings struct for the player from game defines and constant tables. The DLL runs those defaults. The simulator can replace settings per player. Table changes require editing their source and rebuilding; the row tables have compile-time size checks.

| Setting | Default | Source |
| --- | --- | --- |
| `VOX_TACTICAL_OPERATIONAL_LOOP` | 0 | `NewCustomModOptions.xml` |
| Command cap, `iMaxCommands` | 64 | `VOX_OPERATIONAL_MAX_COMMANDS` |
| Medium, High, Braveheart RISK thresholds | 40, 60, 90 | `VOX_OPERATIONAL_AGGRESSION_MEDIUM_RISK`, `VOX_OPERATIONAL_AGGRESSION_HIGH_RISK`, `VOX_OPERATIONAL_AGGRESSION_BRAVEHEART_RISK` |
| Posture and kind offsets | Tables below | `CvTacticalOperationalLoop.cpp` |
| Priority weights, slopes and constants | [Weights file](#weights-file) | `CvTacticalOperationalWeights.cpp` |

The game defines are in `(1) Community Patch/Database Changes/Defines/CoreDefineChanges.sql`. The mod option is in `(1) Community Patch/Database Changes/NewCustomModOptions.xml`, both under `civ5-dll/`.

### Posture rows and kind rows

Offsets are flavor points in the order RISK / OCCUPATION / ATTRITION / HOLD_CITY / HOLD_GROUND. Posture rows are added per contributing zone; kind rows are added after the blend.

| Posture | Row |
| --- | --- |
| None | 0/0/0/0/0 |
| Withdraw | -30/-20/0/+10/-10 |
| Attrition | -20/0/+20/0/0 |
| Exploit flanks | -10/0/+10/0/0 |
| Steamroll | +10/+5/+15/-10/-10 |
| Surgical city strike | 0/+15/-5/-10/-10 |
| Hedgehog | -15/-15/+10/+20/0 |
| Counterattack | -10/-10/+15/0/+20 |

| Active command kind | Row |
| --- | --- |
| Unit fight | 0/0/0/0/0 |
| City fight | +10/+15/-25/-5/-5 |

The unit-fight rows follow native's posture rows, with Hedgehog RISK lowered from −10 to −15. The city row is derived from native CityAssault minus the mean of its assault posture rows, rounded to 5. A Withdraw posture still supplies its row when a fight covers that zone. The loop has no separate Withdraw command kind or `WithdrawUnitToward` helper.

### Weights file

`CvTacticalOperationalWeights.h` and `.cpp` hold the tunable numbers. Names in the tables are also the names for simulator overrides. `ResolveOperationalWeights` turns base weights and mapped flavors into the turn's weights through `FlavorWeight` in the value file.

| Setting | Default | Scaling or use |
| --- | --- | --- |
| `weight.attrition` | 1 | Increases with ATTRITION; scales target and garrison prizes. |
| `weight.occupation` | 1 | Increases with OCCUPATION; scales city siege stake. |
| `weight.holdCity` | 1 | Increases with HOLD_CITY; retained in the table. |
| `weight.holdGround` | 1 | Increases with HOLD_GROUND; scales unit-target ground. |
| `weight.risk` | 1 | Decreases with RISK; scales exposure. |
| `slope.RISK`, `slope.OCCUPATION`, `slope.ATTRITION`, `slope.HOLD_CITY`, `slope.HOLD_GROUND` | 1 each | Exponent slope for each flavor's weight. |
| `floor.theater` | 0.2 | Theater in a zone without a city. |
| `floor.siege` | 0.2 | Starting siege stake of an undamaged city. |
| `floor.prize` | 0.6 | Share of unit worth in a full-HP target's prize. |
| `readiness.maxFailures` | 3 | Truncated to an integer and floored at 1 for the failure limit. |
| `point.safeBar` | 2/3 | Retained table constant. |
| `point.capitalPremium` | 1 | Retained table constant. |

Enemy-fight stakes use attrition, occupation, hold-ground and risk weights. `weight.holdCity`, `point.safeBar` and `point.capitalPremium` have no consumer in those stakes. The removed `gate.retryFactor` has no table row; failed fights wait at their current estimate.

The weight curve is `base × 2^(slope × (flavor − 50) / 50)`, reversed to `50 − flavor` for RISK. Flavor 50 returns the base exactly. With default slope, a 50-point increase doubles an ordinary weight and halves the risk weight. Multiplying all stake weights by the same positive factor preserves ordering.

The value parameters are separate constants in `CvTacticalOperationalValue.h`:

| Parameter | Default |
| --- | --- |
| `unitKillShare` | 0.6 |
| `gradeSeniorityPerLevel` | 0.1 |
| `gradeUpgradeDiscount` | 0.5 |
| `gradeUnitScaleFloorUnits`, `gradeCityScaleFloorCities` | 3 each |
| `groundUnitWeight`, `groundResourceWeight` | 1 each |
| `groundOceanWeight`, `groundShallowWaterWeight` | -0.25, -0.2 |
| `groundImprovementWeight`, `groundGreatPersonImprovementWeight`, `groundBonusResourceWeight` | 0.1, 0.25, 0.15 |
| `groundBlockadeShare`, `groundCreditShare`, `groundCreditFloor` | 0.5, 0.5, 1 |

These parameters affect both the shared value functions and the simulator's grade. `floor.prize` belongs to priority settings and can change independently of the living-unit value floor.

## Code

The source is in `civ5-dll/CvGameCoreDLL_Expansion2`.

| Source | Owns |
| --- | --- |
| `CvTacticalOperationalLoop.h` and `.cpp` | Settings, mapped flavors, posture and kind rows, geographic blend, aggression, turn scales, battlefields, threats, offers, command execution and minimal records. |
| `CvTacticalOperationalWeights.h` and `.cpp` | Named weight and constant tables and `ResolveOperationalWeights`. |
| `CvTacticalOperationalValue.h` and `.cpp` | Shared unit, city, exposure and ground values, reference scales, upgrade premium and flavor weight curve. |
| `CvTacticalSearchShared.h` | Declarations exposing the native search globals used by the copies. |

Native integration consists of the branch at the top of `CvTacticalAI::ProcessDominanceZones`, the target snapshot in `FindTacticalTargets` and its cleanup, the optional executed-row counter in `TacticalAIHelpers::ExecuteUnitAssignments`, friend access in `CvTacticalAI.h` and `CvDangerPlots.h`, and the non-const `CvPlayer::GetDangerPlots` accessor.

The tactical simulator extracts the loop, weights and value source from the DLL. Four host-specific members have DLL definitions here and separate simulator definitions: `TypicalUnitBaseWorth`, `GroundPlotWeight`, `BeginCommand` and `EndCommand`. The DLL reads purchase eligibility and revealed resource types for the first two. The command boundary members are empty in the DLL; the header defines them as the simulator's per-command work boundaries in the battlefield's zone.

### Copies of native functions

Each copy's source comment names its native original so a Vox Populi update can be compared against it. Copies need explicit upkeep when upstream behavior changes.

| Copy | Native original | Change |
| --- | --- | --- |
| `ProcessDominanceZones` | `CvTacticalAI::ProcessDominanceZones` | The turn order described above. |
| `ExecuteEngagement` and `SearchAndExecute` | `TacticalAIHelpers::FindAndExecuteBestUnitAssignments` | Gather geometry, blend flavors and derive aggression before calling native `FindBestUnitAssignments`. Keep flavors across up to four attempts and report rows counted as run. |
| `GatherSearchPlotZones` | Plot gathering in `FindBestUnitAssignments` | Count geometry by zone, leaving out remote air bases and zone IDs 0 and −1. |
| `ExecuteFight` | `ExecuteDestroyEnemyUnits`, `ExecuteAttackWithUnits`, and the capture follow-up of `ExecuteCaptureCityMoves` | Add endangered recruits, exclude held garrisons from spotting and use the loop's engagement flavors. City fights use the shared offensive readiness rules. |
| `RetiresFight` | Suppression geometry in `SortTargetListAndDropUselessTargets` | Apply distance and zone compatibility after execution, with exposure and near-city exemptions. |
| `GetDangerByThreat` | Unit overload of `CvDangerPlotContents::GetDanger` | Preserve the danger total and list each enemy unit's and city's damage contribution. |
| `PositionUnitsAroundTarget` | `CvTacticalAI::PositionUnitsAroundTarget` | Currently uncalled support copy with supplied flavors and aggression, held-garrison exclusions and safe-embark path flags. |
