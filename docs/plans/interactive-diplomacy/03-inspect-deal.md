# Stage 3 — mcp-server + read-only DLL getter: `inspect-deal`

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

A single **read-only** tool exposes everything the deal screen (stage 4) and the agents (stage 5) need to reason about a deal — with **no write path yet**. For a given pair of major civs and an **optional constructed deal (including an empty deal)**, `inspect-deal` returns, in one call (specs §3, §6):

- the **entire range of tradable items per side** — what each civ could put on the table — so the Web screen can render the trade screen like the game does;
- per term, the **structural legality + reasons** (trade items);
- per term, the **AI value estimate, both directions** (what an item is worth if I give it vs. if I receive it — trade items);
- **agreeability factors** for promise terms (no in-game promise valuation exists, so this is the raw decision inputs the negotiator reasons over).

Legality and estimation are unified here — there is no separate estimate tool. Everything is read-only; the enact path lands in stage 6.

## Approach

The DLL additions this stage needs are **read-only**, touching no save format and no acceptance path, so they carry none of the version/merge risk of stage 6's write path — but the stage **does require a DLL rebuild**:

- a Lua wrapper for `CvDealAI::GetTradeItemValue` (its real signature is `GetTradeItemValue(eItem, bFromMe, eOtherPlayer, iData1, iData2, iData3, bFlag1, iDuration, bIsAIOffer, bEqualize = true)` — `CvDealAI.h:64`; pass it deliberately, computing both directions via `bFromMe`);
- a **defaulted `bHumanToHuman` parameter** added to `CvDeal::IsPossibleToTradeItem` (the override of specs §4): default-`false` reproduces the existing computed value at `CvDealClasses.cpp:362` (`... || bHumanToHuman`), so stock callers are byte-for-byte unchanged. The legality wrapper passes `true` so the **screen's per-term legality matches what stage-6 enactment will allow** — otherwise items that are legal-for-agents (e.g. a second city in one deal) would wrongly show as illegal in the preview.

Legality and the per-item add-constructors are otherwise reused as-is. Agreeability factors are assembled in mcp-server from existing getters, so the DLL gains **no new `IsXxxAcceptable` logic** (keeps it merge-compatible — specs §6 out-of-scope).

**Tradable range stays small.** Enumerating "the full tradable range per side" mirrors the game's own legitimacy filters, so the payload is naturally bounded, not a blanket cross-product: techs surface only those the recipient can research and lacks and the other side has; resources only those the other side actually has available to trade (`getNumResourceAvailable`); cities only the player's own non-capital cities; and so on. Enumerate by gating each candidate through `IsPossibleToTradeItem`, exactly as the trade screen does — there is no arg-buffer concern.

## Work items

1. **`civ5-dll/.../Lua/CvLuaDeal.cpp`** (or a `CvLuaDealAI` sibling) — a new read-only Lua getter wrapping `CvDealAI::GetTradeItemValue(eItem, bFromMe, eOtherPlayer, iData1, iData2, iData3, bFlag1, iDuration, bIsAIOffer, bEqualize)`, registered in `PushMethods`, that returns the value **both directions** for a proposed item. Read-only: it never touches `ActivateDeal` / acceptance. The valuation-layer anti-exploit `INT_MAX` guards (last strategic resource, last luxury while unhappy) surface naturally in the estimate but gate nothing (specs §4). Additive only — **no `TradeableItems` or save change**, no version bump required for a read-only getter (confirm against the build's serialization-version conventions).
1b. **`civ5-dll/.../CvDealClasses.{h,cpp}` + `CvLuaDeal.cpp`** — add the **defaulted `bHumanToHuman` override** to `CvDeal::IsPossibleToTradeItem` (and expose it through `lIsPossibleToTradeItem`), per Approach. Default-`false` preserves stock behavior; the inspection wrapper passes `true`. This is the same override stage 6 threads through `AreAllTradeItemsValid`; introducing it here keeps preview legality and enacted legality consistent. Still read-only — no save/version impact.
2. **`mcp-server/src/utils/lua/inspect-deal.ts`** (new) — a `LuaFunction` (modeled on `present-decision.ts` / `player-actions.ts`) that, for a civ pair + an optional list of proposed terms, constructs a transient `CvDeal` in-game using the existing `lAdd*Trade` constructors, then reads back per term: `lIsPossibleToTradeItem` + `lGetReasonsItemUntradeable` + the new value getter, plus enumerates the **full tradable range** for each side. Pure inspection — the transient deal is never activated. Pass the proposed terms as a **structured argument** (bridge serializes → DLL `ConvertJsonToLuaValue`), as `present-decision` does.
3. **`mcp-server/src/tools/knowledge/inspect-deal.ts`** (new) — a read tool taking `{ PlayerA, PlayerB, ProposedDeal? }` that calls the Lua function for trade-item legality + value, and assembles **promise agreeability factors** from `get-opinions` / `get-players` / `get-diplomatic-events` (approach, opinion, trust/untrustworthiness, broken/ignored-promise history, victory competition — specs § Deal valuation). Returns per-term `{ legality, reasons, valueIfIGive, valueIfIReceive }` for trade items and `{ agreeabilityFactors }` for promises, plus the full tradable range per side. Register the factory in `tools/index.ts`. Mark all of it advisory — it gates nothing (specs §4).
4. **Pin the opaque deal-reference format here.** Since this is where a deal is first constructed/inspected, settle the `ProposedDeal` shape that doubles as the transcript's `DealRef` payload (stage 1's `DealRef`): the structured term list `inspect-deal` already accepts is the natural reference — a proposal is referenced by the terms needed to (re)construct and re-inspect it live, never a frozen valuation/legality snapshot (specs §6). Stage 4 round-trips this reference through the conversation and stage 5 rides it through the loop, so locking the format now removes the README open item rather than deferring it to stage 5.

## Reuse

The already-exposed `lIsPossibleToTradeItem` / `lGetReasonsItemUntradeable` and `lAdd*Trade` constructors on `CvLuaDeal.cpp`; `CvDealAI::GetTradeItemValue` (read-only); the `LuaFunction` bridge + structured-argument transport (`bridge/lua-function.ts`, `utils/lua/present-decision.ts`); the `ToolBase` read-tool shape; the diplomacy getters `get-opinions` / `get-players` / `get-diplomatic-events` (and `getTool(...)` intra-tool reuse).

## Verify

Against a running game, via tool calls: `inspect-deal` with an **empty** proposed deal returns the full tradable range for both civs and the promise agreeability factors. Add one trade item — the response shows its per-term legality and value **both directions**. Add a structurally-illegal item (e.g. trading a city you don't own) — it reports untradeable with the reason from `GetReasonsItemUntradeable`. Confirm nothing was enacted (no game-state change; the transient deal left no trace).

## Done when

`inspect-deal` returns, in a single read-only call, the full tradable range per side plus per-term legality, both-direction value estimates, and promise agreeability factors for any constructed or empty deal — with no write path and no save/version impact.
