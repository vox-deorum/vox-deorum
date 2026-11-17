# War triggers

War coverage reports declarations, obligations, city-state participation, and changes in recorded war score. This page is for developers locating the war catalogue entries and their stages. Read the [trigger overview](overview.md) for shared controls, the [war and peace guide](war-and-peace.md) for incident inference, progress conditions, tuning, placeholders, and source limits, and [editorial decisions](../editorial.md) for selection and persistence. War coverage uses recorded `DeclareWar` events plus projected relationship snapshots; it adds no DLL events.

The catalogue is `vox-agents/newspaper/triggers/war.json`; authored variants are in `vox-agents/newspaper/templates/war.json`. Detection and grouping live in `vox-agents/src/newspaper/editorial/war-peace.ts`, `diplomacy-incidents.ts`, and `war-progress.ts`. Shared relationship parsing is in `mcp-server/src/diplomacy/relationships.ts`, with visibility and identity resolution in `mcp-server/src/newspaper/projection.ts`.

## Trigger IDs and stages

Each trigger has a matching template named with the trigger ID followed by `-account`. The detector selects the behavior, and `stage` selects the angle.

| Detector        | Trigger ID                | Stage              | Scale |
| --------------- | ------------------------- | ------------------ | ----- |
| `warTransition` | `war-declaration`         | `declaration`      | 1     |
| `warTransition` | `war-following-master`    | `followingMaster`  | 1     |
| `warTransition` | `war-vassals-joining`     | `vassalsJoining`   | 1     |
| `warTransition` | `war-defensive-pact`      | `defensivePact`    | 1     |
| `warTransition` | `war-inherited-wars`      | `inheritedWars`    | 1     |
| `warTransition` | `war-city-state-attack`   | `cityStateAttack`  | 1     |
| `warTransition` | `war-city-state-joining`  | `cityStateJoining` | 1     |
| `warTransition` | `war-alliance-change`     | `allianceChange`   | 1     |
| `warTransition` | `war-resumed`             | `resumed`          | 1     |
| `warTransition` | `war-observed`            | `observed`         | 1     |
| `warProgress`   | `war-progress-reversal`   | `reversal`         | 2     |
| `warProgress`   | `war-progress-commanding` | `commanding`       | 2     |
| `warProgress`   | `war-progress-advantage`  | `advantage`        | 2     |
| `warProgress`   | `war-progress-swing`      | `swing`            | 2     |
| `warProgress`   | `war-progress-balance`    | `balance`          | 2     |
| `warProgress`   | `war-progress-stagnation` | `stagnation`       | 2     |

## Conditions and defaults

All war triggers use `threshold: 1`. `warTransition` stages select the declaration or participation angle. `warProgress` stages measure score changes with `scale: 2`; their score boundaries, persistence, cooldowns, and rearm values are in the [score-based progress](war-and-peace.md#score-based-progress) and [tuning reference](war-and-peace.md#tuning-names-and-scope). Progress stages are eligible for foreign pairs by default.

A shared incident conflict key prevents participant angles from occupying several slots in the same issue; pair series retain longer-term continuity. One incident presents unique participants and at most three named city-state examples. Minor-versus-minor responses do not produce separate headlines.

If the city-state alliance-change angle is disabled or its condition does not match, eligible war continuity can still fall back to a generic observed or resumed account.

## Evidence and repeats

Incident grouping is an inference from same-turn event order and observed relationships, not proof of the original action. The [war and peace guide](war-and-peace.md#from-observations-to-one-account) explains cascades, recursive records, and the limits of the recorded evidence.

War progress resets on peace and renewed war. At most one progress angle is offered per pair per check, and the guide describes the precedence, cooldowns, rearming, and skipped-check behavior.

## Placeholders

War incident and progress placeholders are listed in the [authored placeholders](war-and-peace.md#authored-placeholders).
