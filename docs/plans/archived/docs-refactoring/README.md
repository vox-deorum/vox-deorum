# Documentation Revamp — Staged Plans

**DONE, Archived.**

This folder breaks the documentation revamp into independently implementable stages. Each numbered file is a self-contained plan: objective, work items, sources, and outputs.

**The ordering is deliberately bottom-up.** It works in three passes:

1. **Scaffold** the `docs/` tree (stage 1).
2. **Document each component** directly from its source, sequenced along the data flow DLL → mod → bridge → MCP → agents (stages 2–6).
3. **Synthesize** the cross-cutting pages (architecture, protocol, setup) and player docs by summarizing and linking the component folders rather than re-reading source (stages 7–8), then clean up and verify (stages 9–10).

Implement in order. Each stage's "Feeds forward" / "Sources" sections name exactly what it consumes from earlier stages, so every component "feeds forward" into the next and into the synthesis stages.

| Stage | Plan | Objective |
|---|---|---|
| 1 | [01-scaffold.md](01-scaffold.md) | Create the `docs/` index, player stubs, and top-level developer stubs. |
| 2 | [02-civ5-dll.md](02-civ5-dll.md) | Write `docs/developers/civ5-dll/` (the game-layer DLL). |
| 3 | [03-civ5-mod.md](03-civ5-mod.md) | Write `docs/developers/civ5-mod/` (Lua hooks and in-game UI). |
| 4 | [04-bridge-service.md](04-bridge-service.md) | Write `docs/developers/bridge-service/` (REST/SSE bridge). |
| 5 | [05-mcp-server.md](05-mcp-server.md) | Write `docs/developers/mcp-server/` (MCP tools and game data). |
| 6 | [06-vox-agents.md](06-vox-agents.md) | Write `docs/developers/vox-agents/` (LLM strategic-AI framework). |
| 7 | [07-developer-overview.md](07-developer-overview.md) | Synthesize `architecture.md`, `protocol.md`, `setup.md` from the component folders. |
| 8 | [08-player-docs.md](08-player-docs.md) | Write the five player pages from the documented behavior. |
| 9 | [09-cleanup.md](09-cleanup.md) | Slim the root README, delete migrated files, fix inbound links. |
| 10 | [10-verify.md](10-verify.md) | Sweep for broken/stale links; confirm reference-only component folders and cross-page consistency. |

## Goals (apply to every stage)

- **Two audiences, two entry points.** Players want to install the mod and play. Developers want to understand what the repo does and how to change it. Neither should have to read the other's material.
- **One home.** All general documentation lives under `/docs/`. A reader should never have to hunt through component directories.
- **Component docs only when component-specific.** A component keeps its own `docs/` folder only for narrow, technical reference material meaningless outside that component (e.g. the per-event references in `mcp-server/docs/events/`). Root-level markdown files inside components are migrated into `/docs/` and removed.
- **Constantly maintained.** Documentation is updated in the same change that alters behavior. The root `AGENTS.md` enforces this.

## Writing principles (apply to every page you write)

- Write in natural language: plain prose, easy to read, easy to follow.
- No excessive detail. Avoid raw code in docs; describe behavior and point to the source file instead.
- No line-number anchors — they drift. Refer to files, functions, or concepts by name.
- Each document answers a real question a reader has. For developers: "what does this repo do and how do its pieces fit?" For players: "how do I install, configure, and play?"
- Prefer one medium-length page over many fragments; split only when a page serves two different questions.

## Target structure (the end state all stages build toward)

```
docs/
├── README.md                  Documentation index: who you are → where to go
├── agents.md                  The documentation guide (standing writing conventions)
│
├── players/                   Audience: people playing the game
│   ├── getting-started.md     Prerequisites, installer, first launch
│   ├── playing.md             What the AI does, chatting with spokespersons, what to expect in-game
│   ├── configuration.md       API keys, choosing LLM providers/models, local models
│   ├── replay.md              Reviewing sessions with the Vox Deorum Replayer
│   └── troubleshooting.md     Common problems and fixes (FAQ style)
│
├── developers/                Audience: contributors and maintainers
│   ├── architecture.md        The big picture: components, data flow, why each layer exists
│   ├── setup.md               Building from source: toolchain, submodules, build/test commands
│   ├── protocol.md            How messages flow end to end (DLL ↔ bridge ↔ MCP ↔ agents)
│   ├── testing.md             Test philosophy, how to run and write tests
│   ├── releasing.md           Versioning, release notes, installer packaging
│   │
│   ├── civ5-dll/              The modified Community Patch DLL
│   ├── civ5-mod/              Lua hooks and in-game UI
│   ├── bridge-service/        REST/SSE bridge between game and AI services
│   ├── mcp-server/            MCP tools and game-data access
│   └── vox-agents/            The LLM strategic-AI framework
│
└── versions/                  Release changelogs (existing; unchanged)
    └── *.md
```

Component-level reference material that stays put:

```
mcp-server/docs/      Per-event references, flavors, strategies, enums, generated API docs
bridge-service/docs/  Wire-level protocol reference (message formats, event pipe details)
vox-agents/docs/      Generated API docs (docs/api/) only — no prose, no plans
civ5-dll/docs/        DLL build toolchain, game database schema, debugging (separate repo/submodule)
civ5-mod/docs/        Lua/C debugging, observer API
```

The rule of thumb: `/docs/developers/` explains *what and why* in prose; component `docs/` folders hold *exact reference data* (event schemas, message formats, generated API listings) that developers consult while working inside that component.
