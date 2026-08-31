# Unit AI: Military Tactical Simulation

**Tactical simulation** plans a coordinated current-turn action for nearby units and one target plot. [Military tactics](military-tactics.md) supplies the group, target, and aggression level; the simulation searches hypothetical outcomes, selects the best complete plan, and replays it as real missions.

This page has two related jobs. Read [coordinated combat search](#coordinated-combat-search) to change attacks, positioning, acceptance, or support. Read [pathfinding policy](#pathfinding-policy) to change which routes and end-of-turn plots any AI movement may use. The same pathfinder supports both jobs, but combat search consumes reachable plots while pathfinding policy supplies them.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvTacticalAI.cpp`, `CvTacticalAI.h`, `CvAStar.cpp`, and `CvUnit.h`.

## Coordinated combat search

A **position** is a hypothetical battle state: simulated unit locations and moves, expected damage, killed enemies, freed plots, and the actions taken so far. `CvTacticalPosition` stores it. An **assignment** is one recorded move, attack, special action, or end-state for one unit. The search extends positions one action at a time and reuses unchanged state, allowing a preallocated pool of 6,000 positions to cover a run.

A unit that finishes the selected plan is committed and processed under the shared [operation lifecycle control state](operation.md#control-state). A unit the simulation blocks remains available to later Tactical passes.

### Entry points and aggression

The callers below use `FindAndExecuteBestUnitAssignments`. The first three come from [Tactical zone and army processing](military-tactics.md#independent-units-and-priorities).

| Caller | Occasion | Aggression |
| --- | --- | --- |
| `ExecuteAttackWithUnits` | Zone combat against a tactical target. | Zone posture for units; city capture is high with more than two melee attackers, otherwise medium. Barbarians use braveheart. |
| `PositionUnitsAroundTarget` | Gather, reinforce, or defend around a plot without a committed attack. | Low |
| `CheckForEnemiesNearArmy` | A persistent-operation army meets enemies near its path. | Medium |
| `PerformRangedOpportunityAttack` | One ranged unit can fire and still move. | Low |

Aggression sets how much damage a plan values and how much risk it can accept. It scales attack value by the friendly-to-enemy force balance and a database weight. Higher levels accept lower post-attack health and more danger; ranged attacks take no counter-damage and skip melee survival checks.

| Level | Damage preference | Post-attack policy |
| --- | --- | --- |
| None | Does not plan attacks. | Marker only. |
| Low | Prefers favorable trades. | Keeps a substantial health reserve. |
| Medium | Accepts slightly unfavorable trades. | Keeps a smaller reserve. |
| High | Trades freely. | Uses danger checks rather than a health floor. |
| Braveheart | Takes extreme risks. | Used by barbarians. |

`FLAVOR_OFFENSE` can increase the casualty budget for large groups and lowers the health threshold at which a wounded unit may use any safe plot.

### Search procedure

```mermaid
flowchart TD
    C[Caller: units, target, aggression] --> B[Build initial position]
    B --> S[Search position tree]
    S -->|best completed position| E[Replay assignments as missions]
    E -->|failed step or new enemy| R[Drop unusable units and retry]
    R --> S
    E --> M[Executed unit missions]
```

The initial position covers the target area, nearby enemies, and participating units. It filters duplicate or inactive units and units stacked outside their native domain, except in cities. Each accepted unit receives a movement strategy from its default [UnitAI role](concepts.md#unitai-roles) and attack range: first line, second line, third line, support, or embarked. The strategy defines the enemy distance it should prefer.

The search accepts at most 13 units. When more are available, it keeps the units with the best single moves and blocks the rest for later passes. It begins with a broad, best-first search, then drives promising lines to completion through narrower depth-first expansion. Difficulty settings bound branches, choices per unit, and completed positions. Candidate moves come from cached [reachable plots](#reachable-plots). A blocked option lets a unit sit out rather than force a bad move, while swaps and chained moves resolve friendly blockers.

Equivalent sibling states are discarded, so action order does not create duplicate plans. A simulated move that reveals a new enemy records a restart, ending that branch and requiring a fresh run with current information.

### Acceptance and replay

A position completes when all starting enemies are dead or all units have exhausted their options. The final safety check permits limited casualties, with one allowance per enemy killed and a bias toward protecting experienced units. If there is no kill, restart, or great-person power use, the plan must improve more units' distance to their preferred line than it worsens. Ties consider movement toward the target, attacks in place, and healing.

Danger checks become more permissive at higher aggression, but hard safety rules remain. Outside braveheart, units reject death traps, ranged and carrier positions that exceed their current hit points in danger, and positions whose health is too low for their danger. A non-killing melee attack also fails when a safer reachable retreat exists and the attack would leave the unit too weak or too exposed. Any attack that leaves fewer than three hit points fails outside braveheart.

`ExecuteUnitAssignments` replays the selected hypothetical plan against the real game. Each step verifies expected unit positions and target state, then verifies the result because combat may differ from the forecast. Replay ignores ordinary danger stopping because the plan has already evaluated danger, but it stops for a newly revealed enemy. A failed check, interrupted move, or restart triggers a new search. The wrapper retries up to four times, dropping unusable units when planning cannot find a complete position.

### Support placement

Great Generals, Great Admirals, and siege towers stay outside the main combat search. Once a combat plan wins, `AddSupportMoves` runs a smaller search over its assignment sequence and can insert support moves before attacks. A move must add new relevant coverage: generals aid land attackers, admirals aid naval attackers, and siege towers improve city attacks. Support units must still end safely.

## Pathfinding policy

The pathfinder in `CvAStar.cpp` receives each caller's path type, turn and movement limits, optional zone-of-control exceptions, and move flags from `CvUnit.h`. Those inputs turn route finding into policy: they state what the unit may risk, ignore, or refuse.

| Policy | Effect |
| --- | --- |
| Abort in danger | Rejects unsafe near-term stops and makes combat danger more expensive. Civilians use stricter limits. |
| Stop for a new enemy | Interrupts movement as soon as an additional enemy becomes visible, so the simulation can re-plan. |
| Safe embarkation | Allows embarkation only onto a zero-danger plot. |
| Ignore danger | Removes danger costs for calculations that are themselves computing danger. |
| Approximate target | Accepts a plot near the target, optionally only in the unit's native domain. |
| Avoid enemy territory | Refuses enemy-owned plots unless the unit already stands there. |
| Maximize exploration | Prefers steps that reveal unseen plots. |
| Assume the map is revealed | Lets the AI recognize dead ends rather than march into unknown ones. |
| Selective zone-of-control exception | Ignores control from enemy units the simulation has already planned to kill. |
| Hypothetical reachability | Can ignore control, enemies, or stacking for questions such as where an enemy could reach. |

Other flags cover narrower movement rules, including no embarkation, no ocean, worker visibility, escorted-civilian stacking, and canal planning.

### Reachable plots

A **reachable-plots query** runs pathfinding without a destination and returns every plot reachable within the caller's turn and remaining-movement limits. The query inherits the caller's policy, so combat search, danger evaluation, and army contact checks all receive legal candidate plots. When a simulated kill frees a plot, the next query ignores that dead unit's zone of control.

### Danger in path cost

For AI units, end-of-turn path cost penalizes risky water, foreign or unowned territory, poor terrain, and unknown plots. Its main cost is projected danger relative to the unit's current health. Near-term stops in high danger become increasingly expensive; later stops matter less because they will be re-planned. Civilians and embarked units receive stronger penalties and can be rejected outright by the abort-in-danger policy.

The danger model uses pathfinding to estimate hostile reach. Its own searches ignore danger, and the pathfinder refreshes danger before ordinary searches. This separation prevents danger evaluation, pathfinding, and tactical simulation from recursing into each other.
