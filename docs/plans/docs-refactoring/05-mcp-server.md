# Stage 5 — Component: mcp-server ✅ DONE

> **Status:** Complete. Wrote all seven pages under `docs/developers/mcp-server/` (`overview.md`, `tools.md`, `knowledge.md`, `database.md`, `events.md`, `influence.md`, `bridge.md`) in prose. Folded `README.md`/`DEVELOPMENT.md` into `overview.md`, `tools.md` prose into `tools.md`, `knowledge.md` prose into `knowledge.md`, and `tactical-ai-influence.md` "how it works" prose into `influence.md`; wrote `database.md`, `events.md`, and `bridge.md` from `src/`. All reference subfolders (`events/`, `flavors/`, `strategies/`, `enums/`, `diplomacy/`, `influence/`, `database/`, `api/`) and exact per-tool/per-event data left in place and linked, not duplicated. `bridge.md` cross-links the bridge-service `connection.md`/`lua.md` counterparts. Forward references to the not-yet-written `vox-agents/` folder kept as prose (no hyperlink) per the bridge-service convention. All relative links verified. Original source files left for Stage 9 deletion. Note: the auto-pause/resume backlog threshold was described qualitatively ("when the backlog stays large") rather than with the exact in-code number, to follow the no-over-detail writing principle.
>
> Part of the documentation revamp. Shared goals, writing principles, and target structure live in [README.md](README.md). The full source plan is [`../plan.md`](../plan.md).
>
> Depends on Stage 1. Builds on Stage 4 (the bridge it drives).

## Objective

Create and write `docs/developers/mcp-server/`: the MCP tools and game-data access layer. Read the `src/knowledge/` and `src/bridge/` modules as the primary source; fold in the component README and prose docs; leave exact reference data (per-tool listings, event schemas, enums) in place.

## Pages

- `overview.md` — Role, server modes, how tools are organized.
- `tools.md` — Tool categories and what they expose to agents.
- `knowledge.md` — The knowledge/visibility system.
- `database.md` — Game-data access via SQLite/Kysely.
- `events.md` — The event system: how game events flow in and are processed.
- `influence.md` — Tactical AI influence and flavor/strategy steering.
- `bridge.md` — How the MCP server drives the Bridge Service (queued Lua, SSE/event pipe).

## Sources

| Source | Action |
|---|---|
| `mcp-server/README.md` | Fold into `overview.md`. |
| `mcp-server/docs/DEVELOPMENT.md` | Fold into `overview.md`; setup detail also feeds Stage 7 `setup.md`. Delete original in Stage 9. |
| `mcp-server/docs/tools.md` | Move "how tools are organized" prose into `tools.md`; exact per-tool listings **stay** in `mcp-server/docs/`. |
| `mcp-server/docs/knowledge.md` | Move prose into `knowledge.md`. Delete original in Stage 9 unless it carries exact reference data. |
| `mcp-server/docs/tactical-ai-influence.md` | Lift "how it works" prose into `influence.md`; keep exact reference (tables, formulas) in place. |
| `src/knowledge/`, `src/bridge/` modules | Write `events.md` (per-event schemas stay in `docs/events/`) and `bridge.md` (queued Lua, SSE/event-pipe consumption). |
| `database.md` | Write game-data access via SQLite/Kysely from source. |
| `mcp-server/docs/events/`, `flavors/`, `strategies/`, `enums/`, `diplomacy/`, `influence/`, `database/`, `api/` | Keep (component-specific reference). |

## Feeds forward

- `bridge.md` is the MCP-side counterpart to Stage 4's `bridge-service/connection.md`/`lua.md` — keep consistent.
- Stage 6 (vox-agents) describes the agents that consume these tools — `tools.md` and `knowledge.md` are the reference those pages point to.
- Stage 7 `protocol.md` summarizes `bridge.md` for the MCP↔bridge link; `architecture.md` summarizes this folder for the MCP layer.

## Done when

The `mcp-server/` folder is written in prose, all reference subfolders (`events/`, `flavors/`, `strategies/`, etc.) are left in place, and per-event/per-tool exact data is not duplicated into the prose. Deletions deferred to Stage 9.
