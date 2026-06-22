# Architecture

Vox Deorum lets language-model agents play Civilization V. They make strategic decisions for AI civilizations and hold in-character conversations with the human player.

The game never knows an LLM is involved. It asks its C++ AI for a decision exactly as it always has, and something on the other side of a pipe answers. Turning "the game wants a decision" into "an LLM decided" crosses four boundaries and five components. Each component bridges a gap the layer below it cannot.

This page is the map. It explains what each component is, how data flows between them, and why the stack is shaped this way. Each component also has its own folder under [developers/](.) with the full story.

## The stack at a glance

```
Civ 5  ↔  Community Patch DLL  ↔  Bridge Service  ↔  MCP Server  ↔  Vox Agents  →  LLM
              (named pipe)         (REST / SSE)       (MCP/HTTP)      (LLMs)
```

Every arrow is a different protocol, because every boundary solves a different problem. Reading from the game upward:

| Boundary | Protocol | What it solves |
|---|---|---|
| Game ↔ DLL | in-process C++ | The DLL is C++ inside the game and can only touch game state at safe moments. |
| DLL ↔ Bridge | named pipe | The DLL speaks a private Windows pipe; nothing above needs to know the pipe exists. |
| Bridge ↔ MCP | REST / SSE | The bridge translates the pipe into ordinary HTTP and an event stream. |
| MCP ↔ Agents | MCP / HTTP | The MCP server exposes "read game state / steer the AI" as tools, and remembers what it has seen. |
| Agents → LLM | provider API | Vox Agents is where LLMs actually run, calling those tools to decide and to talk. |

