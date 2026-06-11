# Diplomatic Influence

How `set-persona` and `set-relationship` steer the in-game diplomatic AI.

For tool schemas and arguments, see [tools.md](../tools.md).

---

## Persona fields (`set-persona`)

### What it writes

`set-persona` forwards a Lua table to `CvLuaPlayer::lSetPersona`, which mutates 26 fields directly on the caller's `CvDiplomacyAI`. These runtime values replace the leader's current personality values on that AI object until overwritten.

**Core competitiveness:**
- `VictoryCompetitiveness` -- reaction intensity to others pursuing victories
- `WonderCompetitiveness` -- reaction intensity to wonder competition
- `MinorCivCompetitiveness` -- reaction intensity to city-state influence competition
- `Boldness` -- military risk-taking and territorial claims

**War and peace tendencies:**
- `WarBias` -- likelihood to plan or declare offensive war
- `HostileBias` -- tendency toward hostile postures without direct war
- `WarmongerHate` -- negative reaction to warlike behaviors
- `NeutralBias`, `FriendlyBias`, `GuardedBias`, `AfraidBias` -- approach biases

**Diplomacy and cooperation:**
- `DiplomaticBalance` -- increased relationship with non-competitive civs and peaceful resolution
- `Friendliness` -- desire for friendship declarations, increases maximum DoFs
- `WorkWithWillingness` -- tendency to collaborate with allies
- `WorkAgainstWillingness` -- tendency to bond over shared enemies
- `Loyalty` -- loyalty to allies; lower values enable backstabbing

**Minor civ relations:**
- `MinorCivFriendlyBias`, `MinorCivNeutralBias`, `MinorCivHostileBias`, `MinorCivWarBias`

**Personality traits:**
- `DenounceWillingness` -- readiness to denounce
- `Forgiveness` -- how quickly past transgressions are forgiven
- `Meanness` -- general aggressiveness, demanding/bullying
- `Neediness` -- desire for support from friends
- `Chattiness` -- frequency of diplomatic contact initiation
- `DeceptiveBias` -- tendency to be deceptively friendly

### Naming notes

- `Friendliness` is the MCP/Lua-facing label for the DLL field `DoFWillingness` (`m_iDoFWillingness`, `GetDoFWillingness`).
- The balance-of-power field in the DLL is `DiploBalance` (`m_iDiploBalance`, `GetDiploBalance`).
- The current bindings are asymmetric: `GetPersona()` returns `DiplomaticBalance`, but `SetPersona()` currently reads the key `DiploBalance`. In other words, the action schema and the Lua setter do not use the same key for that field today.

### AI subsystems and decisions

`CvDiplomacyAI::CalculateApproachTowardsPlayer` is the main consumer: its approach score vector (WAR, HOSTILE, DECEPTIVE, GUARDED, AFRAID, FRIENDLY, NEUTRAL) is seeded from `m_aiMajorCivApproachBiases[]`, then further modified by fields such as `GetBoldness`, `GetMeanness`, `GetVictoryCompetitiveness`, `GetDiploBalance`, and `GetDoFWillingness`.

**Key mechanisms:**

- **Boldness** reduces the AI's estimate of enemy military strength and target value by 3% per point (`MILITARY_STRENGTH_REDUCTION_PER_BOLDNESS = -3`, `TARGET_VALUE_REDUCTION_PER_BOLDNESS = -3`). At Boldness=10, the AI underestimates both by 30%.
- **Meanness** lowers the negative war score threshold via `GetWarscoreThresholdNegative()`, making the AI more willing to stay in unfavorable wars and less likely to accept peace.
- **VictoryCompetitiveness** + **Meanness** additively drive `VICTORY_PURSUIT_DOMINATION` scoring.
- **WonderCompetitiveness** feeds wonder-dispute and culture-victory logic.
- **DoFWillingness** (`Friendliness`), **DenounceWillingness**, **Loyalty**, and **Forgiveness** feed friendship, denouncement, and betrayal logic.
- **MinorCivWarBias**, **HostileBias**, **FriendlyBias**, **NeutralBias** drive city-state approach selection and bully/attack likelihood.
- `CvDealAI`, `CvGrandStrategyAI`, `CvMilitaryAI`, `CvReligionAI`, and other owner-side subsystems also read these getters directly when pricing deals, weighting victory plans, evaluating combat posture, or picking religious behavior.

