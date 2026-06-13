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

The only DLL addition this stage needs is a **read-only** Lua wrapper for `CvDealAI::GetTradeItemValue` — additive, touching no save format and no acceptance path, so it carries none of the version/merge risk of stage 6's write path. Legality and the per-item add-constructors are **already** exposed on `CvLuaDeal.cpp` and are reused unchanged. Agreeability factors are assembled in mcp-server from existing getters, so the DLL gains **no new `IsXxxAcceptable` logic** (keeps it merge-compatible — specs §6 out-of-scope).

## Work items

1. **`civ5-dll/.../Lua/CvLuaDeal.cpp`** (or a `CvLuaDealAI` sibling) — a new read-only Lua getter wrapping `CvDealAI::GetTradeItemValue(eItem, bFromMe, eOtherPlayer, iData1, iData2, iData3, bFlag1, iDuration, ...)`, registered in `PushMethods`, that returns the value **both directions** for a proposed item. Read-only: it never touches `ActivateDeal` / acceptance. The valuation-layer anti-exploit `INT_MAX` guards (last strategic resource, last luxury while unhappy) surface naturally in the estimate but gate nothing (specs §4). Additive only — **no `TradeableItems` or save change**, no version bump required for a read-only getter (confirm against the build's serialization-version conventions).
2. **`mcp-server/src/utils/lua/inspect-deal.ts`** (new) — a `LuaFunction` (modeled on `present-decision.ts` / `player-actions.ts`) that, for a civ pair + an optional list of proposed terms, constructs a transient `CvDeal` in-game using the existing `lAdd*Trade` constructors, then reads back per term: `lIsPossibleToTradeItem` + `lGetReasonsItemUntradeable` + the new value getter, plus enumerates the **full tradable range** for each side. Pure inspection — the transient deal is never activated. Pass the proposed terms as a **structured argument** (bridge serializes → DLL `ConvertJsonToLuaValue`), as `present-decision` does.
3. **`mcp-server/src/tools/knowledge/inspect-deal.ts`** (new) — a read tool taking `{ PlayerA, PlayerB, ProposedDeal? }` that calls the Lua function for trade-item legality + value, and assembles **promise agreeability factors** from `get-opinions` / `get-players` / `get-diplomatic-events` (approach, opinion, trust/untrustworthiness, broken/ignored-promise history, victory competition — specs § Deal valuation). Returns per-term `{ legality, reasons, valueIfIGive, valueIfIReceive }` for trade items and `{ agreeabilityFactors }` for promises, plus the full tradable range per side. Register the factory in `tools/index.ts`. Mark all of it advisory — it gates nothing (specs §4).

## Reuse

The already-exposed `lIsPossibleToTradeItem` / `lGetReasonsItemUntradeable` and `lAdd*Trade` constructors on `CvLuaDeal.cpp`; `CvDealAI::GetTradeItemValue` (read-only); the `LuaFunction` bridge + structured-argument transport (`bridge/lua-function.ts`, `utils/lua/present-decision.ts`); the `ToolBase` read-tool shape; the diplomacy getters `get-opinions` / `get-players` / `get-diplomatic-events` (and `getTool(...)` intra-tool reuse).

## Verify

Against a running game, via tool calls: `inspect-deal` with an **empty** proposed deal returns the full tradable range for both civs and the promise agreeability factors. Add one trade item — the response shows its per-term legality and value **both directions**. Add a structurally-illegal item (e.g. trading a city you don't own) — it reports untradeable with the reason from `GetReasonsItemUntradeable`. Confirm nothing was enacted (no game-state change; the transient deal left no trace).

## Done when

`inspect-deal` returns, in a single read-only call, the full tradable range per side plus per-term legality, both-direction value estimates, and promise agreeability factors for any constructed or empty deal — with no write path and no save/version impact.
