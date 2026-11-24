# Newspaper reader and renderer

The reader lays out a completed issue for the browser and captures that layout as textures for Civilization V. Open `/newspaper/` on the Vox Deorum server or [start the source preview](replay.md#open-a-recording-in-the-browser-reader) to read a sample. Both viewers use scrollable pages with tabs, links, and votes.

## Show an issue in the game

1. Load Civilization V with the current Vox Deorum mod and an active civilization seat. A pure observer needs a seat override to receive a newspaper.
2. In a source checkout, build the reader with `npm run build:newspaper -w vox-agents` and acquire DirectXTex with `npm run acquire:texconv -w vox-agents`. A fresh capture uses installed Microsoft Edge or Chrome, in that order.
3. On the Vox Deorum **Debug** page, choose **Show newspaper**. It exports the packaged Victorian sample for the current seat and reports success once the game acknowledges opening it.

Scroll to the masthead to switch sections. **Close** or resizing returns from article detail to the paper. Reopen the last delivery with `LuaEvents.VoxDeorumNewspaperOpen` in FireTuner. The game preserves the reader's section, scroll position, and votes and can reopen a delivery without the renderer.

The Lua reader in `civ5-mod/UI/Newspaper/` uses `Game.IsNewspaperTextureAvailable` to validate DDS textures and can fall back to native text and controls. A missing section tab falls back to a native masthead and tabs while keeping available article textures. If the seat or window changes during export, choose **Show newspaper** again. For an invalid view, update the mod and reload the game. Delivery and acknowledgement are handled in `src/newspaper/game-delivery.ts`.

## Supply a completed issue

See `newspaper/fixtures/` for completed issues. Keep each article ID on exactly one page. Use typed inline nodes for links, such as a city, a game screen, or an earlier article. The issue saves the renderer family and any overrides for color, type, and ornament so reopening uses the same appearance. The family fills in omitted values, and `renderer/validation.ts` checks asset roles.

| Contract | Purpose |
| --- | --- |
| `IssueDocument` | Receiver, cutoff, ordered pages, typed articles, and presentation; see `contracts/issue.ts` |
| `ReaderState` | Section, scroll positions, and votes saved by the host; see `contracts/reader.ts` |
| `RenderProfile` | Paper and viewport dimensions, display and raster scales, and texture limits; see `contracts/render.ts` |
| `RenderBundle` | Export manifest with strip sizes, offsets, and action rectangles; see `contracts/render.ts` |

## Layout and export

The paper fits its host up to 1200 CSS pixels, including margins and the scrollbar gutter. The shared width and margin rules live in `renderer/layout.ts`. At narrower widths the stories stack; most [designs](designs.md#rendering-constraints) pair briefs above 760 CSS pixels while keeping each story in one column.

For the game, `displayScale` converts between CSS and physical pixels. Raster scale controls texture resolution (default 2, with a 4096 by 2048 pixel texture limit). The game uses uncompressed BGRA; the exporter also supports BC1. When only the viewport height changes, the export can be reused because it captures the full section at a fixed capture viewport height.

The browser reader and exporter both call `mountReader` in `newspaper/src/reader/`. Once fonts and images are ready, export captures the masthead and tabs separately from the page strips and measures action rectangles from the same layout. Each line of a wrapped link gets its own rectangle, and an action can cross a strip boundary. See [designs](designs.md#add-or-change-a-design) to change the shared appearance.

## Service and cache

The loopback endpoint `POST /api/newspaper/export` accepts an issue document and returns its cache key and bundle. **Show newspaper** adds delivery and waits for the game to acknowledge it. `export/service.ts` serializes capture and delivery and finishes accepted work during shutdown. It reaches the DOM through `newspaper/src/export-bridge.ts`.

The default cache is `vox-agents/data/newspaper-cache/`. Keys depend on the saved issue, reader build and assets, render profile, texture format, and schema and renderer versions. A valid hit can skip the browser. The cache evicts least recently used bundles toward a target of 256 MiB and protects the last acknowledged game delivery across restarts.

`npm run build:newspaper -w vox-agents` type-checks and rebuilds `dist-newspaper`, including the Victorian `sample.json`. The installer ships the reader, runtime catalogue, sample, and converter. Export uses the browser already installed on the system.

## Run the tests

From a fresh checkout, build MCP first with `npm run build -w mcp-server`. Run focused in-process checks from the repository root with `npm test -w vox-agents -- tests/mock/newspaper`. To check browser types separately, run `npm run type-check:newspaper -w vox-agents`.

For browser layout, replay controls, and export checks:

```sh
npm run build:newspaper -w vox-agents
npm run test:newspaper:browser -w vox-agents
```

These tests need installed Edge or Chrome. For DDS cases, also run `npm run acquire:texconv -w vox-agents`. Cases skip when a required dependency is missing. For broader checks, run `npm run build:all` and `npm run test:all`.

Use [Plan 1's game checks](../../../plans/newspaper/implementation/01-renderer.md) to verify layout, link alignment, votes, and reading state in Civilization V. Try different resolutions and UI scales, and include issues with varied story lengths. A delivery acknowledgement confirms that the reader opened; inspect appearance and interaction in the game.
