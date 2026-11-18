# Newspaper renderer proof

The newspaper renderer displays completed issues in a browser and exports the same layout as DDS strips with typed interaction rectangles. This guide covers its input, browser reader, export service, and game delivery. Manual testing confirmed the demo's links, scrolling, and general UI in Civilization V. The exact test environment was not recorded.

Configurable designs use Victorian and modern renderer families, section tabs, article links, and reversible votes shared by every appearance of an item. The host owns vote persistence. The normal VD server hosts the reader, export service, and [recording replay](replay.md), and the Debug page can open a sample issue in the loaded game.

## Supply a completed issue

The Zod schemas in `src/newspaper/contracts/issue.ts` are the source of the issue contract, and the TypeScript types are inferred from them. An `IssueDocument` holds ready articles in their publication order. The renderer builds the reading surface from the stored content and presentation.

| Field | Content |
| --- | --- |
| `schemaVersion`, `issueId`, `campaignId`, `timelineId` | Document version and issue, campaign, and timeline identity |
| `receiver` | `IssueReceiver` with the player `playerId`, display `label`, and optional `civilizationId` |
| `cutoff` | `IssueCutoff` with the reporting `turn` and display `label` |
| `publication` | `IssuePublication` with `title`, configurable `designId`, `designVersion`, and the presentation snapshot described below |
| `pages` | Ordered `IssuePage` sections, each with an `id`, `label`, `layout`, and ordered `itemIds` |
| `items` | Canonical `IssueItem` articles, each with an `id`, `tags`, `seriesKeys`, `headline`, `body`, and `sourceNote` |

An item can also supply a `subheadline`, an `earlierReport`, an `image`, an `avatar`, and an `evidenceTable`. Headline, subheadline, body, sourceNote, and earlier report prose use typed inline nodes for text, emphasis, breaks, and links. An `EarlierReportLink` holds its `label`, an article `target`, and the earlier article's `summary`. An `ItemImage` holds an `assetId` and a required `altText`. A `FeedAvatar` holds `initials` and a `tone`. An `EvidenceTable` holds a `title`, `description`, `columns`, `rows`, and an optional `footnote`; each `EvidenceRow` holds a `label`, `values`, and an optional `hasMissingValues` flag. Link targets identify a city, civilization, trade relationship, supported game screen, or article. Supply those typed targets rather than raw markup.

Multiple pages can reference the same canonical item ID. Every appearance shares its vote. Page IDs and item IDs must be unique, and page item references must resolve. Renderer validation in `src/newspaper/renderer/validation.ts` checks registered assets and their kinds, including illustrations, ornaments, and presentation fonts. The contract schemas handle structure and references without importing the renderer.

The developer fixtures in `newspaper/fixtures/` are complete input examples covering ordinary, breaking, analysis, and modern layouts.

### Store the presentation with the issue

Issues use schema 2 and require `publication.presentation`, defined in `contracts/design.ts`. Its own schema version is 1. The snapshot stores the chosen `rendererFamily` (`victorian` or `modern`), optional paper, ink and accent colors, optional body, heading and masthead font asset IDs, and an optional ornament asset ID. Omitted tokens use the selected family's defaults. Headings and the masthead have separate font roles, so the Victorian design reserves blackletter for its publication title.

Font assets resolve to their registered family with all bundled weights and styles. Bold and italic text retain their corresponding faces, and missing files use the family's fallback stack while the reader becomes ready. Disposing the reader removes its font faces. The same saved colors, fonts and ornament apply in browser reading and export.

A configured identity such as `early-account` can therefore use the Victorian renderer with its own colors and typography. Reopening the issue uses its saved snapshot without consulting today's catalogue. Export bundles keep the fixed renderer family in `designId`; cache keys include the entire issue and its presentation snapshot.

An issue uses the ornament stored in its presentation snapshot. Installation packages `constants.json`, `defaults.json`, `pages.json`, and the JSON files in `designs/` and `triggers/` under `vox-agents/newspaper/`. The stock catalogue includes no templates.

Keep these related values separate:

| Value | Purpose |
| --- | --- |
| `IssueDocument` | Completed publication supplied to the reader or exporter |
| `RenderProfile` | Viewport, text, raster, and texture settings for export, defined in `contracts/render.ts` |
| `ReaderState` | Active page, scroll positions, and votes persisted by the reader's host, defined in `contracts/reader.ts` |
| `RenderBundle` | Exported strips and interaction geometry returned by the exporter, defined in `contracts/render.ts` |

## Open the browser reader

