# Unit AI: Civilian Production

**Civilian production** turns **role-owned demand**, a need calculated by a specific civilian system, into weighted unit candidates for a city. The shared [candidate lifecycle](production.md#candidate-lifecycle) compares each candidate with all other buildables. The shared [candidate gates](production.md#shared-candidate-gates) apply to every unit candidate.

The main implementation is in `civ5-dll/CvGameCoreDLL_Expansion2`, chiefly `CvUnitProductionAI.cpp`, `CvCityStrategyAI.cpp`, `CvEconomicAI.cpp`, `CvTradeClasses.cpp`, and `CvMilitaryAI.cpp`. [Flavors](overview.md#flavors) defines the effective city preferences used for each base weight.

## Civilian demand

Each civilian role owns its own demand. A trainable unit with a positive flavor-derived base weight passes through `CvUnitProductionAI::CheckUnitBuildSanity` before shared selection compares it with other buildables. Demand can raise that role's score or reject its candidate, but a shortage in one role does not directly alter candidates for other roles. The diagrams show dependencies rather than exact statement order.

| Demand type | Primary owner | Production effect |
| --- | --- | --- |
| [Settler](#settler-demand) | Economic AI and city strategy | Expansion pressure and city gates. |
| [Worker](#worker-demand) | City strategy | Improvement shortfall bonus. |
| [Work boat](#work-boat-demand) | City strategy | Safe reachable improvement-work bonus. |
| [Land explorer](#land-explorer-demand) | Economic AI and Military AI | Recommendation shortfall bonus. |
| [Trade unit](#trade-unit-demand) | Trade AI | Per-city route-origin priority. |
| [Messenger](#messenger-demand) | Economic AI | Diplomatic-need and influence bonus. |
| [Archaeologist](#archaeologist-demand) | Economic AI | Site shortfall and culture-value bonus. |

### Settler demand

Economic AI supplies expansion state and settle-plot context, while city strategy supplies the city gates. In normal flavor mode, `ECONOMICAISTRATEGY_ENOUGH_EXPANSION` rejects the candidate. Custom flavors bypass that gate. `AICITYSTRATEGY_ENOUGH_SETTLERS`, imminent food growth, and a settler already on the city tile also reject it.

```mermaid
flowchart LR
    E[Expansion state and settle plots] --> D[Settler demand]
    D --> G[City and expansion gates]
    G -->|pass| P[Settler score]
    G -->|reject| X[No candidate]
    P --> S[Shared selection]
```

The score combines expansion flavor and context with settle-plot quality, early expansion, new-continent feeder status, traits, happiness, and the capital's settler preference. The player-level settler skip counter adds pressure when production skips an available settler, then resets when a city starts one or none is available. Once trained, `ECONOMICAISTRATEGY_FOUND_CITY` directs the settler's assignment.

### Worker demand

City improvement state and the empire worker count define the shortfall: cities needing improvements plus one road-work allowance, minus workers that already exist or are training. The shortfall changes the score only while `AICITYSTRATEGY_WANT_TILE_IMPROVERS` or `AICITYSTRATEGY_NEED_TILE_IMPROVERS` is active.

```mermaid
flowchart LR
    I[Improvement work and workers] --> D[Worker shortfall]
    D --> G[City safety and worker gates]
    G -->|pass| P[Worker score]
    G -->|reject| X[No candidate]
    P --> S[Shared selection]
```

A non-friendly tactical dominance zone, a worker on the city tile, or `AICITYSTRATEGY_ENOUGH_TILE_IMPROVERS` rejects the candidate. The role's demand stays with city strategy, while Builder Tasking AI later allocates and directs trained workers.

### Work-boat demand

City strategy supplies the local `AICITYSTRATEGY_NEED_NAVAL_TILE_IMPROVEMENT` signal. Candidate evaluation then uses safe pathfinding to find reachable owned resources that still need a boat, including resources beyond the city's workable plots. It subtracts reachable boats and boats already training from that work.

```mermaid
flowchart LR
    R[Safe reachable resource work] --> D[Reachable boat demand]
    D --> G[Naval safety and work gates]
    G -->|pass| P[Work-boat score]
    G -->|reject| X[No candidate]
    P --> S[Shared selection]
```

No remaining work or a non-friendly naval tactical dominance zone rejects the candidate. For queue production, the score rises with the remaining work, city population, and era. Purchase evaluation uses capital population and also favors nearer work. The demand does not use the empire-wide worker shortfall.

### Land-explorer demand

Economic AI estimates land-exploration need from unrevealed terrain, recon flavor, war, and travel capability. Military AI turns that need into a supply-aware recommendation. See [military explorer demand](military-production.md#explorer-demand) for how that recommendation fits force demand.

```mermaid
flowchart LR
    E[Exploration need] --> R[Supply-aware recommendation]
    R --> G[Explorer limit gate]
    G -->|pass| P[Shortfall score]
    G -->|reject| X[No candidate]
    P --> S[Shared selection]
```

The shortfall below the recommendation adds score. The recommendation gate applies only to supply-consuming explorers, and units training count toward it. Dedicated naval-explorer production adjustment is inactive in this baseline because naval exploration normally reassigns eligible naval units. Combat-capable explorers can remain eligible during siege through the shared gate.

### Trade-unit demand

`CvTradeAI::GetPrioritizedTradeRoutes` ranks valid land and sea routes by their origin city. Production uses the current city's matching origin priority, not an empire-wide unit target.

```mermaid
flowchart LR
    R[Valid ranked routes] --> D[City origin priority]
    D --> G[Population gate]
    G -->|pass| P[Trade-unit score]
    G -->|reject| X[No candidate]
    P --> S[Shared selection]
```

Cities with population four or less reject the candidate. The matching priority drives the score, with war reducing it and the relevant trait adjusting it.

### Messenger demand

Economic AI supplies ordinary messenger demand through `ECONOMICAISTRATEGY_NEED_DIPLOMATS` and `ECONOMICAISTRATEGY_NEED_DIPLOMATS_CRITICAL`. The player must know a valid city-state target, and the city plot must not contain a messenger. The cap counts every `UNITAI_MESSENGER`, including units training.

```mermaid
flowchart LR
    N[Diplomatic need and city-state target] --> D[Messenger demand]
    D --> G[Target, city, and cap gates]
    G -->|pass| P[Influence-based score]
    G -->|reject| X[No candidate]
    P --> S[Shared selection]
```

Promotion-provided influence receives a twofold or threefold need multiplier, plus the paper-alliance bonus when it applies. The generic messenger bonus and a diplomat-trait bonus also raise the score. Great Diplomats follow separate production and action paths.

### Archaeologist demand

For major civilizations, Economic AI compares archaeological sites with archaeologists that exist or are training. Its site-count thresholds activate `ECONOMICAISTRATEGY_NEED_ARCHAEOLOGISTS`, which production requires for the candidate. Minor civilizations have ordinary generic candidacy, but not this archaeology-specific gate or scoring.

```mermaid
flowchart LR
    A[Archaeological sites and archaeologists] --> D[Site shortfall]
    D --> G[Major-civilization need gate]
    G -->|pass| P[Archaeologist score]
    G -->|reject| X[No candidate]
    P --> S[Shared selection]
```

For major civilizations, the score favors having no archaeologist yet, pursuing a culture victory, gaining tourism from digs, and gaining artifact yields.

## Other civilian unit sources

Several systems create civilian units through their own routes:

- `CvReligionAI::DoFaithPurchases` selects and purchases missionaries, inquisitors, and most religious units.
- Specialist progress, faith rules, and free grants create ordinary Great People.
- Buildings, policies, and trade-route rules grant units directly.
- Player-level spaceship planning coordinates spaceship-part units.

When a city can train a unit from one of these routes, it may also become an ordinary production candidate under the shared lifecycle.

## Implementation trace

`CvEconomicAI` supplies expansion, explorer, messenger, and archaeologist context. City strategy supplies settler, worker, and work-boat state. `CvTradeAI` supplies route-origin priorities. `CvMilitaryAI` supplies the explorer recommendation, force-shortage context, and settler skip counter. `CvUnitProductionAI::CheckUnitBuildSanity` evaluates the resulting unit candidate before `CvCityStrategyAI::ChooseProduction` runs the shared comparison.
