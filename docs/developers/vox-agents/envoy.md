# vox-agents — Envoys

Envoys are the agents a human actually talks to: each AI civilization can field a **spokesperson** that answers questions in character and a **diplomat** that engages in negotiation and quietly reports what it learns. Where [strategists](strategist.md) act once per turn, envoys live in chat threads — a conversation can span many turns of the same game.

The chat itself is carried by the web backend: the in-game chat surface and the dashboard's chat view both talk to the same `/api/agents` routes, which execute the envoy and stream its reply back over SSE (see [ui.md](ui.md)). On the game side, the mod only renders the results — the words come from here, as the civ5-mod [ui.md](../civ5-mod/ui.md) page notes from its side of the fence.

## The Envoy base class

`Envoy` (`src/envoy/envoy.ts`) specializes `VoxAgent` for threaded conversation. Its unit of work is an `EnvoyThread` (`src/types/chat.ts`): the thread records which agent is speaking, the game and player it represents, who the user is, and the message history — each message annotated with the wall-clock time and game turn it was sent on, so replies can be prefixed with `[Turn N]` markers and the agent can notice time passing between messages. When the thread is handed to the LLM, tool results and other noise are filtered out of the history to keep token usage sane.

Envoys also understand **special messages**: triple-brace tokens like `{{{Greeting}}}` that the UI sends instead of user text to trigger a behavior — typically "introduce yourself in one sentence" when a chat is first opened. Each envoy declares which special messages it supports via `getSpecialMessages()`, and tools are disabled while one is being handled. The same mechanism drives the [telepathist's](telepathist.md) `{{{Initialize}}}` bootstrapping, since telepathists are envoys too.

## LiveEnvoy: chatting inside a running game

`LiveEnvoy` (`src/envoy/live-envoy.ts`) binds an envoy to a live strategist session: it shares the player's `StrategistParameters`, opens the conversation with the civilization's identity, the players it knows, and its current strategy, and exposes a `get-briefing` tool so the envoy can pull fresh military, economic, or diplomatic [briefings](support-agents.md) on demand instead of carrying the whole game state in context. Subclasses supply a `getHint()` — a standing reminder of who they are and who they are talking to.

Both concrete envoys share prompt building blocks (`src/envoy/envoy-prompts.ts`): the fictional-world framing, an explicit disclaimer that the envoy has **no decision-making power** (it cannot bind its leader to anything), a communication style that matches the leader's personality while staying strategically vague about sensitive details, and audience-aware framing — warm with allies, guarded or taunting with rivals, professionally courteous with neutrals.

### Spokesperson

`Spokesperson` (`src/envoy/spokesperson.ts`) is the civilization's public voice: it answers questions about its nation's positions and views, drawing on briefings and diplomatic history (`get-diplomatic-events`). It conveys existing positions rather than creating new ones, and it does not report back to anyone — a conversation with the spokesperson stays between you and it.

### Diplomat

`Diplomat` (`src/envoy/diplomat.ts`) plays the same conversational role with one crucial addition: it is an intelligence collector. Alongside the spokesperson's tools it has `call-diplomatic-analyst`, and when a conversation produces something noteworthy — an official proposal, a threat, a rumor, an observation — the diplomat files a report (content, situation context, and its own memo) to the [diplomatic analyst](support-agents.md). That call is fire-and-forget: the analyst assesses the report in the background and decides independently whether to relay it to the leader, while the diplomat keeps talking without pause. The diplomat itself still has no authority to agree to anything.

The distinction to keep in mind (and in any UI copy): **talk to a spokesperson to learn about a civilization; talk to a diplomat and the civilization may learn about you.**

## How a chat reaches an envoy

A chat thread is created through `POST /api/agents/chat` with a live context ID, which attaches the thread to the player's existing `VoxContext`; messages then arrive via `POST /api/agents/message`, which appends the user message to the thread, executes the thread's agent, and streams text, reasoning, and tool-call events back as SSE. The dashboard's chat view (and anything else speaking that API) renders the stream. The route details and the views live in [ui.md](ui.md).

The same thread machinery serves database-backed conversations after a game ends — that is the [telepathist](telepathist.md), an envoy whose "game state" is a recorded telemetry database rather than a live session.