The normal VD server hosts the reader and the export service. Start VD as usual and open the newspaper reader at the server's `/newspaper/` path. The reader opens the packaged Victorian ordinary sample. A source checkout also serves the other developer fixtures; installed builds include only the default sample. Section tabs wrap to keep every section visible. Each section retains its own scroll position, and the surrounding inspector reflects the reader's current votes and scroll state alongside actions and article evidence.

`npm run type-check:newspaper -w vox-agents` checks browser code separately from the Node backend. `npm run build:newspaper -w vox-agents` rebuilds `vox-agents/dist-newspaper`. The normal workspace build includes this step.

## Show an issue in the game

Run `npm run acquire:texconv -w vox-agents` once before exporting. The developer acquisition script verifies the pinned DirectXTex executable and retains its license. Export uses an installed Microsoft Edge browser, then Chrome. Neither startup nor export downloads a browser.

The Debug page has a Show newspaper action beside the log download. It exports the packaged sample for the active receiver and reports success after the game displays it. Load a game with the updated mod before the first use. Later clicks need no FireTuner command or mod reload. A pure observer without a civilization-seat override has no receiving publication.

The viewer, XML and data helpers live together under `UI/Newspaper/`; VFS includes use their module basenames. The server registers the loaded reader through a fixed Lua event, then prepares its current seat, request token, and publication view before rendering. The view reports the available physical publication width and height, plus its zoom. The masthead, section tabs, and articles scroll together. Scroll back to the masthead to switch sections; the reader saves the position reached at the tab click, including that navigation. The reader has one Close button above the paper; it returns from article detail before closing the newspaper. Resizing the game window also returns from detail to the publication. Closing and reopening the same issue preserves the current page, reading position and votes. Missing or invalid view settings require updating the mod and reloading the game. The reader rejects superseded requests and receiver changes. FireTuner can reopen the last delivered issue through `LuaEvents.VoxDeorumNewspaperOpen`.

The reader sits below the native EUI top bar. A solid dark backing keeps native beige text readable when the masthead or articles need a fallback, while rendered paper strips cover the same backing.

The viewer needs the DLL's `Game.IsNewspaperTextureAvailable` binding to use images. It checks that each file is readable, stays inside the fixture's cache root, and has a supported DDS header, dimensions, and payload length. With an older DLL, a missing file, or an invalid texture, the viewer uses native article text and controls. If a captured masthead omits any section tab, the reader shows a native title and complete tab list while keeping available article textures. Closing the viewer releases its image controls. It does not need the renderer to remain connected.

## Profiles and cache

Render profiles match `RenderProfile` in `src/newspaper/contracts/render.ts`. `paperWidth` is the outer publication width in CSS pixels, including margins and the stable scrollbar gutter. The Debug button fits that width to the prepared game view, capped at 1200 CSS pixels. Its physical display width is the smaller of the available width and 1200 times zoom. Dividing by zoom and rounding down to a 1/64 CSS-pixel step gives the paper width. Zoom ranges from 0.5 to 2 and defaults to 1 in the mod; text size stays at 1. The capture viewport includes the full paper and texture alignment padding. Profiles with no content space or widths beyond capture and texture limits are rejected before capture.

The default export profile uses a 1200 CSS-pixel paper, raster scale 2, and texture limits of 4096 by 2048 pixels. The Debug button uses the same raster and texture settings with its negotiated paper width. Capture viewport height stays at 720 CSS pixels because export expands each section; changing only the game view's height can reuse the same cached pixels. Tall mastheads scroll out of view and do not reduce the article viewport. The capture library supports raster scales 1 and 2, plus `BC1_UNORM` and `B8G8R8A8_UNORM`. Runtime delivery defaults to uncompressed BGRA. Native image controls use linear filtering and a white tint to preserve the captured colors when scaling. Vote icons map their full raster texture into the displayed slot. Both formats use legacy DDS headers and one mip level. Padding is recorded separately from visible dimensions and must not become extra scrolling space. Broader text-quality and format comparisons await issues generated from recorded data.

Both browser reading and export use `mountReader`, which returns layout readiness and a disposal method. Export waits for fonts, images and settled layout before measuring. Shared layout calculations derive content width from the outer paper. Margins are 16 pixels through a paper width of 480, 24 pixels through 760, then 48 pixels for Victorian and 32 for modern. The gutter remains stable as columns reflow. Sections own their scroll positions; export expands the active section while keeping the browser viewport fixed and disabling transitions. Article content is constructed from typed nodes, so prose cannot inject scripts, styles or arbitrary URLs.

The browser reader fits a paper up to 1200 CSS pixels to its host and resizes without resetting reader state. Wide Victorian ordinary pages place a full-width lead above rows of two stories, in publication order. Each row follows the taller story in the previous row. An unpaired final story takes the full width. Full-width prose uses two text columns when space allows, with the opening letter kept beside its first lines. The modern design keeps its single-column feed.

