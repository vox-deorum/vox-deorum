# Flavor Influence

How `set-flavors`, `unset-flavors`, `set-strategy`, and `keep-status-quo` steer the in-game AI through the flavor system.

For tool schemas and arguments, see [tools.md](../tools.md). For per-flavor deep dives, see [flavors/](../flavors/).

---

## How flavors steer AI

Flavors are the universal weighting system across nearly every AI subsystem. When `set-flavors` is called:

1. `CvFlavorManager::SetCustomFlavors` stores `m_CustomFlavors` in raw MCP range (0--100).
2. Values are converted to the game's internal range (-300..300) via an exponential curve: small changes near 50 (balanced) are modest; extreme values (0 or 100) have steep, outsized impact.
3. `ChangeActivePersonalityFlavors` broadcasts to all player-level `CvFlavorRecipient`s:
   - `CvGrandStrategyAI`
   - `CvEconomicAI`
   - `CvMilitaryAI`
   - `CvTechAI`
   - `CvPolicyAI`
   - `CvWonderProductionAI`
   - `CvDiplomacyAI` (victory weights)
4. `ChangeCityFlavors` broadcasts to every `CvCity` (each city is a `CvFlavorRecipient`).
5. Each recipient's `FlavorUpdate()` callback triggers re-evaluation of its decision logic.

`unset-flavors` replays the deltas negated, restoring the leader's baseline profile. Custom flavors auto-expire after 10 turns via `CheckCustomFlavorExpiration`.

---

## Per-flavor subsystem matrix

Not all flavors steer the same AI subsystems. **Y** = primary influence, dot = secondary.

| Flavor | City Build | City Spec | Site Eval | Worker | Tech | Policy | Wonder | Grand Strat | Military AI | Tactical | Diplomacy | Religion | Great Person | War Modifier |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Offense | . | . | | | . | . | | . | Y | Y | . | . | | Y |
| Defense | . | . | | | . | . | | . | Y | | | . | | Y |
| Ranged | | . | | | . | . | | . | . | Y | | | | |
| Mobile | | . | | | . | . | | . | . | Y | | | | |
| MilitaryTraining | | . | | | . | . | | . | Y | Y | | | | Y |
| Nuke | | | | | . | . | | | . | . | | | | Y |
| UseNuke | | | | | | . | | | | . | . | | | Y |
| Naval | . | . | | | | . | | . | . | | | | | Y |
| NavalGrowth | . | . | . | | . | . | | | | | | | | Y |
| NavalRecon | | . | | | . | | | | . | | | | | Y |
| NavalTileImprovement | | . | | Y | . | | | | | | | | | Y |
| Air | | . | | | . | . | | . | . | Y | | | | Y |
| AntiAir | | . | | | | . | | | . | Y | | | | Y |
| AirCarrier | | . | | | . | | | | . | Y | | | | Y |
| Airlift | | . | | | | . | | | | Y | | | | |
| CityDefense | | . | | | . | . | | | | | | . | | Y |
| Recon | | . | | | . | . | | | | | . | | | Y |
| Growth | . | . | Y | Y | . | . | | . | | | | | | Y |
| Expansion | . | . | . | | . | . | | . | | | . | | | Y |
| Production | . | . | . | Y | . | . | | . | | | | | . | Y |
| TileImprovement | | . | | Y | . | . | | | | | | | . | Y |
| Infrastructure | | . | | | . | . | | | | | | | | Y |
| Wonder | . | . | . | | . | . | Y | . | | | | | . | Y |
| Gold | . | . | . | Y | . | . | | . | | | | | | Y |
| Science | . | . | Y | Y | . | . | | . | | | | | . | |
| Happiness | | . | . | | . | . | | . | | | | | | Y |
| Diplomacy | . | | | | . | . | . | . | | | Y | | | |
| Culture | . | . | | | . | . | . | . | | | . | | . | |
| Espionage | | . | | | . | . | | | | | | | | |
| Spaceship | . | . | | | Y | . | | Y | | | | | | |
| WaterConnection | | | | | | . | | | | | . | | | |
| Religion | . | . | . | | . | . | . | . | | | . | Y | . | Y |
| GreatPeople | | . | | | . | . | . | . | | | | | Y | |
| Archaeology | | | | | | . | | | | | | | | Y |
| ILandTradeRoute | | | | | | . | | | | | | | | Y |
| ISeaTradeRoute | | | | | | . | | | | | | | | Y |
| ITradeOrigin | | | | | | . | | | | | | | | |
| ITradeDestination | | | | | | . | | | | | | | | |
| Mobilization | | . | | | | | | | | | | | | |

