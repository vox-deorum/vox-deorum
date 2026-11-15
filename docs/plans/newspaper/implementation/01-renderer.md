# Plan 1: shared renderer and game proof

**Status: foundations implemented; refactoring and empirical proof remain.** For developers completing the first stage of the [implementation roadmap](../implementation.md). This plan uses fixture content and establishes the rendering foundation for both readers. Paths below describe the agreed destination; moves remain implementation work.

## Goal and success criteria

Render the same issue in a browser and in VP using one HTML/CSS implementation. Demonstrate two section tabs, a long scrollable section, a link that wraps across lines, article links, and reversible votes. The game viewer must remain responsive while the renderer is stopped.

Use a Victorian layout and a modern feed to exercise different compositions. Test ordinary, breaking, and analysis arrangements with fixture data. A fixture vote changes local reader state only; durable feedback arrives in Plan 3.

## Current state

| Existing source | Reuse or constraint |
| --- | --- |
| `docs/plans/newspaper/prototypes/html/reader.js`, `reader.css`, `fonts.css` | Shared layout and interaction examples; currently coupled to global DOM IDs, fixture content, and local storage. Assets are gitignored. |
| `vox-agents/tsconfig.json`, `tsconfig.newspaper.json` | Separate Node-oriented backend and DOM-aware browser type checks already exist. Preserve that boundary. |
| `vox-agents/src/web/server.ts`, `web/loopback.ts` | Existing Express dashboard host, shared loopback request check, and Vue fallback route. Reader static and API routes must precede the fallback; standalone startup must not import the dashboard app. |
| `vox-agents/src/strategist/console.ts` and similar | Console entry points live in their component folder, with matching `<name>` and `<name>:dist` scripts in `vox-agents/package.json`. |
| `scripts/packaging/build-installer.cmd`, `scripts/installer.iss`, `scripts/utilities/acquire-texconv.mjs` | Packaging, production dependency pruning, and converter acquisition already exist. Verify the pruned output and update exclusions after moves. |
| `civ5-mod/UI/HumanControl/VoxDeorumHumanPanel.lua` and `.xml` | `queueDialog`, `releaseDialog`, repeated instances, native scroll panels, and button callbacks. |
| `civ5-mod/UI/Diplomacy/VoxDeorumDiploTransport.lua` | Asynchronous broadcast/register-function pattern, replies and timeouts. |
| `vox-agents/src/newspaper/`, `vox-agents/newspaper/` | Issue/reader contracts, renderer, browser reader, export/cache/converter, fixture host and CLI already exist, with tests under `tests/mock/newspaper/`. Complete the ownership refactors below without recreating these foundations. |
| `vox-agents/package.json`, `tsconfig.newspaper.json` | Reader type-check/build, fixture CLI, and converter acquisition scripts already exist; the workspace build already includes the reader. Verify them after moving browser modules. |
| `civ5-mod/UI/VoxDeorumNewspaper*` | Lua/XML fixture viewer foundations exist. Their presence does not establish texture safety, text quality, or in-game interaction proof. |
| [Runtime texture findings](../../../developers/civ5-mod/runtime-texture-experiment.md) | Absolute DDS paths and unload/set work in the tested DX11 session. Larger images and missing-file handling are unverified. |

## Approach

Keep the plain browser implementation in `vox-agents/newspaper/`, built to `vox-agents/dist-newspaper/`, and backend code in `vox-agents/src/newspaper/`. Use the existing workspaces. Vox Agents owns editorial, issue, reader, and render contracts; MCP owns evidence and transport. Shared contracts remain browser-safe, with no Node or DOM types or runtime implementation imports. MCP must not depend on Vox Agents.

Use installed Edge through `playwright-core`, with installed Chrome as a fallback. An explicit executable override can support nonstandard installations. Start one isolated browser worker for a render batch and close it after a short idle period or process shutdown. Browser absence disables new texture export with a clear status. Installation and ordinary startup must never download a browser.

Use a pinned Windows `texconv` binary and include its license. Begin conversion experiments with the demonstrated DXT1 format and compare a legacy-header uncompressed 32-bit format for small text. Select the format from game results. A custom DDS encoder would add maintenance before its benefit has been measured.

HTML/CSS preserves the existing typography and gives the offline reader the same layout engine as the exporter. A custom canvas renderer would require manual text layout and hit testing. Browser-subset renderers introduce another layout engine and compatibility work. The installed-browser route keeps one implementation while avoiding a bundled browser.

## Folder and type ownership

Paths in this table are relative to `vox-agents/` unless qualified.

