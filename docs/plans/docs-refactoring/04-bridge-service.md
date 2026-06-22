# Stage 4 — Component: bridge-service

> Part of the documentation revamp. Shared goals, writing principles, and target structure live in [README.md](README.md).
>
> Depends on Stage 1. Builds on Stage 2 (the DLL named pipe this service connects to).

## Objective

Create and write `docs/developers/bridge-service/`: the REST/SSE bridge between the game and the AI services. Read the `src/services/` modules as the primary source; fold in the component README and prose docs.

## Pages

- `overview.md` — Role, endpoints, connection lifecycle.
- `configuration.md` — Settings and environment.
- `connection.md` — DLL named-pipe connection lifecycle and reconnection.
- `lua.md` — Lua function registry and execution queue.
- `error-handling.md` — Reconnects, failure modes, error propagation.

## Sources

| Source | Action |
|---|---|
| `bridge-service/README.md` | Fold into `overview.md`. |
| `bridge-service/docs/DEVELOPMENT.md` | Fold into `overview.md`; lift Lua-registry/execution prose into `lua.md`; some setup detail also feeds Stage 7 `setup.md`. Delete original in Stage 9. |
| `bridge-service/docs/CONFIGURATION.md` | Move prose into `configuration.md`. Delete original in Stage 9. |
| `bridge-service/docs/ERROR-HANDLING.md` | Move prose into `error-handling.md`. Delete original in Stage 9. |
| `bridge-service/docs/protocol.md`, `message-types.md`, `event-pipe.md` | Lift the **named-pipe connection story** into `connection.md`. The exact message/format reference **stays** in `bridge-service/docs/`. (The end-to-end narrative is written later in Stage 7 `protocol.md`.) |
| `src/services/` modules | Write `connection.md` and `lua.md` from source. |
| `bridge-service/docs/api-reference.md`, `api/` | Keep (reference). |

## Feeds forward

- Stage 5 (mcp-server) `bridge.md` describes how the MCP server **drives** this service (queued Lua, SSE/event pipe) — keep the two consistent.
- Stage 7 `protocol.md` stitches `civ5-dll/connection.md` + this folder + `mcp-server/bridge.md` into one end-to-end story by **summarizing them**, not re-reading source.
- Stage 7 `setup.md` pulls bridge build/run steps from here.

## Done when

The `bridge-service/` folder is written in prose, the wire-level message/format reference is left in `bridge-service/docs/`, and `connection.md` is consistent with `civ5-dll/connection.md`. Deletions are deferred to Stage 9.
