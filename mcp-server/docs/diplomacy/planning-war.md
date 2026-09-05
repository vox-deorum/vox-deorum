# PlanningWar Diplomatic Approach

## Overview

"PlanningWar" is not a separate enum value. It's a behavioral state that occurs when a player's approach is `CIV_APPROACH_WAR` but they are **not yet at war** with the target. The AI uses a "surface approach" to disguise its true intentions during this phase.

## How It Gets Set

The core logic lives in `CvDiplomacyAI::DoUpdateWarTargets()`. A player enters PlanningWar via `SetCivApproach(player, CIV_APPROACH_WAR)` under these conditions:

1. **Cooperative War Agreement** - A team member has agreed to an offensive coop war at `COOP_WAR_STATE_PREPARING` or higher
2. **Vassal Hierarchy** - The player is a master targeting a vassal, and the vassal already has `CIV_APPROACH_WAR`
3. **Teammate War Plans** - An AI teammate already has `CIV_APPROACH_WAR` toward the target's team
4. **Direct Strategic Selection** - The approach weighting algorithm in `SelectBestApproachTowardsMajorCiv()` determines WAR is the optimal approach based on accumulated scores

## Surface Approach (Deception)

When PlanningWar is active, the AI maintains a **surface approach** to hide its real intentions. The real `CIV_APPROACH_WAR` is concealed; a fake approach (typically NEUTRAL, GUARDED, or FRIENDLY) is shown to the target in diplomacy. The surface approach cannot be better than GUARDED if the AI just denounced or broke a DoF.

## Transitions Into PlanningWar

From any non-war approach, when the conditions above are met. The approach scoring system in `SelectBestApproachTowardsMajorCiv()` evaluates ~15 categories of factors and picks the highest-scoring approach.

## Transitions Out of PlanningWar

### To Active War

When the AI declares war, the approach stays `CIV_APPROACH_WAR` but `IsAtWar()` becomes true.

### Cancellation Without War

There are several paths back from PlanningWar without declaring war:

#### Automatic (Every Turn)

- **Conflict Limit** - If the AI is already stretched thin (conflict score >= conflict limit), all new war plans are cancelled. Conflict limit is `10 + (conqueredCivs * 5)`, capped at 10 in early eras.
- **War Target Cleanup** - At the end of `DoUpdateWarTargets()`, any player NOT selected as a war target gets their approach reverted to the highest non-war approach.
- **Natural Re-evaluation** - Every turn, `SelectBestApproachTowardsMajorCiv()` recalculates all approach scores. If circumstances change (target built up military, another threat emerged, opinion improved), WAR may no longer score highest.

#### Diplomatic Agreements (Hard Blocks)

These **zero out** WAR score entirely during approach calculation:

- **Declaration of Friendship**
- **Defensive Pact**
- **Research Agreement**
- **Liberated Cities** - If the target recently liberated the AI's cities

#### Coop War Cancellation

If the ally who proposed the coop war cancels it (or peace is made), the forced WAR approach is no longer applied.

### Two-Phase Override

`SelectBestApproachTowardsMajorCiv()` sets the approach with `bResetAttackOperations=false`, meaning sneak attack operations aren't cancelled yet. Then `DoUpdateWarTargets()` runs afterward and can override the approach back to WAR. A planned war only truly cancels when both phases agree to drop it.

## How Diplomatic Modifiers Affect War Planning

Modifiers influence war planning through **two parallel paths**:

### Path 1: Indirect (Modifiers -> Opinion -> Approach)

Individual modifiers (border disputes, religion conflicts, wonder competition, tech blocking, etc.) accumulate into an opinion weight. When the sum crosses thresholds, opinion shifts category:

| Weight | Opinion      |
| ------ | ------------ |
| >= 160 | UNFORGIVABLE |
| >= 80  | ENEMY        |
| >= 30  | COMPETITOR   |
| > -30  | NEUTRAL      |
| > -80  | FAVORABLE    |
| > -160 | FRIEND       |
| else   | ALLY         |

Opinion is checked selectively in approach scoring. ENEMY opinion + easy target triggers opportunity attack desire. COMPETITOR or worse adds WAR score in victory competition contexts.

### Path 2: Direct (Events -> WAR Score)

Major provocations add WAR weight directly, bypassing opinion:

| Event                | WAR Score Impact                  |
| -------------------- | --------------------------------- |
| Denounced us         | +2x bias                          |
| Sanctioning us       | +5x bias                          |
| Backstabbed us       | +5-10x bias                       |
| Captured our capital | +10x bias (+20000 if easy target) |
| Captured holy city   | Variable (religion flavor)        |
| Culture bombed       | +0.5x bias                        |

### Can Positive Modifiers Cancel War?

**Yes, for normal war planning.** In the approach calculation, positive opinion applies a percentage reduction to WAR score while boosting FRIENDLY score. The final selection picks the highest-scoring approach with no hard override forcing WAR.

Lua can inject modifiers via `GAMEEVENT_GetDiploModifier`, which feeds into `CalculateCivOpinionWeight()`.

**Limitations:**

- Coop wars and teammate wars **override everything** - `DoUpdateWarTargets()` forces WAR regardless of opinion
- Existing sneak attack operations may persist until `DoUpdateWarTargets()` also agrees to drop the target
- Extreme provocations (capital capture: +10x bias + 20000 flat) require enormous positive modifiers to overcome

## Lua/UI Exposure

- Localization key: `TXT_KEY_DIPLO_REAL_APPROACH_PLANNING_WAR`
- Message type: `DIPLO_MESSAGE_SHARE_APPROACH_PLANNING_WAR`
