# Stage 7 — civ5-mod + civ5-dll + mcp-server + vox-agents: in-game diplomacy panel

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).
>
> **Status: later phase — now fully planned.** This file is the index of the staged sub-plan in [07-ingame-panel/](07-ingame-panel/): the pinned contracts live in [07-ingame-panel/specs.md](07-ingame-panel/specs.md), and the five stage docs are independently verifiable, in order. Depends on stages 1–6 (all machinery it reuses).

## Objective

Give a human **playing their own civ** the Web v1 diplomacy experience inside Civ V: a **Converse** button added to the leader discussion screen (existing options untouched, EUI/VP install), a native-styled **chat panel** over the same durable pair transcript with **streamed** replies, a **vendored copy of the game's own trade screen** with locally computed per-term legality/values (human-to-human semantics) plus the promises category, real enactment through the same stage-6 `enact-agent-deal` entrypoint, and async replies delivered as **native in-game notifications** that persist across turns — so correspondence works like ancient-world mail. No real-time Web⇄game sync: the two surfaces share storage and agents only (specs §6, §9).

The panel is a **second client of the existing backend**: it reuses the Web chat engine (`runChatTurn`), the deal helpers (extracted into transport-neutral actions where they were route-shaped), the transcript store, and the Web's client-side derivation model — the server pushes transcript **rows**; the panel derives deal state in Lua exactly as the browser does with `deriveActiveProposal`.

## Architecture in one look

```
 in-game (civ5-mod)                            server side
 ┌────────────────────────────────┐            ┌────────────────────────────────┐
 │ Converse button (01)           │  4 game    │ mcp-server (thin transport):   │
 │ Chat panel (01) — registers    │  events    │  event schemas + whitelist,    │
 │  the push fns, derives deal    │ ─────────► │  call-lua-function tool        │
 │  state from rows               │            │ vox-agents (all logic):        │
 │ Native notifications (01)      │ ◄───────── │  ingame-bridge → runChatTurn / │
 │ Vendored trade screen (02) —   │  4 push    │  deal action helpers /         │
 │  local legality/values         │  functions │  enact-agent-deal              │
 └────────────────────────────────┘            └────────────────────────────────┘
```

## Stages

Build order is **UI-first**: the two mod-UI stages run entirely on mock data in a live game, retiring the risky Civ-UI unknowns before any server code; transport follows; wiring connects them; hardening closes.

| Stage | Plan | Objective |
|---|---|---|
| 7.01 | [01-ui-groundwork.md](07-ingame-panel/01-ui-groundwork.md) | Converse button on the leader screen, native-notification channel (type, click hook, cross-turn persistence), and the chat panel — all mock-driven. Smoke test: Converse click posts one notification; clicking it opens the panel. |
| 7.02 | [02-deal-screen-ui.md](07-ingame-panel/02-deal-screen-ui.md) | Vendored, renamed trade screen driven by a mock `DealPayload` against real game state: local h2h legality/values, promises category, DealPayload-v1 serialization ending at stub emits. |
| 7.03 | [03-transport.md](07-ingame-panel/03-transport.md) | DLL buffer/pool fixes, the event schemas + whitelist, the generic `call-lua-function` tool, paginated transcript reads, and the ingame-bridge skeleton — probe-verified end to end. |
| 7.04 | [04-wiring.md](07-ingame-panel/04-wiring.md) | Live conversation through `runChatTurn` with a game streaming sink, deal moves through the extracted shared actions, enactment, notifications on replies, greeting parity. |
| 7.05 | [05-hardening.md](07-ingame-panel/05-hardening.md) | Degradation, watch-item and regression sweeps; comparability review vs the Web flow. |

All contracts (events, push functions, derivation rules, UI-responsiveness rules, size/text rules, reuse-and-extension map, design decisions, watch-items) are pinned once in [07-ingame-panel/specs.md](07-ingame-panel/specs.md).

## Verify

A human playing in-game against an LLM civ can: open a conversation from the leader screen (history shared with the Web), exchange streamed messages, walk away and receive the reply as a native notification turns later, negotiate a deal — including promises — on the native-looking trade screen with legality/values computed locally, and have an accepted deal enacted once through the stage-6 entrypoint — with the whole exchange visible in the Web transcript, and native screens regression-free. Each stage doc carries its own concrete verify list.

## Done when

All five stages' done-when hold together in one live game session, and the comparability review in stage 7.05 documents how the in-game panel matches, simplifies, or defers each Web capability.