### Timing

The write itself is immediate. There is no flavor broadcast, no opinion refresh, and no auto-recompute hook. Most observable behavior shifts on the next relevant diplomacy reevaluation, typically the next `CvDiplomacyAI::DoTurn`. The values persist until overwritten; there is no expiration timer.

### Cross-civ scope

The live values are stored directly on the caller's `CvDiplomacyAI`, but foreign civs usually reason about another leader through `Estimate*` helpers rather than by reading those raw fields.

- For **teammates**, `EstimateVictoryCompetitiveness`, `EstimateBoldness`, `EstimateDiploBalance`, `EstimateDoFWillingness`, `EstimateMeanness`, `EstimateMajorCivApproachBias`, and related helpers return the live runtime values.
- For **non-teammates**, those same helpers usually fall back to XML leader values, or to neutral/default estimates for human players and random-personality games.
- Practical effect: `set-persona` strongly changes the caller's own diplomacy logic and teammate-visible personality estimates, but non-teammate AIs usually continue reasoning about that leader through estimated base personality, not the full custom runtime persona.

---

## Relationship modifiers (`set-relationship`)

This is the one tool whose effect leaks to non-LLM civs that never touched any LLM machinery.

### What it writes

`set-relationship` writes two modifier arrays on the **caller's** `CvDiplomacyAI`:

- `m_aiScenarioModifier1[target]` -- "public" modifier
- `m_aiScenarioModifier2[target]` -- "private" modifier

The tool inverts the user-supplied values before storage:

- `Public = +40` stores `m_aiScenarioModifier1[target] = -40`
- `Private = +40` stores `m_aiScenarioModifier2[target] = -40`

This inversion exists because Civ V's opinion weight is signed in the opposite direction: positive internal values are worse, negative values are friendlier.

The arrays themselves are local storage on the caller. Foreign AI code does not directly read another civ's raw scenario-modifier arrays.

### Two propagation paths

There are two distinct ways these modifiers matter:

1. **Raw modifier path** -- the stored `ScenarioModifier1/2` values are read directly in a small number of places. The confirmed gameplay consumers are:
   - peace willingness in `CvDiplomacyAI`, where `GetScenarioModifier1(ePlayer) + GetScenarioModifier2(ePlayer)` directly shifts `iPeaceScore` when `MOD_IPC_CHANNEL` is active
   - coop-war desire in `CvDiplomacyAI::GetCoopWarDesireScore`, where `GetCachedScenarioModifier1(eTargetPlayer) + GetCachedScenarioModifier2(eTargetPlayer)` is added directly to the score before target-value scaling
2. **Cached opinion path** -- `CvDiplomacyAI::GetDiploModifiers` sums modifier1, modifier2, and modifier3 into an opinion delta, `CalculateCivOpinionWeight` includes that delta when `MOD_EVENTS_DIPLO_MODIFIERS` is active and the game is not network multiplayer, and `DoUpdateOpinions` then stores the result in `SetCachedOpinionWeight` and `SetCivOpinion`.

Most downstream effects come from the second path, not the first.

### Opinion cascade mechanics

