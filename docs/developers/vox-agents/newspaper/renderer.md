# Newspaper renderer proof

The newspaper proof renders fixture issues in a browser and exports the same layout as DDS strips with typed interaction rectangles. It supports Victorian and modern designs, section tabs, article links, and reversible votes shared by every appearance of an item. Votes are local to the reader. Replay, story generation, archives, and saved-game persistence belong to later stages.

## Run the browser reader

From the repository root, run `npm run newspaper -w vox-agents`. Open the printed loopback URL, normally `http://127.0.0.1:8788/newspaper/`. The fixture selector exercises ordinary, breaking, and analysis layouts. Section tabs wrap to keep every section visible. Each section retains its own scroll position, and the surrounding inspector reflects the reader's current votes and scroll state alongside actions and article evidence.

`npm run type-check:newspaper -w vox-agents` checks browser code separately from the Node backend. `npm run build:newspaper -w vox-agents` rebuilds `vox-agents/dist-newspaper`. The normal workspace build includes this step.

## Export a game fixture

Run `npm run acquire:texconv -w vox-agents` once before exporting. The developer acquisition script verifies the pinned DirectXTex executable and retains its license. Export uses an installed Microsoft Edge browser, then Chrome; `--browser` can select another executable. Neither startup nor export downloads a browser.

Start the newspaper command with `--issue newspaper-reader/fixtures/victorian-ordinary.json --export --once`. Arguments are relative to the Vox Agents workspace when invoked through npm. Omit `--once` to keep the browser host running. After a full build, `npm run newspaper:dist -w vox-agents -- ...` uses compiled backend code.

The command writes a complete cache bundle and `civ5-mod/UI/VoxDeorumNewspaperFixture.lua`. Run `civ5-mod/deploy.bat` after exporting. Deployment adds the generated file to the deployed manifest only; the source manifest and production installer omit fixture data. Reload the mod to import a new fixture. `LuaEvents.VoxDeorumNewspaperOpen()` opens the proof viewer.

The viewer needs the DLL's `Game.IsNewspaperTextureAvailable` binding to use images. It checks that each file is readable, stays inside the fixture's cache root, and has a supported DDS header, dimensions, and payload length. With an older DLL, a missing file, or an invalid texture, the viewer uses native article text and controls. Closing the viewer releases its image controls. It does not need the renderer to remain connected.

## Profiles and cache

`--profile` accepts a JSON file matching `RenderProfile` in `src/newspaper/contracts/types.ts`. The initial profile uses a 1280 by 720 browser viewport, a 900 CSS-pixel content box, normal text size, raster scale 1, and a 2048-pixel texture limit. Raster scales 1 and 2 are supported for proofing. Margins and the stable scrollbar gutter count toward texture width. Wider profiles that exceed the texture limit are rejected before capture. Final game-supported dimensions and text settings require visual acceptance.

The exporter supports `--format BC1_UNORM` and `--format B8G8R8A8_UNORM`. Both use legacy DDS headers and one mip level. BC1 is the initial proof format; the uncompressed option allows comparison of small-text quality. Padding is recorded separately from visible dimensions and must not become extra scrolling space.

Cache keys include issue content, design assets, compiled renderer bytes, schema version, profile, and texture format. A browser version is recorded in each bundle. Files are published together after validation, and a cache hit can be used without a browser. `--cache` selects the directory and `--cache-mib` sets its size target, defaulting to 256 MiB. The most recently delivered fixture is retained across restarts even when it exceeds that target. Other bundles are evicted by least recent use.

## Ownership and validation

The source is divided by runtime and responsibility:

| Location | Responsibility |
| --- | --- |
| `src/newspaper/contracts/{types,validation,bundle}.ts` | Publication types and validation for issues and bundles |
| `src/newspaper/ui/{assets,layout,state}.ts` | Browser-safe assets, layout defaults, and shared reader state |
| `src/newspaper/renderer/{render,browser,dds}.ts` | Capture orchestration, browser lifecycle, and DDS conversion |
| `src/newspaper/cache/{cache,bundle-assets}.ts` | Atomic cache publication and bundle file resolution |
| `src/newspaper/host/{http,fixture}.ts`, `src/newspaper/console.ts` | Local HTTP host, development Lua delivery, and command entry point |
| `newspaper-reader/src/` | Plain DOM reader lifecycle, article construction, layout measurement, and export bridge |
| `civ5-mod/UI/VoxDeorumNewspaperData.lua` | Pure publication indexing and native text adapters |

Contract validation uses the shared asset registry and layout defaults in `ui/`. Both folders stay browser-safe; UI modules import only types from `contracts/`.

The standalone newspaper HTTP host shares `web/loopback.ts` request protection with the dashboard without importing dashboard startup. It exposes `/newspaper/` and `/api/newspaper/export`; regular dashboard integration is deferred. Browser assets and fixture JSON stay with the reader. Mock tests under `tests/mock/newspaper/` are grouped by the boundary they exercise; reader state is covered with the contracts. Shared test builders live in `tests/helpers/newspaper-fixtures.ts`.

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
