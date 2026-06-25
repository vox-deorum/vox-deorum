# Deal Valuation & the `INT_MAX` Sentinel

Reference for how the Civ 5 Community Patch DLL marks a trade item as `INT_MAX` (2,147,483,647).
Understanding this is important for interpreting AI trade behavior and building tools that reason
about deal feasibility.

## Two distinct mechanisms (don't conflate them)

`INT_MAX` shows up for **two different reasons**, and only the first is a true impossibility:

1. **Structural impossibility** — `CvDeal::IsPossibleToTradeItem()` returns `false` (you don't own the
   item, peace must be mutual, vassalage prerequisites unmet, …). This is an always-on *rule*: the item
   genuinely cannot be in a deal. It is reported separately by `GetReasonsItemUntradeable()` and drives
   the deal board's red/disabled rows.

2. **Advisory valuation refusal** — `CvDealAI::GetTradeItemValue()` returns `INT_MAX` because the stock
   AI's **value estimate maxes out**: it would not make this trade at any price (last strategic resource,
   last luxury while unhappy, a category/policy refusal, an uneconomic peace resource, …). This is a
   strategic/political **preference**, not a structural bar. On the agent/inspection path this valuation
   is **read-only and bypassed for acceptance** (specs §4) — agents may strike deals the stock AI never
   would — so it surfaces as **"no usable estimate"** and **gates nothing**.

Both encode as `INT_MAX` in the stock value cascade (below), which is why the *stock* AI refuses such a
deal outright. The triggers catalogued further down are mostly mechanism (2) — advisory preferences —
even though the stock game treats them as hard refusals.

### The Cascade (stock acceptance path)

```
IsPossibleToTradeItem() returns false     (structural — CvDealClasses.cpp)
  → iItemValue = INT_MAX                  (CvDealAI.cpp, GetDealValue)
...or CvDealAI valuation maxes out        (advisory — GetTradeItemValue, e.g. GetResourceValue)
  → iItemValue = INT_MAX
    → SetFromPlayerValue(INT_MAX) / SetToPlayerValue(INT_MAX)
      → GetDealValue() returns INT_MAX
        → stock AI refuses outright / won't propose
```

One `INT_MAX` item kills the entire deal **for the stock AI**. (On the agent path the valuation is never
consulted for acceptance — see specs §4.)

### Structural-impossible vs advisory-refused vs unfavorable

| | Structurally impossible | Advisory refusal (`INT_MAX` value) | Unfavorable |
|---|---|---|---|
| Source | `IsPossibleToTradeItem` | `CvDealAI::GetTradeItemValue` maxes out | Normal valuation |
| Value | `INT_MAX` | `INT_MAX` | Normal integer |
| Nature | Always-on rule | Strategic/political preference | Bad terms / diplomacy |
| Stock AI | Cannot trade | Immediate refusal | Negotiates for better terms |
| Agent path | Still enforced (red row) | Read-only/advisory; "no usable estimate"; gates nothing | Advisory only |

## Impossibility Triggers by Trade Item

### Gold Per Turn

