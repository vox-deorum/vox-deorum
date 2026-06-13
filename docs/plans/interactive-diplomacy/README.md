# Interactive Diplomacy — Staged Implementation Plan

This folder holds the interactive-diplomacy feature: the specification ([specs.md](specs.md)) and this staged implementation plan. Each numbered file is a self-contained stage: objective, work items, what it reuses, and how to verify it. Implement in order — each stage is independently verifiable.

The goal in one line: two major civilizations — each voiced by a human or an LLM — can hold a durable, Web-visible **conversation** and, within it, **negotiate a structured deal** (trade items + diplomatic promises) that, once both sides agree, is **enacted for real** through a new additive DLL entrypoint that honors structural legality but bypasses the AI's political refusal. Implementation **starts from human→LLM on the Web** (§5, §9).

| Stage | Plan | Objective |
|---|---|---|
| 1 | [01-transcript-store.md](01-transcript-store.md) | Durable conversation transcript store in mcp-server (messages keyed by game + civ pair). |
| 2 | [02-conversation.md](02-conversation.md) | **Core MVP:** human↔LLM civ-to-civ free-text conversation on the Web, write-through to the store. |
| 3 | [03-inspect-deal.md](03-inspect-deal.md) | Read-only `inspect-deal`: full tradable range per side + per-term legality + value/agreeability evaluation of any deal (incl. empty); ships the read-only `GetTradeItemValue` Lua getter. |
| 4 | [04-deal-screen.md](04-deal-screen.md) | Vue deal screen replicating the in-game trade-screen layout, driven by `inspect-deal`. |
| 5 | [05-negotiator.md](05-negotiator.md) | Negotiator agent + diplomat deal tools + diplomat⇔negotiator loop; both sides reach agreement. |
| 6 | [06-dll-enact-deal.md](06-dll-enact-deal.md) | **Only gameplay change:** DLL `EnactAgentDeal` (trade items + 9 promises + Coop War) + the `enact-agent-deal` MCP tool — real enactment flips on. |
| 7 | [07-ingame-panel.md](07-ingame-panel.md) | *(later phase)* In-game diplomacy panel addon modeled on the human-control panel. |
| 8 | [08-directions.md](08-directions.md) | *(later phase)* LLM→human + LLM→LLM directions and per-direction config gating. |
| 9 | [09-additivity-review.md](09-additivity-review.md) | Static review for additivity/comparability (the normal pathway and AI valuation stay untouched). |

**Preview-then-enact shape.** Stages 1–2 deliver the conversation MVP. Stages 3–5 build the *entire* deal **inspection + UI + negotiation** experience in a **preview/inspect mode** against live game state — deals can be browsed, constructed, evaluated, countered, and *agreed*, but not yet enacted. Stage 6 — the single, late, isolated DLL **write path** — flips on real enactment and completes the human↔LLM Web v1. Stages 7–8 are the explicitly-deferred later phases (in-game panel, LLM-initiated directions); stage 9 is the closing review.

This MVP-first ordering means no stage leaves a large untested chunk for the end: stages 3–5 each verify against `inspect-deal` output rather than against game-state change, and stage 6 turns the agreed-but-inert deal into a real one.

## How it fits the existing code