**Column key:**
- **City Build** -- `CvCityStrategyAI` building/unit production weight
- **City Spec** -- `CvCitySpecializationAI` per-city yield targets
- **Site Eval** -- `CvSiteEvaluationClasses` settler placement scoring
- **Worker** -- `CvBuilderTaskingAI` tile improvement priority
- **Tech / Policy** -- `CvTechAI` / `CvPolicyAI` candidate weighting
- **Wonder** -- `CvWonderProductionAI`
- **Grand Strat** -- `CvGrandStrategyAI` victory-type priority
- **Military AI** -- `CvMilitaryAI` threat assessment, offense/defense balance
- **Tactical** -- `CvTacticalAI` unit combat risk tolerance, HP thresholds
- **Diplomacy** -- `CvDiplomacyAI` approach, victory pursuit, deal valuation
- **Religion** -- `CvReligionAI` belief selection
- **Great Person** -- `CvPlayerAI` GP directive (improve vs. consume)
- **War Modifier** -- `MILITARYAISTRATEGY_*` / `AICITYSTRATEGY_*` SQL entries that shift the flavor dynamically

---

## Notable flavor behaviors

### Tactical combat (Offense)

`Offense` uniquely drives `CvTacticalAI` combat behavior in `FindBestAssignmentsForUnits`:

- **Minimum HP for combat:** 50 HP at Offense=0, down to 30 HP at Offense=10 (`gMinHpForTactsim = 50 - 2 * iOffenseFlavor`).
- **Unit-loss acceptance:** when Offense > 6 and the player has > 6 units, the AI accepts losing 1 unit per turn in tactical combat. Below that, it refuses any unit losses unless forced.

No other flavor touches tactical-combat risk tolerance this directly. See [flavors/offense.md](../flavors/offense.md).

### Builder/worker tasking

Six flavors directly steer `CvBuilderTaskingAI::ScorePlot`, multiplying yield-improvement deltas by the flavor value times a configurable per-yield multiplier:

- **Growth** -- food tile improvements (farms, fishing boats, pastures)
- **Production** -- production improvements (mines, lumber mills)
- **Gold** -- gold improvements (trading posts, customs houses)
- **Science** -- science improvements (academies)
- **TileImprovement** -- general improvement priority
- **NavalTileImprovement** -- work boat strategy, sea resource improvements

A flavor change can immediately shift whether workers build farms vs. mines vs. trading posts. See [flavors/growth.md](../flavors/growth.md) and [flavors/production.md](../flavors/production.md) for examples.

### City site evaluation

Only 6 flavors feed `CvSiteEvaluationClasses::ComputeFlavorMultipliers` for settler placement: **Growth**, **Expansion**, **Science**, **Religion**, **Wonder**, **Gold**. Changing these affects where the AI settles new cities.

### Religion belief selection

`CvReligionAI::ScoreBeliefForPlayer` multiplies yield-granting beliefs by the corresponding flavor times a large per-yield coefficient:

- **Religion** -- 110x multiplier on faith-granting beliefs (highest in the game)
- **Science** -- 80x on science-granting beliefs
- **Happiness** -- high multiplier on happiness-granting beliefs

Setting Religion=80 via `set-flavors` dramatically biases which beliefs the AI picks when founding or enhancing a religion. See [flavors/religion.md](../flavors/religion.md).

### Cross-subsystem feedback loops

Several flavors create self-reinforcing commitment loops through the grand strategy system:

- **Culture** -- building cultural infrastructure adds to grand strategy priority, which biases toward more culture buildings. The contribution is era-scaled: `(Era * Flavor * 150) / 100`, so it compounds in later eras.
- **Religion** -- founding a religion increases grand strategy priority for more faith buildings, which strengthens conversion pressure.
- **Wonder** -- constructing wonders adds to grand strategy priority, escalating wonder competition. Has a minimum weight floor: `min(FLAVOR_WONDER * 250, m_iNextWonderWeight * 0.2)`.

### Nonlinear MCP-to-game conversion

The exponential mapping from MCP range (0--100) to game range (-300..300) has practical implications:

