# Diplomatic Influence

This reference explains how `set-persona` and `set-relationship` steer the in-game diplomatic AI, for developers tracing an action's effect through the DLL.

For tool schemas and arguments, see [tools.md](../tools.md).

---

## Persona fields (`set-persona`)

### What it writes

`set-persona` exposes 26 optional personality fields and forwards the supplied values to `CvLuaPlayer::lSetPersona`. The tool clamps them to 1-10; the Lua setter replaces the recognized fields directly on the caller's `CvDiplomacyAI`. Values persist until overwritten. The balance-field naming mismatch below prevents that field from being set through the current tool.

**Core competitiveness:**

- `VictoryCompetitiveness`: reaction intensity to others pursuing victories
- `WonderCompetitiveness`: reaction intensity to wonder competition
- `MinorCivCompetitiveness`: reaction intensity to city-state influence competition
- `Boldness`: military risk-taking and territorial claims

**War and peace tendencies:**

- `WarBias`: likelihood to plan or declare offensive war
- `HostileBias`: tendency toward hostile postures without direct war
- `WarmongerHate`: negative reaction to warlike behaviors
- `NeutralBias`, `FriendlyBias`, `GuardedBias`, `AfraidBias`: approach biases

**Diplomacy and cooperation:**

- `DiplomaticBalance`: increased relationship with non-competitive civs and peaceful resolution
- `Friendliness`: desire for friendship declarations, increases maximum DoFs
- `WorkWithWillingness`: tendency to collaborate with allies
- `WorkAgainstWillingness`: tendency to bond over shared enemies
- `Loyalty`: loyalty to allies; lower values enable backstabbing

**Minor civ relations:**

- `MinorCivFriendlyBias`, `MinorCivNeutralBias`, `MinorCivHostileBias`, `MinorCivWarBias`

**Personality traits:**

- `DenounceWillingness`: readiness to denounce
- `Forgiveness`: how quickly past transgressions are forgiven
- `Meanness`: general aggressiveness, demanding/bullying
- `Neediness`: desire for support from friends
- `Chattiness`: frequency of diplomatic contact initiation
- `DeceptiveBias`: tendency to be deceptively friendly

### Naming notes

- `Friendliness` is the MCP/Lua-facing label for the DLL field `DoFWillingness` (`m_iDoFWillingness`, `GetDoFWillingness`).
- The balance-of-power field in the DLL is `DiploBalance` (`m_iDiploBalance`, `GetDiploBalance`).
- `GetPersona()` and the action schema use `DiplomaticBalance`; `SetPersona()` reads `DiploBalance`. As a result, the current MCP field is ignored by the setter.

### AI subsystems and decisions

`CvDiplomacyAI::SelectBestApproachTowardsMajorCiv` is the main consumer: its approach score vector (WAR, HOSTILE, DECEPTIVE, GUARDED, AFRAID, FRIENDLY, NEUTRAL) uses the major-civ approach biases and fields such as `GetBoldness`, `GetMeanness`, `GetVictoryCompetitiveness`, `GetDiploBalance`, and `GetDoFWillingness`.

**Key mechanisms:**

- **Boldness** reduces the AI's estimate of enemy military strength and target value by 3% per point (`MILITARY_STRENGTH_REDUCTION_PER_BOLDNESS = -3`, `TARGET_VALUE_REDUCTION_PER_BOLDNESS = -3`). At Boldness=10, the AI underestimates both by 30%.
- **Meanness** lowers the negative war score threshold via `GetWarscoreThresholdNegative()`, making the AI more willing to stay in unfavorable wars and less likely to accept peace.
- **Boldness** and **Meanness** contribute to default `VICTORY_PURSUIT_DOMINATION` scoring in `SelectDefaultVictoryPursuits`.
- **WonderCompetitiveness** feeds wonder-dispute and culture-victory logic.
- **DoFWillingness** (`Friendliness`), **DenounceWillingness**, **Loyalty**, and **Forgiveness** feed friendship, denouncement, and betrayal logic.
- **MinorCivWarBias**, **MinorCivHostileBias**, **MinorCivFriendlyBias**, and **MinorCivNeutralBias** drive city-state approach selection and bully/attack likelihood.
- `CvDealAI`, `CvGrandStrategyAI`, `CvMilitaryAI`, `CvReligionAI`, and other owner-side subsystems also read these getters directly when pricing deals, weighting victory plans, evaluating combat posture, or picking religious behavior.

