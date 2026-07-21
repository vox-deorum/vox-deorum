# Stage 7: civ5-mod + civ5-dll + mcp-server + vox-agents: in-game diplomacy panel

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).
>
> **Status: stage 7.01 is implemented; its observer support is a retrofit, and stages 7.02 through 7.05 remain planned.** This index links the pinned contracts in [07-ingame-panel/specs.md](07-ingame-panel/specs.md) and five independently verifiable stages under [07-ingame-panel/](07-ingame-panel/). It depends on stages 1–6.

## Objective

Give a human playing their own civilization the Web v1 diplomacy experience inside Civ V, and extend Converse to observer sessions: a human strategist acts fully as the pinned civilization, while a pure observer uses the spokesperson voice and its live concrete observer slot. Normal humans and human strategists can negotiate deals, including proposing, countering, accepting, rejecting, retracting, inspecting, and enacting them. A pure observer's live deal support depends on its concrete slot satisfying native `CvDeal` participant limits. An out-of-range slot remains chat-only; a native-supported slot may work, but is not promised. Pure observers cannot declare war. Add a **Converse** button without changing existing leader-screen options, a native-styled **chat panel** over the durable pair transcript, streamed replies, and the game's own trade screen reused in place with local human-to-human legality. Include promises and enact accepted deals through the stage-6 `enact-agent-deal` entrypoint. Native notifications preserve replies across turns, like ancient-world mail. The Web and game share storage and agents, but do not synchronize in real time (specs §6, §9).

The panel is a **second client of the existing backend**: it reuses the Web chat engine (`runChatTurn`), the deal helpers (extracted into transport-neutral actions where they were route-shaped), the transcript store, and the Web's client-side derivation model: the server pushes transcript **rows**; the panel derives deal state in Lua exactly as the browser does with `deriveActiveProposal`.

## Architecture in one look

```
 in-game (civ5-mod)                            server side
 ┌────────────────────────────────┐            ┌────────────────────────────────┐
 │ Converse button (01)           │  4 game    │ mcp-server (thin transport):   │
 │ Chat panel (01): registers      │  events    │  event schemas + whitelist,    │
 │  the push fns, derives deal    │ ─────────► │  call-lua-function tool        │
 │  state from rows               │            │ vox-agents (all logic):        │
 │ Native notifications (01)      │ ◄───────── │  ingame-bridge → runChatTurn / │
 │ Native trade screen reused (02):│  4 push    │  deal action helpers /         │
 │  local h2h legality            │  functions │  enact-agent-deal              │
 └────────────────────────────────┘            └────────────────────────────────┘
```

## Stages

Build order is **UI-first**: the two mod-UI stages run entirely on mock data in a live game, retiring the risky Civ-UI unknowns before any server code; transport follows; wiring connects them; hardening closes.

| Stage | Plan | Objective |
|---|---|---|
| 7.01 | [01-ui-groundwork.md](07-ingame-panel/01-ui-groundwork.md) | Mock-driven Converse button, native notification channel, and chat panel, plus an observer retrofit of the shipped stage-01 Lua. Smoke test: Converse posts one notification; clicking it opens the panel. |
| 7.02 | [02-deal-screen-ui.md](07-ingame-panel/02-deal-screen-ui.md) | Native VP EUI trade screen reused in place (included, not copied) driven by a mock `DealPayload` against real game state: local h2h legality via a scratch-deal proxy, native deal-value bar, promises category, DealPayload-v1 serialization ending at stub emits. |
| 7.03 | [03-transport.md](07-ingame-panel/03-transport.md) | DLL buffer and pool fixes, event schemas and whitelist, generic `call-lua-function`, paginated transcript reads, and an end-to-end probe of the ingame-bridge skeleton. |
| 7.04 | [04-wiring.md](07-ingame-panel/04-wiring.md) | Live conversation through `runChatTurn` with a game streaming sink, deal moves through the extracted shared actions, enactment, notifications on replies, greeting parity, spokesperson downgrade, and observer notification targeting. |
| 7.05 | [05-hardening.md](07-ingame-panel/05-hardening.md) | Degradation, watch-item and regression sweeps; comparability review vs the Web flow. |

All contracts (events, push functions, derivation rules, UI-responsiveness rules, size/text rules, reuse-and-extension map, design decisions, watch-items) are pinned once in [07-ingame-panel/specs.md](07-ingame-panel/specs.md).

## Verify

A human playing against an LLM civilization can open a conversation from the leader screen, see history shared with the Web, and exchange streamed messages. They can leave and receive the reply through a native notification on a later turn. They can also negotiate ordinary terms and promises on the native-looking trade screen, then enact an accepted deal once through the stage-6 entrypoint. A human strategist gets the same experience on behalf of the pinned civilization, including correctly attributed war. A pure observer keeps the spokesperson voice and may retain chat and notification behavior, but deal actions are unsupported when its concrete slot is outside native `CvDeal` participant limits. The full exchange remains visible in the Web transcript, and native screens remain regression-free. Each stage has its own verification list.

## Done when

All five stages' done-when hold together in one live game session, and the comparability review in stage 7.05 documents how the in-game panel matches, simplifies, or defers each Web capability.
