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

- a Lua wrapper for `CvDealAI::GetTradeItemValue`; pass the full item shape deliberately, computing both directions via the `bFromMe` argument. Nearby Lua helpers such as `IsTradeItemValuedImpossible`, `GetTotalValueToMeNormal`, and `GetTotalValueToMe` already exist on `CvLuaPlayer`, but they do not expose the per-item two-direction value this tool needs;
- a **defaulted `bTreatAsHumanToHuman` parameter** added to `CvDeal::IsPossibleToTradeItem` (the override of specs §4): default-`false` preserves the existing computed value by OR-ing the explicit override into the already-computed human-to-human flag, so stock callers are unchanged. The legality wrapper passes `true` so the **screen's per-term legality matches what stage-6 enactment will allow** — otherwise items that are legal-for-agents (e.g. a second city in one deal) would wrongly show as illegal in the preview;
- the same treatment must apply to the **reason path**. `GetReasonsItemUntradeable` is stock-UI-oriented and returns no details for several item types, but when it is used its result must be computed under the same `bTreatAsHumanToHuman` semantics as `IsPossibleToTradeItem`. Add a defaulted override there too, or have the inspection wrapper suppress/supplement stale stock reasons with structured fallback reasons.

Legality and the per-item add-constructors are otherwise reused as-is. Agreeability factors are assembled in mcp-server from existing getters, so the DLL gains **no new `IsXxxAcceptable` logic** (keeps it merge-compatible — specs §6 out-of-scope).

**Tradable range stays small.** Enumerating "the full tradable range per side" mirrors the game's own legitimacy filters, so the payload is naturally bounded, not a blanket cross-product: techs surface only those the recipient can research and lacks and the other side has; resources only those the other side actually has available to trade (`getNumResourceAvailable`); cities only the player's own non-capital cities; and so on. Enumerate by gating each candidate through `IsPossibleToTradeItem`, exactly as the trade screen does — there is no arg-buffer concern.

## Work items

1. **`civ5-dll/.../Lua/CvLuaDeal.cpp`** (or a `CvLuaDealAI` sibling) — a new read-only Lua getter wrapping `CvDealAI::GetTradeItemValue`, registered in `PushMethods`, that returns the value **both directions** for a proposed item. Read-only: it never touches `ActivateDeal` / acceptance. The valuation-layer anti-exploit `INT_MAX` guards (last strategic resource, last luxury while unhappy) surface naturally in the estimate but gate nothing (specs §4). Additive only — **no `TradeableItems` or save-format change**. If the read-only DLL is packaged before stage 6, follow the project's normal release/version convention for changed binaries.
2. **`civ5-dll/.../CvDealClasses.{h,cpp}` + `CvLuaDeal.cpp`** — add the **defaulted `bTreatAsHumanToHuman` override** to `CvDeal::IsPossibleToTradeItem` and expose it through `lIsPossibleToTradeItem`, per Approach. Apply the same semantics to `GetReasonsItemUntradeable` / `lGetReasonsItemUntradeable` or return structured fallback reasons from the inspection wrapper when the stock reason API is silent or would use stock AI-human assumptions. Default-`false` preserves stock behavior; the inspection wrapper passes `true`. This is the same override stage 6 threads through `AreAllTradeItemsValid`; introducing it here keeps preview legality and enacted legality consistent. Still read-only — no save-format impact.
3. **`mcp-server/src/utils/lua/inspect-deal.ts`** (new) — a `LuaFunction` (modeled on `present-decision.ts` / `player-actions.ts`) that, for a civ pair + an optional list of proposed terms, constructs a transient `CvDeal` in-game using the existing `lAdd*Trade` constructors, then reads back per term: `lIsPossibleToTradeItem(..., bTreatAsHumanToHuman = true)` + the matched reason/fallback path + the new value getter, plus enumerates the **full tradable range** for each side. Pure inspection — the transient deal is never activated. Pass the proposed terms as a **structured argument** (bridge serializes → DLL `ConvertJsonToLuaValue`), as `present-decision` does.
4. **`mcp-server/src/tools/knowledge/inspect-deal.ts`** (new) — a read tool taking `{ PlayerAID, PlayerBID, ProposedDeal? }` that calls the Lua function for trade-item legality + value, and assembles **promise agreeability factors** from `get-opinions` / `get-players` / `get-diplomatic-events` (approach, opinion, trust/untrustworthiness, broken/ignored-promise history, victory competition — specs § Deal valuation). Returns per-term `{ legality, reasons, valueIfIGive, valueIfIReceive }` for trade items and `{ agreeabilityFactors }` for promises, plus the full tradable range per side. Register the factory in `tools/index.ts`. Mark all of it advisory — it gates nothing (specs §4).
5. **Pin the stored deal payload here.** Since this is where a deal is first constructed/inspected, settle the `Payload.Deal` shape used by transcript proposal messages. Use the same structured form `inspect-deal` accepts:
   - `version: 1`;
   - `items`: ordinary trade terms, each with `fromPlayerID`, `toPlayerID`, `itemType`, and the item-specific data needed by the matching `lAdd*Trade` constructor;
   - `promises`: promise terms, each with `promiserID`, `recipientID`, `promiseType`, optional `targetPlayerID` for Coop War / city-state-related promises, and optional `duration`.
   Proposal and counter messages may also store `Payload.Value1` / `Payload.Value2`, the proposal-time value or agreeability snapshot for the ordered `Player1ID` / `Player2ID`; leave the value undefined for human participants. Do not store legality or reasons in the transcript — current legality comes from a fresh `inspect-deal` call when needed.

## Reuse

The already-exposed `lIsPossibleToTradeItem` / `lGetReasonsItemUntradeable` and `lAdd*Trade` constructors on `CvLuaDeal.cpp`; `CvDealAI::GetTradeItemValue` (new per-item read-only wrapper; existing `CvLuaPlayer` valuation helpers are not enough); the `LuaFunction` bridge + structured-argument transport (`bridge/lua-function.ts`, `utils/lua/present-decision.ts`); the `ToolBase` read-tool shape; the diplomacy getters `get-opinions` / `get-players` / `get-diplomatic-events` (and `getTool(...)` intra-tool reuse).

## Verify

Against a running game, via MCP client tool calls: `inspect-deal` with an **empty** proposed deal returns the full tradable range for both civs and the promise agreeability factors. Add one trade item — the response shows its per-term legality and value **both directions**. Add a structurally-illegal item (e.g. trading a city you don't own) — it reports untradeable with a reason from the matched reason/fallback path. Add an item that stock AI-human legality would reject but human-human legality permits — it reports legal, matching stage-6 enactment semantics. Confirm nothing was enacted (no game-state change; the transient deal left no trace).

## Done when

`inspect-deal` returns, in a single read-only call, the full tradable range per side plus per-term legality, both-direction value estimates, and promise agreeability factors for any constructed or empty deal — with no write path and no save/version impact.
