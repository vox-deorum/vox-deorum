# AGENTS.md - Civ5 Mod Development Guide

This folder is the in-game companion mod "(5) Vox Deorum" for Civilization V. It depends on the Community Patch, (2) Vox Populi, and (3a) VP - EUI Compatibility Files, so all UI work must assume the VP + EUI environment.

## Deployment

**Every time a task is complete, run `deploy.bat`** (from this folder). It:
1. Runs `update_md5.py` to refresh the MD5 hashes in `VoxDeorum.modinfo` (aborts deployment if this fails)
2. Copies the mod into `Documents\My Games\Sid Meier's Civilization 5\MODS\(1b) Vox Deorum`

Never hand-edit the `md5` attributes in the modinfo - `update_md5.py` owns them.

## Folder Layout

- `VoxDeorum.modinfo` - mod manifest: file list with MD5s, database actions, entry points
- `Lua/` - standalone `InGameUIAddin` scripts (no XML context)
- `UI/` - UI contexts: paired `.lua` + `.xml` files, plus shared helper modules
- `Mapscripts/` - map script entry points
- `SQL/`, `XML/` - database updates applied via `OnModActivated`
- `Text/` - localization (`Language_en_US` rows)
- `docs/` - reference docs: [observer-api.md](docs/observer-api.md) (observer API events), [lua-c-debug.md](docs/lua-c-debug.md) (Lua/C debugging)
- `deploy.bat`, `update_md5.py` - deployment tooling (not part of the mod; `.bat` files are excluded from copying)

## Registering Files in VoxDeorum.modinfo

Every shipped file must have a `<File>` entry in `<Files>`:
- `import="1"` for files loaded into the VFS: all Lua (UI contexts, shared modules, mapscripts) and any XML consumed by the engine at runtime (e.g. `LeaderHeadRoot.xml`)
- `import="0"` for database/text content applied via actions

Then wire the file up:
- SQL/XML/Text database files also need an `<UpdateDatabase>` line under `<OnModActivated>`
- New UI screens need an `<EntryPoint type="InGameUIAddin">` pointing at the **XML** file (the XML pulls in its Lua); standalone Lua addins point at the `.lua` directly
- Shared Lua modules (e.g. `VoxDeorumSeat.lua`, `VoxDeorumDealUtils.lua`) are `import="1"` with no entry point - they are included by other contexts

## Lua Conventions

- Indent with tabs
- Start every file with a one-line `--` comment stating its purpose
- Shared modules use the global-table pattern: `VoxDeorumFoo = VoxDeorumFoo or {}` with `PascalCase` public functions (`VoxDeorumSeat.EffectiveSeat()`)
- Locals and private functions are `camelCase`; module-level mutable state uses the `m_` prefix (`m_mockPending`); constants are `UPPER_SNAKE_CASE`
- Write a one-line `--` intent comment above each function ("Return whether...", "Build a...")
- Guard engine bindings defensively: nil/type-check API functions and wrap risky calls in `pcall` (see `VoxDeorumDealUtils.DefaultDealDuration`)
- Be observer-aware: use `VoxDeorumSeat.EffectiveSeat()` / `VoxDeorumSeat.IsPureObserver()` instead of assuming `Game.GetActivePlayer()` is a playing civ

### API Usage

**Always check `civ5-dll/CvGameCoreDLL_Expansion2/Lua/`** (CvLuaGame, CvLuaPlayer, CvLuaUnit, CvLuaCity, ...) for the actual exposed Civ5 Lua APIs. **Never invent non-existent APIs.**

### Mock Drivers

`UI/VoxDeorum*Mock.lua` files are stage-scoped mock drivers that exercise a screen (via FireTuner scenarios / fake delayed results) before the real backend replaces them. Keep the mock as the final include of its screen so a later stage can swap only that file.

## UI XML Conventions

- Header comment block explaining what the context owns and how it interacts with native/EUI UI
- Inline comments for non-obvious layout decisions (anchoring, stack growth, why a native element is overridden)
- Use EUI-consistent fonts/styles (`TwCenMT*`, `Beige` color sets, `DC45_*.dds` icon textures for corner-style buttons)
- User-facing strings reference `TXT_KEY_VD_*` tags rather than hardcoded English (mock/dev-only strings excepted)

## Localization

- All text keys use the `TXT_KEY_VD_` prefix
- Add rows to `Text/VoxDeorum_Text.xml` under `Language_en_US`; comment groups of related keys with where/how they appear
- Keep player-facing text in plain language - no internal identifiers or jargon
