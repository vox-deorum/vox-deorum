# bridge-service — Lua Execution and External Functions

Lua is how the bridge actually reaches into the game. There are two directions, and the bridge has a manager for each: external services calling *into* the game's Lua (the [Lua manager](#calling-into-the-game)), and the game's Lua calling *out* to external services (the [external manager](#calling-out-of-the-game)). Both ride the same DLL connection described in [connection.md](connection.md); this page covers what each manager does with it. Exact request and response shapes are in the kept reference, `bridge-service/docs/api-reference.md`.

## Calling into the game

The Lua manager (`bridge-service/src/services/lua-manager.ts`) is the entry point for running Lua inside the game. It offers three ways to do that, each backed by an HTTP endpoint:

- **Call a registered function** (`POST /lua/call`) — invoke a Lua function the game has exposed by name, with a set of arguments. The manager wraps it as a `lua_call` message and sends it through the connector.
- **Call several at once** (`POST /lua/batch`) — submit an array of function calls. The manager turns them into one batch so they travel through the pipe together. Results come back in request order. This is the efficient path when a caller needs many values at once; the MCP server uses it heavily to assemble game state.
- **Run a raw script** (`POST /lua/execute`) — submit a Lua script string to be evaluated directly, sent as a `lua_execute` message. The manager does a basic sanity check that a script was actually provided before sending.

In every case the manager hands the message to the DLL connector and awaits the matching response. The connector is what assigns each message an id, holds it in its pending-request map, enforces the 300-second timeout, and resolves it when the DLL answers — the queuing and timeout machinery is all described in [connection.md](connection.md). The Lua manager itself is thin: it shapes the message, logs, and returns the connector's response unchanged.

### The function registry

The game decides which Lua functions are callable by name, and it tells the bridge as it goes. The Lua manager keeps a local registry of those names so that `GET /lua/functions` can answer "what can I call?" without a round trip to the game. It stays in sync by listening to the connector for the DLL's registry notifications — a function being registered (with an optional description), a function being unregistered, or the whole registry being cleared. The registry is purely a mirror of what the DLL reports; the bridge never invents entries. Note that `POST /lua/execute` runs arbitrary script and does not depend on the registry at all.

## Calling out of the game

The reverse direction lets game Lua invoke an external HTTP service as if it were a local function — this is how an LLM-backed agent exposes a decision endpoint that the game can call mid-turn. The external manager (`bridge-service/src/services/external-manager.ts`) owns this path.

An external service registers itself with `POST /external/register`, supplying a function name, the URL to call, whether the call is asynchronous, and an optional timeout (default 5 seconds). The manager validates the registration — the name must be a valid identifier, the URL must parse, and the name must not already be taken — then records it and notifies the DLL so the game gains a Lua binding for that name. Registrations can be removed with `DELETE /external/register/:name` and listed with `GET /external/functions`.

When the game's Lua later calls one of these functions, the DLL sends an external-call message up the pipe; the connector emits it and the external manager handles it. The manager looks up the registration, makes an HTTP POST to the registered URL with the supplied arguments and the configured timeout, and sends the result — or a structured error — back down to the DLL as an external response. A call to a name that was never registered comes straight back as an error. The bridge does not retry failed external calls; the registration stays in place and the calling Lua decides whether to try again (see [error-handling.md](error-handling.md)).

Because the DLL forgets its bindings whenever the pipe drops, the external manager re-registers every known function as soon as the connection comes back — so from a registered service's point of view, a bridge or game restart is invisible. That reconnection handshake is described in [connection.md](connection.md).

## See also

- [connection.md](connection.md) — message framing, the request queue, timeouts, and reconnection.
- `bridge-service/docs/api-reference.md` — exact endpoint request/response shapes.
- `bridge-service/docs/message-types.md` — the `lua_call`, `lua_execute`, and external message types on the pipe.
- The MCP server's `bridge.md` (written later) — how the primary consumer drives these endpoints.
