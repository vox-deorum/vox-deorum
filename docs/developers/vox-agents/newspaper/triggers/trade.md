# Trade triggers

Trade stories report changes in the receiver's foreign routes, their concentration, and plunder. This page is for developers tuning or adding that coverage. Read the [trigger overview](overview.md) for shared controls, units, evidence rules, and repeat behavior. The catalogue is `vox-agents/newspaper/triggers/trade.json`; authored variants are in `vox-agents/newspaper/templates/trade.json`. Detection lives in `vox-agents/src/newspaper/editorial/national-developments.ts` and `event-developments.ts`, with route parsing in `development-facts.ts`.

Snapshot detectors read complete outgoing foreign-route observations. Every route partner must resolve unambiguously from recorded identity metadata. Domestic routes and unassigned slots are excluded. Route counts include foreign routes with zero or sentinel gold; concentration uses only positive foreign-route gold.

## Conditions and defaults

| Trigger ID and detector | Condition and default controls | Magnitude; scale |
| --- | --- | --- |
| `trade-partner`, `tradePartners` | A partner is present now and absent from the complete baseline. An empty known baseline is valid. | 1; 1 |
| `trade-contraction`, `tradeContraction` | Foreign route count falls by at least `absolute: 2` and `relative: 0.25`, or positive foreign-route gold falls by at least `reserve: 10` gold per turn and the same proportional amount; `window: 10`. | Greater of route-count loss and gold-per-turn loss; 25 |
| `trade-concentration`, `tradeConcentration` | A partner crosses above or back to/below `share: 0.5`, or its share moves by at least `relative: 0.2`, meaning 20 percentage points. Both observations need positive total foreign-route gold; `threshold: 0`, `window: 15`. | Absolute share change in percentage points; 35 |
| `trade-plunder`, `tradePlunder` | `PlayerPlunderedTradeRoute` names the receiver as route origin or destination owner. Groups the interval's events into one account; event count and gold total use the same distinct source table and ID records. | Number of distinct source events; 1 |

## Evidence and repeats

- Trade-route `FromGold: -1` means no gold yield while retaining the observed route and partner. Such a route still counts toward route totals.
- Concentration uses positive foreign-route gold only. A partner with no positive gold can still appear in route-count changes.
- An empty known baseline is enough to establish a new partner, while a missing baseline is not.
- Plunder groups repeated representations of one interval's events into one account. The event count and gold total use the same distinct source records.

## Placeholders

| Family | Useful factual placeholders |
| --- | --- |
| Partner and share | `gold`, `share`, `previousShare`, `tradeFromTurn`, `tradeToTurn`. |
| Contraction | `routes`, `previousRoutes`, `gold`, `previousGold`. |
| Plunder | `plunderEvents`, `plunderGold`. |
