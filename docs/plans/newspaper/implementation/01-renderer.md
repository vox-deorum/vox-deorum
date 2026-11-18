# Plan 1: shared renderer and game proof

**Status: demo accepted in game; broader acceptance awaits real issues.** The demo works in Civilization V, including links, scrolling, and the general newspaper UI. The [renderer developer guide](../../../developers/vox-agents/newspaper/renderer.md) owns the implemented contracts, delivery workflow, profiles, cache behavior, packaging, measurements, and accepted behavior.

Continue with [Plan 3: heuristic newspaper](03-heuristic-editor.md) to turn [Plan 2's recorded evidence](02-replay.md) into issues. Use that content for the remaining reader checks below. The working demo supports proceeding with editorial implementation.

## Completion gate

Complete this stage when generated issues have readable text and correct interaction at representative sizes, cached reading and native fallback work through service or cache loss, and installation/runtime costs are measured. The accepted demo establishes the basic in-game reader; the checks below extend that coverage.

## Delivery controls for further acceptance

Extend the existing VD delivery pathway with developer selection of an issue, render profile, and DDS format. The current Debug action delivers the packaged sample. Plan 3 supplies generated issues; this stage owns the controls needed to deliver them for game testing. Reuse the existing preparation, export queue, and acknowledged game delivery.

## Acceptance with real issues

Use those controls to deliver generated issues. Record the VP build, DLL revision, DX renderer, resolution, UI scaling, render profile, and DDS format with the observations. Record visual confirmation separately from delivery acknowledgements.

1. Check actual domestic, trade, and foreign stories, long names, variable article lengths, evidence tables, and continuing coverage. Verify city and screen links against the loaded game and confirm unavailable targets produce a brief message.
2. Compare the supported layouts at 1280 by 720, 1920 by 1080, and 2560 by 1440, with representative paper widths and zoom levels. Check small text, clipping, header/content alignment, and matching click targets for wrapped links. An action crossing a strip seam must remain one action. Compare raster scales 1 and 2, and choose BC1 or uncompressed BGRA for supported profiles from the game results.
3. Check section changes, shared votes and clearing votes, article detail and return, and preservation of the active page and reading positions. Exercise wheel scrolling over links and votes with long issues.
4. Check Escape, resizing, and ordinary game popups. Determine whether connection messages need explicit pumping while the reader is open.
5. Reopen a cached issue with VD stopped, then test native text and basic actions after removing that closed issue's cache. The fallback must work without a modal texture error. Exercise missing, unreadable, and invalid DDS files through the loader safeguard.
6. Reopen repeatedly and check texture/cache growth, image-control release on close, and retention of the delivered bundle across backend restarts and cache eviction.

Fold verified behavior and supported limits into the renderer guide, then remove the corresponding checks here.

## Remaining installation measurement

The renderer guide records production-pruned runtime exports, installer file selection, payload size, export latency, sampled browser memory, and DDS sizes. Build comparable full installers with and without the newspaper payload to measure the compressed installer delta with the same packaging settings. Refresh measurements when supported designs or assets change, checking the roadmap's proposed 30 MiB installed-payload budget.

## Verification after implementation changes

Use focused Vitest checks under `vox-agents/tests/mock/newspaper/`, including browser layout/export checks with an installed browser and acquired converter. Run `npm run type-check:newspaper -w vox-agents`, `npm run build:newspaper -w vox-agents`, `npm run build:all`, and `npm run test:all` after implementation changes. Deploy mod edits using `civ5-mod/deploy.bat`; use the documented DLL build-and-copy workflow when DLL changes are needed.

See the [roadmap](../implementation.md) for editorial selection, durable feedback, archives, and live publication.
