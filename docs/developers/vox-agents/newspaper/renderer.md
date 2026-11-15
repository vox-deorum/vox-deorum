# Newspaper renderer proof

The newspaper proof renders fixture issues in a browser and exports the same layout as DDS strips with typed interaction rectangles. It supports Victorian and modern designs, section tabs, article links, and reversible votes shared by every appearance of an item. Votes are local to the reader. Replay, story generation, archives, and saved-game persistence belong to later stages.

## Supply a completed issue

The Zod schemas in `src/newspaper/contracts/issue.ts` are the source of the issue contract, and the TypeScript types are inferred from them. An `IssueDocument` holds ready articles in their publication order. The renderer builds the reading surface from it; editorial selection and replay remain later stages.

| Field | Content |
| --- | --- |
| `schemaVersion`, `issueId`, `campaignId`, `timelineId` | Document version and issue, campaign, and timeline identity |
| `receiver` | `IssueReceiver` with the player `playerId`, display `label`, and optional `civilizationId` |
| `cutoff` | `IssueCutoff` with the reporting `turn` and display `label` |
| `publication` | `IssuePublication` with `title`, `designId`, `designVersion`, and optional `ornamentAssetId` |
| `pages` | Ordered `IssuePage` sections, each with an `id`, `label`, `layout`, and ordered `itemIds` |
| `items` | Canonical `IssueItem` articles, each with an `id`, `tags`, `seriesKeys`, `headline`, `body`, and `sourceNote` |

An item can also supply a `subheadline`, an `earlierReport`, an `image`, an `avatar`, and an `evidenceTable`. Headline, subheadline, body, sourceNote, and earlier report prose use typed inline nodes for text, emphasis, breaks, and links. An `EarlierReportLink` holds its `label`, an article `target`, and the earlier article's `summary`. An `ItemImage` holds an `assetId` and a required `altText`. A `FeedAvatar` holds `initials` and a `tone`. An `EvidenceTable` holds a `title`, `description`, `columns`, `rows`, and an optional `footnote`; each `EvidenceRow` holds a `label`, `values`, and an optional `hasMissingValues` flag. Link targets identify a city, civilization, trade relationship, supported game screen, or article. Supply those typed targets rather than raw markup.

Multiple pages can reference the same canonical item ID. Every appearance shares its vote. Page IDs and item IDs must be unique, and page item references must resolve. Renderer validation in `src/newspaper/renderer/validation.ts` also checks registered assets and their kinds, covering item images and publication ornaments. The contract schemas handle structure and references without importing the renderer.

The four files in `newspaper/fixtures/` are complete input examples: `victorian-ordinary.json`, `victorian-breaking.json`, `victorian-analysis.json`, and `modern-ordinary.json`.

Keep these related values separate:

| Value | Purpose |
| --- | --- |
| `IssueDocument` | Completed publication supplied to the reader or exporter |
| `RenderProfile` | Viewport, text, raster, and texture settings for export, defined in `contracts/render.ts` |
| `ReaderState` | Active page, scroll positions, and votes persisted by the reader's host, defined in `contracts/reader.ts` |
| `RenderBundle` | Exported strips and interaction geometry returned by the exporter, defined in `contracts/render.ts` |

## Run the browser reader

From the repository root, run `npm run newspaper -w vox-agents`. Open the printed loopback URL, normally `http://127.0.0.1:8788/newspaper/`. The fixture selector exercises ordinary, breaking, and analysis layouts. Section tabs wrap to keep every section visible. Each section retains its own scroll position, and the surrounding inspector reflects the reader's current votes and scroll state alongside actions and article evidence.

`npm run type-check:newspaper -w vox-agents` checks browser code separately from the Node backend. `npm run build:newspaper -w vox-agents` rebuilds `vox-agents/dist-newspaper`. The normal workspace build includes this step.

## Export a game fixture

Run `npm run acquire:texconv -w vox-agents` once before exporting. The developer acquisition script verifies the pinned DirectXTex executable and retains its license. Export uses an installed Microsoft Edge browser, then Chrome; `--browser` can select another executable. Neither startup nor export downloads a browser.

Start the newspaper command with `--issue newspaper/fixtures/victorian-ordinary.json --export --once`. Arguments are relative to the Vox Agents workspace when invoked through npm. Omit `--once` to keep the browser host running. After a full build, `npm run newspaper:dist -w vox-agents -- ...` uses compiled backend code.

