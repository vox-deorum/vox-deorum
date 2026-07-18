# civ5-mod — Overview

The `civ5-mod` is the Civilization V mod layer that sits directly on top of the [civ5-dll](../civ5-dll/). The DLL is the C++ gamecore that *can* talk to the outside world; the mod is the thin Lua/SQL/XML package that *switches that capability on* and rides along inside the running game.

The mod contains no C++ of its own. It is an ordinary Civ V mod that the game's mod system loads, and everything it does is database edits, a map script, and a small in-game Lua addin.

It is published as **"(5) Vox Deorum"**, a companion mod to the broader Vox Deorum project. It declares a hard dependency on **Community Patch**: the modified gamecore must already be in place for any of this to mean anything. The mod's definition lives in `VoxDeorum.modinfo` — read that file first. It names every file the mod ships, what runs on activation, and the two entry points the game hooks into.

## What the mod adds

The mod's job is small but pivotal. Four things travel in the package.

**It turns on the DLL's outside channel.** On activation the mod runs `SQL/VoxDeorum_Options.sql`, which flips a set of the gamecore's `CustomModOptions`. It enables `IPC_CHANNEL` (the connection service's named-pipe link to the Bridge Service) and the whole `EVENTS_*` family (the game-event stream the DLL forwards out). The modified DLL ships with these dormant, so **without the mod loaded, the connection service has nothing to do.** Installing and enabling this mod is what wakes the DLL's external channel for a session. The same script also registers a new `FLAVOR_MOBILIZATION` flavor used by the AI-steering work downstream.

**A map script for reproducible research maps.** `Mapscripts/Vox_Deorum.lua` is a tuned copy of the community **Communitu_79a** map script (a Communitas-lineage generator), with its parameters fixed for Vox Deorum studies so experiments run on consistent terrain. It is registered as the mod's `MapScript` entry point.

**An in-game observer/render addin.** `Lua/VoxDeorumTest.lua` is registered as an `InGameUIAddin` and loads into the running game's UI context. It is the bridge between in-game Lua events and the rest of the stack: it listens for the strategic-decision events the system pushes into the game, and forwards render-time UI events back out. The [lua-hooks](lua-hooks.md) page walks through exactly what it listens to and emits.

**Text and diplomacy strings.** `Text/VoxDeorum_Text.sql` and `Text/VoxDeorum_Text.xml` add localized strings — currently a set of diplomacy "opinion" phrases — that the rest of the system can surface in-game.

## How it loads

Loading follows the standard Civ V mod lifecycle, declared entirely in `VoxDeorum.modinfo`:

1. The player enables **"(5) Vox Deorum"** in the game's MODS menu. Because Community Patch is listed as a dependency, the gamecore DLL is already the modified one by the time this mod activates.
2. On activation, the mod's `OnModActivated` actions run the three database scripts (`VoxDeorum_Options.sql`, `VoxDeorum_Text.xml`, `VoxDeorum_Text.sql`) via `UpdateDatabase`. This is the moment the `IPC_CHANNEL` and `EVENTS_*` options get set, so the connection service comes alive when the game starts.
3. At game start the two entry points take effect: the map script generates the world, and the `InGameUIAddin` loads its listeners into the UI runtime.

The mod is marked as affecting saved games and supports single-player, multiplayer, and hot-seat. Each shipped file carries an MD5 in the `.modinfo`. After edits, `update_md5.py` recomputes those hashes so the manifest stays valid, and `deploy.bat` copies the whole mod into the local Civilization V `MODS` directory for testing.

## Where to start reading

- **`VoxDeorum.modinfo`** — the manifest: dependency, files, activation actions, and the two entry points. Start here.
- **`SQL/VoxDeorum_Options.sql`** — the few lines that arm the DLL's channel and event stream.
- **[lua-hooks.md](lua-hooks.md)** — what the in-game addin listens for and forwards, and the round trip between agents and in-game Lua.
- **[ui.md](ui.md)** — what all this looks like from inside the game: replay messages, the active-player panel, and the observer event stream that UI mods tap.
