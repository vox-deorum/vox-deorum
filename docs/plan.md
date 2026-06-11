# Documentation Plan

This plan defines how Vox Deorum's documentation is organized, where each existing document goes, and how the docs stay maintained. It is the blueprint for the documentation revamp; once the revamp is complete, this file describes the standing organization.

## Goals

- **Two audiences, two entry points.** Players want to install the mod and play. Developers want to understand what the repo does and how to change it. Neither should have to read the other's material.
- **One home.** All general documentation lives under `/docs/`. A reader should never have to hunt through component directories to understand the project.
- **Component docs only when component-specific.** A component keeps its own `docs/` folder only for narrow, technical reference material that is meaningless outside that component (e.g., the per-event references in `mcp-server/docs/events/`). Root-level markdown files inside components (`README.md`, `install.md`, etc.) are migrated into `/docs/` and removed.
- **Constantly maintained.** Documentation is updated in the same change that alters behavior. The root `AGENTS.md` enforces this.

## Writing principles

These apply to every document (also codified in `AGENTS.md`):

- Write in natural language: plain prose, easy to read, easy to follow.
- No excessive detail. Avoid raw code in docs; describe behavior and point to the source file instead.
- No line-number anchors — they drift. Refer to files, functions, or concepts by name.
- Each document answers a real question a reader has. For developers: "what does this repo do and how do its pieces fit?" For players: "how do I install, configure, and play?"
- Prefer one medium-length page over many fragments; split only when a page serves two different questions.

## Target structure

