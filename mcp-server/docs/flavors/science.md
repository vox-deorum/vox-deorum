# FLAVOR_SCIENCE

`FLAVOR_SCIENCE` weights scientific development across the AI's settlement, worker, research, trade, religion, and victory calculations. This reference is for developers interpreting flavor values or tuning the tactical AI through MCP. **FLAVOR_SPACESHIP** supplies a separate preference for the space-race endgame.

## Three kinds of value

The same flavor name appears on several scales:

| Value | Meaning | Current scale or example |
| --- | --- | --- |
| **Leader personality** | The civilization's preference, read through `CvFlavorManager` | Normally 0-10; the configured personality maximum is 10. Base leader values can be randomized at initialization. |
| **Content weight** | How strongly a building, technology, policy, or other database entry serves science | Independent of the personality scale. The Library has science weight 40 and Education has 25. |
| **MCP override** | An explicit preference supplied through `set-flavors` | Clamped to 0-100. The tool describes 50 as balanced, 70 as prioritize, and 100 as emergency focus. |

`CvFlavorManager::GetPersonalityIndividualFlavor` maps an active MCP override to the configured personality range with rounding. With the default maximum of 10, MCP Science 90 becomes personality science 9. `GetPersonalityFlavorForDiplomacy` maps overrides to 1-10, so MCP 0 still becomes 1 for diplomacy calculations.

**Effective preference** below means the value from `GetPersonalityAndGrandStrategy`. Normally it combines personality with the active grand strategy. With custom flavors active in VD mode, it returns the converted override alone; the grand strategy supplies strategic state without adding an implicit flavor bonus.

The defaults live in `civ5-dll/(1) Community Patch/Database Changes/Defines/CoreDefineChanges.sql`; conversion lives in `civ5-dll/CvGameCoreDLL_Expansion2/CvFlavorManager.cpp`. MCP validation and clamping live in `mcp-server/src/tools/actions/set-flavors.ts`.

## Where the AI reads it

All C++ files below are under `civ5-dll/CvGameCoreDLL_Expansion2/`. These calculations combine science preferences with other flavors and the current game state.

| System | Consumer | Science contribution |
| --- | --- | --- |
| Settlement | `CvSiteEvaluationClasses.cpp`, `CvSiteEvaluatorForSettler::ComputeFlavorMultipliers` | Adds twice the personality science value to the science-yield multiplier. |
| Feature clearing | `CvBuilderTaskingAI.cpp`, `AddChopDirectives` | Weights the natural science-yield change from removing a feature by personality science and `BUILDER_TASKING_PLOT_EVAL_MULTIPLIER_SCIENCE`, whose default is 2. |
| City specialization | `CvCitySpecializationAI.cpp`, `WeightSpecializations` | Uses ten times the effective science preference, clamped at zero, as an input to specialization weights. |
| Default victory pursuit | `CvDiplomacyAI.cpp`, `SelectDefaultVictoryPursuits` | Adds the diplomacy-scaled science flavor to the science pursuit score, alongside twice Loyalty, twice WarmongerHate, and diplomacy-scaled Growth. |
| Grand strategy | `CvGrandStrategyAI.cpp`, `GetSpaceshipPriority` | Adds an era-squared science term and bonuses from owned policies and buildings carrying science, spaceship, and growth flavors. |
| Research | `CvTechClasses.cpp`, `CvPlayerTechs::SetGSPriorities` | When science-focused, increments technology priority for positive science and spaceship flavor entries. |
| Trade | `CvTradeClasses.cpp` | Multiplies an adjusted technology/science advantage by the effective science preference when scoring international routes. |
| Religion | `CvReligionClasses.cpp`, `ScoreYieldForReligionTimes100` | Uses personality science multiplied by 80 as the personality factor for science-yield scoring. This is one factor in the belief evaluation. |
| Policies | `CvPolicyAI.cpp`, `WeighPolicy` | Adds positive policy science and spaceship weights to `iScienceValue`, then applies victory-interest and focus adjustments. |
| City-state valuation | `CvDiplomacyAI.cpp`, `DoContactMinorCivs` | Reads the effective science preference when valuing militaristic city-states and quest rewards. |
| Advisor recommendations | `CvAdvisorRecommender.cpp` | Assigns science flavor weight 13 in the science advisor's recommendation scoring. |

For example, personality science 9 contributes 18 to the settlement science multiplier. That is an additive input to a larger site score.

### Science victory priority

`GetSpaceshipPriority` adds `era² × max(1, personalityScience) × 3`. For era index 3 and personality science 9, this term is 243. It grows quadratically with the era index. The full priority also includes the civilization's progress, policies, buildings, and other conditions.

Default diplomacy pursuit selection uses the full diplomacy-scaled science value. A value of 9 contributes 9 points when those pursuits are selected. This selection runs during personality initialization and human/AI state changes; `set-flavors` does not rerun it.

### Policy and religion scores

Policy content weights and leader preferences enter `WeighPolicy` separately. A positive flavor entry adds the leader's effective preference to the general weight; the entry's own science weight contributes to `iScienceValue`. Victory interest then scales that subtotal, and science focus determines whether the full subtotal or half is added.

Likewise, religion's science multiplier of 80 is a personality factor inside a larger yield score. Culture uses 100 and faith uses 110 in the same function. These factors alone cannot predict the chosen belief.

## Static database examples

These are content weights from the checked-in Vox Populi SQL under `civ5-dll/(2) Vox Populi/Database Changes/AI/`. They illustrate the scale; the running game's merged database remains authoritative for its loaded mod set.

| Entry | Science weight | Source |
| --- | --- | --- |
| Library | 40 | `BuildingFlavorSweeps.sql` |
| University | 50 | `BuildingFlavorSweeps.sql` |
| Public School | 80 | `BuildingFlavorSweeps.sql` |
| Research Lab (`BUILDING_LABORATORY`) | 75 | `BuildingFlavorSweeps.sql` |
| School of Philosophy (`BUILDING_NATIONAL_COLLEGE`) | 100 | `BuildingFlavorSweeps.sql` |
| Writing | 15 | `TechFlavorSweeps.sql` |
| Education | 25 | `TechFlavorSweeps.sql` |
| Scientific Theory | 30 | `TechFlavorSweeps.sql` |
| Corporations | 30 | `TechFlavorSweeps.sql` |

`LeaderFlavorSweeps.sql` sets Gandhi's base science preference to 9, Casimir's to 8, and Isabella's to 5. These personality values express relative preferences; they do not prescribe a technology sequence, ideology, or willingness to sacrifice other needs.

## Related flavors

- **FLAVOR_SPACESHIP** contributes alongside science in research and science-victory evaluations.
- **FLAVOR_GROWTH** also contributes to science victory pursuit and the spaceship grand-strategy priority.
- **FLAVOR_GOLD**, **FLAVOR_CULTURE**, and **FLAVOR_RELIGION** contribute their own components to trade-route scoring.

For the override contract, see [set-flavors in the tool reference](../tools.md#action-tools-15). For the broader steering model, see [tactical AI influence](../tactical-ai-influence.md).
