# civ5-dll — Overview

The `civ5-dll` is the game layer at the bottom of the Vox Deorum stack. It is a modified build of the **Community Patch + Vox Populi** gamecore DLL for Civilization V. Vox Deorum's one addition to that gamecore is a way for external services to observe and steer the game while it runs.

Community Patch is a long-running community project that replaces the game's C++ logic — the rules engine, the player and city simulation, and the whole built-in AI — with an open, improved version compiled against the official Civ V SDK. Vox Deorum builds on that foundation.

This folder documents the Vox Deorum additions only. It does not re-document the gamecore. The upstream `civ5-dll/CvGameCoreDLL_Expansion2/GAMECORE_OVERVIEW.md` is the canonical tour of how the game, map, players, AI subsystems, and Lua interface are organized. Start there for anything that is not Vox Deorum-specific.

## What Vox Deorum adds

Stock Community Patch is a closed system: the game runs, the built-in AI plays, and nothing outside the process can see in. Vox Deorum opens a channel out of it.

The DLL hosts a **connection service** that exposes the game's internal state and event stream to an external process — the Bridge Service — and accepts commands back. Through that channel, the broader Vox Deorum system can:

- Read what is happening in the game.
- Run Lua inside it.
- Receive a live feed of game events.
- Let LLM-driven agents influence decisions the built-in C++ AI would otherwise make alone.

The connection service is the heart of the modification and the place to start reading the Vox Deorum-specific source. It is a singleton, `CvConnectionService`, defined in `CvGameCoreDLL_Expansion2/CvConnectionService.cpp`. The gamecore brings it to life at game start and pumps it from inside the turn loop. To find those hook points, follow the calls to `CvConnectionService::GetInstance()` from `CvGame`, `CvPlayer`, and the AI classes. The next page, [connection.md](connection.md), walks through how the channel works.

## How it hooks into the game

The connection service does not run its own thread of game logic. It rides along inside the existing one.

At startup the gamecore calls the service's `Setup`, which spins up a background thread to host the IPC channel while the game keeps running on the main thread. From then on, the gamecore periodically calls the service's `ProcessMessages` at safe points in the turn loop — between players, during AI turns, and at other moments where touching game state will not corrupt it. Incoming commands and outgoing events are therefore handled on the main thread, avoiding the desyncs and save-corruption the gamecore is otherwise prone to. Game events are forwarded out as they happen, and external commands (run this Lua, call this registered function) are drained in on the same pump.

Because everything funnels through these main-thread pump points, the modification stays compatible with the gamecore's strict rules about when state may change — the same rules that govern the Lua hooks described in the upstream overview.

## Where to start reading

- **The Vox Deorum channel** — `CvConnectionService.cpp` and its header. Start at `Setup`, then `NamedPipeServerThread`, then `ProcessMessages` and `RouteMessage`. See [connection.md](connection.md) for the guided version.
- **The inherited gamecore** — `CvGameCoreDLL_Expansion2/GAMECORE_OVERVIEW.md` in the submodule, for the game, map, players, AI subsystems, database, and Lua interface.
- **Building and deploying** — [building.md](building.md), which points to the submodule's build toolchain and debugging references rather than repeating them.
