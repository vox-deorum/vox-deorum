# Plan 1: shared renderer and game proof

**Status: draft.** For developers building the first stage of the [implementation roadmap](../implementation.md). This plan uses fixture content and establishes the rendering foundation for both readers.

## Goal and success criteria

Render the same issue in a browser and in VP using one HTML/CSS implementation. Demonstrate two section tabs, a long scrollable section, a link that wraps across lines, article links, and reversible votes. The game viewer must remain responsive while the renderer is stopped.

Use a Victorian layout and a modern feed to exercise different compositions. Test ordinary, breaking, and analysis arrangements with fixture data. A fixture vote changes local reader state only; durable feedback arrives in Plan 3.

## Current state

| Existing source | Reuse or constraint |
| --- | --- |
| `docs/plans/newspaper/prototypes/html/reader.js`, `reader.css`, `fonts.css` | Shared layout and interaction examples; currently coupled to global DOM IDs, fixture content, and local storage. Assets are gitignored. |
| `vox-agents/package.json`, `tsconfig.json` | Backend build uses a Node-oriented TS configuration. The browser reader needs its own DOM-aware type check and Vite build. |
| `vox-agents/src/web/server.ts` | Existing Express host, loopback request check, and Vue fallback route. The request check is private to this module, which builds the dashboard app when imported. Reader static and API routes must precede the fallback. |
| `vox-agents/src/strategist/console.ts` and similar | Console entry points live in their component folder, with matching `<name>` and `<name>:dist` scripts in `vox-agents/package.json`. |
| `scripts/utilities/build-installer.cmd`, `scripts/installer.iss` | Production dependency pruning already exists. Add the compiled reader and converter; exclude reader source and fixture-only assets. |
| `civ5-mod/UI/VoxDeorumHumanPanel.lua` and `.xml` | `queueDialog`, `releaseDialog`, repeated instances, native scroll panels, and button callbacks. |
| `civ5-mod/UI/VoxDeorumDiploTransport.lua` | Asynchronous broadcast/register-function pattern, replies and timeouts. |
| [Runtime texture findings](../../../developers/civ5-mod/runtime-texture-experiment.md) | Absolute DDS paths and unload/set work in the tested DX11 session. Larger images and missing-file handling are unverified. |

## Approach

Place the plain browser implementation in the proposed `vox-agents/newspaper/` directory. Build it to `vox-agents/dist-newspaper/`. Keep data contracts and backend rendering code in `vox-agents/src/newspaper/`; shared types must have neither Node runtime imports nor DOM types.

Use installed Edge through `playwright-core`, with installed Chrome as a fallback. An explicit executable override can support nonstandard installations. Start one isolated browser worker for a render batch and close it after a short idle period or process shutdown. Browser absence disables new texture export with a clear status. Installation and ordinary startup must never download a browser.

Use a pinned Windows `texconv` binary and include its license. Begin conversion experiments with the demonstrated DXT1 format and compare a legacy-header uncompressed 32-bit format for small text. Select the format from game results. A custom DDS encoder would add maintenance before its benefit has been measured.

HTML/CSS preserves the existing typography and gives the offline reader the same layout engine as the exporter. A custom canvas renderer would require manual text layout and hit testing. Browser-subset renderers introduce another layout engine and compatibility work. The installed-browser route keeps one implementation while avoiding a bundled browser.

## Contracts

| Proposed type | Contents |
| --- | --- |
| `IssueDocument` | Schema version, campaign and timeline identity, receiving player, issue ID and cutoff/date, publication title, design/version, ordered pages, and unique items. Each page references item IDs and its selected layout. |
| Article content | Headline and paragraph blocks containing text, emphasis, and typed links. Assets use registered IDs. Keep editorial evidence metadata separate from visible prose. |
| `ReaderAction` | A discriminated action for section selection, vote assignment, opening an article, city, civilization, trade relationship, or supported game screen. Payloads use IDs and explicit target types. |
| `ReaderState` | Active page, scroll position per page, and vote value by item ID. A vote is up, down, or cleared. |
| `RenderProfile` | Fixed browser viewport width/height, publication content-box width in CSS pixels, text-size setting, effective raster scale, and maximum texture dimensions. Record actual image dimensions and padding separately from visible content. |
| `RenderBundle` | Bundle schema version, issue/design/profile identity, renderer version, browser version, section/header assets, content heights, and strip CSS dimensions/offsets. Each action rectangle names its header or page region and uses CSS coordinates relative to that region. File references are cache-relative asset IDs. |

Expose a browser entry point equivalent to `mountReader(root, issue, state, onAction)`, with a readiness promise and disposal method. The headless exporter accepts an issue and profile, waits for layout readiness, and returns a validated render bundle. Both callers use that same entry point.

All new paths and API names in this plan are proposed. Match existing error, logging, configuration, and shutdown conventions during implementation.

## Ordered implementation

### 1. Extract the reader and establish fixture contracts

Add `types.ts` and runtime validation in `src/newspaper/`. Validate issue references, action payloads, and registered assets at the boundary. Build article DOM from structured content so generated text cannot supply scripts, styles, or arbitrary URLs.

Move the required prototype CSS, fonts, ornaments, and selected art into tracked reader assets, preserving licenses. Keep only the fonts and images used by the first two designs. Separate publication rendering from a small browser host that supplies fixture selection, archive stubs, and action inspection.

