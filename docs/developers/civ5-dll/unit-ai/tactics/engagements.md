# Unit AI: Search Engagements

A **search engagement** is one call to the [coordinated combat search](../simulation/overview.md#coordinated-combat-search) with a list of units, a target plot, and an aggression level. Tactical AI never plans all of its units together. Each engagement starts from a target that one pass has already chosen, and only the units that pass collected for that target take part. Later passes can reuse units that still have movement and remain unprocessed; processed or exhausted units are unavailable.

The callers and recruitment rules live in `civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalAI.cpp`. See the [tactics overview](overview.md) for the complete turn order.

## When an engagement runs

| Caller | When it runs | Participants | Aggression |
| --- | --- | --- | --- |
| Zone unit attack (`ExecuteDestroyEnemyUnits`) | A posture routine picks the next enemy unit from its [zone targets](targets-and-postures.md#zone-targets) that has not been tried at this aggression yet. Cities in range fire first, and a kill ends the attack. The search runs only if [striking-distance recruitment](#who-a-zone-attack-recruits) finds a unit and the recruits are expected to deal damage. | Striking-distance recruits. | From the [posture](targets-and-postures.md#postures-and-local-combat). |
| City capture (`ExecuteCaptureCityMoves`) | A posture routine tries each enemy city target. It skips a city whose land and water zones are each missing or enemy-dominated, unless it is in danger of falling; a city the recruits cannot bring down within 13 turns of its healing; and a city down to its last hit point when no recruit is a melee unit to take it. | Striking-distance recruits for the city plot. | Medium with up to two non-ranged recruits, High with more. |
| [Army contact](#army-contact) (`CheckForEnemiesNearArmy`) | Enemy units can attack an operation army moving in `PlotArmyMovesCombat`. | The contact group: army members and our units that can attack the threatening enemies. | Medium |
| Positioning (`PositionUnitsAroundTarget`) | Army gathering, zone reinforcement, and barbarian camp clearing. Reinforcement runs only when the zone would hold at least two friendly units. | The caller's own unit list. | Low |
| Barbarian attack | The [barbarian ladder](overview.md#barbarian-priorities) uses the zone unit attack and city capture paths. | Striking-distance recruits. | Braveheart for unit attacks. City capture keeps its melee-count rule. |
| Ranged opportunity | Many passes, described in [ranged opportunity searches](#ranged-opportunity-searches). | One unit. | Low |

## Who a zone attack recruits

`FindUnitsWithinStrikingDistance` builds the participant list for zone unit attacks and city capture from the [current-turn pool](overview.md#independent-units-and-priorities). A unit qualifies when all of these hold:

- It is still usable by Tactical AI, so not processed by an earlier pass this turn.
- It is not a barbarian guarding a camp, a unit that cannot capture when the target is a city, a defense fighter, or a unit covering a friendly civilian.
- It is no farther than four times its base moves from the target. Units that can change port, and aircraft under the air search, are checked by their own range instead.
- It can act on the target this turn:
  - A ranged unit can strike from where it stands, or reach a plot in range this turn without embarking. It must also be expected to deal meaningful damage, or it is left out.
  - A melee unit can get adjacent this turn.
  - A civilian support unit, such as a Great General, can get within two plots this turn.
- A melee or support unit within two plots of the target joins even when it cannot act, so the search can move it out of the way.

The search keeps at most 13 of the recruits and blocks the rest. Blocked and unused units stay available to later passes.

## Army contact

**Army contact** is the search `CheckForEnemiesNearArmy` runs for a land, naval, or combined operation army. Escort armies never run it. It runs during [operation army movement](movement.md#operation-army-movement), before garrisons and every zone, once per army per turn. Armies go in the order their operations were created. It does not use the [tactical target](targets-and-postures.md#tactical-targets) list.

1. **Contact group.** An army member joins when it can act, has at least half its hit points, and either has a target in range or can be attacked where it stands. Civilian members only need to meet the first two conditions. For each enemy unit that can attack a member, every unit of ours that can attack that enemy joins too, whether it belongs to a zone, a garrison, or another army.
2. **Trigger and target.** Only enemy units that can attack the group count, so an army that could attack but faces no threat does not fight. The target is the threatening enemy plot nearest the group's center of mass.
3. **Trim and veto.** Units seven or more plots from the center of mass are dropped. The fight is skipped when the zone of the city nearest the target is enemy territory and enemy-dominated.
4. **Search.** One search at Medium aggression with the `ArmyContact` search intent.

The fight runs before any zone, so a passing army can consume actions or process units a zone would have used. Helpers keep their existing formation membership.

## Units that engagements leave out

Tactical AI runs only for players whose units the AI controls. A human player's units never enter a tactical search. For that player only Homeland AI runs, and it moves automated units such as auto-explorers and workers.

These units of an AI player are never recruited into the current-turn pool, so no tactical search includes them:

| Unit | Why |
| --- | --- |
| Unit whose current role is explorer, carrier, or nuclear | Tactical AI never recruits these roles. The exclusion follows the unit's current UnitAI role, not its type. Economic AI moves units on and off exploration duty as recon needs change, so a scout taken off exploration is recruited like any combat unit, while a borrowed unit on exploration duty is not. |
| Delayed-death unit | It is about to be removed. |
| Aircraft that should rebase | Homeland AI owns it this turn (see [air operations](air.md)). |

These units are in the pool but are skipped by [striking-distance recruitment](#who-a-zone-attack-recruits), so zone attacks and city capture leave them out. Other searches can still include them:

| Unit | Why zone attacks skip it | Searches it can still enter |
| --- | --- | --- |
| Operation army member | It moves with its army. | Army contact and army gathering. |
| Garrison of a border, blockaded, or exposed city | The [garrison pass](#garrisons) marks it processed before zone work. | Army contact earlier in the turn, and its own ranged opportunity search. |
| Unit processed by an earlier pass | Healing, an earlier engagement, or another move already used its turn. | Only the ones that ran before. |
| Unit with nothing in reach | No target-driven pass selects it. | Reinforcement positioning, ranged opportunity searches, and Homeland AI's opportunity attacks. |
| Ranged unit not expected to deal meaningful damage | The damage check leaves it out. | Positioning and ranged opportunity searches. |
| Defense fighter: an aircraft whose unit type's default UnitAI role is air defense, such as a fighter | It is reserved for interception and sweeps, so it is never recruited as a striker. | Sweep recruitment picks sweep-capable fighters for the same attack. In stock play they sweep greedily before the search. Under the air search they join it. |
| Unit covering a friendly civilian | It stays with the civilian. | None while it covers. |

## Garrisons

Garrisons are recruited into the current-turn pool like other independent units, and they stand inside their city's zone. What keeps a threatened city's garrison out of engagements is timing. `PlotGarrisonMoves` runs in the global high-priority pass, before any posture work:

1. Every friendly city fires at its best target, as a safety net.
2. Each city that is a border city, has a blockaded plot, or is exposed to an enemy then handles its garrison. The garrison takes an opportunity attack and is marked processed with a skip mission, whatever the threat. The threat only decides whether that attack may move: movement is allowed when fewer than two enemies threaten the city and the player has more than one city. A threatening enemy is one adjacent to the city, or two plots away and able to reach the city this turn. Without movement, a ranged garrison shoots from the city or steps out and back, and a melee garrison attacks an adjacent enemy only when the attack would not kill it, since a kill would carry it out of the city.
3. When such a city needs a garrison and has none or a weak one, it moves in a better one, preferring ranged land units. The new garrison also takes an opportunity attack and is marked processed.
4. After every city, naval units in those cities upgrade if they can, or take an opportunity attack with movement allowed. These units stay available to later passes.

From then on, every zone search that turn skips these garrisons: zone unit attacks, city capture, and reinforcement positioning all require a unit that is not yet processed. They fire alone, before the planned attacks of that turn, and the zone's searches treat them as part of the board, never as actors. Two exceptions remain:

- **Army contact runs earlier.** Army moves come before the garrison pass, and [army contact](#army-contact) also takes nearby non-army units that can attack the enemy, so a garrison can join an army's fight before it is marked processed.
- **Interior cities.** Their garrisons skip this pass and stay in the pool for zone attacks. Two native comments, in `FindUnitsWithinStrikingDistance` and `PlotGarrisonMoves`, say garrisons are never recruited into the pool and are used in zone attacks. Neither matches the current code.

## Ranged opportunity searches

A **ranged opportunity search** is a one-unit search on the unit's own plot. `PerformRangedOpportunityAttack` runs it, and `PerformOpportunityAttack` passes ranged units to it. It applies these rules:

- The unit must be able to attack at range, move, and not be dying.
- Movement is turned off for aircraft and for a land garrison whose city needs a garrison: one under siege, or exposed to an enemy outside the early expansion phase.
- With movement allowed, the search may end the unit anywhere. With movement off, a unit that can move after attacking still runs the search, but must end on its starting plot, so it can step out, shoot, and step back. Any other unit takes the best single stationary shot at a unit, without a search.

It runs without first checking that an enemy is in range, so many calls find nothing to shoot. Movement is off unless the caller allows it.

| Caller | Who it covers | Movement |
| --- | --- | --- |
| Garrison pass | Garrisons, new garrisons, and naval units in threatened cities. | See [garrisons](#garrisons). |
| Homeland opportunity attacks (`CvHomelandAI::PlotOpportunityAttacks`) | Every remaining non-air combat unit that Tactical AI handed over. | Allowed, except for a land garrison its city needs. |
| Withdraw posture | A unit after a successful withdrawal. | Off |
| Move to a plot (`ExecuteMoveToPlot`) | A unit that is already at its destination, or reaches it this turn with moves left. Gathering, garrison, and other moves use it. | Off |
| Safety and healing | A retreating ranged unit, and a fast unit firing before it flees to heal. | Off, keeping the moves it needs to flee. |
| Escort, blockade, and trade plunder | A naval escort beside an embarked unit, a blockading ship, and a trade raider after their moves. | Off for escorts and raiders, allowed for blockades. |
| Cover | A defender pinned in place to shield a retreating unit. | Off |
| Barbarians | Camp defenders and roaming units. | Off for camp defenders, allowed for roaming. |

The search uses Low aggression and the `RangedOpportunity` search intent for [flavor defaults](../flavors/overview.md).
