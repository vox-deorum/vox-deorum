# Architecture

Vox Deorum lets language-model agents play Civilization V — making strategic decisions for AI civilizations and holding in-character conversations with the human player. The game itself has no idea an LLM is involved; it asks its C++ AI for a decision as it always has, and something on the other side of a pipe answers. Getting from "the game wants a decision" to "an LLM decided" crosses four boundaries and five components, each of which exists to bridge a gap the layer below it cannot.

This page is the map. Each component has its own folder under [developers/](.) with the full story; here we explain what each one is, how data flows between them, and why the stack is shaped this way.

## The stack at a glance

```
Civ 5  ↔  Community Patch DLL  ↔  Bridge Service  ↔  MCP Server  ↔  Vox Agents  →  LLM
              (named pipe)         (REST / SSE)       (MCP/HTTP)      (LLMs)
```

Reading bottom to top, each arrow is a different protocol because each boundary solves a different problem:

- The **DLL** is C++ inside the game process and can only safely touch game state at specific moments; it speaks a private Windows **named pipe**.
- The **Bridge Service** translates that Windows-only pipe into ordinary **HTTP and an event stream** so nothing above it needs to know a pipe exists.
- The **MCP Server** turns "read game state / steer the AI" into **Model Context Protocol tools** an agent can call, and remembers what it has seen.
- **Vox Agents** is where LLMs actually run, calling those tools to decide and to talk.

Each layer is independently runnable and restartable: the bridge survives the game restarting, the MCP server survives the bridge bouncing, and the agents survive all of it. That resilience is a deliberate property of the boundaries, not an accident.

## The five components

### Community Patch DLL — the game layer
The [civ5-dll](civ5-dll/overview.md) is a modified build of the **Community Patch + Vox Populi** gamecore: the open-source C++ that replaces Civ V's rules engine and built-in AI. Stock Community Patch is a closed system — nothing outside the process can see in. Vox Deorum's one addition is a **connection service** (`CvConnectionService`) that opens a channel out of the game: it exposes game state and a live event stream, accepts commands (run this Lua, call this function), and lets external decisions stand in for what the built-in AI would have done. Because the gamecore is strict about *when* its state may change, the service does all its pipe I/O on a background thread and only acts on messages at safe points in the turn loop. See [civ5-dll/connection.md](civ5-dll/connection.md).

### Civ 5 Mod — the switch that arms it
The modified DLL ships with its outside channel **dormant**. The [civ5-mod](civ5-mod/overview.md) — a small Lua/SQL/XML package published as "(1b) Vox Deorum" — is what turns it on: on activation it flips the gamecore options that enable the named-pipe channel and the game-event stream, registers a reproducible map script for research, and loads an in-game addin that relays strategic-decision events into the UI and render events back out. Without the mod loaded, the connection service has nothing to do. See [civ5-mod/lua-hooks.md](civ5-mod/lua-hooks.md).

### Bridge Service — the translator
The [bridge-service](bridge-service/overview.md) is a small Node.js/TypeScript service that connects to the DLL as the **sole client** of its pipe and re-exposes everything as a REST API plus a real-time event stream. It carries three kinds of traffic in both directions — calls *into* the game (run Lua, invoke a registered function), calls *out of* the game (game Lua invoking a registered external HTTP endpoint), and events *out of* the game (the live turn-by-turn feed, fanned out over Server-Sent Events or a second named pipe). On top of message passing it also **paces** the game: pausing specific players so an agent can take their turn, and throttling AI turns for media capture. See [bridge-service/connection.md](bridge-service/connection.md) and [bridge-service/lua.md](bridge-service/lua.md).