Each layer is independently runnable and restartable. The bridge survives the game restarting, the MCP server survives the bridge bouncing, and the agents survive all of it. That resilience is a deliberate property of the boundaries, not an accident. See [Why the layers exist](#why-the-layers-exist).

## The five components

### Community Patch DLL — the game layer

The [civ5-dll](civ5-dll/overview.md) is a modified build of the **Community Patch + Vox Populi** gamecore: the open-source C++ that replaces Civ V's rules engine and built-in AI.

Stock Community Patch is a closed system; nothing outside the process can see in. Vox Deorum adds one thing, a **connection service** (`CvConnectionService`) that opens a channel out of the game. The service exposes game state and a live event stream, accepts commands (run this Lua, call this function), and lets external decisions stand in for the built-in AI.

The gamecore is strict about *when* its state may change. So the service does all its pipe I/O on a background thread and only acts on messages at safe points in the turn loop. See [civ5-dll/connection.md](civ5-dll/connection.md).

### Civ 5 Mod — the switch that arms it

The modified DLL ships with its outside channel **dormant**. The [civ5-mod](civ5-mod/overview.md) is what turns it on. It is a small Lua/SQL/XML package published as "(1b) Vox Deorum". On activation, the mod:

- Flips the gamecore options that enable the named-pipe channel and the game-event stream.
- Registers a reproducible map script for research.
- Loads an in-game addin that relays strategic-decision events into the UI and render events back out.

Without the mod loaded, the connection service has nothing to do. See [civ5-mod/lua-hooks.md](civ5-mod/lua-hooks.md).

### Bridge Service — the translator

The [bridge-service](bridge-service/overview.md) is a small Node.js/TypeScript service. It connects to the DLL as the **sole client** of its pipe and re-exposes everything as a REST API plus a real-time event stream.

It carries three kinds of traffic, in both directions:

- **Calls into the game** — run Lua, invoke a registered function.
- **Calls out of the game** — game Lua invoking a registered external HTTP endpoint.
- **Events out of the game** — the live turn-by-turn feed, fanned out over Server-Sent Events or a second named pipe.

On top of message passing, the bridge also **paces** the game: it pauses specific players so an agent can take their turn, and throttles AI turns for media capture. See [bridge-service/connection.md](bridge-service/connection.md) and [bridge-service/lua.md](bridge-service/lua.md).

### MCP Server — the game as tools

The [mcp-server](mcp-server/overview.md) is the bridge's primary consumer and the point where the AI side meets the game. It exposes Civ V's state and controls as roughly three dozen [Model Context Protocol](https://modelcontextprotocol.io) tools — "what can this player research?", "set this civ's grand strategy to conquest".

The tools draw on three sources:

- **Knowledge store** — a per-game SQLite database, filled from the event stream and periodic state snapshots, filtered by what each player can see.
- **Game database** — Civ V's own rules data.
- **Bridge integration** — a queue that batches Lua calls into the live game and consumes its events.

A family of action tools also *steers* the built-in AI — flavors, strategies, personas, diplomacy. This means an LLM's influence is felt even by civilizations it does not directly control. See [mcp-server/tools.md](mcp-server/tools.md), [mcp-server/knowledge.md](mcp-server/knowledge.md), and [mcp-server/bridge.md](mcp-server/bridge.md).

### Vox Agents — where the LLMs live

The [vox-agents](vox-agents/overview.md) framework is the top of the stack: TypeScript in which language-model agents actually play. Every agent extends a common `VoxAgent` base class, a bundle of lifecycle hooks driven by an execution context (`VoxContext`) that owns the MCP client connection, the tool registry, and the agentic step loop.

Concrete families build on that core:

- [strategists](vox-agents/strategist.md) make per-turn decisions for LLM-controlled civilizations.
- [envoys](vox-agents/envoy.md) hold in-character conversations with the player.
- [support agents](vox-agents/support-agents.md) do delegated work.
- The [telepathist](vox-agents/telepathist.md), [oracle](vox-agents/oracle.md), and [archivist](vox-agents/archivist.md) handle post-game analysis, counterfactual replay, and episode extraction.

The framework is provider-agnostic — OpenAI, Anthropic, Google, AWS Bedrock, OpenRouter, and local OpenAI-compatible endpoints — with per-agent model assignment.

## How data flows

Two journeys cover almost everything. The [protocol](protocol.md) page traces them message by message.

**Down — an agent reads or acts.** A strategist needs the game state, so it calls MCP tools. Each tool that touches the live game becomes a queued Lua call. The MCP server batches up to fifty of them into one request to the bridge, which frames them onto the named pipe. The DLL drains them at a safe point in the turn loop, runs the Lua, and sends results back up the same path.

Most reads never disturb the game. Static rules data comes straight from the MCP server's game database, and recent observations come from its knowledge store. The game is only touched when it has to be.

**Up — the game tells the agents what happened.** As turns play out, the DLL emits a continuous event stream. The bridge fans it out. The MCP server consumes it (preferring the local event pipe, falling back to SSE), validates and stores each event in the knowledge store, and pushes MCP notifications to connected agents — turn completed, game switched, DLL connected or disconnected, a render-worthy event fired. Agents react to turns as they happen instead of polling.

**Pacing ties the two together.** On an LLM-controlled player's turn, the agent framework has the bridge pause that player. The game holds at a safe point until the agent's decision comes back down the stack, then resumes. The same machinery applies back-pressure: if the MCP server's Lua queue backs up, it pauses the game until it catches up. The game waits for the AI side rather than the AI side dropping work.

## Why the layers exist

Each boundary earns its keep.

- **DLL ↔ Bridge (named pipe).** The game is a 32-bit Windows process with a private IPC mechanism and hard rules about thread-safety and save serialization. Sealing that complexity behind one pipe — one server, one client — means everything above it can be ordinary cross-platform Node.js.
- **Bridge ↔ MCP (HTTP/SSE).** Translating the pipe into HTTP decouples the AI side from Windows and from the game's lifecycle. The bridge reconnects to the game on its own and replays lost registrations, so the MCP server above it sees a stable service even as the game restarts.
- **MCP ↔ Agents (MCP).** Model Context Protocol is the standard interface LLM agents already speak. Exposing the game as MCP tools means any MCP-capable agent — and any provider's model — can drive it. The knowledge store gives agents a queryable memory the game itself does not keep.
- **A separate agent layer.** Strategy, conversation, and analysis are prompt-and-model concerns with their own lifecycle: sessions, tracing, batching, replay. Keeping them out of the MCP server lets the same tool surface serve many different agents.

## Where to go next

- [Setup](setup.md) — build the stack from source and run it end to end.
- [Protocol](protocol.md) — the full message path, layer by layer.
- [Testing](testing.md) and [Releasing](releasing.md) — how the project is tested and shipped.
- The five component folders linked above, for depth on any single layer.