- **Conversation reuses the Envoy stack.** `Envoy` / `LiveEnvoy` / `Diplomat` (`vox-agents/src/envoy/*.ts`), the `EnvoyThread` type (`vox-agents/src/types/chat.ts`), and the web chat routes `/api/agents/chat` + `/api/agents/message` (`vox-agents/src/web/routes/agent.ts`). Today those routes hold chat only in the in-memory `chatSessions` map; this feature turns that map into a **write-through cache** over the mcp-server transcript store (stage 2 § Threads live only in vox-agents).
- **Transcript storage reuses the knowledge store.** A single `TimedKnowledge`-backed table via `createTimedKnowledgeTable` / `setupKnowledgeDatabase` (`mcp-server/src/knowledge/schema/*`) and `storeTimedKnowledgeBatch`, surfaced through the `ToolBase` / `ActionTool` pattern (`mcp-server/src/tools/abstract/*`) and the `tools/index.ts` registry. One conversation per civ pair ⇒ **no thread table, no status column** (specs §6).
- **Deal tools reuse the Lua bridge.** The `LuaFunctionTool` / `ActionTool` base classes and the `LuaFunction` pattern (`mcp-server/src/bridge/lua-function.ts`, `src/utils/lua/*`). Promise **agreeability factors** are assembled from existing diplomacy getters — `get-opinions`, `get-players`, `get-diplomatic-events` (`mcp-server/src/tools/knowledge/*`) — not computed in the DLL.
- **Read-only deal inspection reuses what `CvLuaDeal.cpp` already exposes.** `lIsPossibleToTradeItem` / `lGetReasonsItemUntradeable` and the per-item `lAdd*Trade` constructors already exist on the Lua-exposed `CvDeal`. The only read-only DLL addition (stage 3) is a Lua wrapper for `CvDealAI::GetTradeItemValue`, computed both directions — additive, no save/version impact.
- **Enactment (stage 6) is one additive DLL entrypoint.** `lEnactAgentDeal` registered in `CvLuaDeal.cpp`'s `PushMethods`, reusing `AreAllTradeItemsValid()` / `FinalizeDealValidAndAccepted` / `ActivateDeal` (`CvDealClasses.cpp`) with acceptance pre-decided and `bHumanToHuman = true`, **never** calling `CvDealAI`. Promises are applied directly via the eight `SetXxxPromiseState` / `SetXxxPromiseTurn` setters (with their existing side-effects) and `SetCoopWarState` (`CvDiplomacyAI.*`). The whole entrypoint is gated behind `MOD_ACTIVE_DIPLOMACY` (`CustomMods.h`); version bump via `scripts/release.py`.
- **Per-seat agent selection mirrors the strategist model.** Add `diplomat` / `negotiator` fields to `PlayerConfig` (`vox-agents/src/types/config.ts`); resolve the *target* seat's configured agents from `getPlayerAssignments` rather than trusting a client-supplied agent name; register the new agents in `vox-agents/src/infra/agent-registry.ts` (the `initializeDefaults` idiom).
- **The Web deal screen lives beside the existing chat UI.** New Vue components under `vox-agents/ui/src/components/` embedded in `ChatDetailView.vue`, talking to vox-agents through `ui/src/api/client.ts` — the Web reaches mcp-server only **through** vox-agents (specs §6, no direct Web→mcp channel).

## Risks / watch-items

- **DLL arg-buffer headroom.** The full `OptionsReport`-style deal payload travels through `CvConnectionService.cpp`'s `lua_call` args buffer (the human-control work already bumped it to 64 KB). A late-game tradable range across all item types is large — confirm headroom and degrade gracefully on overflow.
- **Promise legality is a light entrypoint check, not `IsPossibleToTradeItem`.** Promises are not `TradeableItems`; their structural check (distinct living majors; not already `PROMISE_STATE_MADE` for the pair; Coop War needs a valid target) lives in `EnactAgentDeal`, separate from trade-item validation.
- **Deals are fetched live, never stored.** The transcript records only that a proposal was made plus an **opaque reference** — never a frozen copy. A deal under discussion is (re)constructed and inspected in the game on demand.
- **One conversation per civ pair.** The store is keyed by game + the two `playerID`s; the conversation *is* the ordered message list. No thread identity, no status column; open/closed is derived from the close-conversation special message and its turn.
- **A conversation may outlive its pause.** Even a human conversation can stretch across turns and the game state can move on. A deal is validated and enacted against the game state **at enactment time**, not at proposal time; the diplomat must re-read current state rather than assume a frozen world (specs §8).
- **Keep the DLL merge-compatible with upstream Vox Populi.** No new `TradeableItems` value, no new save fields, no new `IsXxxAcceptable`/valuation logic. Promise agreeability is factor-based reasoning in the negotiator agent, not a DLL verdict.
- **Stages 3–5 run in preview mode until stage 6.** Their Verify sections assert against `inspect-deal` output and reached-agreement, not against real game-state change — only stage 6 can verify items actually changing hands.

## Open items to settle during implementation

- **Opaque deal-reference scheme** (stage 3/5): how a proposal under discussion is referenced in the transcript and re-fetched/-reconstructed from the game on demand.
- **Per-direction config flags** (stage 8): the exact shape that lets a seat/session enable or disable initiating diplomacy, accepting incoming diplomacy, and each of the three directions — none hard-wired (specs §5).
- **Negotiator authority** (stage 5): whether anything beyond "authority is baked into the chosen negotiator agent" (specs §7) is needed; the plan assumes no separate ratification-threshold knob.
- **Web deal-screen parity with the in-game trade screen** (stage 4): the layout is a replica of the in-game screen; settle the exact column/section mapping (both sides' tables, promise terms, per-term legality + estimate) as the component is built — no separate mockup gate.