### MCP Server — the game as tools
The [mcp-server](mcp-server/overview.md) is the bridge's primary consumer and the point where the AI side meets the game. It exposes Civ V's state and controls to agents as roughly three dozen [Model Context Protocol](https://modelcontextprotocol.io) tools — "what can this player research?", "set this civ's grand strategy to conquest" — backed by three sources: a **knowledge store** (a per-game SQLite database it fills from the event stream and periodic state snapshots, filtered by what each player can see), the **game database** (Civ V's own rules data), and the **bridge integration** (a queue that batches Lua calls into the live game and consumes its events). A family of action tools also *steers* the built-in AI — flavors, strategies, personas, diplomacy — so an LLM's influence is felt even by civilizations it does not directly control. See [mcp-server/tools.md](mcp-server/tools.md), [mcp-server/knowledge.md](mcp-server/knowledge.md), and [mcp-server/bridge.md](mcp-server/bridge.md).

### Vox Agents — where the LLMs live
The [vox-agents](vox-agents/overview.md) framework is the top of the stack: TypeScript in which language-model agents actually play. Every agent extends a common `VoxAgent` base class — a bundle of lifecycle hooks driven by an execution context (`VoxContext`) that owns the MCP client connection, the tool registry, and the agentic step loop. Concrete families build on that core: [strategists](vox-agents/strategist.md) make per-turn decisions for LLM-controlled civilizations, [envoys](vox-agents/envoy.md) hold in-character conversations with the player, [support agents](vox-agents/support-agents.md) do delegated work, and the [telepathist](vox-agents/telepathist.md), [oracle](vox-agents/oracle.md), and [archivist](vox-agents/archivist.md) handle post-game analysis, counterfactual replay, and episode extraction. The framework is provider-agnostic — OpenAI, Anthropic, Google, AWS Bedrock, OpenRouter, and local OpenAI-compatible endpoints — with per-agent model assignment.

## How data flows

Two journeys cover almost everything; the [protocol](protocol.md) page traces them message by message.

**Down — an agent reads or acts.** A strategist needs the game state, so it calls MCP tools. Each tool that touches the live game becomes a queued Lua call; the MCP server batches up to fifty of them into one request to the bridge, which frames them onto the named pipe. The DLL drains them at a safe point in the turn loop, runs the Lua, and sends results back up the same path. Reads of static rules data short-circuit this entirely — they come straight from the MCP server's game database — and recent observations come from its knowledge store, so the game is only disturbed when it has to be.

**Up — the game tells the agents what happened.** As turns play out the DLL emits a continuous event stream. The bridge fans it out; the MCP server consumes it (preferring the local event pipe, falling back to SSE), validates and stores each event in the knowledge store, and pushes MCP notifications to connected agents — turn completed, game switched, DLL connected or disconnected, a render-worthy event fired. Agents react to turns as they happen instead of polling.

**Pacing ties the two together.** When it is an LLM-controlled player's turn, the agent framework has the bridge pause that player; the game holds at a safe point until the agent's decision comes back down the stack, then resumes. The same machinery applies back-pressure: if the MCP server's Lua queue backs up, it pauses the game until it catches up, so the game waits for the AI side rather than the AI side dropping work.

## Why the layers exist

Each boundary earns its keep:

- **DLL ↔ Bridge (named pipe).** The game is a 32-bit Windows process with a private IPC mechanism and hard rules about thread-safety and save serialization. Keeping that complexity sealed behind one pipe — with one server, one client — means everything above it can be ordinary cross-platform Node.js.
- **Bridge ↔ MCP (HTTP/SSE).** Translating the pipe into HTTP decouples the AI side from Windows and from the game's lifecycle. The bridge reconnects to the game on its own and replays lost registrations, so the MCP server above it sees a stable service even as the game restarts.
- **MCP ↔ Agents (MCP).** Model Context Protocol is the standard interface LLM agents already speak. Exposing the game as MCP tools means any MCP-capable agent — and any provider's model — can drive it, and the knowledge store gives agents a queryable memory the game itself does not keep.
- **A separate agent layer.** Strategy, conversation, and analysis are prompt-and-model concerns with their own lifecycle (sessions, tracing, batching, replay). Keeping them out of the MCP server lets the same tool surface serve many different agents.

## Where to go next

- [Setup](setup.md) — build the stack from source and run it end to end.
- [Protocol](protocol.md) — the full message path, layer by layer.
- [Testing](testing.md) and [Releasing](releasing.md) — how the project is tested and shipped.
- The five component folders linked above, for depth on any single layer.