- Changes near 50 (balanced) produce modest game-range deltas.
- Moving from 50 to 70 has a much smaller effect than moving from 70 to 90.
- Extreme values (0 or 100) produce the steepest effects.
- The flavor descriptions in `docs/flavors/` cite game-range values from XML entries; the MCP tool uses the 0--100 scale.

---

## Auto-activation thresholds

After setting custom flavors, `CvLuaPlayer::lSetCustomFlavors` auto-toggles specific economic and military strategies based on flavor value thresholds.

### Economic strategies

| Flavor threshold | Strategy activated |
|---|---|
| Happiness > 60 | `ECONOMICAISTRATEGY_NEED_HAPPINESS` |
| Happiness > 80 | `ECONOMICAISTRATEGY_NEED_HAPPINESS_CRITICAL` |
| Recon > 70 | `ECONOMICAISTRATEGY_NEED_RECON` |
| NavalRecon > 70 | `ECONOMICAISTRATEGY_NEED_RECON_SEA` |
| Diplomacy > 70 | `ECONOMICAISTRATEGY_NEED_DIPLOMATS` |
| Diplomacy > 90 | `ECONOMICAISTRATEGY_NEED_DIPLOMATS_CRITICAL` |
| Spaceship > 90 | `ECONOMICAISTRATEGY_GS_SPACESHIP_HOMESTRETCH` |
| Religion > 60 | `ECONOMICAISTRATEGY_DEVELOPING_RELIGION` |
| Expansion < 30 | `ECONOMICAISTRATEGY_ENOUGH_EXPANSION` |
| Expansion > 60 + game-state | `ECONOMICAISTRATEGY_EARLY_EXPANSION` (falls back to `EXPAND_TO_OTHER_CONTINENTS`) |
| Game-state (losing money) | `ECONOMICAISTRATEGY_LOSING_MONEY` |
| Grand-strategy-mapped | `GS_DIPLOMACY`, `GS_SPACESHIP`, `GS_CULTURE`, `GS_CONQUEST` |

Note: `ENOUGH_EXPANSION` uses inverted logic -- **low** expansion flavor (< 30) signals the AI has expanded enough and should stop settling.

### Military strategies

| Flavor threshold | Strategy activated |
|---|---|
| Defense > 60 | `MILITARYAISTRATEGY_EMPIRE_DEFENSE` |
| Defense > 80 | `MILITARYAISTRATEGY_EMPIRE_DEFENSE_CRITICAL` |
| Naval > 60 | `MILITARYAISTRATEGY_NEED_NAVAL_UNITS` |
| Naval > 80 | `MILITARYAISTRATEGY_NEED_NAVAL_UNITS_CRITICAL` |
| Naval < 25 | `MILITARYAISTRATEGY_ENOUGH_NAVAL_UNITS` |
| Game-state (barbarians) | `MILITARYAISTRATEGY_ERADICATE_BARBARIANS` |
| Game-state (barbarians) | `MILITARYAISTRATEGY_ERADICATE_BARBARIANS_CRITICAL` |

Each auto-activation fires its own flavor deltas via `SetUsingStrategy` -- **compound effect**. Setting Happiness=75 doesn't just bias building priorities; it also activates `NEED_HAPPINESS`, which fires additional flavor deltas, creating a cascade.

---

## Strategy-mediated flavor changes

`set-strategy` and `keep-status-quo` influence the AI primarily through flavors, not independently.

When `set-strategy` activates or deactivates economic/military strategies:

1. Each strategy has associated flavor deltas defined in XML/SQL.
2. `SetUsingStrategy(true)` fires `ChangeActivePersonalityFlavors` with positive deltas + `ChangeCityFlavors`.
3. `SetUsingStrategy(false)` fires the same with negative deltas (reversal).
4. `SetTurnStrategyAdopted` is forced 10 turns forward to prevent the in-game AI from immediately overriding the LLM's choice.

`keep-status-quo` re-applies the current strategy/flavor values without changing them, solely to refresh the override-prevention timer.

---

## Hard-coded strategy effects

These `set-strategy` effects do NOT go through the flavor system:

### City specialization rebuild

`SetGrandStrategy` marks `CvCitySpecializationAI` dirty via `SetSpecializationsDirty(SPECIALIZATION_UPDATE_NEW_GRAND_STRATEGY)`. On next DoTurn, `ComputeSpecializationWeights` reads `GetActiveGrandStrategy` and applies `GetSpecializationBoost` yield multipliers (YIELD_FOOD / GOLD / SCIENCE / PRODUCTION / CULTURE / FAITH). This reshapes per-city yield specialization targets -- which cities focus on food vs. production vs. science, etc.

