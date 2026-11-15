# Newspaper implementation roadmap

**Status: draft for review.** This roadmap is for developers implementing the [newspaper specification](spec.md). It establishes the shared rendering architecture and divides implementation into five plans. Each plan has its own deliverable and verification gate.

## Goal and success criteria

Build one publication renderer that serves the offline browser reader and produces the images displayed inside Civilization V. Use it to evaluate recorded-game newspapers before connecting the editorial loop to live play and game saves.

Success means both editors produce useful, evidence-backed issues with continuing series; votes influence later coverage; browser and game readers use the same publication designs; and published issues remain readable after saving, loading, or losing the service connection.

## Architecture decisions

| Area | Direction |
| --- | --- |
| Shared renderer | Plain TypeScript and HTML/CSS, built with the existing Vite toolchain. Start from the local prototypes and promote the required assets into tracked production files. |
| Browser reader | Run the renderer interactively, with browser controls for replay, archive browsing, and inspection outside the publication. |
| Image export | Use `playwright-core` with an installed Microsoft Edge browser, then Chrome if available. Render locally, capture images and action rectangles, and convert the images to DDS with a pinned `texconv` executable. |
| Installation | Reuse the installed browser. Never download a browser automatically. Ship compiled reader assets, the runtime automation library, and the converter with its license. Measure the complete incremental installation cost in Plan 1. |
| Game reader | A Lua/XML viewer displays bounded image strips and places controls at the exported rectangles. Scrolling, section switching, link activation, and vote indicators respond locally. |
| Text interaction | Browser text remains selectable and accessible. The game reader uses rasterized text; browser text selection and accessibility parity are outside its requirements. |
| Durable content | Store structured articles, links, editorial memory, and presentation choices. Images and interaction maps are derived cache entries. Retain a basic native text view for missing caches while rendering is unavailable. |
| Runtime ownership | Newspaper editing and rendering live in Vox Agents. MCP owns game-data collection, historical queries, and its queryable live publication copy. Standalone evaluation reads MCP's database directly and keeps publication output in a separate local database. The game save owns the live publication history. |