| Destination | Responsibility and implementation move |
| --- | --- |
| `src/newspaper/contracts/issue.ts`, `reader.ts` | Existing serializable publication, structured article, action, and reader-state contracts and structural schemas. |
| `src/newspaper/contracts/render.ts` | Move serializable `RenderProfile`, geometry, bundle and version contracts from `renderer/types.ts`, plus their structural schemas. |
| `src/newspaper/renderer/bridge.ts` | Move browser export bridge, measurement and capture types from `renderer/types.ts`; reuse geometry from `contracts/render.ts`. |
| `src/newspaper/renderer/validation.ts`, `bundle.ts` | Keep renderer capability, registered-asset and layout validation here; structural schemas belong in contracts. |
| `src/newspaper/renderer/state.ts` | Keep pure reader-state transitions, separate from serialized state shape and browser DOM. |
| `src/newspaper/export/http.ts` | Move `host/http.ts` and its tests here. Own loopback reader/export hosting; accept injected application routes before API/static fallbacks for Plan 2. |
| `src/newspaper/export/service.ts` | Extract reusable export queue, worker/cache orchestration and shutdown lifecycle from `console.ts`. |
| `src/newspaper/console.ts` | Parse CLI arguments, wire services and handle fixture delivery, including `export/lua-fixture.ts`; keep fixture delivery out of the reusable service. |
| `src/agents/runtime/process-manager.ts` | Use the canonical lifecycle module directly. Remove `src/infra/process-manager.ts` if no other consumers remain. |
| `newspaper/src/reader/` | Move `mount.ts`, `story.ts`, `actions.ts`, `dom.ts`, `measure.ts`, and `reader.css` together as the shared publication renderer. |
| `newspaper/src/app/main.ts`, `styles.css` | Move browser `host.ts` and `host.css` into the application shell. Keep `export-bridge.ts` and `env.d.ts` at `newspaper/src/`. |
| `civ5-mod/UI/Newspaper/` | Move newspaper Lua/XML modules here, including Data, Mock, and generated Fixture modules. Update modinfo, generated-fixture destination, gitignore and installer exclusions together. |

Update all imports and HTML entry points, preserve public asset URLs, and remove `renderer/types.ts` after the split without forwarding shims. Mirror moved backend modules under `vox-agents/tests/mock/newspaper/`. During code implementation, update `vox-agents/AGENTS.md` and `civ5-mod/AGENTS.md` for folder ownership. Update `docs/developers/vox-agents/newspaper/overview.md` for component boundaries and `renderer.md` in that directory for renderer paths, build, packaging and fixture delivery. This documentation revision does not claim those moves have happened.

## Contracts

| Contract | Contents |
| --- | --- |
| `IssueDocument` | Schema version, campaign and timeline identity, receiving player, issue ID and cutoff/date, publication title, design/version, ordered pages, and unique items. Each page references item IDs and its selected layout. |
| Article content | Headline and paragraph blocks containing text, emphasis, and typed links. Assets use registered IDs. Keep editorial evidence metadata separate from visible prose. |
| `ReaderAction` | A discriminated action for section selection, vote assignment, opening an article, city, civilization, trade relationship, or supported game screen. Payloads use IDs and explicit target types. |
| `ReaderState` | Active page, scroll position per page, and vote value by item ID. A vote is up, down, or cleared. |
| `RenderProfile` | Fixed browser viewport width/height, publication content-box width in CSS pixels, text-size setting, effective raster scale, and maximum texture dimensions. Record actual image dimensions and padding separately from visible content. |
| `RenderBundle` | Bundle schema version, issue/design/profile identity, renderer version, browser version, section/header assets, content heights, and strip CSS dimensions/offsets. Each action rectangle names its header or page region and uses CSS coordinates relative to that region. File references are cache-relative asset IDs. |

Expose a browser entry point equivalent to `mountReader(root, issue, state, onAction)`, with a readiness promise and disposal method. The headless exporter accepts an issue and profile, waits for layout readiness, and returns a validated render bundle. Both callers use that same entry point.

Use the ownership table for contract locations. Match existing error, logging, configuration, and shutdown conventions during implementation.

## Ordered implementation

### 1. Extract the reader and establish fixture contracts

Complete the contract split and browser moves above. Validate issue references and action payloads structurally in contracts, then validate renderer capabilities and registered assets at the rendering boundary. Build article DOM from structured content so generated text cannot supply scripts, styles, or arbitrary URLs.