Through 760 pixels, ordinary stories and the inner breaking and analysis columns stack in publication order. Victorian display headings shrink again through 560 pixels. Footer links, vote controls, and evidence cells wrap to fit the paper.

The exporter captures the masthead and tabs separately from bounded vertical page strips. `RenderBundle` records schema, renderer and browser versions; publication and profile identity; region sizes; strip CSS offsets, visible dimensions and padded pixel dimensions; and typed action rectangles. Wrapped links use individual DOM line rectangles. Votes have reserved icon slots, and tab labels export in a neutral state so the game can update selection locally. Pixels and geometry come from the same settled layout.

The game uses `displayScale` to scale image controls and action rectangles from CSS coordinates. Raster scale affects texture resolution only. Page actions belong to the page coordinate space independently of strip seams. The header and page share one clipped scroll container, with the page placed immediately below the header. Each page keeps separate rendered and native reading positions. Local positions preserve the distance into the articles when a masthead changes height; positions within the masthead preserve their proportional progress, including the publication's top. Delivered state uses page-local CSS offsets: positive values start within the articles, while missing or zero values open at the publication's top. Closing releases the displayed textures; reopening checks their availability before assigning paths. Browser absence disables new capture while cached reading and native text remain available. The browser worker reuses an installed browser for a batch and closes it after 15 seconds idle or during shutdown.

Cache keys include issue content, design assets, compiled renderer bytes, schema version, profile, and texture format. Each queued request snapshots its profile, so negotiated widths and zoom remain isolated from concurrent requests. Generic exports use the service's constructor profile. Bundle schema 2 and renderer 0.2.0 invalidate exports made with the earlier content-width contract. A browser version is recorded in each bundle. Files are published together after validation, and a cache hit can be used without a browser. The default cache directory is `vox-agents/data/newspaper-cache/`, with a 256 MiB size target. The most recently delivered proof bundle is retained across restarts even when it exceeds that target. Other bundles are evicted by least recent use.

## Ownership and validation

The source is divided by runtime and responsibility:

| Location | Responsibility |
| --- | --- |
| `src/newspaper/contracts/issue.ts` | Issue schemas, inferred types, typed links, and structural validation |
| `src/newspaper/contracts/design.ts` | Versioned presentation snapshots and supported renderer families |
| `src/newspaper/contracts/reader.ts` | Reader actions, persisted state, and their validation |
| `src/newspaper/contracts/render.ts` | Serialized profiles, geometry and bundles, with structural schemas |
| `src/newspaper/renderer/{assets,layout,state}.ts` | Browser-safe assets, layout defaults, and shared reader state helpers |
| `src/newspaper/renderer/{bridge,validation,bundle}.ts` | Browser bridge interfaces, asset and profile capability checks, and bundle consistency checks |
| `src/newspaper/export/{browser,render,dds}.ts` | Node capture orchestration, browser lifecycle, and DDS conversion |
| `src/newspaper/export/{cache,bundle-assets,lua-fixture}.ts` | Atomic cache publication, bundle file resolution, and structured game delivery payloads |
| `src/newspaper/export/{http,service}.ts` | Server-mounted HTTP routes, reusable export queue, cache delivery, and shutdown |
| `src/newspaper/{application,game-delivery}.ts` | Lazy renderer lifecycle, sample orchestration, and acknowledged MCP delivery to the active game reader |
| `newspaper/src/reader/` | Plain DOM reader lifecycle, article construction, styling, actions, and layout measurement |
| `newspaper/src/app/` | Fixture and replay controls, state inspection, and browser navigation |
| `newspaper/src/export-bridge.ts` | Browser entry point used by texture export and CLI previews |
| `civ5-mod/UI/Newspaper/VoxDeorumNewspaperData.lua` | Pure publication indexing and native text adapters |

Contracts have no renderer imports. The renderer depends on contracts and stays free of Node and DOM imports; DOM work belongs to `newspaper/src/`. The Node-only exporter consumes serialized render contracts and the browser bridge interfaces. Structural schemas live in contracts; issue parsing at the rendering boundary adds registered asset and kind checks, while profile and bundle consistency checks use renderer layout defaults.

`mountNewspaperRoutes` shares `web/loopback.ts` request protection with the dashboard. It exposes `/newspaper/`, `/api/newspaper/export`, and any mode-specific application routes before static and API fallbacks. The VD server mounts these routes during normal startup, so the reader and export service share its port. The Debug page's Show newspaper action uses the same export service and asks the game to display the result.

