# Envoys

Envoys are the agents a person talks to. Each AI civilization can field two voices in chat:

| Voice | Does | Reports back? |
| --- | --- | --- |
| **Spokesperson** | Answers questions in character about its nation's views. | No. The conversation stays between you and it. |
| **Diplomat** | Talks and negotiates, and quietly files reports on what it learns. | Yes, to its leader through an analyst. |

Talk to a spokesperson to learn about a civilization; talk to a diplomat and the civilization may learn about you. Keep this distinction in UI text.

A third agent, the **negotiator**, works behind the diplomat and makes the actual deal decisions.

Envoys work in chat threads that can span many turns. In-game and dashboard chats share the runner in `src/web/chat/turn.ts`. See [Web UI](../platform/ui.md) for the HTTP routes and [Diplomacy](../../diplomacy.md) for the in-game path.

## Threads

`Envoy` (`src/envoy/envoy.ts`) is the base class. Its unit of work is an `EnvoyThread` (`src/types/chat.ts`), which records:

- which agent is speaking, and the game and player it represents,
- who the user is,
- the message history, with each message's wall-clock time and game turn.

The timestamps let replies carry `[Turn N]` markers and let the agent notice time passing. Tool results and other noise are filtered out of the history before it goes to the model, to save tokens.

### Special messages

A special message is a token in triple braces, such as `{{{Initialize}}}`, that the UI sends instead of user text to trigger a behavior. Each envoy lists the ones it supports in `getSpecialMessages()`. Only the [telepathist](telepathist.md) uses them, for setup and its opening greeting.

Live envoys never greet first. An empty live chat shows a fixed greeting line in the UI, and the agent speaks once addressed.

## Live envoys

`LiveEnvoy` (`src/envoy/live-envoy.ts`) connects an envoy to a running game.

- **Its own run.** Each chat message has a separate [run](../framework/runs.md) at the session's current turn and reuses the seat's cached state.
- **Opening context.** The civilization's identity, the players it knows, and its current strategy.
- **Briefings on demand.** A `get-briefing` tool fetches fresh military, economic, or diplomatic [briefings](support-agents.md#briefers) instead of carrying the whole game state.
- **A hint.** Each subclass supplies `getHint()`, a standing reminder of who it is and who it is talking to.
- **Retry reply.** A run that neither speaks nor closes the conversation sends a shared retry line, in observer chats and diplomacy.
- An observer chat cannot name the voiced civilization itself as the caller.

### What the prompts tell them

The diplomat and spokesperson prompts (`vox-agents/prompts/diplomat.md` and `spokesperson.md`, with shared parts in `shared/`; see [Prompt files](../framework/prompt-files.md)) cover:

- The fictional-world framing.
- **No decision-making power.** An envoy cannot commit its leader to anything.
- A speaking style that matches the leader's personality while staying vague about sensitive details.
- Staying in character without denying visible facts. An envoy may spin events or decline to discuss them, but never denies what the other side can see.
- Matching the audience: warm with allies, guarded or taunting with rivals, courteous with neutrals.

**Teammates.** When the other side is a permanent teammate (same team since game start, read from the cached players report), the tone changes. The envoy treats the team's interest as its own, shares plans and numbers openly, and coordinates instead of bargaining. The diplomat always reports a teammate's plans, requests, commitments, warnings, and changes in situation. The negotiator judges a teammate's deals by the team's combined benefit.

## Spokesperson

`Spokesperson` (`src/envoy/agents/spokesperson.ts`) is the civilization's public voice. It explains existing positions using briefings and diplomatic history (`get-diplomatic-events`). It does not invent new positions and does not report to anyone.

## Diplomat

`Diplomat` (`src/envoy/agents/diplomat.ts`) adds analyst reporting, negotiator handoffs, and conversation closure to the shared live tools. It runs in civilization-to-civilization diplomacy threads. When a conversation produces useful information, it sends the content, context, and its memo through `call-diplomatic-analyst`.

The report runs [detached](../framework/agent-framework.md#two-special-shapes), so the diplomat can keep talking while the [analyst](support-agents.md#analysts) decides whether to relay it. Closing the chat does not cancel that analysis. Deal decisions belong to the negotiator.

The diplomat can pick its own model tier for each message with [triage](../models/tiers-and-triage.md#diplomat-triage).

## Deals and the negotiator

Diplomats can see which deal items each side may currently offer, but only so they can talk about them. Deal terms and every accept, counter, or reject decision belong to the negotiator (`src/envoy/agents/negotiator.ts`), which works against the ledger in `src/envoy/ledger/`.

- **Deal history.** The negotiator's context includes its recent closed proposals (the Recent Deal History section), so it does not re-offer a package that was already turned down.
- **Its message.** The negotiator's `Message` is one spoken line for the diplomat to say. The terms themselves are shown to the other side separately.
- **Its model.** The handoff may include a `Tier` to choose the negotiator's model without triage. Resolution follows the shared [tier rules](../models/tiers-and-triage.md).

The full round trip, from the in-game panel through the MCP deal tools and back, is in [diplomacy.md](../../diplomacy.md).

## How a chat reaches an envoy

1. `POST /api/agents/chat` with a live context ID creates a thread attached to the player's existing context.
2. `POST /api/agents/message` adds the user's message, runs the thread's agent, and streams text, reasoning, and tool events back over SSE.

The handlers and the thread store are in `src/web/chat/` (see [Web UI](../platform/ui.md#agent-chat)). Because each request runs in its own run, a client that disconnects cancels only that request.

### Diplomacy transcripts

Diplomacy threads keep a permanent transcript. Two tools make sure nothing bypasses it:

| Tool | File | Role |
| --- | --- | --- |
| `send-message` | `src/envoy/tools/send-message-tool.ts` | The only way a diplomacy thread can speak. Streams the model's message as it arrives, strips any echoed turn and speaker prefix, and adds the transcript row. Threads only accept voices that use this tool, so free text cannot skip the transcript. |
| `close-conversation` | `src/envoy/tools/close-conversation-tool.ts` | Closes the conversation. Its transcript row is saved last, after the turn's other rows. |

At the end of a turn, model and tool traffic is dropped, every saved row goes into the in-memory cache, and those rows are sent to the client. A turn that neither speaks nor closes sends and saves a shared retry line.

## After the game

The same thread machinery serves chats about finished games. That is the [telepathist](telepathist.md), an envoy whose "game state" is a recorded telemetry database.