### Timing

The write itself is immediate. There is no flavor broadcast, no opinion refresh, and no auto-recompute hook. Most observable behavior shifts on the next relevant diplomacy reevaluation, typically the next `CvDiplomacyAI::DoTurn`. The values persist until overwritten; there is no expiration timer.

Default victory pursuits are selected during personality initialization and human/AI state changes. `set-persona` does not rerun `SelectDefaultVictoryPursuits`.

### Cross-civ scope

The live values are stored directly on the caller's `CvDiplomacyAI`, but foreign civs usually reason about another leader through `Estimate*` helpers rather than by reading those raw fields.

- For **teammates**, `EstimateVictoryCompetitiveness`, `EstimateBoldness`, `EstimateDiploBalance`, `EstimateDoFWillingness`, `EstimateMeanness`, `EstimateMajorCivApproachBias`, and related helpers return the live runtime values.
- For **non-teammates**, those same helpers usually fall back to XML leader values, or to neutral/default estimates for human players and random-personality games.

The caller's own diplomacy and teammate-visible estimates therefore use the custom persona. Other civilizations usually continue using estimated base personality.

---

## Relationship modifiers (`set-relationship`)

Relationship changes can affect other civilizations through the caller's refreshed opinion of its target.

### What it writes

`set-relationship` writes two modifier arrays on the **caller's** `CvDiplomacyAI`:

- `m_aiScenarioModifier1[target]`: "public" modifier
- `m_aiScenarioModifier2[target]`: "private" modifier

The tool inverts the user-supplied values before storage:

- `Public = +40` stores `m_aiScenarioModifier1[target] = -40`
- `Private = +40` stores `m_aiScenarioModifier2[target] = -40`

This inversion exists because Civ V's opinion weight is signed in the opposite direction: positive internal values are worse, negative values are friendlier.

The arrays themselves are local storage on the caller. Foreign AI code does not directly read another civ's raw scenario-modifier arrays.

The MCP field descriptions give an intended range of -100 to 100, with positive values expressing friendliness. Both default to zero. The current tool accepts numeric values without enforcing that range.

### How modifiers reach decisions

The stored values reach gameplay through two paths:

| Path | Readers | Timing and effect |
| --- | --- | --- |
| **Direct modifier reads** | Peace scoring, approach scoring, and `GetCoopWarDesireScore` in `CvDiplomacyAI` | These calculations can use the newly stored values as soon as they next run, without an opinion refresh. The added hooks require `MOD_IPC_CHANNEL`. |
| **Opinion cascade** | `GetDiploModifiers` → `CalculateCivOpinionWeight` → `DoUpdateOpinions` | The summed modifiers change the cached opinion weight and its opinion band. Most downstream consumers use these refreshed results. |

`GetCachedScenarioModifier1/2` read the same arrays the setters just updated, without Lua callbacks.

`GetScenarioModifier1/2`, used by peace scoring and the opinion cascade, can refresh those arrays from the `GetScenarioDiploModifier1/2` Lua hooks. With no hook result, they keep the stored values.

The opinion cascade requires `MOD_EVENTS_DIPLO_MODIFIERS` and a game that is not network multiplayer. `GetDiploModifiers` sums modifiers 1, 2, and 3; modifier2 still counts numerically when its normal breakdown string is hidden in VD mode. `DoUpdateOpinions` stores the resulting weight with `SetCachedOpinionWeight` and maps it to a band through `SetCivOpinion`.

**Opinion bands** supply categorical decisions such as friend-versus-enemy branching. **Cached opinion weights** preserve the numeric score for ranking rivals, allies, and targets. With the default thresholds, the mapping is:

| Cached weight                    | Band           |
| -------------------------------- | -------------- |
| Greater than or equal to 160     | `UNFORGIVABLE` |
| 80 to less than 160              | `ENEMY`        |
| 30 to less than 80               | `COMPETITOR`   |
| Greater than -30 to less than 30 | `NEUTRAL`      |
| Greater than -80 through -30     | `FAVORABLE`    |
| Greater than -160 through -80    | `FRIEND`       |
| -160 or lower                    | `ALLY`         |

The thresholds come from the `OPINION_THRESHOLD_*` defines. Crossing one can change several categorical branches at once; changing a weight within a band can still change a numeric ranking.

### Direct effects and an example

The VD hooks in `CvDiplomacyAI.cpp` apply the stored modifiers as follows:

