# Stage 2 — Component: civ5-dll

> Part of the documentation revamp. Shared goals, writing principles, and target structure live in [README.md](README.md).
>
> Depends on Stage 1. First of the five component stages — these run early and bottom-up (DLL → mod → bridge → MCP → agents) so the synthesis stages (7 developer overview, 8 player docs) can draw from finished component docs.

## Objective

Create and write `docs/developers/civ5-dll/`: the modified Community Patch DLL — the game layer at the bottom of the stack. Read the actual source as the primary source for new prose; fold in the component's own README/overview.

## Pages

- `overview.md` — Purpose, how it hooks into the game, where to start reading.
- `connection.md` — Named-pipe IPC and the connection service.
- `building.md` — Build & deploy workflow (prose that **points to** the submodule toolchain docs).

## Sources

| Source | Action |
|---|---|
| `civ5-dll/README.md`, `civ5-dll/CvGameCoreDLL_Expansion2/GAMECORE_OVERVIEW.md` | Summarize into `overview.md`. Originals **stay** — separate submodule repo with upstream history. |
| `src/` connection service / named-pipe IPC | Write `connection.md` from the source modules. |
| `civ5-dll/docs/*` (build toolchain, db schema, minidumps) | Keep in place. `building.md` points to them. |

## Feeds forward

- Stage 4 (bridge-service) `connection.md` describes the **other end** of this named pipe — keep the two consistent.
- Stage 7 `architecture.md` and `protocol.md` describe this layer and the start of the message chain by **summarizing this folder**, not re-reading the DLL source.

## Done when

The `civ5-dll/` folder is written in prose, points to the submodule reference docs rather than duplicating them, and no DLL source is embedded as raw code. Original submodule files are left in place (no deletion in this stage).
