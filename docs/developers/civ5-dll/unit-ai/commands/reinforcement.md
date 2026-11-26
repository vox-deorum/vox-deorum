# Unit AI: Reinforcement Priorities

A **Reinforce offer** brings distant units toward a [battlefield](overview.md#battlefields). It scores the value at stake and the rise in friendly strength that incoming units provide. This lets a threatened city draw help before the enemy strikes, or an enemy target draw help before local units can deal damage.

| Stage | What it supplies | Reference |
| --- | --- | --- |
| Recruit | Local and enemy strength, selected units and their join turns. | [Recruitment](recruitment.md#candidates-and-selection) |
| Score | Swing, turns to contact and priority. The loop refreshes them after each command. | `EstimateBattlefield` and `ScoreReinforce` in `CvTacticalOperationalLoop.cpp` |
| Check and execute | Actual paths, available recruits and path orders. | [Reinforce readiness](execution.md#reinforce-readiness) |

An [empty camp claim](value.md#camp-value) or [Army March](march.md#priority) can use the same offer slot with its own priority.

## Shared values and scales

Strength uses the [strength tallies](recruitment.md#strength-tallies). The [value page](value.md#fight-priority) defines realized and potential stake.

| Symbol | Meaning | Scale or range |
| --- | --- | --- |
| `L` (**local strength**) | Our units near the center, from the [local set](recruitment.md#battlefield-estimate). At our city it includes the city's own strength. | Native strength × remaining health share. Only ratios matter, so examples use strengths such as 100. |
| `L_R` (**adjusted local strength**) | Reinforce's local tally after released local units enter its candidate pool. It equals `L` when no local units are released. | Same scale as `L`. |
| `T` (**enemy strength**) | Hostile units and cities near the center. At an enemy city it includes the city. | Same scale as `L`. |
| `r` (**desired ratio**) | Setting `reinforce.strengthRatio` (1): the friendly/enemy strength ratio selection aims for. | Positive; 1 means parity. |
| `need` | `max(0, r × T − L_R)`: full strength selection tries to add. | Strength, at least 0. |
| `S` | Selected units' full strength, including any role unit. | Strength. |
| `j` (**join turns**) | `max(1, travel turns − 1)`, from the [distance estimate](recruitment.md#candidates-and-selection). | Whole turns, at least 1. |
| `help` | Sum over selected units of strength / `j`: strength discounted by how long it takes to join. | 0 to `S`. |
| `s` (**fight share**) | Our share of fighting power at the center now, `L² / (L² + T²)`. The fight counts its target's exposure at `s`, and a [Withdraw](withdrawal.md#withdraw-priority) keeps `s⁺` at or above this share. At a city battlefield it matches the theater's [pressure](value.md#theater-multiplier) at an enemy city and `1 − pressure` at ours. | 0 to 1; 0.5 at parity. |
| `s_R` (**Reinforce start**) | Reinforce's own starting share, `L_R² / (L_R² + T²)`, after local units enter its candidate pool. It equals `s` when no local units are released. | 0 to 1. |
| `s_h` (**projected share**) | `(L_R + help)² / ((L_R + help)² + T²)`: Reinforce's share once the selected help joins from `s_R`. | 0 to 1. |
| `θ` | Current [theater multiplier](value.md#theater-multiplier) of the destination's zone. | Theater floor (0.2) to 1. |

## Running example inputs

Examples use these inputs unless they state their own. Results are rounded only for display.

| Input | Value | Source |
| --- | --- | --- |
| Desired ratio `r` | 1 | Setting `reinforce.strengthRatio`. |
| Local strength `L`; enemy strength `T` | 100; 150 | Supplied. |
| Need | `1 (r) × 150 (T) − 100 (L) = 50` | Derived. |
| Selection | One spearman of strength 100, `j = 1` | Supplied; its full strength covers need 50. |
| Help | `100 (strength) / 1 (j) = 100` | Derived. |
| Strength share `s` | `100² (L) / (100² + 150² (T)) = 0.307692` | Derived. |
| Swing | `0.64 (s_h) − 0.307692 (s_R) = 0.332308` | Derived in [swing](#swing); with no local units released, `s_R = s`. |
| City allowance `C`; city scale `Z_C` | 3; 40 | [Value page's running inputs](value.md#running-example-inputs). |
| City maximum HP; expected heal `H` | 250 HP; 20 HP | Value page's running inputs; healing reduces non-capturing city progress. |
| Unlisted exposure, ground, relief, garrison and camp terms | 0 | Supplied. |
| Theater floor; room above it | 0.2; 0.8 | Setting `floor.theater`. |
| Strength exponent | 2 | Setting `theater.steepness`. |
| Typical unit worth `Z_T`; retained share `q` | 400; 0.6 | [Value page's running inputs](value.md#running-example-inputs). |
| Potential weight `φ` | 0.1 at `a = 1` | Default `potential.weight` and `potential.turnDiscount`, below. |
| Gates | Open | Supplied. |

## Reinforce priority

`priority = θ × (realized stake + φ × potential stake) × swing`

`φ = potential.weight × potential.turnDiscount^(a − 1)`

**Swing** is the rise in our strength share as the selected help joins. The **potential weight** `φ` starts at `potential.weight` (0.1) and is multiplied by `potential.turnDiscount` (0.5) for each turn to contact past the first, including fractional turns. Set `potential.weight` to 0 to score without potential stake.

**Turns to contact** `a` estimates when the side that can realize the potential stake will be in place:

| Battlefield | Whose arrival matters | `a` |
| --- | --- | --- |
| Enemy unit | Our selected help can damage the target. | `S / help`, at least 1 |
| Enemy city | Our selected help can attack the city. | `S / help`, at least 1 |
| Our city | Counted enemies can come into striking range. | Fixed at 1 |

At enemy targets, `S / help` is a harmonic mean of join turns weighted by unit strength. For example, with a spearman of strength 100 at `j = 1` and a knight of strength 200 at `j = 3`, `S = 300` and `help = 100 / 1 + 200 / 3 ≈ 166.667`. That gives `a = 1.8` and `φ ≈ 0.0574`. At our city, the enemy tally already consists of approaching units and direct attackers. Our help still affects swing through its own join turns.

| Gate | Our city | Enemy unit or city |
| --- | --- | --- |
| Border | None. | Destination zone must be ours or adjacent to ours, by the turn's initial zone data. Guarded and fogged camps are exempt. |
| Posture | None. | Withdraw posture gives priority 0. |
| **Short selection** | Partial help counts. | Priority 0 when full selected strength falls short of need: `L_R + S < r × T`. |
| No selection | Priority 0. | Priority 0. |

Reinforce can score at an enemy unit or city with no local units if its selection passes these gates. Enemy-city recruitment still checks `CanStrikeCity` and looks for a capturer if one is missing.

**Camps.** At a visible guard, the camp contributes to total and realized stake as shown in the [term table](value.md#fight-priority). Before multiplying by swing, `ScoreReinforce` uses the higher of `θ × (realized stake + φ × potential stake)` and `θ × camp value`. At a fogged camp the camp value is fully realized, with zero potential stake, turns to contact and potential weight. Enemy strength is at least that of a typical unit, the average combat strength of the player's reference military types. The usual posture, selection and reach checks still apply. Recruits march to safe stops short of a fogged camp without a combat search.

A camp seen empty uses its single claimant's [travel priority](value.md#camp-value). For a later arrival, the claimant heads toward this turn's stopping point on the route to the camp. Danger can abort the move.

## Swing

The **swing** is the rise in our strength share when help joins.

`swing = s_h − s_R`, with `s_R = L_R² / (L_R² + T²)` and `s_h = (L_R + help)² / ((L_R + help)² + T²)`

| Part | Reads as |
| --- | --- |
| `s_R` (**Reinforce start**) | Our share of fighting power from `L_R`, squared per Lanchester's square law with the theater's exponent (`theater.steepness`, 2). When a fight has released local units into the candidate pool, `L_R` is below the fight's `L`, so the swing starts from a lower share than the fight's exposure uses. 1 with no enemy strength. |
| `L_R`, `T` | The battlefield's tallies after released local units enter the candidate pool. At a city they are the theater inputs; at a unit they are centered on the target. `L_R = L` when no local units are released. |
| `s_h − s_R` | Each added unit is worth less once our side dominates, so no separate cap is needed. As help grows without limit the swing approaches `1 − s_R`. |

The fight's exposure and the Withdraw's `s⁺` read the fight's share `s`, which the released candidate pool does not change.

**Swing curve** at the running strengths, `s_R = s = 0.307692` because no local units are released.

| Selection | Help | `s_h = (100 (L_R) + help)² / ((100 + help)² + 150² (T))` | Swing `s_h − 0.307692 (s_R)` |
| --- | --- | --- | --- |
| None | 0 | 0.307692, unchanged | 0 |
| A knight of strength 100, `j = 2` | `100 (strength) / 2 (j) = 50` | `150² / (150² + 150²) = 0.5` | 0.192308 |
| The spearman, `j = 1` | 100 | `200² / (200² + 150²) = 0.64` | 0.332308 |
| Supplied large group | 400 | `500² / (500² + 150²) = 0.917431` | 0.609739 |
| Unlimited | | 1 | `1 − 0.307692 (s_R) = 0.692308`, the bound |

## Selection

Native selection is described in full under [recruitment](recruitment.md#candidates-and-selection). After its reach check, it becomes the native admission proposal. An optional provider can retain it or admit a candidate subset before spotting or marching. Added candidates pass the same reach checks; failures stay excluded. The admitted group determines help, swing, turns to contact and any missing capture role. The command keeps its checked priority. See [participant admission](execution.md#participant-admission).

Path and competing-target rejections can clear when a nearby unit moves or dies. A friendly unit can reopen the offer even when its move leaves it spent. The retry still runs the same [reach and safe embark checks](execution.md#reinforce-readiness).

| Step | Rule |
| --- | --- |
| 1. Filter | Candidates beyond strike reach and within recruitment range. At an enemy city a candidate must also pass `CanStrikeCity`, so strength that cannot hurt the city is never counted. |
| 2. Cover need | Sort by join turns, travel turns, then unit ID, and select until full strength `S` meets `need`. |
| 3. Role unit | Enemy city only: if no local or selected unit can capture, the nearest remaining capturer joins, even when need is 0. Its strength counts in help. |

**Selection example.** Need 50 from the running inputs. The spearman has the lower unit ID in its tie with the horseman.

| Candidate | Strength | Travel turns | `j` | Help | Selected |
| --- | --- | --- | --- | --- | --- |
| Spearman | 100 | 2 | `max(1, 2 (travel) − 1) = 1` | `100 (strength) / 1 (j) = 100` | Yes; full strength 100 covers need 50. |
| Horseman | 50 | 2 | 1 | 50 | No; tie broken by unit ID, then selection stops. |
| Knight | 100 | 3 | `max(1, 3 (travel) − 1) = 2` | `100 / 2 (j) = 50` | No; need already covered. |

## Worked priorities

The table uses the running strengths and one spearman with `j = 1` unless stated otherwise, giving swing 0.332308 and `φ = 0.1`. The knight is at full health, worth 700 and in a cityless zone. The cities have no garrison or exposure in these examples.

| Destination | `θ` | Realized stake | Potential stake | Realized + `φ` × potential | Reinforce priority |
| --- | --- | --- | --- | --- | --- |
| Our capital at 25 of 250 HP, danger exceeds 25 | 0.975385 | 3 | 0 | 3 | 0.972 |
| Our capital at 200 of 250 HP, danger 80 | 0.803077 | 1.2 | 1.8 | 1.38 | 0.368 |
| Our capital at full health, enemy two turns out, no danger this turn | 0.753846 | 0 | 3 | 0.3 | 0.075 |
| Enemy city worth 45 at 125 of 250 HP, 50 local damage | 0.723077 | 0.72 | 2.28 | 0.948 | 0.228 |
| Same city at full health | 0.446154 | 0.36 | 2.64 | 0.624 | 0.093 |
| Enemy city worth 20 at half HP, no local units, enemy strength 100 | 0.4 | 0 | 3 | 0.3 | 0.060, swing 0.5 |
| Knight with 45 local damage, threatening the [archer](value.md#exposure) | 0.2 | 0.548846 | 1.961154 | 0.744962 | 0.050 |
| Knight with 30 local damage and no exposure | 0.2 | 0.21 | 1.54 | 0.364 | 0.024 |
| Same knight, no local damage | 0.2 | 0 | 1.75 | 0.175 | 0.012 |
| Same knight, still no local damage but help joins at `j = 2` | 0.2 | 0 | 1.75 | 0.0875 | 0.003, swing 0.192308 and `φ = 0.05` |

At the capital with 200 HP, danger realizes `3 × 80 / 200 = 1.2`. Reinforce also takes `0.1 × (3 − 1.2) = 0.18` of potential stake, giving `0.803077 × 1.38 × 0.332308 ≈ 0.368`.

The enemy city with 50 local damage loses 20 of that damage to healing, leaving 30. At half health that gives `3 × 30 / 125 = 0.72` realized stake.

If the only recruit for the knight has strength 25, `(100 + 25) / 150 ≈ 0.833` falls below parity. The priority is 0 even if there is potential stake.

For a cityless camp worth 0.05 with a full-health guard worth 100 and no local damage, the weighted stake before the camp floor is `0.1 × (100 / 400 + 0.05) = 0.03`. The floor raises it to 0.05, so at the running swing the offer scores `0.2 × 0.05 × 0.332308 ≈ 0.0033`. A fogged camp of the same value with the same swing scores 0.0033 directly on the camp value.

## Withdraw at the same battlefield

A [Withdraw](withdrawal.md) at the same battlefield competes with this offer for the turn; a Withdraw or Reinforce that moves a unit closes the other, with the own-city and disabled-switch exemptions in the [Withdraw closing rules](withdrawal.md#closing-the-battlefield).

Withdraw counts its own removable exposure. It credits projected help only if the Reinforce would score above zero without potential stake. See [Withdraw priority](withdrawal.md#withdraw-priority) for how that help affects `s⁺`.

### Army March in the same slot

A prepared combat army takes the same Reinforce slot and `eReinforce` state, but its [Army March](march.md#priority) is a separate offer with its own estimate:

`priority = θ × R × w_goal × g`

| Aspect | Reinforce | Army March |
| --- | --- | --- |
| Base | The battlefield's realized and discounted potential stake. | One turn of the army's formation progress at its operation's goal weight. |
| Risk | Exposure in the battlefield's stake. | Gather scores danger, and fallback movement checks danger at the stop. |
| Selection | Incoming candidates beyond strike reach. | The prepared army's own members who can still act. |
| Retirement | An executed Reinforce retires enemy battlefields counted in its strength estimate. | A March retires no offer, and no offer retires a March. |

The two offers never share a row. An army row supports only the Reinforce slot, and a battlefield row never carries an Army March.

## Reinforce against fights

Fight uses `θ × realized stake`. At the capital with 25 HP, Fight scores 2.926 and Reinforce scores 0.972. At 200 HP, Fight scores 0.964 and Reinforce scores 0.368. That Reinforce outranks a sure kill of the cityless knight at 0.350. At the large enemy city at half HP, Fight scores 0.521 and Reinforce scores 0.228.

If no local unit can hit the knight and there is no exposure, the Fight scores 0 while Reinforce can still score 0.012. As each command runs, the loop re-estimates open offers and their available recruits.
