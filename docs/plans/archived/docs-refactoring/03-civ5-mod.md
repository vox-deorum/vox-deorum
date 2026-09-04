# Stage 3 — Component: civ5-mod

> Part of the documentation revamp. Shared goals, writing principles, and target structure live in [README.md](README.md).
>
> Depends on Stage 1. Builds on Stage 2 (the DLL the mod runs against).

## Objective

Create and write `docs/developers/civ5-mod/`: the Lua hooks and in-game UI layer. Read the mod source as the primary source; summarize the component's debugging/observer reference docs rather than moving them.

## Pages

- `overview.md` — What the mod adds and how it loads.
- `lua-hooks.md` — Game-event hooks and scripts.
- `ui.md` — In-game UI: chat, spokespersons.

## Sources

| Source | Action |
|---|---|
| Mod load logic / `src/` | Write `overview.md` and `lua-hooks.md` from the source. |
| `civ5-mod/docs/*` (Lua/C debugging, observer API) | Keep in place. Summarize the observer/UI story into `ui.md`. |

## Feeds forward

- Stage 6 (vox-agents) `envoy.md` and `ui.md` describe the agents that drive the in-game chat surface documented here — keep terminology aligned.
- Stage 7 `architecture.md` summarizes this folder for the mod layer.
- Stage 8 `players/playing.md` draws on `ui.md` for "chatting with spokespersons / what to expect in-game."

## Done when

The `civ5-mod/` folder is written in prose, the observer/UI summary in `ui.md` points to `civ5-mod/docs/` for exact reference, and no source is embedded as raw code. No deletions in this stage.
