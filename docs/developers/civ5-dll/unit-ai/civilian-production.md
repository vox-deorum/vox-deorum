# Unit AI: Civilian Production

**Civilian production** turns **role-owned demand**, a need calculated by a specific civilian system, into weighted unit candidates for a city. The shared [candidate lifecycle](production.md#candidate-lifecycle) compares each candidate with all other buildables. The shared [candidate gates](production.md#shared-candidate-gates) apply to every unit candidate.

The main implementation is in `civ5-dll/CvGameCoreDLL_Expansion2`, chiefly `CvUnitProductionAI.cpp`, `CvCityStrategyAI.cpp`, `CvEconomicAI.cpp`, `CvTradeClasses.cpp`, and `CvMilitaryAI.cpp`. [Flavors](concepts.md#flavors) defines the effective city preferences used for each base weight. The `ECONOMICAISTRATEGY_*` and `AICITYSTRATEGY_*` gates named below are [strategy flags](concepts.md#strategy-flags).

## Civilian demand

Each civilian role owns its own demand. A trainable unit with a positive flavor-derived base weight passes through `CvUnitProductionAI::CheckUnitBuildSanity` before shared selection compares it with other buildables. Demand can raise that role's score or reject its candidate, but a shortage in one role does not directly alter candidates for other roles. The diagram shows dependencies rather than exact statement order.

| Demand type | Primary owner | Production effect |
| --- | --- | --- |
| [Settler](#settler-demand) | Economic AI and city strategy | Expansion pressure and city gates. |
| [Worker](#worker-demand) | City strategy | Improvement shortfall bonus. |
| [Work boat](#work-boat-demand) | City strategy | Safe reachable improvement-work bonus. |
| [Land explorer](#land-explorer-demand) | Economic AI and Military AI | Recommendation shortfall bonus. |
| [Trade unit](#trade-unit-demand) | Trade AI | Per-city route-origin priority. |
| [Messenger](#messenger-demand) | Economic AI | Diplomatic-need and influence bonus. |
| [Archaeologist](#archaeologist-demand) | Economic AI | Site shortfall and culture-value bonus. |

Every role follows the same path after its owner calculates demand:

```mermaid
flowchart LR
    I[Role-specific inputs] --> D[Demand]
    D --> G[Role and city gates]
    G -->|pass| S[Candidate score]
    G -->|reject| X[No candidate]
    S --> P[Shared selection]
```

### Settler demand

Economic AI supplies expansion state and settle-plot context, while city strategy supplies the city gates. The settle-plot context comes from **settlement-site evaluation**, the subsystem in `civ5-dll/CvGameCoreDLL_Expansion2/CvSiteEvaluationClasses.cpp` that scores candidate city plots by their founding value. In normal flavor mode, `ECONOMICAISTRATEGY_ENOUGH_EXPANSION` rejects the candidate. Custom flavors bypass that gate, and in the score they replace the early-expansion bonus with a smooth adjustment of (expansion flavor − 5) × 30, so the flavor pushes settler weight continuously in both directions. `AICITYSTRATEGY_ENOUGH_SETTLERS`, imminent food growth, and a settler already on the city tile also reject it.

The score combines expansion flavor and context with settle-plot quality, early expansion, new-continent feeder status, traits, happiness, and the capital's settler preference. The player-level settler skip counter adds pressure when production skips an available settler, then resets when a city starts one or none is available. Once trained, `ECONOMICAISTRATEGY_FOUND_CITY` directs the settler's assignment.

### Worker demand

City improvement state and the empire worker count define the shortfall: cities needing improvements plus one road-work allowance, minus workers that already exist or are training. The shortfall changes the score only while `AICITYSTRATEGY_WANT_TILE_IMPROVERS` or `AICITYSTRATEGY_NEED_TILE_IMPROVERS` is active.

A non-friendly tactical dominance zone, a worker on the city tile, or `AICITYSTRATEGY_ENOUGH_TILE_IMPROVERS` rejects the candidate. The role's demand stays with city strategy, while Builder Tasking AI later allocates and directs trained workers.

### Work-boat demand

City strategy maintains the local `AICITYSTRATEGY_NEED_NAVAL_TILE_IMPROVEMENT` signal, but work-boat production does not use it as a gate. Candidate evaluation uses [safe pathfinding](military-tactical-simulation.md#danger-in-path-cost) to find reachable owned resources that still need a boat, including resources beyond the city's workable plots. It then subtracts reachable boats and boats already in training from that work.

No remaining work or a non-friendly naval tactical dominance zone rejects the candidate. For queue production, the score rises with the remaining work, city population, and era. Purchase evaluation uses capital population and also favors nearer work. The demand does not use the empire-wide worker shortfall.

### Land-explorer demand

Economic AI estimates land-exploration need from unrevealed terrain, recon flavor, war, and travel capability. The explorer headcount target scales with `FLAVOR_RECON`, and its naval counterpart with `FLAVOR_NAVAL_RECON`; the same target drives explorer promotion and retirement, described under [UnitAI roles](concepts.md#unitai-roles). Military AI turns that need into a supply-aware recommendation. See [military explorer demand](military-production.md#explorer-demand) for how that recommendation fits force demand.

The shortfall below the recommendation adds score. The recommendation gate applies only to supply-consuming explorers, and units training count toward it. Dedicated naval-explorer production adjustment is inactive in this baseline because naval exploration normally reassigns eligible naval units. Combat-capable explorers can remain eligible during siege through the shared gate.

### Trade-unit demand

`CvTradeAI::GetPrioritizedTradeRoutes` ranks valid land and sea routes by their origin city. Production uses the current city's matching origin priority, not an empire-wide unit target.

Cities with population four or less reject the candidate. The matching priority drives the score, with war reducing it and the relevant trait adjusting it.

### Messenger demand

Economic AI supplies ordinary messenger demand through `ECONOMICAISTRATEGY_NEED_DIPLOMATS` and `ECONOMICAISTRATEGY_NEED_DIPLOMATS_CRITICAL`. The player must know a valid city-state target, and the city plot must not contain a messenger. The cap counts every `UNITAI_MESSENGER`, including units training.

Promotion-provided influence receives a twofold or threefold need multiplier, plus the paper-alliance bonus when it applies. The generic messenger bonus and a diplomat-trait bonus also raise the score. Great Diplomats follow separate production and action paths.

### Archaeologist demand

For major civilizations, Economic AI compares archaeological sites with archaeologists that exist or are training. Its site-count thresholds activate `ECONOMICAISTRATEGY_NEED_ARCHAEOLOGISTS`, which production requires for the candidate. Minor civilizations have ordinary generic candidacy, but not this archaeology-specific gate or scoring.

For major civilizations, the score favors having no archaeologist yet, pursuing a culture victory, gaining tourism from digs, and gaining artifact yields.

## Other civilian unit sources

Several systems create civilian units through their own routes:

- `CvReligionAI::DoFaithPurchases` selects and purchases missionaries, inquisitors, and most religious units through the [faith acquisition path](acquisition.md#faith-priority-and-legality).
- Specialist progress, faith rules, and free grants create ordinary Great People.
- Buildings, policies, and trade-route rules grant units directly.
- Player-level spaceship planning coordinates spaceship-part units.

When a city can train a unit from one of these routes, it may also become an ordinary production candidate. [Civilian operation](civilian-operation.md) explains how trained civilian units receive work.
