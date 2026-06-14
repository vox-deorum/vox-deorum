# Stage 2 — vox-agents + Web: human↔LLM civ-to-civ conversation (CORE MVP)

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

A human seated as a major civilization can, **from the Web**, open a free-text conversation with an LLM-played civ and exchange messages; the LLM answers in the voice of **that seat's configured diplomat agent** (specs §1, §7), not whatever agent name the client requests. The transcript persists through the stage-1 store and survives a restart. Closing the conversation writes a special message and **locks it for the rest of the current turn** (specs §8). No deals yet — this is the conversation MVP, the easiest direction (human→LLM) built end to end.

## Approach

Diplomacy is inherently civ-to-civ and **direction-agnostic** (specs §2, §5): a conversation is keyed by an initiator player and a target player, either of which may be human or LLM. Today's `EnvoyThread` carries a single `playerID` + a `userIdentity` describing the other party; this generalizes it to carry **both endpoint `playerID`s explicitly**. The in-memory `chatSessions` map stops being the source of truth and becomes a **write-through cache** over the stage-1 transcript store.

## Work items

1. **`vox-agents/src/types/chat.ts`** — generalize `EnvoyThread` to carry **both endpoint `playerID`s** (initiator + target) instead of one `playerID` + `userIdentity`, so either side can be human or LLM (specs §2). Keep the existing message/metadata shape.
2. **`vox-agents/src/types/config.ts`** — add optional `diplomat` and `negotiator` fields to `PlayerConfig` beside `strategist` (the `negotiator` is unused until stage 5 but declared now so seat config is complete). They select agents the same way `strategist` does, and may carry their own model overrides via the existing per-agent `llms` map.
3. **Endpoint resolution (initiator + target).** When a conversation is opened against an LLM civ, resolve **that target seat's** configured `diplomat` from `getPlayerAssignments` / the session config, **not** from a client-supplied agent name (specs §2, §7) — the client names the target civ; the server decides which diplomat voices it. The **initiator** endpoint must also be a real seat `playerID`, not a free-form client claim: settle how the Web request establishes which civ the human is seated as (e.g. derived from the session's human-control assignment) so both endpoint IDs on the generalized `EnvoyThread` are server-trusted. For the single-operator human→LLM debug surface this can be as simple as a configured/seleted human seat, but it must be explicit rather than assumed.
4. **`vox-agents/src/web/routes/agent.ts`** — rewire `/api/agents/chat` (open/find the one conversation for the civ pair) and `/api/agents/message` (append + stream the reply) to **persist through the stage-1 mcp-server tools**: write each human and LLM message via `append-message`, hydrate from `read-transcript`, and keep `chatSessions` only as an in-memory write-through cache. Preserve the existing SSE streaming.
5. **`close-conversation` tool + semantics** — give the `Diplomat` envoy a **`close-conversation`** tool that writes the close special message via `append-message`; vox-agents derives **open/closed status (and the same-turn reopen lock)** from the presence and turn of that message (specs §8). Once closed on a turn, the counterpart cannot reopen until a later turn — giving an LLM diplomat a real way to walk away from a fruitless or hostile exchange. (The deal-handling tools `propose-deal` / `forward-deal` are added to the diplomat later, in stage 5.)
6. **Web close control** (`vox-agents/ui` — `ChatDetailView.vue` / the chat components) — a **Close** action on the conversation so the human can close it from the Web, and a read-only **open/closed indicator** reflecting the derived status (closed-this-turn vs. reopenable). Closing from the Web routes through the same `append-message` close path as the diplomat's tool.
7. **`vox-agents/src/infra/agent-registry.ts`** — ensure the `Diplomat` envoy is registered/selectable per seat (it already exists); no negotiator yet.

## Reuse

`Diplomat` / `LiveEnvoy` / `Envoy` (`src/envoy/*.ts`) and their existing tools (`get-briefing`, `get-diplomatic-events`); the chat routes + SSE streaming and `chatSessions` map (`src/web/routes/agent.ts`); the per-seat agent-selection idiom used for strategists; `getPlayerAssignments`; the Vue chat surface (`ui/src/components/chat/*`, `ChatDetailView.vue`) and `ui/src/api/client.ts`, which need no structural change for plain conversation.

## Verify

End to end on the Web: launch a session with an LLM civ whose seat config names a diplomat. A human seated as another civ opens a conversation with it and exchanges free-text; the LLM replies in the configured diplomat's voice (and uses the configured model). Stop and restart; reopen the conversation — the full transcript is still there (read from the store, not memory). Close the conversation; confirm it cannot be reopened on the same turn but can on a later turn.

## Done when

A human can hold a durable, restart-surviving, civ-to-civ free-text conversation with an LLM-played civ on the Web, voiced by the target seat's configured diplomat, with working close-and-lock semantics — and the transcript is the mcp-server store, with `chatSessions` reduced to a write-through cache.
