# Draft Vox Populi PR: Account for units that lose cover in tactical search

For future review. The proposed PR covers shared tactical search, including legal stack entry and the native helpers it needs. Vox Deorum keeps the operational commands and simulator integration. The experiment summary below covers both parts of the work.

## Proposed PR body

The tactical AI can move a warship away from an embarked swordsman, or an escort away from a worker, without charging the plan for the danger left behind. Score that change even when the exposed unit stays put or was never recruited into the fight. A plan can still leave the unit exposed if the gains elsewhere justify it.

- Compare the starting and ending friendly positions using the same surviving enemies and post-action health. That keeps the placement score focused on movement and cover, while kills remain credited by the attack score.
- Count nearby units that will end their turn in place as cover, by domain. For units sharing a tile, use the game's defender selection with their projected positions, embarkation and health. A defender can absorb some or all of the danger to the other occupants. Remaining moves soften newly added danger.
- Use the same stacking rule when gathering candidate plots and searching moves. An embarked unit should be able to join a warship already holding a tile when game rules allow it. A second warship must still be rejected when it would exceed the stack limit.

The placement changes are in `CvTacticalAI`. The projected defender helpers extend the existing selection in `CvPlot` and `CvUnit`.

## Related work in Vox Deorum

**Withdraw** compares the group's first reachable stops with holding position, caps the danger attributed to each enemy by its available attacks, and uses the net safety gain to decide whether to proceed or return the offer to the queue at a lower priority. If some recruits cannot join, the command rescores with those units holding. Units going to the same destination share a search. The shared placement score then measures the search's withdrawal progress.

**Reinforce** separates initial reach failure, failed movement, and a competing target. Moves and deaths can reopen a previously rejected offer when they change its conditions. Safe embarkation still applies on retry.

The DLL and simulator revisions were `48d3e64bf` / `41a01c65` before the changes, `9d6773999` / `25f91eff` after withdrawal admission and shared rules, and `7e1bf1f79` / `b89b1a5a` after shared placement scoring. See [placement scoring](../developers/civ5-dll/unit-ai/simulation/scoring.md#completed-plan-score), [Withdraw](../developers/civ5-dll/unit-ai/commands/withdrawal.md), and [Reinforce](../developers/civ5-dll/unit-ai/commands/reinforcement.md).

## Experiment summary

Each comparison starts from the same recorded player-turns and seeds and uses the same tactical outcome grade. Higher is better. Native uses the usual tactical scheduler. Operational enables the command loop for the evaluated player; active opponents still use native scheduling from that run's build. The scores measure three turns of tactical play from recorded positions.

**Coastal recording.** All five runs selected the same 1,069 starts across eight players. All five had a turn +3 grade on 1,057 of those starts.

| Mean turn +3 grade | Before | After admission and shared rules | After placement scoring |
| --- | ---: | ---: | ---: |
| Native | 0.04649 | Not run | 0.04859 |
| Operational | 0.05564 | 0.05523 | 0.05293 |

At turn +3, native gained 4.5% and operational fell 4.9% from its own baseline. Operational still led native by 8.9% on the final build. Most of the operational drop came from higher friendly unit losses; player 1 accounted for about 93% of the net decline.

From player 1's turn 339 start, both builds prioritized the threatened city on turn 341. The earlier build brought in a reinforcement and held the city. The final build found no reachable reinforcement on two checks, and player 5 captured the city on its reply. In a separate check of player 5's native opening turns from the same recorded positions at turns 339–344, both builds killed six units in total, and the final build dealt slightly less damage.

**Five held-out recordings.** Both modes on both builds selected the same 4,363 starts across five games and two maps. The table uses the 4,331 starts with a turn +3 score in all four runs.

| Mean turn +3 grade | Before | After | Change | Games improved |
| --- | ---: | ---: | ---: | ---: |
| Native | 0.03476 | 0.03542 | +1.9% | 4 of 5 |
| Operational | 0.03985 | 0.04041 | +1.4% | 4 of 5 |

Both modes also improved overall at turns +1 and +2. At turn +3, operational led native in every held-out game on the final build, by 14.1% overall. Its lead narrowed slightly, from 0.00509 to 0.00499. The coastal decline did not repeat overall. These comparisons show that native improved on average, but they cannot attribute the coastal drop to stronger opponents because the build changes both sides. They also test the full set of changes, rather than the proposed upstream subset by itself.

## Before submitting

Extract the shared changes against current upstream and verify the standard Windows game DLL build there. With March disabled, check that the search can enter a legal ship and embarked-unit stack when the ship is outside the search, and still rejects an illegal second ship. Exercise the escort and stationary-neighbor cases and check for excessive clustering, especially around siege units and garrisons. Compare search cost and outcomes on additional maps before making broader gameplay or performance claims.
