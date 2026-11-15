# Plan 1: shared renderer and game proof

**Status: default proof implemented; acceptance controls and game proofs remain.** This stage of the [implementation roadmap](../implementation.md) uses fixture content to establish one publication renderer for the browser and game readers. Implemented contracts, folder ownership, commands, cache behavior, packaging, and local measurements are folded into the [renderer developer guide](../../../developers/vox-agents/newspaper/renderer.md). Keep that guide current under the roadmap's folding rule.

## Completion gate

Accept the same issue in the browser and VP with readable text, matching links, responsive scrolling, section tabs, and reversible votes. The game reader must remain usable with the renderer stopped and fall back to structured native text when its textures are unavailable.

The automated checks and local export measurements establish the rendering implementation. They do not establish visual correctness in Civ V. Keep this stage open until the following proofs are recorded.

## Remaining game acceptance

Load a game with the updated mod, start VD normally, and use Debug > Show newspaper for the Victorian ordinary sample at the default profile and BC1 format. Later clicks need no FireTuner command or mod reload. This pathway can check scrolling, actions, reopening, and receiver changes for that sample. The existing texture-check DLL is required for images; if the installed DLL needs updating, close Civilization V and use the documented DLL build-and-copy workflow. Record the exact VP build, DLL revision, DX renderer, screen resolution, UI scaling, render profile, and DDS format with the observations.

Before completing the wider comparison matrix below, add developer fixture, render-profile, and DDS-format selection to the existing VD delivery pathway. That selection tooling remains pending. Reuse its preparation, queued delivery, and acknowledgement rather than introducing another server. The default Debug button does not provide these choices yet.

1. Compare Victorian ordinary, breaking and analysis layouts and the modern feed at 1280 by 720, 1920 by 1080, and 2560 by 1440. Compare raster scales 1 and 2 and readable text settings. Confirm small-text sharpness and choose BC1 or uncompressed BGRA from the game results.
2. Verify registration from `UI/Newspaper/`, header and content alignment, clipped scrolling, strip seams, wheel scrolling over links and votes, and matching click targets for wrapped links. An action crossing a strip seam must remain one action.
3. Switch tabs, vote and clear votes on shared items, follow supported city and screen links, open an article, and return. Confirm the active page, scroll positions and shared vote indications survive. Verify unavailable targets show a brief message.
4. Check Escape, resizing and ordinary game popups. Determine whether connection messages need explicit pumping while the reader is open.
5. Close the reader, stop the VD backend, then reopen its cached issue. Delete only that closed fixture's cache bundle and reopen it. Confirm native text and basic actions work without a modal texture error. Use controlled missing, unreadable and invalid DDS fixtures to verify the loader safeguard; never assign an unchecked path to a texture control.
6. Reopen repeatedly and compare texture/cache growth. Confirm closing releases image controls and that the fixture pin preserves the delivered bundle across backend restarts and cache eviction.

Record visual confirmation separately from successful transport calls. Fold accepted profile and strip limits, the chosen format, and any resulting implementation changes into the renderer guide.

## Remaining installation measurement

The renderer guide records production-pruned runtime exports, installer file-selection checks, a payload below the proposed 30 MiB budget, cold/warm/cache latency, sampled browser memory, DDS sizes, and a compression probe. The compressed delta is an estimate. Build comparable full installers with and without the newspaper payload to measure the actual compressed installer delta, retaining the same packaging settings. Refresh the measurements if the supported designs or assets change.

## Verification after acceptance fixes

Use focused Vitest checks under `vox-agents/tests/mock/newspaper/`, including real browser layout/export checks with an installed browser and acquired converter. Run `npm run type-check:newspaper -w vox-agents`, `npm run build:newspaper -w vox-agents`, `npm run build:all`, and `npm run test:all` after implementation changes. Deploy mod edits using `civ5-mod/deploy.bat`.

Replay, editorial selection, durable feedback, archives, live publication, and save synchronization remain in Plans 2 to 5.
