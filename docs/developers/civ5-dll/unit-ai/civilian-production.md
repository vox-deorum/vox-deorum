# Unit AI: Civilian Production

This page describes the interface between civilian demand and city production in the **Vox Populi 5.2.7** baseline. Its job is to turn role-specific needs into scored civilian unit candidates for a city. The shared production comparison decides whether a candidate becomes the next build.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, primarily `CvUnitProductionAI.cpp`, `CvCityStrategyAI.cpp`, `CvEconomicAI.cpp`, `CvTradeClasses.cpp`, and `CvMilitaryAI.cpp`.

## Inputs and outputs

| Inputs | What they supply |
| --- | --- |
| Effective city flavors | The primary unit-preference vector. Vox Deorum custom flavors feed it directly when active. |
| Role state | Expansion state, settle-plot quality, improvement needs, exploration needs, route priorities, diplomatic flags, and archaeology needs. |
| Existing commitments | Relevant units already present, already available, or already in production. |
| Local feasibility | City trainability, construction time, population, growth timing, tactical safety, reachable work, and other city conditions. |
| Military and economic context | War, siege, force shortages, maintenance, resources, and empire priorities. |

The output is a list of zero or more civilian candidates. Each contains a concrete trainable unit type, the city's remaining turns to construct it, and a positive revised weight before the shared construction-time discount. A rejected unit is absent from the list; its negative skip reason is diagnostic information for logging.

These candidates enter `CvCityStrategyAI::ChooseProduction` beside military units and non-unit buildables. If one wins, city production creates an `ORDER_TRAIN` order with the selected unit type and its default unit role (`UnitAI`).

Named `ECONOMICAISTRATEGY_*` and `AICITYSTRATEGY_*` values below are specific Vox Populi boolean state flags. They act as gates or bonuses for particular roles. They are not a separate general source of intent: flavors supply the base preference, and these named states revise it for current conditions.

Civilian production retains little demand state of its own. Source systems retain the need, and production reads it when choosing. The main feedback exception is the settler-skip counter, which raises future settler pressure until a settler is chosen or no viable settler remains.

## Distributed demand

There is no general civilian force target. Each role supplies its own interface:

| Role | Demand owner and signal | Production effect |
| --- | --- | --- |
| Settler | Expansion flavors and named Economic AI and city AI states describe expansion value. | Expansion value and earlier skips adjust the candidate. |
| Worker | Named city AI states compare workers with outstanding improvement work. | Worker shortage adjusts the candidate. |
| Work boat | Reachable water resources define local work. | Outstanding reachable work adjusts the candidate. |
| Land explorer | Economic AI estimates need; Military AI applies shared supply. | The supply-aware shortfall adjusts the candidate. |
| Trade unit | Trade AI ranks each city as a land or sea route origin. | Route-origin priority adjusts the matching candidate. |
| Diplomatic unit | Named Economic AI and city AI states report diplomatic need. | Useful targets and expected influence adjust the candidate. |
| Archaeologist | Economic AI compares archaeologists with sites. | Site and culture value adjust the candidate. |

Each row is independent. A strong need for one civilian role does not create a common civilian quota or automatically suppress the other roles.

## Shared entry and safety rules

A civilian unit enters the production interface only if the city can train it and its flavor-derived base weight is positive. `CvUnitProductionAI::CheckUnitBuildSanity` then combines role demand with shared constraints.

