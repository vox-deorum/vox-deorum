# Stage 8 — Player docs

> Part of the documentation revamp. Shared goals, writing principles, and target structure live in [README.md](README.md).
>
> Depends on Stages 2–6 (component docs) and benefits from Stage 7. A **synthesis** stage: translate the now-documented behavior into plain player-facing prose. Players should never need to read the developer pages this stage draws from.

## Objective

Write the five player-facing pages. Players want to install the mod and play.

## Pages and how to build each

- **`getting-started.md`** — Prerequisites, the installer, first launch. Source: root `README.md`, the installer experience, `vox-agents/install.md` (player parts).
- **`playing.md`** — What the AI does, chatting with spokespersons, what to expect in-game. **Draw on** `vox-agents/strategist.md` and `envoy.md` (what the AI does) and `civ5-mod/ui.md` (the in-game chat surface), rewritten for players — no architecture, no source pointers.
- **`configuration.md`** — API keys, choosing LLM providers/models, local models. Source: the **player-relevant** parts of `vox-agents/install.md` plus the provider/model handling described in `vox-agents/overview.md`.
- **`replay.md`** — Reviewing sessions with the Vox Deorum Replayer. The Replayer is an **external tool** in its own repository ([vox-deorum-replay](https://github.com/CIVITAS-John/vox-deorum-replay)) — source this page from that repo's README/docs. `vox-agents/telepathist.md` (post-game analysis) and `ui.md` are optional context for the developer-facing review surfaces, which are distinct from the Replayer.
- **`troubleshooting.md`** — Common problems and fixes (FAQ style). Source: known failure modes from `bridge-service/error-handling.md` and the installer/config pitfalls, restated as player symptoms-and-fixes.

## Sources

- **Primary for behavior:** the component folders (especially `vox-agents/` and `civ5-mod/`) — but **rewrite for a player audience**; strip developer detail and source pointers.
- The root `README.md` and the installer experience.
- `vox-agents/install.md` — player-relevant parts only.

## Done when

A player can install, configure, play, replay, and troubleshoot using only the `docs/players/` pages, in plain prose, with no need to open any developer page.