The [Playwright browser documentation](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge) supports using installed Edge and Chrome. Its [screenshot](https://playwright.dev/docs/screenshots) and [page evaluation](https://playwright.dev/docs/evaluating) APIs provide the two export outputs. [DirectXTex's converter](https://github.com/microsoft/DirectXTex/wiki/Texconv) supports DDS output and legacy headers. VD's added footprint includes the browser library, fonts, art, the converter, and other runtime dependencies.

```mermaid
flowchart LR
    E[Permitted evidence] --> H[Heuristic or LLM editor]
    H --> I[Stored issue]
    I --> R[Shared HTML/CSS renderer]
    R --> B[Browser reader]
    R --> X[Images and action rectangles]
    X --> V[VP viewer]
    B --> F[Votes and reading state]
    V --> F
    F --> H
```

The renderer consumes a completed issue. It never selects stories, changes series importance, or asks an LLM to rewrite an archived article.

## Current state

The [research index](research/research.md) covers the recorded data, historical visibility limitations, and existing UI primitives. The fixture renderer now lives in `vox-agents/newspaper/`, with tracked assets, a separate DOM-aware type check, and a Vite build to `dist-newspaper`. The local prototypes remain design references and are gitignored.

`vox-agents/src/newspaper/` already contains issue and reader contracts, rendering helpers, export/cache code, a fixture console, and a one-file `host/` directory. Plan 1 consolidates the host into `export/` and separates serialized render contracts from browser bridge types. Its remaining game and installation proofs still determine the supported profiles. `scripts/packaging/build-installer.cmd` prunes development dependencies before `scripts/installer.iss` packages the application.

The [texture experiment](../../developers/civ5-mod/runtime-texture-experiment.md) established loading newly created 256-by-256 DXT1 DDS files in a DX11 session. Newspaper-sized text, image strips, control alignment, cache loss, and reopening need their own proof. Existing Lua code does not establish a safe external-file existence check.

## Implementation order

| Plan | Deliverable | Completion gate |
| --- | --- | --- |
| [1. Shared renderer and game proof](implementation/01-renderer.md) | A fixture issue works in the browser and through the DDS viewer, with matching links, scrolling, tabs, and votes. | Readable text and correct interaction at representative sizes, safe missing-file behavior, and measured installation/runtime cost. |
| [2. Historical queries](implementation/02-replay.md) | Queries against MCP's dated records supply newspaper inputs; standalone evaluation reads the database directly. | Cutoff and field filtering work in both access paths, with inspectable source references. |
| [3. Heuristic newspaper](implementation/03-heuristic-editor.md) | Configured triggers and authored templates produce stored issues, series, pages, and feedback-sensitive selections. | A complete read, vote, continue, and resume workflow produces useful coverage without an LLM. |
| [4. Offline evaluation and LLM editor](implementation/04-offline-evaluation.md) | Complete the offline archive and design coverage; compare both editors on the same recordings. | Demonstrate continuity, merging, useful short pieces, fallback, and design evolution; review the reading experience. |
| [5. Live publication and persistence](implementation/05-live-integration.md) | Human-only collection, background publication, save restoration, and the finished game reader. | Old saves restore the correct history and preferences; delayed work cannot cross timelines; reading survives service loss. |

The early game proof uses fixtures. Live generation and save integration remain after the offline editorial evaluation. Evidence research can proceed once Plan 1's issue and action contracts are stable, but the renderer proof should finish before investing in a large design catalogue.

Run the save-capacity proof from Plan 5's first step alongside Plans 1 and 2, once `IssueDocument` has a draft shape. It needs only fixture archives, and its measured limits constrain the issue and decision-record formats that Plans 1 and 3 fix. The rest of Plan 5 still waits for the offline evaluation.

## Shared contracts and boundaries

Keep contracts in the existing workspaces: MCP owns evidence and transport envelopes; Vox Agents owns articles, editorial state, and rendering. The paths below are the target structure. Each stage names the existing files to move and the new modules to add.

| Contract | Owner | Established in |
| --- | --- | --- |
| `IssueDocument`, typed article links; `ReaderAction` and `ReaderState` | Vox Agents `contracts/issue.ts` and `contracts/reader.ts` | Plan 1, retaining existing schemas. |
| `RenderProfile`, `RenderBundle`, geometry and format versions | Vox Agents `contracts/render.ts` | Plan 1, extracted from `renderer/types.ts`; structural schemas move with the types. |
| Browser export bridge, measurements and capture interfaces | Vox Agents `renderer/bridge.ts` | Plan 1, separate from persisted render data. |
| Evidence requests, results and source references | MCP `newspaper/evidence.ts` | Plan 2; both query access paths use these schemas. |
| Replay settings and HTTP responses | Vox Agents `contracts/replay.ts` | Plan 2, reusing MCP evidence contracts. |
| Configuration, candidates and editor/check interfaces | Vox Agents `editorial/config.ts`, `triggers.ts` and `check.ts` respectively | Plan 3, beside the code that uses them. |
| Durable publication, series, preferences and decisions; configured designs | Vox Agents `contracts/publication.ts` and `contracts/design.ts` | Plan 3. |
| Archive indexes and queries; responses containing issue documents | MCP `newspaper/protocol.ts`; Vox Agents `contracts/archive.ts` respectively | Plan 3, reused for live reading in Plan 5. |
| LLM proposal schemas; comparison-run records | Vox Agents `editorial/proposal.ts`; `replay/evaluation.ts` respectively | Plan 4. |
| Save checkpoint schema, versions and migrations; live envelopes and revisions | Vox Agents `contracts/checkpoint.ts`; MCP `newspaper/protocol.ts` respectively | Plan 5; draft checkpoint format participates in the early save proof. |

Paths in the table are relative to `vox-agents/src/newspaper/` or `mcp-server/src/` as labelled. Infer TypeScript types from shared runtime schemas. Keep private helper types beside their implementation. Shared contracts must be browser-safe and independent of Node, DOM, renderer runtime, absolute paths, and live game objects. MCP never imports Vox Agents; browser code may import only browser-safe MCP contract modules.

## Folder ownership

Each folder groups a sustained responsibility. Move existing files and all consumers together, without forwarding modules or barrel files added solely to preserve the old layout.

| Location | Responsibility and stage |
| --- | --- |
| `vox-agents/src/newspaper/contracts/` | Serialized content and boundary schemas across readers, editors and adapters. Plans 1 to 5 add the contracts listed above. |
| `vox-agents/src/newspaper/renderer/` | Layout, assets, reader state, bridge interfaces and renderer capability checks. Plan 1 removes its mixed `types.ts`. |
| `vox-agents/src/newspaper/export/` | Browser worker, capture, DDS conversion, cache and HTTP host. Plan 1 moves `host/http.ts` here and extracts orchestration into `service.ts`; Plan 5 extends that service with viewer pins and releases. |
| `vox-agents/src/newspaper/editorial/` | Pure configuration, detection, selection, series, feedback, presentation and validation. Plan 3 establishes `check.ts` as dispatch/fallback owner; Plan 4 adds the constrained LLM adapter. |
| `vox-agents/src/newspaper/replay/` | Read-only recording connection, replay session and routes in Plan 2; separate output storage in Plan 3; comparison evaluation in Plan 4. |
| `vox-agents/src/newspaper/live/` | Lifecycle, scheduler and MCP-backed state adapter in Plan 5. The game owns committed state. |
| `vox-agents/src/newspaper/console.ts` | CLI parsing, mode wiring, fixture delivery and shutdown. Export jobs belong to `export/service.ts`. |
| `vox-agents/newspaper/src/reader/` and `src/app/` | Plan 1 groups reader DOM/layout separately from the browser application. Plan 2 adds replay and inspection; Plan 4 completes archive navigation. The export entry stays at `src/export-bridge.ts`. |
| `vox-agents/newspaper/catalogue/` | Plan 3 adds flat `defaults.json`, `triggers.json`, `templates.json`, `pages.json` and `designs.json`. Package these runtime inputs explicitly alongside the compiled reader. |
| `mcp-server/src/newspaper/` | Evidence contracts, queries and field projection in Plan 2; archive protocol types in Plan 3; live mirror and transport in Plan 5. `projection.ts` remains the single reporting-policy owner. |
| `mcp-server/src/knowledge/` | Shared pure history reads in `history.ts`; Plan 5 collection in `newspaper-collection.ts` and database definitions in `schema/newspaper.ts`. |
| `civ5-mod/UI/Newspaper/` | Plan 1 groups the existing viewer, XML, data helpers and mock. Plan 5 adds the game checkpoint store and transport here. |

Replay and live sessions supply evidence and state to the same editorial check and persist its accepted result through their own adapters. `export/http.ts` accepts mode-specific routes before its fallback: replay owns offline mutations, while live browser archive handlers expose reads. The Lua reader owns live votes and preferences. The design catalogue selects supported renderer families; Plan 3 separates configurable design IDs from those fixed families and versions any stored-format change.

## Risks and decisions still requiring evidence

- Full-size DDS quality and the game viewer's coordinate transform determine the supported render profiles. Start with the demonstrated DX11 environment and record the exact VP build.
- The initial size target is **at most 30 MiB of added installed production files**, including dependencies and bundled assets. This is a proposed engineering budget. Measure it before expanding the design catalogue; report any overrun with its cause.
- Installed browsers can be absent, blocked by local policy, or updated independently. Detect capability when rendering is requested and preserve reading when export cannot run.
- Historical records may be incomplete. Initial evaluation uses a suitable recording and skips comparisons whose required data is unreliable.
- Save volume and texture-cache retention need measurement, starting with the early save-capacity proof. A portable save must retain readable text even when local images are missing. Persistence preserves the saved design and layout choices; regenerated images may differ slightly from the originals.
- The live trade and espionage field policy needs a concrete field/strength matrix before new collection is implemented. Plan 2 uses existing recorded access; Plan 5 adds explicit new reporting grants.

## Verification and scope

Use Vitest for behavior and contract checks, including browser-driven checks launched from Vitest where needed. Each plan names its focused commands and manual acceptance cases. Run root `npm run build:all` and `npm run test:all` at integration gates. Game checks require the appropriate mod deployment and, only when DLL code changes, the documented DLL build/deployment command.

Keep Vox Agents tests under `tests/mock/newspaper/`, grouped by the same responsibilities as the implementation, and MCP newspaper tests under `tests/newspaper/`. When implementing moves, update imports, HTML entry points, mod registration, generated fixture destinations and packaging together. Update the affected component's `AGENTS.md` and the corresponding [newspaper developer guide](../../developers/vox-agents/newspaper/overview.md) in that code change. These plans describe the target structure until those changes land.

Deferred work includes graphs, generated illustrations, audio/video, immediate special editions, strategist publications, propaganda mechanics, and a new embedded browser inside Civ V. Richer art and additional designs should fit the same renderer after the initial footprint has been measured.
