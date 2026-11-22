# Newspaper reader and renderer

Open `/newspaper/` on the normal Vox Deorum server to read a sample in the browser. For a source checkout, see [how to start the preview](replay.md#open-a-recording-in-the-browser-reader) and switch between mockups and recorded editions. The masthead, tabs, and articles scroll together in the browser and in the game. Both use the same layout, with clickable links, tabs, and votes.

## Show an issue in the game

1. Load Civilization V with the current Vox Deorum mod and an active civilization seat. A pure observer needs a seat override to receive a newspaper.
2. In a source checkout, build the reader with `npm run build:newspaper -w vox-agents` and acquire DirectXTex with `npm run acquire:texconv -w vox-agents`. Installed builds include both. A fresh capture uses installed Microsoft Edge or Chrome, in that order.
3. On the Vox Deorum **Debug** page, choose **Show newspaper**. It exports the packaged Victorian sample for the current seat and reports success once the game acknowledges opening it.

Scroll back to the masthead to switch sections. **Close** returns from article detail before closing the paper. Resizing also returns from detail to the publication. Reopening the issue preserves its section, scroll position, and votes. In FireTuner, `LuaEvents.VoxDeorumNewspaperOpen` reopens the last delivered issue.

The game uses the DLL binding `Game.IsNewspaperTextureAvailable` to check each texture's path, dimensions, and DDS data. With an older DLL or a missing or invalid texture, the reader can show native article text and controls. If the masthead is missing a section tab, the reader shows a native title and complete tab list while keeping available article textures. An issue already delivered can be reopened without a connected renderer.

If delivery reports an invalid view, update the mod and reload the game. If the seat or window changed during export, export again for the current view. `src/newspaper/game-delivery.ts` owns the request and acknowledgement; the Lua reader lives in `civ5-mod/UI/Newspaper/`.

## Supply a completed issue

`IssueDocument` in `src/newspaper/contracts/issue.ts` holds the receiver, cutoff, publication, ordered pages, and articles. Each article ID appears exactly once in the pages. Prose uses typed inline nodes; link targets can identify cities, civilizations, trade relationships, supported game screens, or earlier articles. Articles can also carry images, avatars, and evidence tables. Look in `newspaper/fixtures/` for complete input examples.

The issue saves a presentation snapshot with its renderer family and optional colors, font assets, and ornament. For example, `oral-accounts` uses the inscription family with its own typography. The family supplies defaults for omitted values. Reopening an issue uses the saved presentation. `contracts/design.ts` defines the snapshot; `renderer/validation.ts` checks that assets are registered for their roles.

| Contract | Purpose |
| --- | --- |
| `IssueDocument` | Saved publication, its presentation, and its typed content |
| `ReaderState` | Section, scroll positions, and votes saved by the host; see `contracts/reader.ts` |
| `RenderProfile` | Paper and viewport dimensions, display and raster scales, and texture limits; see `contracts/render.ts` |
| `RenderBundle` | Export manifest with strip sizes, offsets, and action rectangles; see `contracts/render.ts` |

## Layout and export

The browser fits the paper to its host, up to 1200 CSS pixels wide. `paperWidth` includes the margins and scrollbar gutter. At widths through 480 pixels, margins are 16 pixels per side; through 760 they are 24. Wider papers use the family defaults in `renderer/layout.ts`: 32 for inscription and feed, 40 for folio, and 48 for broadsheet.

Every story reads in one column. On narrow pages the stories stack in publication order. Above 760 pixels, [historical designs](designs.md#rendering-constraints) give the lead a full row and place the briefs two across. The feed keeps a single stream.

For the game, export fits the paper width to the available physical width at the requested zoom, with the same 1200 CSS-pixel cap. `displayScale` controls how the game places strips and actions; raster scale controls texture resolution. Defaults are raster scale 2 and a 4096 by 2048 pixel texture limit. The runtime uses uncompressed BGRA; the exporter also supports BC1. A height change alone can reuse the same export because the reader captures the full section at a fixed capture viewport height.

The reader and exporter use `mountReader` and the styles in `newspaper/src/reader/`. Export waits for fonts, images, and layout, then captures the masthead and tabs separately from the bounded vertical page strips. The bundle records visible dimensions separately from padding and pairs the textures with action rectangles measured from the same layout. A wrapped link has a rectangle for each line, and an action can cross a strip boundary.

To change an existing design's colors, fonts, or assets, edit its JSON under `newspaper/designs/`. A new renderer family also needs an entry in the presentation schema, shared layout defaults, vote icons under `newspaper/public/assets/families/`, and a stylesheet scoped to its `data-design` value and imported before export overrides.

## Service and cache

The normal server serves the reader and `POST /api/newspaper/export` on loopback through `export/http.ts`. A generic export accepts an issue document and returns its cache entry, including the key, directory, and bundle. The Debug action uses the same service and adds game delivery. `export/service.ts` serializes capture and delivery and drains accepted work during shutdown. DOM code stays in `newspaper/src/`; the Node exporter uses the browser bridge at `newspaper/src/export-bridge.ts`.

The default cache is `vox-agents/data/newspaper-cache/`. Keys include the saved issue and presentation, compiled reader and assets, profile, texture format, and schema and renderer versions. A validated cache hit does not start a browser. The cache targets 256 MiB, evicts least recently used bundles, and retains the last acknowledged game delivery across restarts. Generic exports leave that pin in place.

`npm run build:newspaper -w vox-agents` type-checks and recreates `dist-newspaper`, then copies the packaged Victorian fixture to `sample.json`. The normal workspace build includes this step. The installer ships the compiled reader and backend, runtime catalogue, sample, and licensed converter. Export uses the browser already installed on the system.

## Run the tests

From a fresh checkout, build MCP first with `npm run build -w mcp-server`. Run focused in-process checks from the repository root with `npm test -w vox-agents -- tests/mock/newspaper`. To check browser types separately, run `npm run type-check:newspaper -w vox-agents`.

For browser layout, replay controls, and export checks:

```sh
npm run build:newspaper -w vox-agents
npm run test:newspaper:browser -w vox-agents
```

These tests need installed Edge or Chrome. For DDS cases, also run `npm run acquire:texconv -w vox-agents`. Cases skip when a required dependency is missing. For broader checks, run `npm run build:all` and `npm run test:all`.

Use [Plan 1's game checks](../../../plans/newspaper/implementation/01-renderer.md) to verify layout, link alignment, votes, and reading state in Civilization V. Try different resolutions and UI scales, and include issues with varied story lengths. A delivery acknowledgement confirms that the reader opened; inspect appearance and interaction in the game.