Add reader type-check/build scripts to `vox-agents/package.json`, using root-installed Vite and TypeScript. The backend's existing `tsconfig.json` remains Node-oriented. Clean `dist-newspaper` before each reader build, chain that build into the workspace build sequence, and package only the compiled reader at runtime. Add a pinned `playwright-core` runtime dependency from the repository root so production pruning retains it.

Create the minimal loopback static host in `src/newspaper/host/http.ts` here, before export work. A fixture command in `src/newspaper/console.ts`, run through new `newspaper` and `newspaper:dist` scripts, starts it and handles shutdown. Keep it independent of normal web-server startup, MCP, and strategist sessions. Move the loopback request check from `web/server.ts` into a small shared module so both hosts use it without importing the dashboard app. Later plans extend the same host and command for replay.

### 2. Export pixels and interaction geometry together

Implement the worker in `src/newspaper/renderer/render.ts` and the converter wrapper in `src/newspaper/renderer/dds.ts`. Load local built assets and fonts through the loopback host. Keep DOM inspection, font/image readiness, and geometry collection in the browser-compiled entry point; the Node worker invokes its fixed export bridge and receives serializable values. This keeps DOM globals out of the backend's Node-only type check. Disable transitions during export and fix viewport/raster scale for the profile.

Give the interactive and export modes the same explicit publication content width and a stable scrollbar gutter. Bake the paper, margins, ornament, and backgrounds into the header/content images; Lua owns only the surrounding game window. Assert the measured content width and line rectangles agree before exporting. Remove the prototype's dependence on window scrolling so each section owns its scroll position in both modes.

Capture the masthead/tab region separately from each section's complete content. Expand the section's browser scroll container for export without changing the browser viewport, then capture bounded vertical strips at the original layout width. Disable sticky positioning in the export regions. Choose a profile whose rasterized outer width fits the tested maximum texture dimension, and reject unsupported width/scale combinations before capture. Split vertically within the same limit. Pad edge strips if the selected DDS format requires it. Store visible dimensions so padding never becomes extra scrollable space.

Read link rectangles from the DOM after the final layout. Use each inline link's individual rectangles, as described by [getClientRects](https://developer.mozilla.org/en-US/docs/Web/API/Element/getClientRects), so a wrapped link does not make neighboring prose clickable. The map and all images must come from the same settled layout.

Reserve export slots for dynamic vote controls. Export their geometry and small design-specific neutral/selected icons; Lua supplies hover/focus outlines and selected-state indication. The browser uses ordinary DOM controls in those slots. Capture tab labels in a neutral state and show selection through a local underline or outline. Tab states must keep identical label metrics and positions. This avoids rerendering an entire issue after a vote or tab change.

### 3. Add the cache and local export host

Add `cache.ts` and extend the existing fixture host with the export endpoint. Mount the same reader routes under `/newspaper/` and `/api/newspaper` in the regular web host when integrating it later; those mounts must precede its SPA fallback.

Write completed images and the manifest to a temporary bundle directory, then publish the bundle atomically. Key it by immutable issue content, design assets/version, renderer version, bundle schema version, and profile. Validate schema compatibility when reading. Record the actual browser version for diagnosis. Resolve asset IDs to absolute paths only when presenting a bundle on the current machine.

Cap the disk cache by size and evict the least recently used bundles first. In this proof the viewer has no channel back to the backend, so never evict the bundle most recently exported for the fixture viewer. Cached bundles stay usable after the rendering process exits. Eviction affects presentation only; article text and votes live elsewhere. Plan 5 adds the viewer pin/release handshake once a live transport exists.

### 4. Build the Lua/XML proof viewer

Add proposed `UI/VoxDeorumNewspaper.lua`, `.xml`, and a stage-scoped `VoxDeorumNewspaperMock.lua`, registered through `VoxDeorum.modinfo`. Use the documented runtime XML import convention and verify registration in game. Keep the mock as the final include so live transport can replace it later.

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
- Add and run `npm run type-check:newspaper -w vox-agents` and `npm run build:newspaper -w vox-agents`; run the focused newspaper tests through the workspace's existing Vitest command.
- Run `npm run build:all` and `npm run test:all` after build integration. Verify the packaged output with development dependencies omitted in a disposable packaging directory.
- Deploy the mod with `civ5-mod/deploy.bat`. If adding the DLL binding, build/deploy with `powershell -Command "& .\build-and-copy.bat"` from `civ5-dll/` first.
- In game, verify small text, all actions, keyboard dismissal, clipping, resizing, cache reuse, missing cache, and service disconnection. Record visual confirmation separately from successful transport calls.

## Risks and open questions

Text sharpness, DDS encoding, maximum dimensions, and UI scaling are measured decisions. The local file-check API and texture lifetime need implementation proof. Browser updates can alter pixel output, so persistence keeps the saved design and content and regenerates images from them.

The native missing-cache view preserves readability and basic actions. It does not reproduce publication typography. Its final save-backed behavior belongs to Plan 5.

## Out of scope

Real recording queries, story generation, durable votes, production archive browsing, live publication, and save synchronization. Browser text selection or accessibility parity inside VP is not required.
