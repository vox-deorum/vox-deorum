# Unit AI: Tactical Simulation Scoring

This guide describes how `CvTacticalAI.cpp`, under `civ5-dll/CvGameCoreDLL_Expansion2`, scores actions and ranks plans. See the [simulation overview](overview.md) for the search procedure and safety checks, and [air search](air.md) for aircraft scoring.

Scores rank useful damage, valuable actions, and good positioning. A high score still needs to pass the [acceptance checks](overview.md#acceptance-and-replay).

An assignment combines three terms:

`assignment score = new plot score - old plot score + 10 * (damage delta + bonus)`

| Term | What it measures |
| --- | --- |
| Damage delta | `ScoreAttackDamage` credits damage dealt and subtracts damage received. Unit damage is capped at remaining HP; city damage permits limited overkill. Forecasts approximate flanking, support, splash, and repeat attacks. Healing, such as from pillaging, can also add value. |
| Bonus | A direct unit kill adds 15 and city capture adds 100, before the 10× weight. Other bonuses cover focus fire, kill effects, civilian captures, pillaging, and barbarian camps. Ranged attacks also favor the requested target and movement left to disengage. |
| Plot score | `ScorePlotForCombatUnitMove` combines ten times plot desirability, a danger adjustment, and small location and movement preferences. Only the change from the unit's previous plot score enters the assignment score. |

For example, dealing 30 damage, receiving 10, earning a 15-point kill bonus, and improving the plot score by 20 contributes `20 + 10 * (30 - 10 + 15) = 370`, before other contextual bonuses. Score components and the combined assignment score are clamped to the signed 16-bit range so large penalties cannot wrap into rewards.

**Positioning.** With enemies present, the land desirability table peaks at 12. First-line units prefer adjacency or a killing advance onto the enemy plot; second-line units prefer distance 2; third-line units prefer distance 3. Naval units use a separate table. Without enemies, desirability follows distance to the tactical target. City proximity and remaining movement add small preferences. Attacks include the score of the resulting location.

**Danger.** Intermediate moves receive provisional danger penalties. `ScoreCombatUnitTurnEnd` checks final positions against remaining HP, adjusts for experience, and penalizes isolation more heavily. Nearby friendlies, terrain, air cover, and citadels can improve the result. Unsafe plots can be rejected outright.

**Search order and final ranking.** The queue prefers shallow generations early and deeper ones later. Within a generation it uses a last-round heuristic based on damage, bonuses, and plot-score changes. Accepted complete positions are ranked by cached total score, then fewer assignments, then lower position ID.

Two implementation details matter when debugging rankings:

- `CvBasePosition::UpdateScore` caches `10 * (cumulative damage delta + cumulative bonuses) + sum of stored unit plot scores`. It sums the plot entries before replacing the acting unit's entry, so the total lags that update. Completion adds finish assignments and unused-unit plot bonuses without refreshing the total.
- The queue's separate last-round heuristic uses unscaled damage and bonuses. It subtracts both the assignment's old plot score and any prior stored plot score, so it can subtract the previous plot value twice.

**Trade routes.** With the default-off `VOX_TACTICAL_TRADE_SEARCH` mod option, `GetTradeStepScore` adds two small terms for the plot a unit ends on. Both are about the size of the "stay together" term, so they choose between similar end plots and never override the danger checks.

| Term | When it applies |
| --- | --- |
| Intercept | The unit ends on a plot a visible enemy trade unit steps onto in its owner's next trade movement, and native trade movement would have this unit plunder the route there. It is worth 7 plus 1 per 200 plunder gold, up to 11. A route pays once, so it scores nothing when a unit takes the route on an earlier step. |
| Guard | The unit ends on a next step of our own trade unit that a known enemy melee unit could reach, where the ocean rule allows plunder. It is worth 7, because a unit standing there keeps that enemy off. |

Native trade movement meets only the first defender on a plot, in the plot's unit order (`isBeforeUnitCycle`: lower player ID first, then sea before land), and the route survives when that unit cannot plunder. `GetTradeStepTaker` applies the same rule to the units the plan puts on a step, plus every other unit there, of any player, that the plan does not kill. An allied embarked unit with a lower player ID on our ship's plot therefore blocks the interception, as it does in native.

Guard counts only melee units in the danger map's attacker list, which can move onto every plot they threaten. Danger from a city, a ranged unit or terrain does not count, and a ranged unit that could walk onto the step is missed.

The final pass only accepts or rejects a plan, and plans are ranked by their move scores. So `ScorePlotForCombatUnitMove` adds the terms to each move's score, like the citadel bonus, and a unit keeps the score of its last move. `ScoreCombatUnitTurnEnd` adds them to the starting score of a unit that stays put. `isKillOrImprovedPosition` counts a unit that ends with a higher trade score than it started with as progress, so a sideways move onto a step is not rejected for leaving the enemy distance unchanged.

Two units on the same step cannot both claim it:

- While moves are scored one at a time, a unit of ours that already takes the route there keeps the claim.
- When every unit is scored where it stands, the defender native trade movement meets keeps it.

Because claims are judged when each move is scored, a stored score is not revised by later moves. If a unit takes a later step of a route and another unit then takes an earlier step, both keep the bonus; a capture that cuts a route after a unit claimed it leaves that claim too. Each case overcounts by at most one intercept bonus.

`TacticalAIHelpers::UpdateTradeSteps` rebuilds the step map only when a trade route changed since the last search. A route scores nothing once the plan captures its origin or destination, or a city on a sea route's path, since that capture cancels it. A plunderer's invisibility is judged at the step plot.

[Military tactical flavor scoring](../flavors/scoring.md) can scale selected damage, bonus, and end-of-turn terms, reduce the pull into enemy territory, reward guarding cities and holding friendly ground, and change the danger penalty through RISK. At neutral values of 50, with RISK unset, these adjustments leave the rules unchanged.