- Requested GPT exceeds `netGold - 2` (can't afford it)

### Strategic Resources

- Resource type invalid, unrevealed, or info missing
- Trading away **all** copies of a strategic resource
- Selling uranium to **Nuclear Gandhi**
- **We** are Nuclear Gandhi (keep our uranium)
- They **previously nuked us** (no uranium)
- They're close to **world conquest** or we're avoiding exchanges
- They're close to **spaceship victory** (no aluminum)
- No surplus inventory to sell

### Luxury Resources

- Selling **last copy** while empire is unhappy
- Selling last copy would **push us below 50% happiness ratio**

### Cities

- City is a **capital** or doesn't exist
- Buying a city while our empire is **unhappy**
- City was **already traded** to this player before
- Player has **fewer than 5 cities**
- City is an **original capital** or **holy city**
- City under **severe/critical military threat** (outside peace deals)
- City we're **trying to liberate** (anti-exploit)

### Open Borders

- Not willing to give open borders to this player
- Don't want their open borders

### Defensive Pacts

- Don't want a defensive pact with this player

### Research Agreements

- Active **denouncement** in either direction
- Player is **untrustworthy** (backstabber)

### Third-Party Peace

- Target **captured our capital or holy city**
- Target is close to **world conquest** or we're endgame aggressive toward them

### Third-Party War

- No capital (can't declare war)
- **Denouncement** or untrustworthiness between deal partners
- **Friendly** toward the target minor civ
- **Afraid** of the target major civ
- In **no new wars** state (military weakness)
- Close to **any victory condition** (don't get distracted)

### Trade Category Refusals

The AI can globally refuse entire categories: resources, embassies, open borders, research agreements, defensive pacts, brokered peace, brokered war. When a category is refused, all items of that type return `INT_MAX`.

### Buy/Sell Price Propagation

For two-sided items, if either side's valuation returns `INT_MAX`, the whole item becomes impossible (with one exception: if a human is involved and it's not an AI-initiated offer, it falls back to a minimum acceptable price instead of `INT_MAX`).

## Vassalage (`TRADE_ITEM_VASSALAGE`)

### Possibility Gate — `IsPossibleToTradeItem()`

Returns `false` (triggering `INT_MAX` upstream) when:
- Same team, or VP mod not active
- AI teammate of a human
- Vassalage game option disabled
- `canBecomeVassal()` fails (already a vassal, team size issues, etc.)
- Deal already contains a Defensive Pact or Vassalage Revoke
- **Voluntary vassalage only**: the would-be master can't declare war on everyone the vassal is currently fighting

### Valuation Gate — `GetVassalageValue()`

Returns `INT_MAX` in 2 cases, both delegating to `IsVassalageAcceptable()`:
- **Us becoming vassal**: diplomacy AI refuses (not desperate/friendly enough)
- **Them becoming our vassal**: we don't want them (too much baggage)

### `IsVassalageAcceptable()` — Dual-Mode Function

**As Master** (`bMasterEvaluation = true`):
- **At war** → always accept (capitulation)
- **At peace** → delegates to `IsVoluntaryVassalageRequestAcceptable()`, needs majority team approval

**As Vassal** (`bMasterEvaluation = false`):

Hard rejections:
- Already their vassal
- `canBecomeVassal()` fails
- We have vassals of our own (and not at war)
- Resurrected by a *different* team (loyal to liberator)

Then delegates based on war state:

#### `IsCapitulationAcceptable()` (during war)

War-score-based with threshold:
- War score must be ≤ -75 (auto-accept at ≤ -95)
- Must be in defensive war state or worse
- They must be militarily stronger (IMMENSE/POWERFUL bonus, else reject)
- Modifiers for proximity, happiness, victory pursuit

#### `IsVoluntaryVassalageAcceptable()` (during peace)

Hard rejections first (any one kills it):
- >50% of civs eliminated (late game)
- They failed to protect us, stole from us, plotted against us
- We have more team members than they do
- Too far away (less than CLOSE proximity)
- Different ideologies in late game
- Hostile/guarded approach or enemy opinion
- They're untrustworthy
- We're close to winning
- They're not stronger than us militarily AND economically
- They're an easy target for us

Then 50+ factor scoring:

| Factor | Range |
|---|---|
| Opinion (ALLY → COMPETITOR) | +15 → -50 |
| Approach (AFRAID → NEUTRAL) | +20 → -10 |
| Military strength (IMMENSE → POWERFUL) | +40 → +20 |
| Economic strength (IMMENSE → POWERFUL) | +40 → +20 |
| Warmonger threat (NONE → CRITICAL) | +10 → -150 |
| Tech ratio (far behind → ahead) | +40 → -50 |
| Resurrected by them | +100 |
| Liberated our capital / holy city | +50 / +30 |
| Wars declared on us by them | -10 each |
| Cities captured by them | -30 each |
| Their existing vassals | -20 each |

Final score multiplied by cultural dominance and proximity, must exceed `VASSALAGE_CAPITULATE_BASE_THRESHOLD`.

## Revoke Vassalage (`TRADE_ITEM_VASSALAGE_REVOKE`)

### Possibility Gate

Returns `false` when:
- Same team, VP mod not active, vassalage disabled
- `canEndAllVassal()` fails (no vassals, or any vassal below minimum liberate turns)
- Requester is our vassal (vassals can't demand this of their master)
- Deal already contains a Vassalage item

### Valuation Gate — `GetRevokeVassalageValue()`

**Us revoking our vassals** — 6 `INT_MAX` return points:

| Condition | Why |
|---|---|
| At war but war score ≥ -75 | Not losing badly enough |
| Our approach is WAR | Hostile — won't free vassals for an enemy |
| Close to **world conquest** | Vassals are part of domination strategy |
| Close to **diplomatic victory** | Vassal votes count toward diplo win |
| They are **untrustworthy** | Won't negotiate with backstabbers |
| Going for world conquest + controlling capitals + not in terrible shape | Still strong enough to hold the empire |

**Them revoking their vassals** — 1 `INT_MAX` return point:

| Condition | Why |
|---|---|
| None of the freed vassals are our friends/allies/resurrection candidates | No strategic benefit to demanding this |

## Liberation Mechanics

There is no `TRADE_ITEM_LIBERATION` or `TRADE_ITEM_CAPITULATION`. Capitulation is `TRADE_ITEM_VASSALAGE` during a peace deal. Liberation is handled outside the trade system.

### Four Paths to Ending Vassalage

**1. Voluntary revocation** (vassal initiates, peaceful)
- Only for voluntary vassals, no turn requirement beyond minimum
- No war declared

**2. Forced rebellion** (capitulated vassal breaks free)
- `canEndVassal()` checks — must meet minimum turns AND one of:
  - Lost ≥75% of original cities (master failed to protect)
  - Grew to ≥300% original population (outgrew master)
  - Have ≥60% of master's cities AND population (caught up)
- Master can **block rebellion** via `IsVassalsNoRebel()` trait
- Declares war on master

**3. Master voluntarily liberates** (peaceful)
- `CanLiberateVassal()` — requires minimum liberate turns
- No war

**4. Deal-based liberation** (`TRADE_ITEM_VASSALAGE_REVOKE`)
- Master forced to revoke all vassals as part of a deal
- Always peaceful
- Liberating capitulated vassals gives diplomatic bonus with freed vassals

### `DoEndVassal()` Side Effects

When vassalage ends:
1. Reset taxes, remove diplomat spies
2. Close embassies both directions, cancel open borders
3. If forced: temporarily disable warmonger penalties, then declare war on master
4. Update all other vassals' war/peace relationships
5. Recalculate happiness for both sides
6. If forced: clear "resurrected by" flags (no more loyalty debt)
7. Re-evaluate all diplomatic relationships

### Auto-Liberation

When a team becomes someone else's vassal via `DoBecomeVassal()`, any vassals it currently holds are automatically liberated (peacefully).

## Key Source Files

- `CvDealClasses.h` — CvTradedItem and CvDeal data structures
- `CvDealClasses.cpp` — `IsPossibleToTradeItem()` (~line 347), deal finalization (~line 4711)
- `CvDealAI.cpp` — `GetDealValue()` (~line 813), `GetTradeItemValue()` (~line 897), `GetVassalageValue()` (~line 7069), `GetRevokeVassalageValue()` (~line 7278)
- `CvDiplomacyAI.cpp` — `IsVassalageAcceptable()` (~line 55363), `IsCapitulationAcceptable()` (~line 55470), `IsVoluntaryVassalageAcceptable()` (~line 55669)
- `CvTeam.cpp` — `canEndVassal()` (~line 9379), `DoEndVassal()` (~line 9472), `CanLiberateVassal()` (~line 9804), `DoBecomeVassal()` (~line 9839)
- `CvLuaDeal.cpp` — Lua interface: `lIsPossibleToTradeItem()`, `lGetReasonsItemUntradeable()` (~line 139)