### Victory pursuit mapping

`SetGrandStrategy` updates `CvDiplomacyAI` victory pursuit:

| Grand strategy | Victory pursuit |
|---|---|
| CONQUEST | VICTORY_PURSUIT_DOMINATION |
| CULTURE | VICTORY_PURSUIT_CULTURE |
| UNITED_NATIONS | VICTORY_PURSUIT_DIPLOMACY |
| SPACESHIP | VICTORY_PURSUIT_SCIENCE |

These map to `IsGoingForWorldConquest` / `IsGoingForDiploVictory` / `IsGoingForCultureVictory` / `IsGoingForSpaceshipVictory`, which control 50+ diplomatic decision points: war declarations, approach selection, deal valuation, coop-war willingness, target selection.

### Military strategy production weights

`ComputeSpecializationWeights` directly checks `IsUsingStrategy` for specific military strategies and applies hard-coded production weight adjustments (not flavor-mediated):

| Strategy | Effect |
|---|---|
| WAR_MOBILIZATION | +250 military training weight |
| EMPIRE_DEFENSE | +250 emergency unit weight |
| EMPIRE_DEFENSE_CRITICAL | +1250 emergency unit weight |
| ENOUGH_MILITARY_UNITS | Zeros military + emergency weights |
| NEED_NAVAL_UNITS | +50 sea weight |
| NEED_NAVAL_UNITS_CRITICAL | +250 sea weight |
| ENOUGH_NAVAL_UNITS | Zeros sea weight |

### Grand strategy production channeling

If the active grand strategy has a positive `GetSpecializationBoost(YIELD_PRODUCTION)`:
- With positive `FLAVOR_OFFENSE` -> production boost channels into military training weight.
- With positive `FLAVOR_SPACESHIP` -> production boost channels into spaceship weight.

---

## Dynamic wartime modifiers

Military/economic/city strategy SQL entries dynamically adjust flavors during war and crisis. These can **fight against or amplify** LLM-driven flavor changes:

| Situation | Key flavor changes (selected) |
|---|---|
| AT_WAR | Offense +40, Defense +40, Nuke +50, Air +40, Production +10, Growth -10, Wonder -20, Expansion -10, Religion -20, Diplomacy -20, Infrastructure -20, Archaeology -20 |
| WINNING_WARS | Offense +60, Mobile +50, Ranged +40, Happiness +20, Gold +20, Production +15, Wonder -10, Growth -10 |
| LOSING_WARS | Defense +100, CityDefense +40, Air +30, Expansion -100, Culture -50, Wonder -50, Diplomacy -40, Religion -40, Growth -30, MilitaryTraining -20 |
| LOSING_MONEY | Mobile -300, Naval -300, NavalRecon -300, Air -300, AntiAir -300, Ranged -300, Recon -300, Offense -50, Defense -50, Gold +100 |
| NEED_HAPPINESS_STARVE | Growth +60, TileImprovement +60, NavalGrowth +60 (city strategy via `AICITYSTRATEGY_*`) |

The LLM sets flavors, but the in-game AI layer still applies its own situational overlays. The net effect is the combination. If the LLM sets Growth=80 but the player is losing wars, the in-game strategy entry subtracts 30 from growth -- the net effect is attenuated.

---

## Cross-civ leak: FLAVOR_USE_NUKE

`FLAVOR_USE_NUKE` is the **only** flavor confirmed to be read cross-civ. Foreign `CvDiplomacyAI::SelectBestApproachTowardsMajorCiv` reads:

```
GET_PLAYER(ePlayer).GetFlavorManager()->GetPersonalityFlavorForDiplomacy(FLAVOR_USE_NUKE)
```

This converts to `iHowLikelyAreTheyToNukeUs = iFlavorNuke * 10`, shifting diplomatic approach scores toward AFRAID or GUARDED when the LLM player's nuke-use flavor is high.

All other flavors are scoped to the caller. Verified by grep: no other `GET_PLAYER(ePlayer).GetFlavorManager()` cross-civ call exists except an unused `EstimateFlavorValue` stub.

See [flavors/usenuke.md](../flavors/usenuke.md) for full detail on nuclear-strike probability, threat assessment, and policy preference effects.
