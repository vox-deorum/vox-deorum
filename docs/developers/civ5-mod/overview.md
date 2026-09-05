# civ5-mod: Overview

`civ5-mod` is the Civilization V mod layer that sits directly on top of the [civ5-dll](../civ5-dll/). The DLL is the C++ gamecore that _can_ talk to the outside world; the mod is the Lua, SQL, and XML package that _switches that capability on_ and provides the in-game surfaces a player interacts with.

The mod contains no C++ of its own. It is an ordinary Civ V mod that the game's mod system loads: database edits, a map script, and a set of in-game UI contexts.

It is published as **"(5) Vox Deorum"** and declares three mod dependencies, all of which must already be active:

- **Community Patch**, since the modified gamecore has to be in place for any of this to mean anything.
- **(2) Vox Populi**.
- **(3a) VP - EUI Compatibility Files**. The EUI dependency is load-bearing, not cosmetic: the seat-resolution work described in [ui.md](ui.md) lives partly in files that ship with EUI.

`VoxDeorum.modinfo` is the manifest and the first file to read. It names every shipped file, the database scripts that run on activation, and the six entry points the game hooks into.

## What the mod adds

**It turns on the DLL's outside channel.** `SQL/VoxDeorum_Options.sql` flips a set of the gamecore's `CustomModOptions`: `IPC_CHANNEL` (the connection service's named-pipe link to the Bridge Service) and the whole `EVENTS_*` family (the game-event stream the DLL forwards out). The modified DLL ships with these dormant, so **without the mod loaded, the connection service has nothing to do.** The same script registers a `FLAVOR_MOBILIZATION` flavor used by the AI-steering work downstream.

**A map script for reproducible research maps.** `Mapscripts/Vox_Deorum.lua` is a tuned copy of the community **Communitu_79a** map script (a Communitas-lineage generator), with its parameters fixed for Vox Deorum studies so experiments run on consistent terrain. It is the mod's `MapScript` entry point.

**An observer addin.** `Lua/VoxDeorumTest.lua` loads into the running game's UI context. It subscribes to the strategic-decision events the system pushes into the game and forwards render-time UI events back out. The [Lua hooks](lua-hooks.md) page walks through what it listens to and emits.

**The human-control surface.** `UI/VoxDeorumHumanPanel` and `UI/VoxDeorumHumanTrigger` (each a paired `.lua` and `.xml`) let a human play the strategist role: the trigger is a small always-available widget, and the panel renders the choices a decision request carries. See the [human-control plans](../../plans/human-control/).

**The interactive diplomacy surface.** `UI/VoxDeorumDiploPanel` is the conversation panel and `UI/VoxDeorumDealScreen` is the trade editor, each with its own transport module, mock driver, and XML. `UI/VoxDeorumConverse.lua` and the `UI/LeaderHeadRoot` override add the Converse button that opens the conversation from the leader screen. See [diplomacy-panel.md](diplomacy-panel.md) and [deal-screen.md](deal-screen.md), and [diplomacy.md](../diplomacy.md) for the round trip across the whole stack.

**Text and a notification type.** `Text/VoxDeorum_Text.xml` holds the mod's own localized strings, all under the `TXT_KEY_VD_` prefix and dominated by the three interactive surfaces: roughly a hundred `TXT_KEY_VD_HUMAN_*` keys, eighty `TXT_KEY_VD_DEAL_*`, forty `TXT_KEY_VD_DIPLO_*`, plus a few for the Converse launcher. `Text/VoxDeorum_Text.sql` is smaller and different in kind: it overrides four vanilla diplomacy opinion phrases. `XML/VoxDeorum_Notifications.xml` registers one notification type, `NOTIFICATION_VOX_DEORUM_DIPLOMACY`, which the diplomacy panel uses to tell the player an envoy has opened a correspondence.

## How it loads

Loading follows the standard Civ V mod lifecycle, declared entirely in `VoxDeorum.modinfo`:

1. The player enables **"(5) Vox Deorum"** in the game's MODS menu. Because Community Patch, Vox Populi, and the EUI compatibility files are dependencies, they are already active by the time this mod activates.
2. On activation, `OnModActivated` runs four `UpdateDatabase` scripts in order: `SQL/VoxDeorum_Options.sql`, `Text/VoxDeorum_Text.xml`, `Text/VoxDeorum_Text.sql`, and `XML/VoxDeorum_Notifications.xml`. This is the moment `IPC_CHANNEL` and the `EVENTS_*` options get set, so the connection service comes alive when the game starts.
3. At game start the six entry points take effect: the map script generates the world, and five `InGameUIAddin` entries load into the UI runtime. Four of them point at an `.xml` context (the human panel, the human trigger, the diplomacy panel, and the deal screen), which in turn pulls in its Lua. `VoxDeorumTest.lua` is a standalone Lua addin with no XML.

The mod is marked as affecting saved games and supports single-player, multiplayer, and hot-seat. Each shipped file carries an MD5 in the `.modinfo`. After edits, `update_md5.py` recomputes those hashes and `deploy.bat` copies the mod into the local Civilization V `MODS` directory (as `(1b) Vox Deorum`) for testing.

## Where to start reading

- **`VoxDeorum.modinfo`**: dependencies, files, activation actions, and entry points. Start here.
- **`SQL/VoxDeorum_Options.sql`**: the few lines that arm the DLL's channel and event stream.
- **[lua-hooks.md](lua-hooks.md)**: what the observer addin listens for and forwards, and the round trip between agents and in-game Lua.
- **[ui.md](ui.md)**: what all this looks like from inside the game, including seat resolution in human-strategist mode.
- **[diplomacy-panel.md](diplomacy-panel.md)** and **[deal-screen.md](deal-screen.md)**: the two interactive diplomacy screens.
