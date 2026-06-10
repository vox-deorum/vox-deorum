# civ5-dll — Building & Deploying

The `civ5-dll` is a separate submodule with its own upstream history (Community Patch + Vox Populi), and it carries its own detailed build and debugging documentation. This page gives the prose overview of how building and deploying fit into Vox Deorum work and points you at those submodule references for the exact steps — it deliberately does not duplicate them, since they track upstream.

## The short version

The gamecore is a 32-bit (Win32/x86) C++ DLL built with the legacy **v90 platform toolset** — the Visual C++ 2008 compiler. Most of Vox Deorum's day-to-day changes are not in C++ at all: large parts of the mod are Lua, SQL, and XML, which can be edited and tested without rebuilding the DLL. You only need to compile when you change the C++ gamecore — which, for Vox Deorum, mainly means the connection service described in [connection.md](connection.md).

When you do need to build, there are two supported paths:

- **Visual Studio + v90 toolset** — open the solution and build. This requires both **Visual C++ 2008 SP1** (the actual compiler, CRT, and headers) and **Visual C++ 2010 SP1** (the MSBuild integration that lets a modern Visual Studio discover and drive the v90 toolset), with VS2019/2022 as the host IDE. The reasons both are required, the archived installer download links, the install order, and the common errors (`MSB8020`, missing `<array>`, whole-program-optimization pauses) are all spelled out in the submodule's **[Build Toolchain Guide](../../../civ5-dll/docs/build-toolchain.md)**.
- **Clang scripts** — Python-driven clang builds (`build_vp_clang.py` for local development against an installed VS2008, `build_vp_clang_sdk.py` for CI using Windows SDK 7.0 with no Visual Studio install). These are the same scripts CI uses; see the Alternative: Clang Build section of the toolchain guide.

CI builds with both compilers, so verify changes compile cleanly — without new warnings — under MSVC and clang before submitting.

## Deploying a build

A successful build produces the gamecore `.dll` (and, for debug builds, a matching `.pdb`) in the project's build output. Deploying means placing that DLL into the **Community Patch Core** mod folder in your Civilization V mods directory, replacing the DLL already there, and then launching the game with the mod loaded. For a Vox Deorum session the DLL also needs the rest of the stack running — the bridge service, MCP server, and agents — so that the connection service has a client to talk to; the [setup guide](../setup.md) covers bringing up the whole stack, and the Vox Deorum launch scripts wire it together.

## Debugging

To debug the running DLL, build the **Debug** configuration, deploy the debug DLL and its `.pdb`, start the game with the mod, and attach the Visual Studio debugger to the Civilization V process. From there you can set breakpoints in the gamecore and inspect crashes. The submodule's **[DEVELOPMENT.md](../../../civ5-dll/DEVELOPMENT.md)** documents the full debug-attach workflow, how to enable in-game logging for bug reports, and Visual Studio's CPU/memory diagnostic tools. When the game crashes it writes a minidump; the **[Minidump Guide](../../../civ5-dll/docs/minidumps.md)** explains how to read those. Game-database schema questions are covered by the submodule's **[database reference](../../../civ5-dll/docs/db.md)**.

In short: this page tells you *when and why* you build and deploy; the submodule's `docs/` and `DEVELOPMENT.md` tell you *exactly how*.