Retain the tracked reader CSS, fonts, ornaments, selected art and licenses already extracted from the prototype. Keep only the fonts and images used by the first two designs. Complete the separation between publication rendering and the browser shell that supplies fixture selection, archive stubs, and action inspection.

Retain the existing reader type-check/build scripts using root-installed Vite and TypeScript. The backend's `tsconfig.json` remains Node-oriented. Verify `dist-newspaper` is cleaned before each reader build, the reader stays in the workspace build sequence, and runtime packaging includes only the compiled reader. Retain pinned `playwright-core` as a runtime dependency so production pruning retains it; install dependency changes from the repository root.

Move the existing loopback host to `src/newspaper/export/http.ts` and extract `export/service.ts`. The existing `newspaper` and `newspaper:dist` commands wire the service and fixture delivery through `console.ts`. Retain the shared `web/loopback.ts` request check without importing the dashboard app. Keep startup independent of MCP and strategist sessions; Plan 2 extends this host and command for replay.

### 2. Export pixels and interaction geometry together

Complete and verify the existing worker in `src/newspaper/export/render.ts` and converter wrapper in `export/dds.ts`. Load local built assets and fonts through the loopback host. Keep DOM inspection, font/image readiness, and geometry collection in the browser-compiled entry point; the Node worker invokes its fixed export bridge and receives serializable values. This keeps DOM globals out of the backend's Node-only type check. Disable transitions during export and fix viewport/raster scale for the profile.

Give the interactive and export modes the same explicit publication content width and a stable scrollbar gutter. Bake the paper, margins, ornament, and backgrounds into the header/content images; Lua owns only the surrounding game window. Assert the measured content width and line rectangles agree before exporting. Remove the prototype's dependence on window scrolling so each section owns its scroll position in both modes.

Capture the masthead/tab region separately from each section's complete content. Expand the section's browser scroll container for export without changing the browser viewport, then capture bounded vertical strips at the original layout width. Disable sticky positioning in the export regions. Choose a profile whose rasterized outer width fits the tested maximum texture dimension, and reject unsupported width/scale combinations before capture. Split vertically within the same limit. Pad edge strips if the selected DDS format requires it. Store visible dimensions so padding never becomes extra scrollable space.

Read link rectangles from the DOM after the final layout. Use each inline link's individual rectangles, as described by [getClientRects](https://developer.mozilla.org/en-US/docs/Web/API/Element/getClientRects), so a wrapped link does not make neighboring prose clickable. The map and all images must come from the same settled layout.

Reserve export slots for dynamic vote controls. Export their geometry and small design-specific neutral/selected icons; Lua supplies hover/focus outlines and selected-state indication. The browser uses ordinary DOM controls in those slots. Capture tab labels in a neutral state and show selection through a local underline or outline. Tab states must keep identical label metrics and positions. This avoids rerendering an entire issue after a vote or tab change.

### 3. Add the cache and local export host

Retain `export/cache.ts` and the existing fixture host's export endpoint through the reusable export service. Mount the same reader routes under `/newspaper/` and `/api/newspaper` in the regular web host when integrating it later; those mounts must precede its SPA fallback.

Write completed images and the manifest to a temporary bundle directory, then publish the bundle atomically. Key it by immutable issue content, design assets/version, renderer version, bundle schema version, and profile. Validate schema compatibility when reading. Record the actual browser version for diagnosis. Resolve asset IDs to absolute paths only when presenting a bundle on the current machine.

Cap the disk cache by size and evict the least recently used bundles first. In this proof the viewer has no channel back to the backend, so never evict the bundle most recently exported for the fixture viewer. Cached bundles stay usable after the rendering process exits. Eviction affects presentation only; article text and votes live elsewhere. Plan 5 adds the viewer pin/release handshake once a live transport exists.

### 4. Build the Lua/XML proof viewer

Move the existing newspaper Lua/XML modules into `civ5-mod/UI/Newspaper/`, including `VoxDeorumNewspaperData.lua`, `VoxDeorumNewspaperMock.lua`, and the generated `VoxDeorumNewspaperFixture.lua`. Update `VoxDeorum.modinfo` and includes together. Use the documented runtime XML import convention and verify registration in game. Keep the mock as the final include so live transport can replace it later.

For this proof, the fixture command also emits a generated Lua data file containing the manifest, local resolved paths, structured article blocks, and initial state. The mock includes that file when the mod is loaded; export it before deploying the proof. This requires no runtime JSON/file-reading API in UI Lua. The images are still loaded by absolute path. Keep generated fixture data out of production packaging; Plan 5 replaces delivery with the live transport and save store.

