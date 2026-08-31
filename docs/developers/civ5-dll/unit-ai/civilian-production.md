# Unit AI: Civilian Production

**Civilian production** turns **role-owned demand**, the need calculated by a specific civilian system, into weighted unit candidates for a city. The shared [candidate lifecycle](production.md#candidate-lifecycle) compares each candidate with all other buildables. The shared [candidate gates](production.md#shared-candidate-gates) apply to every unit candidate.

The relevant code is in `civ5-dll/CvGameCoreDLL_Expansion2`, chiefly `CvUnitProductionAI.cpp`, `CvCityStrategyAI.cpp`, `CvEconomicAI.cpp`, `CvTradeClasses.cpp`, and `CvMilitaryAI.cpp`. [Flavors](overview.md#flavors) defines the effective city preferences used for each base weight.

## Role-owned demand and scoring

Each role maintains its own demand and scoring. A shortage in one role changes that role's candidate only.

| Role | Demand owner and gates | Score effects |
| --- | --- | --- |
| **Settler** | Expansion flavor, Economic AI expansion state, city expansion state, and settle-plot quality determine availability. The city declines the candidate while it will grow within one turn, hosts a settler, or has `AICITYSTRATEGY_ENOUGH_SETTLERS`; without Vox Deorum custom flavors, `ECONOMICAISTRATEGY_ENOUGH_EXPANSION` also declines it. | Expansion flavor, early expansion, settle-plot quality, new-continent feeder status, traits, happiness, the capital's settler preference, and the settler skip counter. Custom flavors add signed expansion pressure and bypass the `ENOUGH_EXPANSION` gate. |
| **Worker** | City improvement states and the empire's worker shortfall supply demand. A non-friendly tactical dominance zone, a worker on the city tile, or `AICITYSTRATEGY_ENOUGH_TILE_IMPROVERS` declines the candidate. | The empire compares workers, including units training, with cities needing terrain improvements plus one road-work allowance. `WANT_TILE_IMPROVERS` and `NEED_TILE_IMPROVERS` convert the shortfall into bonuses. |
| **Work boat** | Safe, reachable unimproved owned resources create demand. A non-friendly naval tactical dominance zone or no remaining reachable work declines the candidate. | Safe pathfinding identifies resources needing boats, then subtracts nearby boats and boats training. Remaining work scales with city population and era. |
| **Land explorer** | Economic AI estimates exploration need from unknown terrain, recon flavor, war, and travel capability. Military AI supplies a recommendation that includes unit supply. Supply-consuming explorers stop entering production when the recommendation is met. | Production adds pressure for the shortfall below the recommendation. During siege, combat-capable explorers can remain eligible through the shared gate. Dedicated naval-explorer production adjustment is inactive in this baseline. |
| **Trade unit** | `CvTradeAI::GetPrioritizedTradeRoutes` supplies land and sea route-origin priority for the city. Cities of population four or less decline trade-unit candidates. | The matching route priority, a war penalty, and a trait bonus. |
| **Messenger** | Economic AI diplomatic need and valid city-state targets supply demand. The player must know a valid city-state, the city must be free of a messenger, and ordinary production needs `ECONOMICAISTRATEGY_NEED_DIPLOMATS` or `ECONOMICAISTRATEGY_NEED_DIPLOMATS_CRITICAL`. The cap includes every `UNITAI_MESSENGER`, including units training. | Diplomatic need multiplies promotion-provided influence, with an additional paper-alliance bonus where applicable. |
| **Archaeologist** | Economic AI compares archaeological sites with available archaeologists. Major civilizations require `ECONOMICAISTRATEGY_NEED_ARCHAEOLOGISTS`; minor civilizations proceed through their available shared and role conditions. | Major civilizations favor having no archaeologists, pursuing a culture victory, gaining tourism from digs, and gaining artifact yields. |

## Role boundaries

**Settler assignment** begins once a settler exists: `ECONOMICAISTRATEGY_FOUND_CITY` directs its work. The player-level settler skip counter records each choice that skips an available settler and resets when production starts one or no settler is available.

**Explorer demand** covers land exploration. The AI normally reassigns eligible naval units for naval exploration.

**Trade opportunity** belongs to Trade AI. Unit production weighs the city's next land or sea candidate using that priority.

**Great Diplomat roles** use paths separate from ordinary `UNITAI_MESSENGER` production. Economic AI also retains the major-civilization site-to-archaeologist comparison.

## Other civilian unit sources

Several systems create civilian units through their own routes:

- `CvReligionAI::DoFaithPurchases` selects and purchases missionaries, inquisitors, and most religious units.
- Specialist progress, faith rules, and free grants create ordinary Great People.
- Buildings, policies, and trade-route rules grant units directly.
- Player-level spaceship planning coordinates spaceship-part units.

When a city can train a unit from one of these routes, it may also become an ordinary production candidate under the shared lifecycle.

## Implementation trace

`CvEconomicAI` and city strategy state provide settler, worker, explorer, messenger, and archaeologist demand. `CvTradeAI` supplies route-origin priorities. `CvMilitaryAI` supplies the explorer recommendation, force-shortage context, and settler skip counter. `CvUnitProductionAI::CheckUnitBuildSanity` evaluates the resulting unit candidate before `CvCityStrategyAI::ChooseProduction` runs the shared comparison.