1. `CvDiplomacyAI::GetDiploModifiers` sums modifier1, modifier2, and modifier3 into an opinion delta. In Vox Deorum mode, modifier2's normal breakdown string is hidden behind the `MOD_IPC_CHANNEL` guard, but the numeric value still counts.
2. `CalculateCivOpinionWeight` only adds `GetDiploModifiers` when `MOD_EVENTS_DIPLO_MODIFIERS` is active and the game is not network multiplayer.
3. `DoUpdateOpinions` caches the refreshed weight through `SetCachedOpinionWeight`, then maps it to opinion bands using the normal thresholds: `160`, `80`, `30`, `-30`, `-80`, `-160`.
4. `GetCachedOpinionWeight` and `GetCivOpinion` are then consumed across many DLL subsystems.

These modifiers therefore do not only change how A "feels about" B. Once opinions refresh, they also change how other systems score B as a partner, rival, target, founder, trade partner, or diplomatic threat.

### What can change

| Subsystem | Representative symbols | Mechanism | What shifts |
|---|---|---|---|
| Core diplomacy | `CvDiplomacyAI::CalculateApproachTowardsPlayer`, `GetCoopWarDesireScore`, `RespondToCoopWarRequest`, `IsCoopWarRequestUnacceptable`, friendship / denouncement / warning / war logic | `GetCivOpinion`, some `GetCachedOpinionWeight`, plus direct cached `ScenarioModifier1/2` in coop-war desire | Approach selection, coop-war desire, coop-war request reactions, warn-target behavior, and "friend vs enemy" branching |
| Peace willingness | `CvDiplomacyAI` peace scoring around `iPeaceScore` | **Direct `GetScenarioModifier1/2` read** | Immediate willingness to continue war or accept peace, without waiting for cached opinion recomputation |
| Deals and treaty behavior | `CvDealAI` demand, gift, peace, vassalage, and treaty valuation paths | Mostly `GetCivOpinion` | Demand compliance, gift willingness, peace valuation, vassalage acceptability, and general deal scoring |
| World Congress / voting | `CvVotingClasses` proposal evaluation and target scoring; `CvDiplomacyAI` league ally / competitor selection | Both `GetCivOpinion` and `GetCachedOpinionWeight` | Resolution support, sanctions and target preferences, ally/competitor ranking, and proposal priorities |
| Trade and economic behavior | `CvTradeClasses`, `CvEconomicAI` | Mostly `GetCivOpinion` | International trade-route attractiveness, trade-partner friendliness handling, and hostile city-state-ally counting |
| Settlement / territorial planning | `CvSiteEvaluationClasses`, `CvCultureClasses`, `CvBuilderTaskingAI` | Mostly `GetCivOpinion` | Borderland settlement pressure, archaeological landmark vs artifact choices, and tile-steal / build-task hostility weighting |
| Military / tactical behavior | `CvMilitaryAI`, `CvTacticalAnalysisMap`, `CvDiplomacyAI` target / competitor logic | `GetCivOpinion` plus some `GetCachedOpinionWeight` comparisons | Nuclear launch willingness, tactical danger estimates, military threat framing, and rival/target ranking |
| Religion / espionage / misc. systems | `CvReligionClasses`, `CvEspionageClasses`, `CvPlayer`, `CvGame` | Mostly `GetCivOpinion` | Religion founder preference weighting, coup / influence-penalty exceptions, grateful-settler defect chance, and high-level major-opinion summaries |

### Important examples by category

