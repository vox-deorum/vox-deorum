# Unit AI: Commands

The **operational loop** coordinates combat, reinforcement, withdrawal and combat army movement across the map during a player's turn. It replaces the zone-by-zone combat pass of [military tactics](../tactics/overview.md), giving higher-priority work access to shared units first. With Army March enabled, it also takes over the native movement pass for land, naval and combined combat armies. This developer guide describes the DLL (dynamic-link library) implementation, enabled for non-barbarian players by `VOX_TACTICAL_OPERATIONAL_LOOP` (0, off by default).

```mermaid
flowchart TD
    B["Build battlefields<br/>enemy targets, camps, our cities and armies"] --> E["Estimate<br/>Fight, Reinforce, Withdraw and Army March offers"]
    E --> S["Select highest ready priority"]
    S --> C{"Readiness passes?"}
    C -->|No| S
    C -->|Yes| X["Execute one command"]
    X --> R["Retire overlap<br/>refresh threats and estimates"]
    R --> S
    S -->|No ready offer or command cap| F["Finish"]
```

| Term | Meaning |
| --- | --- |
| **Battlefield** | A queue row centered on an enemy unit, a city, a known camp without a visible guard, or a prepared combat army. |
| **Offer** | A proposed action with a queue state and an **estimate**, its queue priority. **Fight** attacks an enemy, defends our city or claims a camp this turn. **Reinforce** moves units toward the center; **Withdraw** pulls them toward a friendly city; **Army March** advances a prepared army. |
| **Readiness check** | Confirms suitable recruits, damage or reach before issuing orders. |
| **Command** | One passing offer's execution. Each offer runs at most once per turn, even when it finds no action. |
| **Engagement** | Tactical search and execution, including retries. A fight can end after city fire; a Reinforce, Withdraw or Army March command can also march units along paths. |
| Our, native, HP | The acting player; existing Vox Populi behavior; hit points. |

Start with the command loop below, then follow the part you need to audit:

| Guide | Question it answers |
| --- | --- |
| [Value and priorities](value.md) | What does each formula mean, what are its units and bounds, and how large are its terms? |
| [Recruitment](recruitment.md) | Which units count as local or incoming, how is strength measured, and who gets selected? |
| [Reinforcement priorities](reinforcement.md) | How much does bringing the selected units add, and how does travel reduce that benefit? |
| [Withdrawal priorities](withdrawal.md) | When is pulling local units back worth more than fighting, and where do they go? |
| [Army March](march.md) | How does a combat army move, when does it advance or hold, and when does it yield? |
| [Readiness and execution](execution.md) | Can the offer run, what orders does it issue, and how are search preferences chosen? |
| [Settings and reference](reference.md) | Where are the defaults, records, source files and copies of native functions? |

The implementation is primarily in `civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalOperationalLoop.h` and `.cpp`, with shared scoring in `CvTacticalOperationalValue` and weight settings in `CvTacticalOperationalWeights`.

## Shared callbacks

The simulator can supply an **operational provider** through host callbacks; `CvTacticalOperationalLoop` owns their timing and execution. Requests carry decision identities and state revisions.

