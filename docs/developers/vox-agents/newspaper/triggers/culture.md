# Culture and politics triggers

Culture and politics stories report policies, ideology, cultural output, tourism, wonders, great works, and golden ages. This page is for developers tuning or adding that coverage. Read the [trigger overview](overview.md) for shared controls, units, evidence rules, and repeat behavior. The catalogue is `vox-agents/newspaper/triggers/culture.json`; authored variants are in `vox-agents/newspaper/templates/culture.json`. Detection lives in `vox-agents/src/newspaper/editorial/developments/events.ts`, `developments/national.ts`, and `developments/cities.ts`.

## Conditions and defaults

| Trigger ID and detector | Condition and default controls | Magnitude; scale |
| --- | --- | --- |
| `policy-direction`, `policy` | Receiver `PlayerAdoptPolicy` and `PlayerAdoptPolicyBranch` events have recorded text identities; bundles the interval's adoptions. | Number of distinct policy/branch identities; 3 |
| `ideology-switch`, `ideology` | Receiver `IdeologySwitched` event names different old and new branches. Multiple events retain the latest switch's names and date, with all source references. | 1; 1 |
| `domestic-culture`, `cultureOutput` | Domestic culture per turn changes by at least `absolute: 5` and `relative: 0.25`; `window: 10`. | Absolute culture-per-turn change; 40 |
| `foreign-culture`, `foreignCulture` | Same change requirements for known foreign national observations; `window: 10`. | Absolute culture-per-turn change; 100 |
| `tourism-shift`, `tourismOutput` | Domestic or permitted foreign tourism per turn changes by at least `absolute: 5` and `relative: 0.25`; `window: 10`. | Absolute tourism-per-turn change; 40 |
| `new-wonder`, `wonder` | A named wonder appears in a comparable domestic or known foreign city's `Wonders` list; `window: 15`. | Number of added wonder names; 1 |
| `great-works`, `greatWorks` | A domestic city's known `GreatWorkCount` increases; `window: 15`. Reports collection growth without inferring creation or transfer. | Increase in count; 3 |
| `golden-age`, `goldenAge` | Explicit recorded domestic status changes between active and inactive. Unknown or unrecognized status text is suppressed. | 1; 1 |

## Evidence and repeats

- A new visible wonder in a comparable city list reports an addition. It does not by itself prove recent construction.
- Great works report collection growth without inferring creation or transfer. Missing counts remain unknown.
- Golden age coverage requires an explicit recorded domestic status change. Unknown status text is suppressed.
- Policies adopted in one check share a bundled report and require recorded text identities.
- Foreign culture and tourism cover known foreign national observations only; missing observations do not become zero.

## Placeholders

| Family | Useful factual placeholders |
| --- | --- |
| Culture output | `culture`, `previousCulture`, `cultureChange`, `cultureFromTurn`, `cultureToTurn`, plus the generic output placeholders from the [overview](overview.md#shared-placeholders). |
| Policies and ideology | `policies`; ideology: `previousIdeology`, `ideology`. |
| Wonders and works | `wonders`; great works: `works`, `previousWorks`, `addedWorks`. |
| Golden age | `stage`. |