- **Core diplomacy** -- opinion bands drive friendly/guarded/hostile branching throughout `CvDiplomacyAI`, including coop-war request acceptability, ally/friend checks, enemy checks, and many "warn, denounce, help, backstab, or cooperate" decisions. Separately, Vox Deorum adds the raw relationship modifiers directly into `GetCoopWarDesireScore`, so hostility toward the target can raise coop-war desire even before the next opinion refresh.
- **Coop war specifics** -- `RespondToCoopWarRequest` accepts a request when `GetCoopWarDesireScore(...)` reaches the coop-war threshold; accepted or preparing requests then set `COOP_WAR_STATE_PREPARING` / `ONGOING` and update the target's approach to `CIV_APPROACH_WAR`. `IsCoopWarRequestUnacceptable` also branches on `GetCivOpinion` toward both asker and target, so the modifiers can affect coop war through both the direct desire hook and the later opinion-band path.
- **Deals and treaty behavior** -- `CvDealAI` switches on `GetCivOpinion` for human-demand compliance, peace valuation, and vassalage-related deal scoring.
- **World Congress / voting** -- `CvVotingClasses` uses both banded opinion and numeric cached-weight comparisons when scoring proposals, allies, competitors, sanctions, and targets.
- **Trade and economy** -- `CvTradeClasses` discounts the downside of enriching civs that the AI likes, and `CvEconomicAI` tracks whether city-state allies belong to civs it sees as competitors, enemies, or hostiles.
- **Settlement / planning** -- `CvSiteEvaluationClasses` pushes border settlement harder near disliked neighbors and backs off near friends; `CvCultureClasses` and `CvBuilderTaskingAI` also branch on major-civ opinion.
- **Military / tactical** -- `CvMilitaryAI` is more willing to roll for nukes against hated civs, and `CvTacticalAnalysisMap` treats neighboring hostile/enemy civs as more dangerous.
- **Religion / espionage / misc.** -- `CvReligionClasses` heavily scales some scores by founder opinion, `CvEspionageClasses` exempts some hated or untrustworthy prior allies from extra influence penalties, and `CvPlayer` / `CvGame` use opinion bands in broader world-state logic.

### Bands vs weights

Two different downstream patterns matter:

- **Opinion-band consumers** react to state changes like `ALLY`, `FRIEND`, `FAVORABLE`, `NEUTRAL`, `COMPETITOR`, `ENEMY`, or `UNFORGIVABLE`. These are the most common.
- **Cached-weight consumers** compare the numeric `GetCachedOpinionWeight` values directly, usually to rank which civ is the bigger rival, preferred ally, or more acceptable diplomatic target.

Crossing a threshold such as `30`, `80`, `160`, `-30`, `-80`, or `-160` can therefore cause a wider jump than the raw number alone suggests, because many branches trigger on the band, not only the underlying weight.

### Timing

Two timings matter:

- **Immediate** -- the raw scenario modifiers are stored immediately, raw getter/debug-style pathways can observe them immediately, and the direct peace-score and coop-war-desire consumers can react immediately.
- **Next opinion refresh** -- cached opinion, opinion bands, and most foreign-AI side effects update on the next `CvDiplomacyAI::DoTurn` that runs `DoUpdateOpinions`.

In network multiplayer, `CalculateCivOpinionWeight` skips the `GetDiploModifiers` path, so the normal cached-opinion cascade should not be described as unconditional there.

### Three-audience visibility

| Audience | Immediate raw numeric | Immediate string visibility | Composite opinion impact |
|---|---|---|---|
| Non-LLM VPAI (C++) | No foreign raw-array read | No | Yes, via `GetCachedOpinionWeight` / `GetCivOpinion` after opinion refresh, when the diplo-modifier path is active |
| Other LLM (via `get-opinions`) | Indirect rather than raw-array access | Public-string paths are visible; private-string paths are hidden in normal VD mode except self/debug-style views | Yes, through the refreshed opinion table and composite opinion |
| Human UI / raw Lua | Yes, through `GetScenarioModifier1/2` on the owner | Public modifier strings are visible; private modifier strings are hidden in normal VD mode, but self/debug strings exist (`TXT_KEY_SPECIFIC_DIPLO_STRING_1_SELF`, `TXT_KEY_SPECIFIC_DIPLO_STRING_2_SELF`) | Yes, once opinion refresh has recomputed the cached totals |

### Modifier3 note

`SetScenarioModifier3` exists as a Lua binding and is summed by `GetDiploModifiers`, but **no current MCP tool writes to it**. It stays at its default value and contributes nothing to the cascade.
