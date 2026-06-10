# Stage 7 — Developer overview

> Part of the documentation revamp. Shared goals, writing principles, and target structure live in [README.md](README.md). The full source plan is [`../plan.md`](../plan.md).
>
> Depends on Stages 2–6. This is a **synthesis** stage: the five component folders are already written, so build these cross-cutting pages by summarizing and linking them rather than re-reading source.

## Objective

Write the top-level developer pages that explain the project as a whole, now that every component is documented. These answer "what does this repo do and how do its pieces fit?"

## Pages and how to build each

- **`architecture.md`** — The big picture: the five components, the data flow between them, and why each layer exists. **Primary source: the five `overview.md` pages from Stages 2–6.** Summarize each in a paragraph and link to the folder for depth.
- **`protocol.md`** — How messages flow end to end (DLL ↔ bridge ↔ MCP ↔ agents). **Stitch together** `civ5-dll/connection.md` + `bridge-service/connection.md`/`lua.md` + `mcp-server/bridge.md` into one narrative. Link to `bridge-service/docs/` for the exact wire-level message/format reference.
- **`setup.md`** — Building from source: toolchain, submodules, build/test commands. Pull the per-component build/run steps already captured in `civ5-dll/building.md`, `bridge-service/overview.md`, and `mcp-server/overview.md`; fold the **setup/build steps** from `vox-agents/install.md`; cross-check the `AGENTS.md` files.
- **`testing.md`** — Test philosophy, how to run and write tests. Source from the `AGENTS.md` files and the component test suites.
- **`releasing.md`** — Versioning, release notes, installer packaging.

## Sources

- **Primary:** the component folders written in Stages 2–6.
- The root `README.md` and the `AGENTS.md` files (working rules, test philosophy).
- `vox-agents/install.md` — setup/build steps (player-relevant parts go to Stage 8).
- `bridge-service/docs/` — link to for exact reference; do not duplicate.

## Done when

`architecture.md`, `setup.md`, and `protocol.md` are written and consistent with the component folders they summarize; a new contributor can grasp the system shape and build it from source. `testing.md`/`releasing.md` are written if source material exists, otherwise left as stubs with a note.
