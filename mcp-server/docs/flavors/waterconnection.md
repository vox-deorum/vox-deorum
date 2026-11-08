# FLAVOR_WATER_CONNECTION

`FLAVOR_WATER_CONNECTION` expresses the AI's preference for water-based city connections. This reference is for developers interpreting coastal infrastructure weights or tuning AI preferences through MCP.

## Coastal-city threshold

The economic strategy **ECONOMICAISTRATEGY_ONE_OR_FEWER_COASTAL_CITIES** counts the player's cities whose `isCoastal()` predicate is true:

| Coastal cities | Strategy predicate | Purpose |
| --- | --- | --- |
| 0 or 1 | True | Suppress water-connection flavor while the empire lacks multiple coastal cities. |
| 2 or more | False | Remove this reason to suppress water-connection flavor. Other strategy and flavor inputs still apply. |

The predicate lives in `EconomicAIHelpers::IsTestStrategy_OneOrFewerCoastalCities` in `civ5-dll/CvGameCoreDLL_Expansion2/CvEconomicAI.cpp`. Its source comment describes the strategy as nullifying the flavor; the strategy's configured flavor modifiers determine the adjustment. `CvEconomicAI::DoTurn` evaluates strategies subject to their prerequisites, start conditions, and recheck intervals, so a change in city count takes effect when the strategy is reevaluated.

The DLL blacklists this formula-driven strategy from the normal `Player:GetEconomicStrategies` results and `Player:SetEconomicStrategies` updates. Both bindings have an optional `includeBlacklisted` flag for explicit access. See `civ5-dll/CvGameCoreDLL_Expansion2/Lua/CvLuaPlayer.cpp`.

## Other consumers

| System | Use | Source under `civ5-dll/CvGameCoreDLL_Expansion2/` |
| --- | --- | --- |
| Policy evaluation | Positive policy water-connection weights contribute to the diplomatic subtotal, alongside `FLAVOR_I_TRADE_DESTINATION`. Victory interest and diplomatic focus adjust that subtotal. | `CvPolicyAI.cpp`, `WeighPolicy` |
| Economic advisor | Assigns water-connection flavor weight 17 when scoring recommendations. This is a scoring weight, with the final recommendation also depending on the candidate and other flavors. | `CvAdvisorRecommender.cpp` |

In `WeighPolicy`, the leader's effective preference from `GetPersonalityAndGrandStrategy` also contributes to the general weight for each positive policy flavor. The policy's water-connection weight then enters the diplomatic subtotal separately. The calculation combines these contributions with victory interest and focus adjustments.

## Values and static examples

**Leader personality** normally uses a 0-10 scale. **Content weights** on buildings and technologies have their own scale. **MCP overrides** supplied through `set-flavors` are clamped to 0-100 and converted by `CvFlavorManager` for personality consumers; see [the science reference's scale explanation](science.md#three-kinds-of-value).

The checked-in SQL under `civ5-dll/(2) Vox Populi/Database Changes/AI/` supplies these examples:

| Entry | Water-connection value | Source |
| --- | --- | --- |
| Lighthouse | 40 content weight | `BuildingFlavorSweeps.sql` |
| Runestone | 40 content weight | `BuildingFlavorSweeps.sql` |
| Sailing (`TECH_OPTICS`) | 20 content weight | `TechFlavorSweeps.sql` |
| Elizabeth | 8 base personality | `LeaderFlavorSweeps.sql` |
| Harald | 8 base personality | `LeaderFlavorSweeps.sql` |
| Kamehameha | 8 base personality | `LeaderFlavorSweeps.sql` |

`StrategyChanges.sql` also assigns a water-connection modifier of 60 to `AICITYSTRATEGY_NEED_HAPPINESS_CONNECTION`, alongside infrastructure and tile-improvement modifiers. These are inputs to AI weighting. Final choices also depend on geography, available content, and the other scoring inputs.

## Related flavors

- **FLAVOR_INFRASTRUCTURE** covers broader city-connection priorities and shares the connection-happiness strategy modifier.
- **FLAVOR_NAVAL_GROWTH** and **FLAVOR_NAVAL_TILE_IMPROVEMENT** supply other coastal-development preferences.
- **FLAVOR_I_SEA_TRADE_ROUTE** supplies a separate preference for international sea trade routes.
- **FLAVOR_I_TRADE_DESTINATION** shares the diplomatic policy subtotal described above.

Use the loaded game's database tools to inspect the actual buildings and technologies available for its mod set. The [tool reference](../tools.md) describes those queries and the `set-flavors` override contract.