`NewspaperExportService` validates issues, serializes cache lookup and capture, and awaits each request's delivery callback before pinning the delivered bundle. Generic exports do not open the game or replace its pin. A failed request does not block later requests. Shutdown rejects new exports, drains accepted jobs and delivery, then closes the browser before the VD server closes HTTP. Rendering uses the server's actual bound port, including a fallback port. The initial MCP connection wait is limited to eight seconds. Once dispatched, a game call retains the existing 660-second timeout so a paused game can resume and acknowledge delivery. Shutdown waits for that acknowledgement or failure; a second Ctrl+C forces process exit.

Vite cleans `dist-newspaper` on every build, then `scripts/utilities/package-newspaper-sample.mjs` copies the existing Victorian ordinary fixture to `sample.json`. Production packaging retains that sample, the runtime JSON catalogue, the compiled backend in `dist/newspaper`, the compiled reader, runtime `playwright-core`, and `vendor/texconv` with its license. The installer anchors its source-folder exclusion to the component root so it preserves the compiled backend, and explicitly includes the catalogue. It excludes reader source and the remaining developer fixtures. Converter acquisition runs during developer setup or the installer build. No browser is bundled or downloaded. Mock tests under `tests/mock/newspaper/` mirror the implementation boundaries, including HTTP and service lifecycle checks under `export/`. Shared test builders live in `tests/helpers/newspaper-fixtures.ts`.

Run focused checks with `npm test -w vox-agents -- tests/mock/newspaper`, then run `npm run build:all` and `npm run test:all` for integration. Browser-driven tests use installed browsers and the built reader. Converter checks require the acquired executable.

Broader game acceptance needs generated issues with actual stories, variable article lengths, and real link targets. The stock catalogue has no templates, so generated stories await stage 7 template expressions and stage 8 fresh in-game stories. [Plan 1](../../../plans/newspaper/implementation/01-renderer.md) retains the remaining checks for layout quality, votes, reader state, game UI interactions, and cache loss. Record the VP build, DLL revision, DX renderer, resolution, UI scaling, render profile, and DDS format when performing those checks, keeping observed appearance and interaction separate from delivery acknowledgements.

## Local measurements

On Windows with Chrome 157.0.8103.51 and renderer 0.2.0, the Victorian ordinary fixture exported in about 3.76 seconds at a 600.5 CSS-pixel paper width, raster scale 2, and uncompressed BGRA, with strips limited to 512 physical pixels high. Header and page DDS files totaled 25,295,296 bytes (about 24.1 MiB), excluding vote icons. The local baseline is recorded in `.tmp/newspaper-responsive/baseline.json`. This browser export does not establish in-game appearance or interaction alignment.

With renderer 0.1.0, an export through the integrated VD server completed in 3.34 seconds on an ephemeral bound port. Its structured sample delivery arguments used 14,135 bytes of the DLL's 262,144-byte ArduinoJson pool, measured with the repository's parser in a 32-bit executable. The real exported payload also passed the Lua 5.1 reader harness. These checks use mocked game controls and do not establish in-game appearance.

A controlled Inno Setup compiler probe confirmed that the installer retains the compiled newspaper backend and packaged sample while excluding reader source. A fresh compiled runtime using production-pruned dependencies then started the VD server, served the UI and default sample, and exported both sample pages. Dependency resolution was restricted to the staged runtime and pruned dependency tree. The remaining developer fixtures were absent. This verifies file selection and runtime dependencies; the full installer size comparison remains pending.

On Windows with Chrome 157.0.8103.51 and renderer 0.1.0, the Victorian ordinary fixture exported in 3.20 seconds with browser startup, 1.68 seconds warm, and 8 ms from cache. The sampled browser working-set peak during the batch was 576 MiB. These are local observations, with the test suite running concurrently.

| Export                                 | DDS bytes | Warm time |
| -------------------------------------- | --------: | --------: |
| Victorian, BC1, raster 1               |   953,328 |    1.68 s |
| Victorian, BC1, raster 2, text 1.25    | 4,632,368 |    2.31 s |
| Modern, BC1, raster 1                  |   840,928 |    1.70 s |
| Modern, BC1, raster 2, text 1.25       | 3,705,984 |    1.89 s |
| Victorian, uncompressed BGRA, raster 1 | 7,620,352 |    1.43 s |

The added production payload measured about 23.5 MiB after dependency pruning. An isolated Inno Setup compression probe added about 8.4 MiB; this is an estimate, not a full installer size comparison. The reader and converter survived production pruning without downloading a browser.

The texture-check DLL built against VP checkout `a092e06b4` with local changes. When DLL changes are needed, close Civilization V before running the DLL build-and-copy workflow, then reload the mod.