The universal gates described in [production](production.md#candidate-contracts) — puppet and underdeveloped cities — apply to civilian candidates as they do to military ones. The civilian-specific rule is that a city under siege rejects ordinary civilian production. A very small army or navy also reduces civilian weights by favoring combat units in the same domain. These rules make civilian demand subordinate to immediate survival without moving ownership of the underlying demand into Military AI. The all-failed fallback described in [production](production.md) can still restore a positive precheck candidate.

Automated human cities are narrower than ordinary AI cities. Their production comparison permits worker-style civilians with a work rate, while excluding other noncombat units from automatic production.

## Expansion

Settler demand combines expansion flavor, named expansion gates, and city suitability. The ordinary path treats `ECONOMICAISTRATEGY_ENOUGH_EXPANSION` and the city's `AICITYSTRATEGY_ENOUGH_SETTLERS` as gates. It also rejects a settler when the city is about to grow or another one is waiting on its tile.

For a viable candidate, the score uses expansion flavor, early-expansion state, best settle-plot quality, new-continent feeder status, traits, happiness, and whether a non-capital city should take over settler production. Every comparison where a viable settler loses adds to the skip counter, increasing pressure in later choices.

Vox Deorum custom flavor mode changes the empire-level gate. It maps expansion flavor to a direct positive or negative adjustment rather than treating `ECONOMICAISTRATEGY_ENOUGH_EXPANSION` as a hard stop. City and local feasibility checks still apply.

The related `ECONOMICAISTRATEGY_FOUND_CITY` launches settlement operations for existing settlers. It does not itself place a settler in a production queue.

## Improvements and exploration

Worker demand is concrete. The empire compares its worker count with cities needing terrain improvements and includes an allowance for road work. The city's `WANT_TILE_IMPROVERS`, `NEED_TILE_IMPROVERS`, and `ENOUGH_TILE_IMPROVERS` states turn that shortage into a bonus or rejection. A non-friendly tactical dominance zone blocks the candidate there.

Work-boat demand is local to reachable water but accounts for nearby supply. Safe pathfinding finds owned, unimproved resources that require a work boat, then subtracts nearby work boats and boats already being produced. No remaining work means rejection.

Economic AI estimates land exploration need from unexplored terrain, recon flavor, war, and travel capability. Military AI stores the resulting supply-aware explorer recommendation because explorers share unit supply with the force. Production adds shortfall weight below that target, but reaching it does not reject further explorers.

Naval exploration is different. Economic AI mainly satisfies it by reassigning eligible naval units. The dedicated naval-explorer production adjustment in `CvUnitProductionAI` is inactive in this baseline.

## Trade, diplomacy, and archaeology

`CvTradeAI::GetPrioritizedTradeRoutes` ranks possible routes and records each origin city's relative value for land and sea trade. Trade-unit sanity reads the matching city priority. Trade AI therefore owns route opportunity, while production decides whether a trade unit is worth the city's next build.

Ordinary diplomatic production uses `UNITAI_MESSENGER`. Economic AI supplies `NEED_DIPLOMATS` and `NEED_DIPLOMATS_CRITICAL`; city AI states help direct the flavor pressure to suitable cities. Unit sanity also requires contact with a valid city-state, limits idle units, and values the influence granted by promotions. Great Diplomat roles are separate from this ordinary messenger path.

Archaeologists require `ECONOMICAISTRATEGY_NEED_ARCHAEOLOGISTS`, which compares archaeological sites with available archaeologists. Once active, production adds value for having none, pursuing culture victory, receiving tourism from digs, and gaining artifact yields.

## Boundaries

Several civilian units are created through other interfaces:

- Missionaries, inquisitors, and most religious units are selected and bought by `CvReligionAI::DoFaithPurchases`.
- Ordinary Great People arise from specialist progress, faith rules, free grants, or other direct spawn rules.
- Buildings, policies, and trade-route rules can grant units directly.
- Spaceship-part units are coordinated by player-level spaceship planning.

Those units may have flavors or capability-based bonuses, but affect ordinary production only when the specific unit is trainable through `canTrain`. A demand signal does not make a purchase-only or automatically granted unit a production candidate.

## Reading the implementation

Start at the role source, then follow its state into `CvUnitProductionAI::CheckUnitBuildSanity` and `CvCityStrategyAI::ChooseProduction`. The main sources are `CvEconomicAI` and city AI states for settlers, workers, explorers, diplomats, and archaeologists; `CvTradeAI` for trade origin priorities; and Military AI for the explorer recommendation and force-emergency context.

See [production](production.md) for the common comparison and [the unit AI overview](overview.md) for the boundary with acquisition and operation.
