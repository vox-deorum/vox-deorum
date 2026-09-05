# bridge-service: Lua Execution and External Functions

Lua is how the bridge actually reaches into the game. Traffic flows in two directions, and the bridge has a manager for each:

| Direction | Manager | Source | What it does |
| --- | --- | --- | --- |
| External services call _into_ the game's Lua | [Lua manager](#calling-into-the-game) | `lua-manager.ts` | Runs Lua functions and scripts inside the game, and mirrors the game's function registry. |
| The game's Lua calls _out_ to external services | [external manager](#calling-out-of-the-game) | `external-manager.ts` | Registers outbound HTTP endpoints and dispatches calls to them. |

Both ride the same DLL connection described in [connection.md](connection.md); this page covers what each manager does with it. Exact request and response shapes are in [api-reference.md](../../../bridge-service/docs/api-reference.md).

## Calling into the game

The Lua manager (`bridge-service/src/services/lua-manager.ts`) is the entry point for running Lua inside the game. It offers three ways to do that, each backed by an HTTP endpoint:

- **Call a registered function** (`POST /lua/call`) invokes a Lua function the game has exposed by name, with a set of arguments. The manager wraps it as a `lua_call` message and sends it through the connector.
- **Call several at once** (`POST /lua/batch`) takes an array of function calls and turns them into one batch so they travel through the pipe together. Results come back in request order. This is the efficient path when a caller needs many values at once, and the MCP server uses it heavily to assemble game state.
- **Run a raw script** (`POST /lua/execute`) submits a Lua script string to be evaluated directly, sent as a `lua_execute` message. The manager checks only that a non-empty string was actually provided, rejecting anything else as `INVALID_SCRIPT`.

In every case the manager hands the message to the DLL connector and awaits the matching response. The connector assigns each message an id, holds it in its pending-request map, enforces the 300-second timeout, and settles it when the DLL answers. That queuing and timeout machinery is described in [connection.md](connection.md). The Lua manager itself is thin: it shapes the message, logs, and returns the connector's response unchanged.

Because `POST /lua/execute` will run whatever it is given, anyone who can reach the port has full control of the game. The bridge does not authenticate callers; see the security note in [overview.md](overview.md).

### The function registry

The game decides which Lua functions are callable by name, and it tells the bridge as it goes. The Lua manager keeps a local registry of those names so that `GET /lua/functions` can answer "what can I call?" without a round trip to the game.

It stays in sync by listening to the connector for the DLL's registry notifications: a function being registered (with an optional description), a function being unregistered, or the whole registry being cleared. The registry is purely a mirror of what the DLL reports, and the bridge never invents entries. `POST /lua/execute` does not consult it at all.

## Calling out of the game

The reverse direction lets game Lua invoke an external HTTP service as if it were a local function. This is how an LLM-backed agent exposes a decision endpoint that the game can call mid-turn. The external manager (`bridge-service/src/services/external-manager.ts`) owns this path.

**Registering.** An external service registers itself with `POST /external/register`, supplying a function name, the URL to call, whether the call is asynchronous, and an optional timeout (default 5 seconds). The manager validates the registration first:

- The name must be a valid identifier and must not already be taken.
- The URL must parse.
- `async` must be a boolean, and `timeout`, if given, a positive integer.

It then notifies the DLL so the game gains a Lua binding for that name, and only afterwards stores the registration in its own map. The HTTP response is the connector's send result, so registering while the game is down answers `DLL_DISCONNECTED` even though the bridge did keep the registration and will replay it on reconnect. Registrations can be removed with `DELETE /external/register/:name` and listed with `GET /external/functions`.

**Dispatching.** When the game's Lua later calls one of these functions, the DLL sends an external-call message up the pipe, the connector emits it, and the external manager handles it. The manager looks up the registration, makes an HTTP POST to the registered URL with the supplied arguments and the configured timeout, and sends the result back down to the DLL as an external response. A failure comes back the same way as a structured error, and a call to a name that was never registered is answered immediately with `INVALID_FUNCTION`.

The bridge does not retry failed external calls. The registration stays in place and the calling Lua decides whether to try again (see [error-handling.md](error-handling.md)).

Because the DLL forgets its bindings whenever the pipe drops, the external manager re-registers every known function as soon as the connection comes back, so from a registered service's point of view a bridge or game restart is invisible. That reconnection handshake is described in [connection.md](connection.md).

## See also

- [connection.md](connection.md) covers message framing, the request queue, timeouts, and reconnection.
- [api-reference.md](../../../bridge-service/docs/api-reference.md) gives exact endpoint request and response shapes.
- [message-types.md](../../../bridge-service/docs/message-types.md) defines the `lua_call`, `lua_execute`, and external message types on the pipe.
- [mcp-server/bridge.md](../mcp-server/bridge.md) shows how the primary consumer drives these endpoints.
