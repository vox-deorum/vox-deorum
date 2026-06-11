# Protocol

This page follows a message all the way across the stack — from a language model deciding a turn, down through four components into the running game, and back. It stitches together the per-layer connection pages into one narrative; when you need the exact wire formats, the reference lives with the bridge service (linked at the end). For why the layers are shaped this way, see [architecture.md](architecture.md).

The chain is:

```
Vox Agents  ──MCP──▶  MCP Server  ──HTTP──▶  Bridge Service  ──named pipe──▶  DLL  ──▶  game Lua
```

Each hop changes protocol, and each hop is documented from both ends — the two sides of every link share one format and are meant to be read together:

| Link | Down side | Up side |
|---|---|---|
| Agents ↔ MCP | the agent's tool calls | MCP tools & notifications |
| MCP ↔ Bridge | [mcp-server/bridge.md](mcp-server/bridge.md) | [bridge-service/lua.md](bridge-service/lua.md) |
| Bridge ↔ DLL | [bridge-service/connection.md](bridge-service/connection.md) | [civ5-dll/connection.md](civ5-dll/connection.md) |

## Journey 1: an agent reads or acts on the game

A [strategist](vox-agents/strategist.md) is deciding a turn. To see the board and then act, it calls MCP tools — "what can this player build?", then "set this civ's grand strategy." Here is what each call does.

**1. The agent calls a tool (MCP).** The agent runs inside a `VoxContext`, which is connected to the [MCP server](mcp-server/overview.md) as an MCP client over stdio or HTTP. A tool call travels over that MCP connection. Many reads never go further than the MCP server: questions about *rules* ("what does this unit do?") are answered from the game database, and questions about *recent state* are answered from the knowledge store, both held inside the MCP server. Only a call that needs the *live* game continues down.

**2. The MCP server turns it into Lua (HTTP).** A live read or action means running Lua inside the game. The MCP server's `BridgeManager` has two paths ([mcp-server/bridge.md](mcp-server/bridge.md)): a raw script goes out immediately on a fast path, while a named function call is **queued**. A background loop drains the queue in batches of up to fifty and sends each batch as a single HTTP request to the [bridge](bridge-service/overview.md). Batching is the point — refreshing knowledge fires many small Lua calls per turn, and bundling them cuts the cost of crossing into the game. If the DLL isn't connected, a queued call is rejected at once rather than hanging.

**3. The bridge frames it onto the pipe (named pipe).** The bridge's Lua manager wraps each call as a `lua_call` message (or `lua_execute` for a raw script) and hands it to the DLL connector ([bridge-service/lua.md](bridge-service/lua.md)). The connector assigns every message an id, records it in a pending-request map with a timeout (300 s by default), and writes it to the Windows named pipe. Messages are JSON separated on the wire by the literal delimiter `!@#$%^!`, and a batch is several messages joined by that delimiter in one write ([bridge-service/connection.md](bridge-service/connection.md)).

**4. The DLL runs it — but only when safe (main thread).** On the DLL side ([civ5-dll/connection.md](civ5-dll/connection.md)), a dedicated pipe thread reads the bytes off the pipe and drops the parsed messages into a thread-safe incoming queue; it never touches game state. At safe points in the turn loop the gamecore calls `ProcessMessages` on the main thread, which drains that queue and routes each message by its `type` to a handler. A `lua_call` invokes a registered Lua function by name; a `lua_execute` evaluates a script. The result is packaged as a response tagged with the original id, queued outbound, and written back to the pipe by the pipe thread.

