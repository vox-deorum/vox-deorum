# Unit AI: Reinforcement Priorities

Each [battlefield](overview.md#battlefields) has a **Reinforce offer** to bring distant units toward its center. [Recruitment](recruitment.md) supplies the selected units, local strength and enemy strength. This page explains how their expected benefit becomes a queue priority. [Readiness and marching](execution.md#reinforce-readiness) check the paths and issue the orders.

`EstimateReinforce`, `ScoreReinforcement` and `ProjectCityShares` implement these formulas in `civ5-dll/CvGameCoreDLL_Expansion2/CvTacticalOperationalLoop.cpp`. The examples use the [value guide's running inputs](value.md#running-example-inputs) unless stated otherwise. HP means hit points.

## Reinforce priority

Selection supplies two measures: **gain** rewards useful help and discounts travel time; **odds** discounts arriving below the desired strength ratio. Despite its name, odds is a strength multiplier, not a win probability.

| Input | Meaning | Unit or range |
| --- | --- | --- |
| `L`, `T` | Local friendly strength and enemy strength from the [strength tallies](recruitment.md#strength-tallies). | Native strength already scaled by 100, then multiplied by remaining health share. Both use the same scale. |
| `r` | `reinforce.strengthRatio`, the desired friendly/enemy ratio. | Default 1, meaning parity. Supported simulator values are positive. |
| `S` | Sum of selected units' full strength. | Strength units, before travel discount. Includes the role unit and damage-extension units. |
| `help` | Sum of selected unit strength / join turns. | Discounted strength, between 0 and `S`. |
| `need` | `max(0, r × T − L)`. | Additional full strength wanted. |
| `roleHelp` | Capture-role unit's strength / join turns, or 0 without a separate role unit. | Discounted strength; also included in `help`. |

| Output | Formula when `T > 0` | Range and interpretation |
| --- | --- | --- |
| Gain | `min(r / (1 + r), min(help, need + roleHelp) / ((1 + r) × T))` | 0 to `r / (1 + r)`, default 0 to 0.5. The inner cap stops excess help from raising the score. |
| Arrival ratio | `(L + S) / T` | Nonnegative, no upper cap. 1 means parity on arrival. Travel time does not reduce `S` here. |
| Odds | `min(1, arrival ratio / r)` | 0 to 1. Full credit once arrival reaches the desired ratio. |

All three outputs are 0 when `T ≤ 0`. For example, with `r = 1.5`, arriving at parity gives odds `1 / 1.5 ≈ 0.667`; reaching 1.5 gives odds 1. At the default `r = 1`, any enemy-center offer that passes the parity gate already has odds 1.

Priority depends on the destination. `θ`, the preference weights, `C`, `P_g` and `Z_U` are defined under [fight priority](value.md#fight-priority). `V` is the enemy-unit fight's current stake, refreshed even after that fight executes.

| Destination | Priority                                                 |
| ----------- | -------------------------------------------------------- |
| Our city    | `θ × w_C × C × gain`                                     |
| Enemy unit  | `θ × V × gain × odds`                                    |
| Enemy city  | `θ × (w_O × C × Δf_att + w_A × P_g / Z_U × Δf_g) × odds` |

At any **enemy center**, priority is 0 if any of these conditions holds:

- The zone is neither ours nor adjacent to one of ours, based on the turn's initial zone data.
- The zone's posture is Withdraw.
- The arrival ratio (combined local and incoming strength divided by enemy strength) is below 1.

These reinforcement gates leave the fight offer unchanged.

At **our city**, border, parity and odds checks do not apply.

**Score scale.** At default `r = 1`, gain is at most 0.5. An enemy-unit Reinforce therefore earns at most half the target fight's current priority `θ × V`. An own-city Reinforce earns at most half the full city allowance `θ × w_C × C`. At other positive ratios, replace 0.5 with `r / (1 + r)`.

At an **enemy city**, the score rewards added city and garrison damage directly. It uses share increases in place of gain:

| Part | Meaning | Range |
| --- | --- | --- |
| `f_att`, `f_g` | Base fall and garrison shares from local damage alone. Capture counts an available local `CanCapture` attacker or a local strength-filter unit passing `IsCapturer`; the latter needs no current-turn availability. | Each 0 to 1. |
| `f_att⁺`, `f_g⁺` | Projected shares after adding selected units' travel-discounted damage. A selected capturer can also enable capture. | Each 0 to 1. |
| `Δf_att` | `max(0, f_att⁺ − f_att)`. | 0 to 1; added city progress or capture enabled by this selection. |
| `Δf_g` | `max(0, f_g⁺ − f_g)`. | 0 to 1; added garrison damage or death on capture. |

`EstimateReinforce` computes the projected shares by continuing the fight's local damage simulation:

1. Simulate the selected units in selection order, including the capture-role unit. Each attacks from its current plot under the local damage rules. A unit that fails `CanStrikeCity` adds no damage, though it still counts toward strength.
2. Divide each unit's city and garrison damage by its join turns, the discount that help uses, and add the results to `D_c` and `D_g`.
3. Apply the fight's share rules to the new totals, with the same remaining health, expected heal and starting garrison. The baseline's local capturers and any selected capturer satisfy the projected capture requirement.

The base shares can exceed the fight's shares when a local land capturer is outside the damage filter and local damage is lethal. That capturer might be spent, off the tactical roster or covering a civilian. Counting it in the baseline prevents the march from earning an existing later-turn capture opportunity. Bringing a new capturer can earn credit even without adding damage: the base has no capturer, while the projection does.

Gain is still recorded, but the city formula uses only the two share increases and odds. Exposure stays with the fight. With no local damage, the base shares are 0 and Reinforce earns the whole projected benefit. If the selected units add no benefit, the [damage extension](recruitment.md#candidates-and-selection) tries further eligible candidates. Each increase is at most its projected share, so the march's score is bounded by the projected fight's city and garrison terms before any exposure.

**Selection example.** Our town has local strength `L = 100` and enemy strength `T = 150`. With the default `r = 1`, `need = 150 − 100 = 50`:

| Candidate     | Strength | Travel turns | Join turns | Help | Selected |
| ------------- | -------- | ------------ | ---------- | ---- | -------- |
| Spearman      | 100      | 2            | 1          | 100  | Yes      |
| Horseman      | 50       | 2            | 1          | 50   | No       |
| Knight        | 100      | 3            | 2          | 50   | No       |
| Second knight | 100      | 3            | 2          | 50   | No       |

The spearman has the lower unit ID, which breaks its travel-time tie with the horseman. Its full strength 100 covers the need of 50, so selection stops. The other units stay free. For town value 15, `Z_C = 90`, `C = 0.3` and neutral hold-city weight:

| Output | Calculation | Result |
| --- | --- | --- |
| Selected full strength `S` | Spearman strength | 100 |
| Help | `100 / 1` | 100 |
| Useful help after cap | `min(100, 50 + 0)` | 50 |
| Gain | `min(0.5, 50 / (2 × 150))` | 0.166667 |
| Arrival ratio | `(100 + 100) / 150` | 1.333333 |
| Odds, recorded but unused at our city | `min(1, 1.333333 / 1)` | 1 |
| Priority | `(0.2 + 15 / 90) × 0.3 × (1 / 6)` | 0.018333 |

**Enemy-unit example.** The capital-zone spearman in the [worked priorities](value.md#worked-priorities) has stake `V = 0.06` and theater `θ = 0.2 + 40 / 90`. With gain `1 / 6`, odds 1 and all enemy-center gates open, Reinforce priority is `(0.2 + 40 / 90) × 0.06 × (1 / 6) ≈ 0.006444`, one sixth of the fight's 0.038667 priority.

**Enemy-city example.** Take the large city from the [worked priorities](value.md#worked-priorities): `θ = 0.7`, `C = 0.3`, remaining HP 250, heal 20, no garrison and local damage 50. Its base share is `(50 − 20) / 250 = 0.12`. Two selected units each simulate 40 city damage. Use neutral weights, default `r = 1` and arrival ratio at least 1, giving odds 1. The zone is ours or adjacent to ours, and its posture permits reinforcement:

| Case | `D_c` with incoming damage | Projected share `f_att⁺` | Increase `Δf_att` | Reinforce priority |
| --- | --- | --- | --- | --- |
| Both join in 1 turn | `50 + 2 × 40 / 1 = 130` | `(130 − 20) / 250 = 0.44` | `0.44 − 0.12 = 0.32` | `0.7 × 0.3 × 0.32 = 0.0672` |
| Both join in 2 turns | `50 + 2 × 40 / 2 = 90` | `(90 − 20) / 250 = 0.28` | `0.28 − 0.12 = 0.16` | `0.7 × 0.3 × 0.16 = 0.0336` |

The city fight itself has priority 0.0252 now and `0.7 × 0.3 × 0.44 = 0.0924` once both units stand beside the city, so the march ranks between the two. Incoming units that simulate only 10 city damage each leave `D_c` at 70 or less, `f_att⁺` at 0.2 or less, and the priority at 0.0168 or less.
