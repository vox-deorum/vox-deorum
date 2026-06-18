# Stage 3 — mcp-server + read-only DLL getter: `inspect-deal`

> **✅ Done.** TypeScript side unit-tested (8 mocked-bridge tests green); the live legality/value path is validated manually in-game. Requires a DLL rebuild (read-only; no version bump per request).
> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

A single **read-only** tool exposes everything the deal screen (stage 4) and the agents (stage 5) need to reason about a deal — with **no write path**. For a pair of major civs and an **optional constructed deal (including an empty deal)**, `inspect-deal` returns, in one call (specs §3, §6):

- the **entire range of tradable items per side** — what each civ could put on the table — so the Web screen can render the trade screen like the game does;
- per trade item, the **structural legality + reasons** and the **AI value estimate both directions** (what it's worth if I give it vs. if I receive it);
- **agreeability factors** for promise terms (no in-game promise valuation exists, so this is the raw decision inputs the negotiator reasons over).

Legality and estimation are unified here — there is no separate estimate tool, and everything is advisory: it gates nothing (specs §4). The DLL additions are read-only, touching no save format and no acceptance path, so they carry none of stage 6's write-path risk — but the stage **does require a DLL rebuild**.

## What was built

### DLL (read-only)

- **`CvDeal::IsPossibleToTradeItem`** gained a defaulted trailing `bTreatAsHumanToHuman` (default `false` reproduces the computed value exactly, OR-ed into `bHumanToHuman`), exposed through `lIsPossibleToTradeItem` (optional 9th Lua arg). The inspection wrapper passes `true` so the **screen's per-term legality matches what stage-6 enactment will allow** — otherwise items legal for agents (e.g. a second city in one deal) would wrongly show illegal in preview.
- **`CvDeal::GetReasonsItemUntradeable`** gained the same defaulted parameter, threaded **only into its internal `IsPossibleToTradeItem` call**, so it never reports a stale reason for an item the agent path allows. Exposed through `lGetReasonsItemUntradeable` (optional 9th arg). Where the stock reason API is silent, the inspection wrapper supplies a structured fallback reason.
- **New read-only `lGetTradeItemValue`** (`CvLuaDeal.cpp`/`.h`, registered in `PushMethods`) wrapping `CvDealAI::GetTradeItemValue` and returning **both directions** in one call (value to the giver with `bFromMe=true`, value to the receiver with `bFromMe=false`). The valuation-layer anti-exploit `INT_MAX` sentinels (last strategic resource, last luxury while unhappy) surface in the estimate but gate nothing.
- All additive, with **no `TradeableItems` or save-format change**. The `AreAllTradeItemsValid(bTreatAsHumanToHuman)` override is deferred to stage 6 — only enactment needs it; nothing read-only calls it.

### mcp-server

- **[deal-schema.ts](../../../mcp-server/src/utils/deal-schema.ts)** — the **pinned shared contract** for stages 4–6: `Payload.Deal` (`version: 1`, `items`, `promises`, optional `rationale`, optional `message`), the `Payload.Value1` / `Value2` per-item value-map shape, and the `TRADE_ITEM_TYPES` / `PROMISE_TYPES` vocabularies (see *Pinned deal payload* below).
- **[inspect-deal.lua](../../../mcp-server/lua/inspect-deal.lua)** — builds a transient `UI.GetScratchDeal()` (never activated), evaluates each proposed term directly (legality under `bTreatAsHumanToHuman=true`, reason, both-direction value), and enumerates the **full tradable range per side** (gold, GPT, resources, cities, techs, maps, open borders, embassy, defensive pact, research agreement, peace, DoF, third-party peace/war, vassalage + revoke). Vote-commitment enumeration is omitted from the *range* (needs live World Congress context) but vote commitments are fully supported as explicit proposed terms.
- **[utils/lua/inspect-deal.ts](../../../mcp-server/src/utils/lua/inspect-deal.ts)** — a `LuaFunction` wrapper (structured-arg transport, modeled on `present-decision.ts`).
- **[tools/knowledge/inspect-deal.ts](../../../mcp-server/src/tools/knowledge/inspect-deal.ts)** — the read tool `{ PlayerAID, PlayerBID, ProposedDeal? }` returning per-trade-item `{ legality, reasons, valueIfIGive, valueIfIReceive }`, per-promise `{ agreeabilityFactors }` (assembled from `get-opinions` / `get-players` / `get-diplomatic-events` — approach, opinion, trust/untrustworthiness, broken/ignored-promise history, victory competition — cached per promiser; **no DLL verdict**, keeping the DLL merge-compatible), and the tradable range per side. Registered in `tools/index.ts`.

### Pinned deal payload

`Payload.Deal` is the shared form `inspect-deal` accepts and transcript proposals store:

- `version: 1`;
- `items`: ordinary trade terms, each with `fromPlayerID`, `toPlayerID`, `itemType`, and the item-specific data the matching `lAdd*Trade` constructor needs;
- `promises`: promise terms, each with `promiserID`, `recipientID`, `promiseType`, optional `targetPlayerID` (Coop War / city-state promises), optional `duration`;
- optional **`rationale`** (inward reasoning for the proposing diplomat) and optional **`message`** (a one-sentence outward line) — both optional, both ignored by `inspect-deal` (not game state); they ride with the deal for the diplomat⇔negotiator handoff and display (stage 5).

Proposal/counter messages may also carry `Payload.Value1` / `Value2`: a **per-item value map** for each ordered player (`Value1` → `Player1ID`, `Value2` → `Player2ID`), keyed by trade-item index, holding the proposal-time `GetTradeItemValue` of that item to that player. Promises are excluded (their agreeability is factor-based). `inspect-deal` returns per-item values only — the trade screen's **other-side total value balance** is summed from them on the client (no per-side total field, no new DLL helper). Legality and reasons are never stored — current legality comes from a fresh `inspect-deal` call.

## Reuse

The already-exposed `lAdd*Trade` constructors on `CvLuaDeal.cpp`; `CvDealAI::GetTradeItemValue` (new per-item read-only wrapper; existing `CvLuaPlayer` valuation helpers expose only totals, not the per-item two-direction value); the `LuaFunction` bridge + structured-argument transport (`bridge/lua-function.ts`, `utils/lua/present-decision.ts`); the `ToolBase` read-tool shape; the diplomacy getters `get-opinions` / `get-players` / `get-diplomatic-events` (and `getTool(...)` intra-tool reuse).

## Verify

Against a running game, via MCP client tool calls: `inspect-deal` with an **empty** proposed deal returns the full tradable range for both civs and the promise agreeability factors. Add one trade item — the response shows its legality and value **both directions**. Add a structurally-illegal item (e.g. a city you don't own) — it reports untradeable with a reason from the matched reason/fallback path. Add an item that stock AI-human legality would reject but human-human permits — it reports legal, matching stage-6 enactment semantics. Confirm nothing was enacted (no game-state change; the transient deal left no trace).

## Done when

`inspect-deal` returns, in a single read-only call, the full tradable range per side plus per-term legality, both-direction value estimates, and promise agreeability factors for any constructed or empty deal — with no write path and no save/version impact.