**5. The answer climbs back up.** The bridge connector matches the `lua_response` to its pending request by id, resolves it (or rejects on the response's `success` flag), and returns it through the HTTP reply. The MCP server matches each batched result to its waiting caller and hands the tool its value. The agent's `VoxContext` formats it and feeds it back to the model. The round trip is complete, and the game was disturbed only at a moment when mutating its state was safe.

## Journey 2: the game tells the agents what happened

The other direction is a continuous push, not a request/response.

**1. The game emits an event.** As turns play out, the gamecore fires events the connection service cares about — only because the [civ5-mod](civ5-mod/overview.md) armed the `EVENTS_*` options at activation. Each becomes a `game_event` message with a unique id (derived from the turn and a running sequence number), queued outbound and written to the pipe.

**2. The bridge fans it out.** The bridge connector sees an inbound message that matches no pending request, so it re-emits it by `type`; the event routes pick it up and broadcast it — over **Server-Sent Events** to HTTP clients, and/or over a **second outbound named pipe** to local subscribers. Both use the same `!@#$%^!` framing, and events are batched on a short time/count window so a busy turn doesn't flood subscribers ([bridge-service/connection.md](bridge-service/connection.md)).

**3. The MCP server consumes and stores it.** The `BridgeManager` subscribes to that feed, **preferring the local event pipe and falling back to SSE** ([mcp-server/bridge.md](mcp-server/bridge.md)). Each event is validated against its schema, analyzed for visibility (who could see it), and recorded in the knowledge store; periodic state snapshots fill in the rest. See [mcp-server/events.md](mcp-server/events.md) and [mcp-server/knowledge.md](mcp-server/knowledge.md).

**4. The agents are notified (MCP).** Render-worthy events and lifecycle changes become MCP notifications pushed to connected clients — `DLLConnected`, `DLLDisconnected`, `GameSwitched`, and per-event render notifications. An agent reacts to a turn completing as it happens instead of polling.

## Journey 3: the game calls out to an agent

There is a third path that runs the other way at the bottom: game Lua invoking an external HTTP endpoint as if it were a local function — how an agent exposes a decision point the game itself triggers mid-turn.

An external service registers with the bridge (`POST /external/register`), giving a function name and a URL; the bridge validates it and notifies the DLL, which gains a Lua binding for that name ([bridge-service/lua.md](bridge-service/lua.md)). When the game's Lua later calls it, the DLL sends an external-call message up the pipe; the bridge's external manager looks up the registration, makes an HTTP POST to the URL, and sends the result — or a structured error — back down to the DLL. Because the DLL forgets its bindings whenever the pipe drops, the external manager re-registers everything the moment the connection returns, making a restart invisible to the registered service.

## Pacing: pausing the game for a decision

Reads and events alone don't let an agent *take* a turn — for that the game has to wait. The bridge can pause the game for specific players: when it's an LLM-controlled player's turn, the gamecore holds at a safe point until the decision comes back down, rather than letting the built-in AI act ([civ5-dll/connection.md](civ5-dll/connection.md)). The same mechanism applies back-pressure — if the MCP server's Lua queue backs up, it pauses the game until it drains, so the game waits for the AI side instead of work piling up ([mcp-server/bridge.md](mcp-server/bridge.md)). Pause state is per-connection: it resets when the pipe drops, so a crashed or restarted bridge never leaves the game stuck.

## Resilience: every link reconnects

No layer assumes the one below it stays up. The DLL is the pipe **server** and waits patiently for a client; the bridge is the **sole client** and reconnects with exponential backoff, infinitely, replaying its external-function registrations and pause state on every reconnect ([bridge-service/connection.md](bridge-service/connection.md)). The MCP server reconnects its event stream the same way, dropping pending Lua calls with a clear error rather than hanging when the DLL goes away. The result is that you can restart the game, the bridge, or the MCP server independently and the stack heals itself.

## Where the exact formats live

This page is the narrative; the precise wire-level reference stays with the bridge service, which owns the pipe format:

- `bridge-service/docs/PROTOCOL.md` — sequence diagrams for each flow.
- `bridge-service/docs/MESSAGE-TYPES.md` — every JSON message type on the pipe (`lua_call`, `lua_execute`, `game_event`, external calls, registry notifications).
- `bridge-service/docs/EVENT-PIPE.md` — the event-pipe wire format and a client example.
- `bridge-service/docs/API-REFERENCE.md` — every bridge HTTP endpoint, with request and response shapes.
- `mcp-server/docs/events/` — per-event schemas.