Build header controls and a clipped scrolling content container from the render bundle. Size images and controls from CSS dimensions multiplied by the CSS-to-game-control scale. Raster scale changes image resolution only; never multiply the image's pixel dimensions by UI scale a second time. Put each action overlay once in its page's content coordinate space, independently of the strip containing its pixels, so an action crossing a strip seam remains one action. Clip the whole content tree at the viewport and keep padding outside the hit regions.

Images sit below interactive controls; noninteractive overlays do not intercept input. Verify wheel scrolling over links and votes, forwarding wheel input to the scroll container if native controls consume it. Test raster scales 1 and 2, game UI scaling, seam-crossing links/buttons, clipping, and scroll restoration.

Dispatch typed actions locally. Fixture city and screen targets should use verified Lua APIs; unavailable targets show a brief message. Votes are assigned to item IDs and reflected on every page displaying the same item. Opening a target and returning preserves the page and scroll position.

Follow the HumanPanel's direct show/hide pattern and verify ordinary game popups still work. Check whether connection messages need explicit pumping while this screen is open, using the diplomacy panels as precedent.

### 5. Make missing textures safe

Verify whether the actual UI environment exposes a reliable local file query. The inspected UI code establishes none. The prior experiment's unresolved basename triggered a modal texture error despite Lua error handling; a missing absolute path was not tested. In a controlled manual proof, establish missing, unreadable, and invalid-file behavior before choosing the loader safeguard.

If loading failures cannot be handled safely and no suitable query API exists, add a narrow read-only binding through `CvLuaGame.h`/`.cpp` to verify newspaper cache files before assigning them. Its scope is file availability under the configured cache root, with no rendering or browser logic in the DLL. Follow repository modification comments and the DLL build workflow.

With the renderer disconnected, reopen a cached fixture. Delete a closed fixture's cache and reopen it: display a basic native text view from the fixture's structured article data without attempting the missing path. In Plan 5 that data will come from the game save. Validate generated DDS headers/dimensions before publishing a bundle; the local file check alone cannot prove that arbitrary bytes are loadable textures.

### 6. Measure and package the result

Update installer inclusion/exclusion rules and the converter acquisition step. Pin its version and checksum; retain the license; acquire it during the developer build rather than during issue generation. The source-run workflow must provide the same converter path. Verify the pruned install can resolve `playwright-core`, the converter, and `dist-newspaper`, and contains neither reader source fixtures nor a downloaded browser. Exclude `newspaper` source explicitly from the current recursive installer rule.

Measure incremental installed bytes, compressed installer delta, render latency for cold/warm batches, the browser process tree's peak memory, DDS bytes per issue, and texture/cache growth. The proposed added-install target is 30 MiB. Compare 1280-by-720, 1920-by-1080, and 2560-by-1440 screens with readable text settings. Select supported profile and strip limits from those measurements and document the exact VP build and renderer.

## Verification

- Use Vitest for issue/action validation, shared-item vote state, cache publication, worker shutdown, and browser-unavailable behavior. Exercise actual rendered wrapping and rectangle placement through Playwright from Vitest; avoid tests that pin fixture prose.
- Run the existing `npm run type-check:newspaper -w vox-agents` and `npm run build:newspaper -w vox-agents`; run focused tests under `vox-agents/tests/mock/newspaper/` through the workspace's existing Vitest command. Move the HTTP tests to `export/http.test.ts` and cover the extracted service lifecycle there or in `export/service.test.ts` as appropriate.
- Run `npm run build:all` and `npm run test:all` after build integration. Verify the packaged output with development dependencies omitted in a disposable packaging directory.
- Deploy the mod with `civ5-mod/deploy.bat`. If adding the DLL binding, build/deploy with `powershell -Command "& .\build-and-copy.bat"` from `civ5-dll/` first.
- In game, verify small text, all actions, keyboard dismissal, clipping, resizing, cache reuse, missing cache, and service disconnection. Record visual confirmation separately from successful transport calls.

## Risks and open questions

Text sharpness, DDS encoding, maximum dimensions, and UI scaling are measured decisions. The local file-check API and texture lifetime need implementation proof. Browser updates can alter pixel output, so persistence keeps the saved design and content and regenerates images from them.

The native missing-cache view preserves readability and basic actions. It does not reproduce publication typography. Its final save-backed behavior belongs to Plan 5.

## Out of scope

Real recording queries, story generation, durable votes, production archive browsing, live publication, and save synchronization. Browser text selection or accessibility parity inside VP is not required.