The command writes a complete cache bundle and `civ5-mod/UI/Newspaper/VoxDeorumNewspaperFixture.lua`. Run `civ5-mod/deploy.bat` after exporting. The viewer, XML, data helpers and final mock include live together under `UI/Newspaper/`; VFS includes use their module basenames. Deployment adds the generated file to the deployed manifest only; the source manifest and production installer omit fixture data. Reload the mod to import a new fixture. `LuaEvents.VoxDeorumNewspaperOpen()` opens the proof viewer.

The viewer needs the DLL's `Game.IsNewspaperTextureAvailable` binding to use images. It checks that each file is readable, stays inside the fixture's cache root, and has a supported DDS header, dimensions, and payload length. With an older DLL, a missing file, or an invalid texture, the viewer uses native article text and controls. Closing the viewer releases its image controls. It does not need the renderer to remain connected.

## Profiles and cache

`--profile` accepts a JSON file matching `RenderProfile` in `src/newspaper/contracts/render.ts`. The initial profile uses a 1280 by 720 browser viewport, a 900 CSS-pixel content box, normal text size, raster scale 1, and a 2048-pixel texture limit. Raster scales 1 and 2 are supported for proofing. Margins and the stable scrollbar gutter count toward texture width. Wider profiles that exceed the texture limit are rejected before capture. Final game-supported dimensions and text settings require visual acceptance.

The exporter supports `--format BC1_UNORM` and `--format B8G8R8A8_UNORM`. Both use legacy DDS headers and one mip level. BC1 is the initial proof format; the uncompressed option allows comparison of small-text quality. Padding is recorded separately from visible dimensions and must not become extra scrolling space.

Both modes use `mountReader`, which returns layout readiness and a disposal method. Export waits for fonts, images and settled layout before measuring. The publication has the same explicit content width and stable scrollbar gutter in both modes. Sections own their scroll positions; export expands the active section while keeping the browser viewport fixed and disabling transitions. Article content is constructed from typed nodes, so prose cannot inject scripts, styles or arbitrary URLs.

The exporter captures the masthead and tabs separately from bounded vertical page strips. `RenderBundle` records schema, renderer and browser versions; publication and profile identity; region sizes; strip CSS offsets, visible dimensions and padded pixel dimensions; and typed action rectangles. Wrapped links use individual DOM line rectangles. Votes have reserved icon slots, and tab labels export in a neutral state so the game can update selection locally. Pixels and geometry come from the same settled layout.

The game scales image controls and action rectangles from CSS coordinates. Raster scale affects texture resolution only. Page actions belong to the page coordinate space independently of strip seams, and the scroll container clips the whole content tree. Closing releases the displayed textures; reopening checks their availability before assigning paths. Browser absence disables new capture while cached reading and native text remain available. The browser worker reuses an installed browser for a batch and closes it after 15 seconds idle or during shutdown.

Cache keys include issue content, design assets, compiled renderer bytes, schema version, profile, and texture format. A browser version is recorded in each bundle. Files are published together after validation, and a cache hit can be used without a browser. `--cache` selects the directory and `--cache-mib` sets its size target, defaulting to 256 MiB. The most recently delivered fixture is retained across restarts even when it exceeds that target. Other bundles are evicted by least recent use.

## Ownership and validation

The source is divided by runtime and responsibility:

| Location | Responsibility |
| --- | --- |
| `src/newspaper/contracts/issue.ts` | Issue schemas, inferred types, typed links, and structural validation |
| `src/newspaper/contracts/reader.ts` | Reader actions, persisted state, and their validation |
| `src/newspaper/contracts/render.ts` | Serialized profiles, geometry and bundles, with structural schemas |
| `src/newspaper/renderer/{assets,layout,state}.ts` | Browser-safe assets, layout defaults, and shared reader state helpers |
| `src/newspaper/renderer/{bridge,validation,bundle}.ts` | Browser bridge interfaces, asset and profile capability checks, and bundle consistency checks |
| `src/newspaper/export/{browser,render,dds}.ts` | Node capture orchestration, browser lifecycle, and DDS conversion |
| `src/newspaper/export/{cache,bundle-assets,lua-fixture}.ts` | Atomic cache publication, bundle file resolution, and development Lua delivery |
| `src/newspaper/export/{http,service}.ts` | Loopback HTTP host and reusable export queue, cache delivery, and shutdown |
| `src/newspaper/console.ts` | CLI options, service wiring, fixture delivery, and process-manager registration |
| `newspaper/src/reader/` | Plain DOM reader lifecycle, article construction, styling, actions, and layout measurement |
| `newspaper/src/app/` | Fixture application shell, state inspection, and browser navigation |
| `newspaper/src/export-bridge.ts` | Browser entry point consumed by the Node worker |
| `civ5-mod/UI/Newspaper/VoxDeorumNewspaperData.lua` | Pure publication indexing and native text adapters |

