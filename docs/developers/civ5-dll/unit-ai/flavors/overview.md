# Unit AI: Military Tactical Flavors

**Military tactical flavors** are five 0 to 100 dials that weight cities, enemy units, friendly territory, and danger in [tactical simulation](../simulation/overview.md). They steer plan selection within the search's existing moves and safety gates.

This page covers flavor resolution. [Scoring](scoring.md) covers weights, RISK thresholds, and worked examples; the [Unit AI guide](../overview.md) shows the surrounding systems.

Every flavor is neutral at 50. A search with all five at 50 and RISK unset keeps stock scoring.

## The five flavors

| Flavor | Question it answers | Higher value means |
| --- | --- | --- |
| **RISK** | How much danger and loss will we accept? | More risk-taking: fewer HP needed to hold the line, one loss allowed in large groups, less weight on danger, and a more tolerant turn-end HP-versus-danger check |
| **OCCUPATION** | How much do cities matter as targets? | City damage and captures count more |
| **ATTRITION** | How much does damaging enemy units matter? | Unit damage and kills count more |
| **HOLD_CITY** | How much should units guard our threatened cities? | Units hold friendly frontline cities and focus attacks on enemies threatening friendly cities in the search area |
| **HOLD_GROUND** | How much should units hold friendly ground? | Units stand on good ground at home, are pulled less into enemy territory, and value hits on enemies standing on our land |

## Where a search's flavors come from

```mermaid
flowchart TD
    L[Leader personality<br/>FLAVOR_RISK and the other four] --> G[General vector]
    S[Strategy flavor rows] --> G
    C[Vox Deorum custom flavors] --> G
    G --> M[Add the modifiers in game scale]
    CM[Civ modifier<br/>against the counterpart] --> M
    OM[Operation modifier<br/>for the running operation] --> M
    ZM[Zone modifier<br/>for the target's zone] --> M
    M --> I{VOX_TACTICAL_INTENT_FLAVORS on?}
    I -->|yes| ID[Add the intent default in points,<br/>except in slots the operation or zone sets]
    I -->|no| F[Search flavors]
    ID --> F
```

Both search callers, the coordinated engagement and the ranged opportunity attack, resolve the flavors once through `TacticalAIHelpers::ResolveSearchFlavors` and pass them to every retry. A caller that passes no flavors gets the player's general vector.

### The general vector

`TacticalAIHelpers::GetGeneralTacticalFlavors` builds one value per slot:

| Part | RISK | The other four |
| --- | --- | --- |
| Default | 10 x the leader's `FLAVOR_RISK`, read with the grand strategy applied. A leader without `FLAVOR_RISK` uses its offense instead (see the note after this table). | 50 |
| Strategy change | The active strategies' change to the flavor, applied in game scale | Same |
| Custom flavors | While active, the custom value replaces the default, and the strategy change still applies. A leader without `FLAVOR_RISK` keeps following its offense. | Same |

