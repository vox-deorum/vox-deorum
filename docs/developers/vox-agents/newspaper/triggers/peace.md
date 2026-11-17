# Peace triggers

Peace coverage reports settlements, their obligations and visible concessions, and enduring peace. This page is for developers locating the peace catalogue entries and their stages. Read the [trigger overview](overview.md) for shared controls, the [war and peace guide](war-and-peace.md) for settlement inference, progress conditions, tuning, placeholders, and source limits, and [editorial decisions](../editorial.md) for selection and persistence. Peace coverage uses recorded `MakePeace` events plus projected relationship snapshots; it adds no DLL events.

The catalogue is `vox-agents/newspaper/triggers/peace.json`; authored variants are in `vox-agents/newspaper/templates/peace.json`. Detection and settlement grouping live in `vox-agents/src/newspaper/editorial/diplomacy/war-peace.ts` and `diplomacy/diplomacy-incidents.ts`. Shared relationship parsing is in `mcp-server/src/diplomacy/relationships.ts`, with visibility and identity resolution in `mcp-server/src/newspaper/projection.ts`.

## Trigger IDs and stages

Each trigger has a matching template named with the trigger ID followed by `-account`. The detector selects the behavior, and `stage` selects the angle.

| Detector | Trigger ID | Stage | Scale |
| --- | --- | --- | --- |
| `peaceTransition` | `peace-agreement` | `agreement` | 1 |
| `peaceTransition` | `peace-master-led` | `masterLed` | 1 |
| `peaceTransition` | `peace-vassals-included` | `vassalsIncluded` | 1 |
| `peaceTransition` | `peace-city-state-agreement` | `cityStateAgreement` | 1 |
| `peaceTransition` | `peace-city-states-included` | `cityStatesIncluded` | 1 |
| `peaceTransition` | `peace-partial` | `partial` | 1 |
| `peaceTransition` | `peace-concessions` | `concessions` | 1 |
| `peaceTransition` | `peace-capitulation` | `capitulation` | 1 |
| `peaceTransition` | `peace-quiet-fronts` | `quietFronts` | 1 |
| `enduringPeace` | `peace-enduring` | `enduring` | 1 |

## Conditions and defaults

All peace triggers use `threshold: 1`. The shipped `peaceTransition` entries have no tuning overrides. `peace-enduring` supplies these defaults:

| Control | Default | Meaning |
| --- | --- | --- |
| `persistence` | 25 Standard turns | Observed peace required before the single report. |
| `freshness` | 5 Standard turns | Maximum age of the latest relationship observation. |
| `maxGap` | 10 Standard turns | A longer gap restarts the observed peace duration. |
| `foreign` | `false` | Foreign enduring-peace coverage is disabled by default. |

## Evidence and repeats

Settlement reports use only visible terms and relationships. The [war and peace guide](war-and-peace.md#from-observations-to-one-account) explains same-turn deal evidence, master-led settlements, included vassals and city-states, partial peace, concessions, and capitulation. The [uncertainty table](war-and-peace.md#interpret-uncertainty-proportionately) lists the `MakePeace` fields and incomplete city-state rosters that limit those claims.

Enduring peace is offered once after a known settlement or a change from observed war to peace. An initially peaceful relationship supplies a baseline, so it cannot produce a settlement anniversary. The guide gives the full conditions and repeat controls.

## Placeholders

Peace incident and enduring-peace placeholders are listed in the [authored placeholders](war-and-peace.md#authored-placeholders).