| Decision | When | DLL's native choice |
| --- | --- | --- |
| Command choice | Before each readiness check, including after a failed check | Highest ready priority, with the [queue tie breaks](#command-loop). |
| Participant admission | After readiness, before recruits act | The checked participants for the command, including the single recruit for a camp claim. A provider can retain the selection or request a candidate subset. See [admission and refusal](execution.md#participant-admission). |
| Search flavors | After spotting and greedy air, using the final geometry | Geographic flavor blend plus command-kind row. See [search preferences](execution.md#geographic-blend). |

The simulator's supplied adapter builds a separate menu from the acting player's permitted knowledge. It maps selected objectives to live battlefields and walks ranked replies through these readiness checks, stopping at the first pass. Missing mappings and failed checks are execution feedback. Native decoding keeps the queue above, including when the supplied reply delegates to native.

## Turn integration

The loop's copy of `ProcessDominanceZones` keeps the surrounding native passes in order:

1. Global high priority: healing, operation armies and garrisons. In this pass `PlotOperationalArmyMoves` prepares land, naval and combined combat armies for the loop when `march.enabled` is nonzero. Other operations move natively.
2. Emergency purchases in every zone.
3. The [command loop](#command-loop), through `RunCommandLoop`, for fights, Reinforce, Withdraw and Army March. When the loop ends, `FinishPreparedArmies` runs the safety move and native finish of every army it prepared.
4. Deferred garrison holds, global middle and low priority passes, then the review of unassigned units.

Battlefield reinforcement replaces the zone reinforcement pass. The loop skips per-zone target extraction and replaces the zone posture routines and the native camp pass. Global passes still handle ruins, civilians, improvements and other targets. Units left unprocessed can pass to Homeland AI. Barbarians keep native scheduling.

With `march.enabled` at 0, no army is prepared and every operation keeps its native movement. No army battlefields exist, and recruitment and discovery behave as they did before Army March. See [Army March](march.md#enablement-and-turn-integration).

## Command loop

`RunCommandLoop` owns the turn's action queue. It builds the initial estimates, executes one ready offer at a time, and uses each command's result to update the remaining work:

| Stage | Rule |
| --- | --- |
| Build | Resolve settings, **mapped flavors** (player preferences on military scales), **weights** (relative importance of benefits) and **reference scales** (normalization values). Build battlefields and threat maps, which attribute damage to enemy units and cities. |
| Estimate | A [battlefield estimate](recruitment.md#battlefield-estimate) shares the local scan, theater and **stake** (combined fight benefits) needed by open offers. Closed cities still refresh theater. Positive estimates become ready, nonpositive estimates inactive; waiting fights also need a helpful change. Invalid targets drop every open offer. |
| Select | Highest ready estimate first. Ties favor own-city Fight, enemy-city Fight, unit and camp Fight, Reinforce, Withdraw, then Army March. Further ties favor lower plot index, then build order. Stop with no ready offer or at the command cap. |
| Check | Check only the selected offer. A failed fight check makes it waiting or skipped at the failure limit. Reinforce goes inactive if its target is gone, no recruit passes the reach check, or the selected group falls short of the required strength at a target other than one of our cities. Withdraw goes inactive or skipped at the failure limit if it cannot find a group with positive priority. Army March drops when its prepared order is gone and goes inactive if the order no longer matches, no member has a stop to propose, or the new priority is zero. A reduced offer competes again at its lower positive priority without using a failure attempt. A passing offer executes at its checked estimate. |
| Record and retire | Close the offer even if it ended before search or found no action. Explicit refusal consumes the slot without retiring other offers. Rebuild threats, then apply the [overlap rules](#overlapping-offers). |
| Refresh | Compare the board before and after the command, add newly captured own-city battlefields, re-estimate open offers and apply the [wake rule](#wake-rule). Resume selection. |

The command cap, `iMaxCommands` (64), includes refused commands. Failed readiness checks consume no slots, and search retries belong to the same command. An Army March counts no readiness failures: its check passes, returns at a reduced estimate, turns inactive or drops. A yield spends a command slot and leaves the offer ready for the next estimate. Every open offer is re-estimated after every command, including distant offers, without native recruitment, path or readiness checks. A closed fight still refreshes its stake while its Reinforce or Withdraw remains open.

The loop separates facts fixed for the turn from values refreshed after commands:

| Fixed for the turn | Refreshed after each command |
| --- | --- |
| Weights and reference scales | Fight stakes and open-offer priorities |
| City battlefields' theater importance and every battlefield's ground term | Theater contest, threat maps and reinforcement selections |
| Original enemy battlefields and their zone and near-city flags | Surviving unit targets' plots and newly captured own-city battlefields |
| Prepared armies, their operation and army IDs, and their stable row order | Army waypoints and zones, March priorities, and targets discovered after the command |
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
| Executed | It runs as a command without provider refusal | The turn ends. |
| Refused | A provider chooses an empty subset from nonempty eligibility | The turn ends; the command slot is consumed and no other offer is retired. |
| Dropped | Re-estimation finds the target unit gone, or its city lost by its recorded owner or no longer ours | The turn ends. |

A Reinforce offer uses these states:

| State | Enters when | Leaves when |
| --- | --- | --- |
| Ready | An opening, later or reduced check estimate is positive | It reaches the top and is checked: executes, is refused, turns inactive, or returns ready at a reduced estimate. |
| Inactive | Its estimate is nonpositive, or its check leaves no selected unit or reduces the estimate to 0 | A later estimate is positive. |
| Retired | Another battlefield's executed Reinforce moved a unit, and its enemy-strength tally `T` counted this battlefield's target | The turn ends. |
| Executed | It runs as a command without provider refusal | The turn ends. |
| Refused | A provider chooses an empty subset from nonempty eligibility | The turn ends; the command slot is consumed and no other offer is retired. |
| Dropped | Re-estimation finds the target unit gone, or its city lost by its recorded owner or no longer ours | The turn ends. |

A Withdraw offer uses these states:

| State | Enters when | Leaves when |
| --- | --- | --- |
| Ready | An opening, later or reduced check estimate is positive, which requires an endangered recruit | It reaches the top and is checked: executes, is refused, turns inactive, or returns ready at a reduced estimate. |
| Inactive | Its estimate is nonpositive, including when no recruit is endangered, `withdraw.enabled` is 0, or the battlefield is our city. A failed check below the limit also makes it inactive. | The next re-estimation makes it ready when its estimate is positive. |
| Skipped | A failed check reaches `readiness.maxFailures` failures, default 3 | The turn ends. |
| Retired | An executed Reinforce that moved a unit at the same battlefield while the Withdraw is open | The turn ends. |
| Executed | It runs as a command without provider refusal, whether or not a unit moved | The turn ends. |
| Refused | A provider chooses an empty subset from nonempty eligibility | The turn ends; the command slot is consumed and no other offer is retired. |
| Dropped | Re-estimation finds the target unit gone, or its city lost by its recorded owner or no longer ours | The turn ends. |

Only enemy unit and enemy city rows can offer Withdraw when `withdraw.enabled` is nonzero. Camps and our cities keep the slot inactive. Records keep a stable slot address for each row.

An Army March uses the Reinforce slot and counts no failures:

| State | Enters when | Leaves when |
| --- | --- | --- |
| Ready | An opening or later estimate is positive | It reaches the top and is checked, executes or yields. |
| Inactive | Its estimate is nonpositive, or a check finds no legal stop or no positive priority, including when the row no longer matches its prepared order | A later estimate is positive. |
| Executed | It runs as a command without provider refusal or yield | The turn ends. |
| Refused | The provider chooses an empty subset, the prepared order cannot be resolved, or a changed order cannot be rebuilt | The turn ends. |
| Dropped | `ResolveArmyMarch` finds no prepared row for the battlefield | The turn ends. |
| Yielded | A new contact stops the move | It returns to ready, and the command slot is spent. |

A waiting fight keeps its refreshed estimate and cumulative failure count. Waking it preserves the count and applies no priority discount. Readiness determines whether the fight can execute; the current estimate determines its priority. A reinforcement, Withdraw or Army March offer never waits, so it is never woken; a Reinforce or Army March offer also never counts failures. When `EstimateFight` finds a target gone, every open offer at that battlefield drops together.

## Battlefields

`FindTacticalTargets` scores the native targets and merges the naval list. With the loop enabled, it copies enemy units, enemy cities and known camps into `m_OperationalTargets` before native target suppression. Native consumers use the filtered list. `CleanUp` clears the snapshot.

`BuildBattlefields` reads the snapshot after the high-priority pass and emergency purchases. Each surviving hostile combat unit or enemy city supplies one battlefield. Unit targets use the plot's best defender, following native selection. Duplicate owner/unit IDs and duplicate city plots are removed. A city captured earlier in the turn gets no enemy battlefield. `GroundSide` determines hostility, including barbarians and players at war with us.

`AddOwnCityBattlefield` adds one battlefield per city of ours, including safe cities whose offers can become inactive at the first estimate. It uses the city plot's land zone. If that zone is unknown, it uses the city's water zone, identified by the negative city ID. Zone data is read without refreshing because the zone map cannot be rebuilt mid-turn.

With March on, `SnapshotEnemies` and `DiscoverEnemyBattlefields` add visible hostile combat units and visible enemy cities of players at war that the tactical snapshot did not supply. Each target is classified once in map order, and duplicate owner and ID pairs are skipped. `SyncArmyBattlefields` then adds one row per prepared army, with center `OPERATIONAL_CENTER_ARMY`. The row's plot and zone come from the prepared waypoint, and its operation and army IDs identify the order it scores.

Fight, Reinforce and Withdraw offers keep separate states. An army row supports only the Reinforce slot, which carries its Army March and uses the row's army ID as its target. Executing any offer refreshes the other open offers' estimates along with the rest of the queue.

The battlefield stores its build-order ID, center type, target owner and unit, city or army ID, plot index and zone ID. It also records these facts for the turn:

| Fact | Rule |
| --- | --- |
| Theater importance | A city battlefield fixes its own importance: city value divided by `Z_C` (city scale), capped at 1. A fight at an enemy target uses its target zone's city, which can be ours or an enemy's; an own-city fight uses its own city. A unit battlefield stores no importance: it remembers its zone city's plot for the turn and reads that city's current theater, so the link survives a capture during the turn, and a cityless zone uses the theater floor. The [theater multiplier](value.md#theater-multiplier) `θ` combines importance with contest, which is refreshed after every command. |
| `ΔG(t)` (ground recovered by removing target unit t) | Local ground score with the target present minus the score with it removed, in plot weight. |
| Near our city | Native `GetCityDistanceInPlots` is below 4 at build time. For major civilizations this means within 3 plots of our nearest city. Minors use half the plot distance to their capital, rounded down, so their exemption reaches 7 plots. |
| Army waypoint | `ComputeTargetPlotForThisTurn` in the prepared order, which is the muster plot while the army is Recruiting or Gathering and the army goal afterward. The row reads its zone from that plot, and the March checks stops from it. |

With March off, every enemy battlefield is fixed for the turn. A newly revealed enemy can enter danger calculations, city strength and search geometry immediately; it receives an independent battlefield in the next turn's snapshot. With March on, `DiscoverEnemyBattlefields` can add a visible enemy after a command when enemy observations changed. The new row keeps its own identity and fixed facts, and existing rows keep theirs. Army rows are fixed before the loop; `SyncArmyBattlefields` only updates the waypoint of an open March.

Re-estimation follows a surviving unit while its original zone, ground term and near-city flag stay fixed. A dead unit or a city lost by its recorded owner drops every open offer on that row. Each pass estimates cities first, then units and camps, then armies. Closed city rows still refresh the theater inherited by units and camps in their zones.

A city we capture during the turn becomes an own-city battlefield when the command that took it ends. It uses the city's current value and zone; the turn's weights, scales and other battlefields stay as they were. The captured city's enemy-city offer drops under the rule above.

### Barbarian camps

`BuildBattlefields` classifies each known camp once, when the queue opens. A camp with zero value gets no plot row or camp bonus. A visible guard uses its ordinary unit row with a [camp bonus](value.md#camp-value). If the guard leaves or dies, the loop can offer a claim next turn.

| Opening view | Queue behavior |
| --- | --- |
| In fog | The camp gets a plot row that can offer only [Reinforce](reinforcement.md#reinforce-priority). Recruits must be strong enough for a typical guard and march to safe stops short of the camp. The offer drops if the plot gains an owner or the camp is revealed gone. |
| Seen empty | The camp looks for one claimant when the queue opens and checks again if the claimant moves, dies or is spent, or when the offer reaches readiness. If any of those searches finds no claimant, the claim stays inactive in the native queue for the rest of the turn. An arrival this turn offers Fight; a later arrival offers Reinforce. The claimant issues one move and earns the reward on entry. The claim drops if the camp is cleared, the plot gains an owner, or a guard becomes visible. |

Camp rows keep their opening role through the turn. They have no Withdraw, and an empty camp claim uses only the command's plot and unit records. For example, a ranged attack can kill a guard without entering the camp; the loop does not add a claim that turn.

## Overlapping offers

A search centered on one enemy can attack surrounding enemies. After an enemy-unit command runs its search with at least one candidate, `RetiresFight` retires open enemy-unit fights within 2 plots of its target in compatible zones. Opposite zone-ID signs are incompatible: positive land zones and negative water zones do not overlap. Different zones of the same domain can overlap.

These offers are exempt:

- A fight whose target has positive threat damage against our units. The Fight threat layout includes enrolled army members, while the Withdraw layout leaves them out, and the fight's own search can recruit those endangered units. Spent units still sustain this exemption.
- A fight that borrows members of a prepared army, meaning its `fightArmies` set is not empty.
- A fight marked near our city at build time, using the [native city-distance rule](#battlefields).
- Every enemy-city and own-city fight. These commands also retire no unit fights.

The loop rebuilds threats after execution, before the overlap pass, so a unit moved into danger by the command can protect its attacker's offer. A Withdraw's local peer closure runs earlier, immediately after the command, and reads only whether a selected unit moved or died. Ready, inactive and waiting offers can be retired; executed, refused, retired, skipped and dropped offers are closed. A fight retires other fights only after a search with a nonempty group, whether or not the search found or completed a plan; a Reinforce retires on movement, and a Withdraw closes its own peers on movement. Commands ending after city fire, visibility failure or greedy air retire no fights.

**Reinforce retirement** uses enemies counted in the executed offer's last estimate. If a selected unit changed plot or died, the command retires ready or inactive Reinforce offers for the enemy targets it counted. Our cities, camps and army rows are exempt. A single-unit claim at an empty camp retires no other offers.

**Withdraw closure** is local: a Withdraw and a Reinforce close each other at their battlefield only when one moves a unit, with the own-city and disabled-switch exemptions in the [Withdraw closing rules](withdrawal.md#closing-the-battlefield). A formation Withdraw follows the same rule at its own battlefield. Other battlefields are not retired directly, but their offers can change when the loop re-estimates them.

Apart from that peer rule, retiring an offer leaves its battlefield's other offers intact. Reinforcement commands retire only reinforcement offers, and fights retire only fights. An Army March retires no offer, and no offer retires an Army March. Its own estimate closes it.

The examples below use the [value guide's running inputs](value.md#running-example-inputs): town value 15, city scale `Z_C = 40`, typical unit worth `Z_T = 400`, 100 maximum unit HP and neutral weights. Killing a unit earns its [destroyed value](value.md#destroyed-value): its whole living value, 60% of full-health worth plus 40% scaled by remaining HP.

**Near-city example.** Supplied: a full-health town, equal enemy and local strength, killable targets at 20 HP, and no ground, relief or exposure. Theater is `0.2 (floor) + 0.8 (room) × 15/40 (city importance) × 0.5 (contest at parity) = 0.35`.

| Target | Living value destroyed | Priority `θ × value / Z_T` | After the catapult search |
| --- | --- | --- | --- |
| Scout, worth 100 | `100 (worth) × (0.6 (retained share) + 0.4 (health share) × 20/100 (HP)) = 68` | `0.35 (θ) × 68 / 400 (Z_T) = 0.0595` | If it survives 2 plots from our town, its fight stays open even within 2 plots of the catapult. |
| Catapult, worth 500 | `500 × (0.6 + 0.4 × 20/100) = 340` | `0.35 × 340 / 400 = 0.2975` | Checked first. |

**Waiting-offer example.** Supplied: a cityless zone, full-health killable targets 1 plot apart, far from our cities, with no threat damage or other stake terms.

| Offer | Priority | Sequence and result |
| --- | --- | --- |
| Catapult, worth 500 | `0.2 (cityless θ) × 500 (living value) / 400 (Z_T) = 0.25` | Fails readiness first and waits. |
| Spearman, worth 400 | `0.2 × 400 / 400 = 0.2` | Its search runs next and retires the nearby waiting catapult fight. |

## Wake rule

`SnapshotBoard` and `DiffBoard` compare visible hostile-unit identities and plots, city-battlefield owners and our living units' plots before and after each command. `WakesFight` wakes a waiting offer after these helpful changes:

| Change | Distance test |
| --- | --- |
| An enemy unit drops out of sight, dies, moves or becomes visible | Its old or new plot is within the turn's largest native land/sea striking-distance scan (`base moves × 4`) of the target, or within 5 plots of our city. |
| A city battlefield changes owner | Its plot is within that same reach. |
| A unit of ours arrives at a new plot and remains available | It is within its own native striking distance (`base moves × 4`) of the target, or within its [strike reach](recruitment.md#battlefield-estimate), base moves plus ranged attack range, of our city. Aircraft and port-changing ships pass this distance test automatically. |
| Our city's re-estimate finds an endangered recruit | Always wakes that own-city fight. |

Native striking distance uses `baseMoves(false) × 4`. The turn's scan takes the largest value among our living land and sea units at turn build. A moved unit uses its own native striking distance at an enemy target and its strike reach at our city. A prepared army member released by operation cleanup counts as a friendly arrival. These are distance tests; waking returns a positive-estimate fight to ready so its full readiness check can run again.

Damage alone does not wake a fight, and our units that die or are spent do not count as arrivals. A fight stays waiting without adding failures if a helpful change still leaves it with a nonpositive estimate. Camp Reinforce offers use the usual inactive state and have no failure count.

**Blocker example.** Use the waiting-offer example's worths and priorities, but put the targets 3 plots apart (outside the 2-plot retirement radius) on neutral land. Supplied local damage is 100 HP for each full-health target, enough to kill; the spearman blocks the only approach to the catapult.

| Event | Catapult fight's result |
| --- | --- |
| Priority 0.25 beats the spearman's 0.2, but recruitment fails | Waiting, with 1 failure. |
| Another command only spends or damages our units | Still waiting; no new failure. |
| Spearman command kills the blocker within the wake scan | Ready if its refreshed estimate is positive; recruitment can now use the open path. |
| Later checks fail after helpful wakeups | Skipped on failure 3, from `readiness.maxFailures` (3). |