```
docs/
├── README.md                  Documentation index: who you are → where to go
├── plan.md                    This plan
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
│   │   ├── overview.md        Purpose, how it hooks into the game, where to start reading
│   │   ├── connection.md      Named-pipe IPC and the connection service
│   │   └── building.md        Build & deploy workflow (points to submodule toolchain docs)
│   ├── civ5-mod/              Lua hooks and in-game UI
│   │   ├── overview.md        What the mod adds and how it loads
│   │   ├── lua-hooks.md       Game-event hooks and scripts
│   │   └── ui.md              In-game UI: chat, spokespersons
│   ├── bridge-service/        REST/SSE bridge between game and AI services
│   │   ├── overview.md        Role, endpoints, connection lifecycle
│   │   ├── configuration.md   Settings and environment
│   │   ├── connection.md      DLL named-pipe connection lifecycle and reconnection
│   │   ├── lua.md             Lua function registry and execution queue
│   │   └── error-handling.md  Reconnects, failure modes, error propagation
│   ├── mcp-server/            MCP tools and game-data access
│   │   ├── overview.md        Role, server modes, how tools are organized
│   │   ├── tools.md           Tool categories and what they expose to agents
│   │   ├── knowledge.md       The knowledge/visibility system
│   │   ├── database.md        Game-data access via SQLite/Kysely
│   │   ├── events.md          The event system: how game events flow in and are processed
│   │   ├── influence.md       Tactical AI influence and flavor/strategy steering
│   │   └── bridge.md          How the MCP server drives the Bridge Service (queued Lua, SSE/event pipe)
│   └── vox-agents/            The LLM strategic-AI framework
│       ├── overview.md        The VoxAgent framework: base class, lifecycle, context, how pieces fit
│       ├── strategist.md      In-game strategic AI: turn-based agents, sessions, per-player state, modes
│       ├── envoy.md           Player-facing chat agents: spokespersons and diplomats
│       ├── support-agents.md  Briefers, analysts, librarians — cooperative agents the others invoke
│       ├── telepathist.md     Post-game conversational analysis over recorded telemetry
│       ├── oracle.md          Counterfactual "what-if" prompt-replay experiments
│       ├── archivist.md       Batch episode extraction from finished games
│       ├── ui.md              The web dashboard (Vue) and its Express/SSE backend
│       ├── media.md           OBS capture and the narrators video-generation pipeline
│       └── observability.md   Tracing and logging (OpenTelemetry/Langfuse); inspecting agent behavior
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

## Migration map

### Root level

| Current | Action |
|---|---|
| `README.md` | Keep, but slim down to: project pitch, screenshot, quick-start link to `docs/players/getting-started.md`, developer link to `docs/developers/architecture.md`, license. The README becomes a front door, not a manual. |
| `AGENTS.md` | Keep (agent/contributor working rules, not documentation). |
| `LICENSE.md` | Keep. |

### Component root-level markdown (migrate, then delete)

| Current | Destination |
|---|---|
| `bridge-service/README.md` | Fold into `docs/developers/bridge-service/overview.md` |
| `mcp-server/README.md` | Fold into `docs/developers/mcp-server/overview.md` |
| `vox-agents/README.md` | Fold the framework overview into `docs/developers/vox-agents/overview.md`; split its per-agent sections across `strategist.md`, `envoy.md`, `support-agents.md`, `telepathist.md`, `oracle.md`, `archivist.md`, and `ui.md`; then delete |
| `vox-agents/install.md` | Fold setup steps into `docs/developers/setup.md`; player-relevant parts into `docs/players/configuration.md` |
| `civ5-dll/README.md`, `civ5-dll/CvGameCoreDLL_Expansion2/GAMECORE_OVERVIEW.md` | Summarize in `docs/developers/civ5-dll/overview.md`; originals stay (separate submodule repo with upstream history) |

`AGENTS.md` files in each component stay — they are working instructions for agents, not documentation.

### Component `docs/` folders (sort: prose moves, reference stays)

| Current | Action |
|---|---|
| `bridge-service/docs/protocol.md`, `message-types.md`, `event-pipe.md` | Distill the end-to-end story into `docs/developers/protocol.md`; lift the named-pipe connection story into `docs/developers/bridge-service/connection.md`; keep the exact message/format reference in `bridge-service/docs/` |
| `bridge-service/docs/CONFIGURATION.md` | Move prose to `docs/developers/bridge-service/configuration.md`; delete original |
| `bridge-service/docs/ERROR-HANDLING.md` | Move prose to `docs/developers/bridge-service/error-handling.md`; delete original |
| `bridge-service/docs/DEVELOPMENT.md` | Fold into `docs/developers/bridge-service/overview.md` and `docs/developers/setup.md`; lift Lua-registry/execution prose into `docs/developers/bridge-service/lua.md`; delete original |
| (no single source) | Write `docs/developers/bridge-service/connection.md` (DLL connector lifecycle) and `lua.md` (Lua function registry and execution queue) from the `src/services/` modules |
| `bridge-service/docs/api-reference.md`, `api/` | Keep (reference) |
| `mcp-server/docs/DEVELOPMENT.md` | Fold into `docs/developers/mcp-server/overview.md` and `setup.md`; delete original |
| `mcp-server/docs/tools.md` | Move the "how tools are organized" prose to `docs/developers/mcp-server/tools.md`; exact per-tool listings stay in `mcp-server/docs/` |
| `mcp-server/docs/knowledge.md` | Move prose to `docs/developers/mcp-server/knowledge.md`; delete original unless it carries exact reference data |
| `mcp-server/docs/tactical-ai-influence.md` | Lift the "how it works" prose into `docs/developers/mcp-server/influence.md`; keep any exact reference (tables, formulas) in place |
| (no single source) | Write `docs/developers/mcp-server/events.md` (event pipeline: how game events arrive, are schema-validated, and reach agents; per-event schemas stay in `docs/events/`) and `bridge.md` (queued Lua execution and SSE/event-pipe consumption) from the `src/knowledge/` and `src/bridge/` modules |
| `mcp-server/docs/events/`, `flavors/`, `strategies/`, `enums/`, `diplomacy/`, `influence/`, `database/`, `api/` | Keep (component-specific reference) |
| `vox-agents/docs/obs.md` | Move prose to `docs/developers/vox-agents/media.md` (OBS capture + narrators pipeline); delete original |
| `vox-agents/docs/oracle.md` | Move prose to `docs/developers/vox-agents/oracle.md`; delete original |
| `vox-agents/docs/plans/telepathist.md` | Historical design plan, now shipped — distill the current behavior into `docs/developers/vox-agents/telepathist.md`, then **delete** |
| `vox-agents/docs/plans/webui-plan.md` | Historical implementation plan, now shipped — distill the current behavior into `docs/developers/vox-agents/ui.md`, then **delete** |
| `vox-agents/docs/plans/` | **Remove** the folder once both plans are distilled — historical plans are not part of the standing doc tree |
| `vox-agents/docs/api/` | Keep (generated reference) |
| (no single source) | Write `strategist.md`, `envoy.md`, `support-agents.md` (briefer/analyst/librarian), and `archivist.md` under `docs/developers/vox-agents/` from the corresponding `src/` subsystems and the root README's agent sections |
| `civ5-dll/docs/*` | Keep (submodule; build toolchain, db schema, minidumps are DLL-specific) |
| `civ5-mod/docs/*` | Keep (Lua debugging, observer API are mod-specific); summarize the observer/UI story in `docs/developers/civ5-mod/ui.md` |

### docs/ (existing)

| Current | Action |
|---|---|
| `docs/versions/*.md` | Keep as-is |

## Implementation stages

1. **Scaffold** — create `docs/README.md` index and the `players/` and `developers/` skeletons with stub pages that state their intended content.
2. **Player docs** — write the five player pages, sourcing from the root README, the installer experience, and `vox-agents/install.md`.
3. **Developer overview** — write `architecture.md`, `setup.md`, and `protocol.md`, sourcing from the root README, AGENTS.md files, and `bridge-service/docs/`.
4. **Component folders** — for each of the five components, write its folder under `docs/developers/` (overview plus the sub-pages listed in the target structure), folding in the component's root README and prose docs.
5. **Cleanup** — slim the root README into a front door; delete migrated component root-level markdown and prose docs; remove historical plan folders (`vox-agents/docs/plans/`) once their behavior is distilled into the standing pages; fix all inbound links.
6. **Verify** — sweep for broken links and stale references; confirm component `docs/` folders contain only reference material.

## Maintenance

- Any change that alters behavior, configuration, setup steps, or player experience updates the affected page(s) in the same change set.
- New documentation goes into the structure above; do not create new root-level markdown in components.
- New component-specific reference material may be added under that component's `docs/` folder.
- Release notes continue to land in `docs/versions/`.
- Follow the writing principles above; the root `AGENTS.md` carries the binding rules.
