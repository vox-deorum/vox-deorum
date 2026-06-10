# Stage 1 — Scaffold

> Part of the documentation revamp. Shared goals, writing principles, and target structure live in [README.md](README.md). The full source plan is [`../plan.md`](../plan.md).

## Objective

Lay out the top-level `docs/` tree so later stages have homes to write into. This stage creates the index, the player stubs, and the top-level developer stubs. Each component folder is created and written by its own stage (2–6), so it is **not** scaffolded here.

## Work items

1. **`docs/README.md`** — the documentation index. Route readers by who they are: a player heading to `players/getting-started.md`, a developer heading to `developers/architecture.md`. Keep it short.
2. **`docs/players/` stubs** — create each page with a one-paragraph statement of what it will contain:
   - `getting-started.md` — Prerequisites, installer, first launch
   - `playing.md` — What the AI does, chatting with spokespersons, what to expect in-game
   - `configuration.md` — API keys, choosing LLM providers/models, local models
   - `replay.md` — Reviewing sessions with the Vox Deorum Replayer
   - `troubleshooting.md` — Common problems and fixes (FAQ style)
3. **`docs/developers/` top-level stubs** — one-paragraph statements of intended content:
   - `architecture.md` — The big picture: components, data flow, why each layer exists
   - `setup.md` — Building from source: toolchain, submodules, build/test commands
   - `protocol.md` — How messages flow end to end (DLL ↔ bridge ↔ MCP ↔ agents)
   - `testing.md` — Test philosophy, how to run and write tests
   - `releasing.md` — Versioning, release notes, installer packaging

Leave `versions/` untouched. Do **not** create `docs/developers/<component>/` folders — Stages 2–6 each create and fill their own.

## Output

`docs/README.md` plus the `players/` and top-level `developers/` stub pages exist, each a one- or two-sentence placeholder.

## Done when

The two entry points (`players/getting-started.md`, `developers/architecture.md`) are linked from `docs/README.md`, and every player and top-level developer page exists as a stub.