Contracts have no renderer imports. The renderer depends on contracts and stays free of Node and DOM imports; DOM work belongs to `newspaper/src/`. The Node-only exporter consumes serialized render contracts and the browser bridge interfaces. Structural schemas live in contracts; issue parsing at the rendering boundary adds registered asset and kind checks, while profile and bundle consistency checks use renderer layout defaults.

The standalone newspaper HTTP host shares `web/loopback.ts` request protection with the dashboard without importing dashboard startup. It exposes `/newspaper/` and `/api/newspaper/export`. Its optional application-route hook runs after loopback protection and before static and API fallbacks, allowing later replay routes to use the same host. Regular dashboard integration is deferred.

`NewspaperExportService` validates issues, serializes cache lookup and capture, and awaits the owning application's delivery callback before pinning the delivered bundle. A failed request does not block later requests. Shutdown rejects new exports, drains accepted jobs and delivery, then closes the browser. The CLI supplies Lua fixture delivery and closes the HTTP host after the service drains. It imports `agents/runtime/process-manager.ts` directly.

Browser assets and developer fixture JSON stay with the reader source. Vite cleans `dist-newspaper` on every build. Production packaging retains the compiled reader, runtime `playwright-core`, and `vendor/texconv` with its license; it excludes `newspaper/` source, copied fixture JSON, and generated Lua fixture data. Converter acquisition runs during developer setup or the installer build. No browser is bundled or downloaded. Mock tests under `tests/mock/newspaper/` mirror the implementation boundaries, including HTTP and service lifecycle checks under `export/`. Shared test builders live in `tests/helpers/newspaper-fixtures.ts`.

Run focused checks with `npm test -w vox-agents -- tests/mock/newspaper`, then run `npm run build:all` and `npm run test:all` for integration. Browser-driven tests use installed browsers and the built reader. Converter checks require the acquired executable.

Game acceptance must record the VP build and renderer separately from automated results. Check text at 1280 by 720, 1920 by 1080, and 2560 by 1440; raster scales 1 and 2; scrolling over links and votes; seam-crossing links; tab and vote updates; target return; Escape; native popups; cached reopening with the host stopped; and reopening after deleting a closed fixture's cache. A successful transport call does not establish visual correctness.

## Local measurements

On Windows with Chrome 157.0.8103.51 and renderer 0.1.0, the Victorian ordinary fixture exported in 3.20 seconds with browser startup, 1.68 seconds warm, and 8 ms from cache. The sampled browser working-set peak during the batch was 576 MiB. These are local observations, with the test suite running concurrently.

| Export | DDS bytes | Warm time |
| --- | ---: | ---: |
| Victorian, BC1, raster 1 | 953,328 | 1.68 s |
| Victorian, BC1, raster 2, text 1.25 | 4,632,368 | 2.31 s |
| Modern, BC1, raster 1 | 840,928 | 1.70 s |
| Modern, BC1, raster 2, text 1.25 | 3,705,984 | 1.89 s |
| Victorian, uncompressed BGRA, raster 1 | 7,620,352 | 1.43 s |

The added production payload measured about 23.5 MiB after dependency pruning. An isolated Inno Setup compression probe added about 8.4 MiB; this is an estimate, not a full installer size comparison. The reader and converter survived production pruning without downloading a browser.

The texture-check DLL built against VP checkout `a092e06b4` with local changes. Final in-game text quality, cropping, and hit alignment remain unverified. A running game locks the installed DLL, so close Civilization V before running the DLL build-and-copy workflow, then reload the mod for acceptance.