| RISK fallback detail | Rule |
| --- | --- |
| Shipped data | Vox Deorum's options SQL adds the five types but no leader `FLAVOR_RISK` rows. |
| Missing type or leader row | Start from 10 x runtime offense, with grand strategy applied, preserving [stock thresholds](scoring.md#risk-thresholds). Strategy rows can still shift it. |
| Why runtime offense | Personality randomizes at game start. An SQL copy would randomize independently and drift from the offense in use. |
| Detecting a leader row | A nonzero base personality indicates a row; the game never randomizes a zero flavor. |

A strategy or Vox Populi data row can name one of the five flavors to move it, the same way strategies move any other flavor.

### The game scale

Strategy rows, custom flavors, and modifiers all work in the **game scale**, the signed scale the game uses for flavor changes. `CvFlavorManager` converts with a fixed 101-entry table, `FLAVOR_GAME_SCALE`, which is Vox Deorum's exponential custom flavor mapping: 50 maps to 0, and 0 and 100 map to -300 and +300. Small moves near 50 are fine-grained, and moves near the ends are coarse.

- `FlavorToGameScale` reads the table.
- `FlavorFromGameScale` finds the nearest entry, with ties going toward 50.
- `ShiftFlavor` moves a 0 to 100 value by a game-scale change, so the same change moves a neutral flavor further than one near an end.

| Start | +40 in game scale | -40 in game scale |
| ----- | ----------------- | ----------------- |
| 50    | 71                | 29                |
| 80    | 86                | 71                |

### Modifiers

Modifiers are signed game-scale changes, one per slot. The three scopes add up first, then shift the general vector once.

| Scope | Stored in | Lasts | Set by |
| --- | --- | --- | --- |
| Civ | `CvMilitaryAI`, one row per other player | Saved with the game until changed | Lua: `Player:SetTacticalFlavorModifiers(otherPlayer, { FLAVOR_RISK = 40, ... })`. Listed slots are replaced and others are kept. `Player:GetTacticalFlavorModifiers(otherPlayer)` returns the nonzero slots. |
| Operation | `CvAIOperation` | Saved for the operation's life | C++ producers only |
| Zone | `CvTacticalAnalysisMap`, by zone ID | Until the zones are rebuilt, since zone IDs change then | C++ producers only |

Values are clamped to -1000 to 1000. Reading a player's general vector from Lua goes through `Player:GetCustomFlavors`.

Which modifiers a search picks up:

- **Civ.** The counterpart is the owner of the target's dominance zone if we are at war with it, otherwise the owner of the target plot if we are at war with it. The search applies our row against that counterpart. The lookup runs only while the player has any civ modifier.
- **Operation.** The innermost operation the player is running when the search starts. Operation turns are tracked as they run, so this is the same operation the search reports as its parent.
- **Zone.** The zone that contains the target plot.

### Intent defaults

**Search intent** labels the caller's purpose, such as city assault or reinforcement. The default-off `VOX_TACTICAL_INTENT_FLAVORS` option adds intent defaults after modifiers, in 0 to 100 points, then clamps to 0 to 100.

| Condition in a flavor slot | Intent default |
| --- | --- |
| Operation or zone modifier is nonzero | Skip it; the explicit modifier wins. |
| Only a civ modifier is nonzero | Apply it; the civ modifier describes the enemy, not the kind of fight. |
| No modifier is nonzero | Apply it. |

Edit `TACTICAL_INTENT_FLAVOR_DEFAULTS` in `CvTacticalAI.cpp`, one row per intent and one column per flavor. Adding an intent without a row fails the build.

### When RISK counts as set

RISK always sets the [loss allowance and minimum-HP thresholds](scoring.md#risk-thresholds). Its **set** flag controls the extra danger and safety scaling:

```mermaid
flowchart TD
    S[Strategy or custom flavor<br/>changed general RISK] --> Y[RISK is set]
    M[Civ, operation, or zone modifier<br/>changes RISK] --> Y
    I[Applied intent default<br/>changes RISK] --> Y
    C[Caller pins RISK<br/>such as the simulator] --> Y
    Y --> W[Also weight danger penalty<br/>and scale turn-end safety threshold]
    N[Only the leader default] --> U[RISK is unset<br/>keep stock danger and safety scaling]
```

Without this rule, every leader whose offense isn't 5 would score danger differently from stock.

## Cost

Flavors are on the search's hot path, so the neutral case stays close to free:

- A neutral weight returns the term without arithmetic.
- Resolution runs once per engagement. With no modifiers and the mod option off, it costs a few checks beyond reading the general vector. A cached count skips the civ lookup when no civ modifier exists.
- City threat budgets are prepared once per search only when there is a local friendly city and a root enemy, and only above neutral HOLD_CITY. Scoring reuses cached integer budgets; searches with no actual threat skip bonus lookups.

## What flavors don't change

- **Hard gates.** Death-trap checks, edge-of-vision checks, the melee trade veto, and the final extreme-danger block remain, with their stock exceptions for frontline cities and citadels. A flavor can make a plot more attractive, but it can't make a forbidden plot legal.
- **Aggression.** The caller's [aggression level](../simulation/overview.md#entry-points-and-aggression) still decides which attacks are allowed and how much provisional danger is tolerated.
- **What the search explores.** Search bounds, the 13-unit limit, duplicate pruning, and replay don't change.

## The operational loop

Under `VOX_TACTICAL_OPERATIONAL_LOOP`, engagements resolve flavors differently: mapped VP flavors blended by the zones a search covers, plus a row for the kind of engagement, with aggression taken from RISK. See the [operational loop](../tactics/operational-loop.md#flavors-and-aggression).

## The simulator

The tactical simulator in `vox-deorum-rl` extracts this code from the DLL source instead of keeping copies: the conversion table and its helpers, the intent table, the resolution helpers, the RISK thresholds, and every scoring term. The capture records each search's final vector, whether RISK was set, the counterpart, and the modifiers in force, so simulated searches resolve the same way.

## Source map

The code lives under `civ5-dll/CvGameCoreDLL_Expansion2`:

| Source | Owns |
| --- | --- |
| `CvTacticalAI.cpp` and `CvTacticalAI.h` | `STacticalFlavors`, `TacticalAIHelpers` resolution, scoring terms, intent table |
| `CvFlavorManager` | Conversion between 0 to 100 and game scale |
| `CvMilitaryAI`, `CvAIOperation`, `CvTacticalAnalysisMap` | Civ, operation, and zone modifiers |