- **Peace willingness:** adds the negated sum of Public and Private storage values, divided by 10, to `iPeaceScore`.
- **Approach selection:** friendly intent damps the WAR score using the stronger of Public or Private, and damps DECEPTIVE using Private alone. At MCP +100, the corresponding score is scaled to zero. Existing cooperative-war commitments are handled separately.
- **Cooperative-war desire:** adds the stored Public-plus-Private sum divided by 20 before target-value scaling, after rejecting an objectively nonpositive base score.

For example, MCP `Public = +40`, `Private = 0` stores `-40` and `0`. The peace hook adds 4 points; the WAR approach hook scales its score to 60%; the coop-war hook subtracts 2 raw points. These adjustments apply when each calculation runs. The later opinion refresh also includes the -40 opinion delta, subject to the cascade's mode guards.

`RespondToCoopWarRequest` compares desire with its acceptance threshold. Accepted or preparing requests set `COOP_WAR_STATE_PREPARING` / `ONGOING` and update the target's approach to `CIV_APPROACH_WAR`. `IsCoopWarRequestUnacceptable` also reads opinion bands toward both asker and target, so cooperation can depend on both paths.

### Downstream consumers

This map identifies where to investigate a changed decision after an opinion refresh. All named C++ files are under `civ5-dll/CvGameCoreDLL_Expansion2/`.

| Category | Representative consumers | What the opinion input affects |
| --- | --- | --- |
| Core diplomacy | `CvDiplomacyAI::SelectBestApproachTowardsMajorCiv`, `IsCoopWarRequestUnacceptable`, friendship, denouncement, warning, and war logic | Approach and friend/enemy branches, cooperative-war reactions, and target selection |
| Deals and treaties | `CvDealAI` demand, gift, peace, and vassalage paths | Compliance, willingness, valuation, and acceptability |
| World Congress | `CvVotingClasses`; league ally/competitor selection in `CvDiplomacyAI` | Resolution support, sanctions, target preferences, and numeric ally/rival rankings |
| Trade and economy | `CvTradeClasses`, `CvEconomicAI` | How much it matters to enrich a trade partner, and whether city-state allies belong to hostile or competing civs |
| Settlement and territory | `CvSiteEvaluationClasses`, `CvCultureClasses`, `CvBuilderTaskingAI` | Border settlement pressure, landmark/artifact choices, and hostile tile-steal/build-task weighting |
| Military and tactics | `CvMilitaryAI`, `CvTacticalAnalysisMap`, diplomacy target/competitor logic | Nuclear willingness, danger estimates, threat framing, and target ranking |
| Religion and espionage | `CvReligionClasses`, `CvEspionageClasses` | Founder preference and influence-penalty exceptions |
| World-state summaries | `CvPlayer`, `CvGame` | Grateful-settler defect chance and major-opinion summaries |

Most of these consumers use `GetCivOpinion`. Congress and target-ranking code also use `GetCachedOpinionWeight` directly.

### Timing

The setters update the arrays immediately and do not trigger recomputation. Direct consumers can react on their next calculation. Cached opinion weights, bands, and their downstream effects update when `DoUpdateOpinions` next runs, normally through `CvDiplomacyAI::DoTurn`. The normal opinion cascade is skipped in network multiplayer.

### Three-audience visibility

| Audience | Immediate raw numeric | Immediate string visibility | Composite opinion impact |
| --- | --- | --- | --- |
| Non-LLM VPAI (C++) | No foreign raw-array read | No | Yes, via `GetCachedOpinionWeight` / `GetCivOpinion` after opinion refresh, when the diplo-modifier path is active |
| Other LLM (via `get-opinions`) | Indirect rather than raw-array access | Public-string paths are visible; private-string paths are hidden in normal VD mode except self/debug-style views | Yes, through the refreshed opinion table and composite opinion |
| Human UI / raw Lua | Yes, through `GetScenarioModifier1/2` on the owner | Public modifier strings are visible; private modifier strings are hidden in normal VD mode, but self/debug strings exist (`TXT_KEY_SPECIFIC_DIPLO_STRING_1_SELF`, `TXT_KEY_SPECIFIC_DIPLO_STRING_2_SELF`) | Yes, once opinion refresh has recomputed the cached totals |

### Modifier3 note

`SetScenarioModifier3` exists as a Lua binding and is summed by `GetDiploModifiers`. **No current MCP tool writes to it**; its value can still come from other Lua code or the `GetScenarioDiploModifier3` callback.
