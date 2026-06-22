# civ5-dll — Building & Deploying

You only need to build the DLL when you change the C++ gamecore. For Vox Deorum that mainly means the connection service in [connection.md](connection.md). Most day-to-day mod work is Lua, SQL, and XML, which you can edit and test without rebuilding.

The `civ5-dll` is a separate submodule with its own upstream history (Community Patch + Vox Populi) and its own detailed build and debugging documentation. This page explains *when and why* you build and deploy. The submodule's `docs/` and `DEVELOPMENT.md` give the exact steps. This page does not duplicate them, since they track upstream.

## What gets built

The gamecore is a 32-bit (Win32/x86) C++ DLL built with the legacy **v90 platform toolset** — the Visual C++ 2008 compiler.

## Build paths

There are two supported ways to build.

| Path | Use it for | Requirements |
| --- | --- | --- |
| **Visual Studio + v90 toolset** | Building from the IDE | VS2019/2022 as host, plus **Visual C++ 2008 SP1** and **Visual C++ 2010 SP1** |
| **Clang scripts** | Local clang builds and CI | `build_vp_clang.py` (local, against an installed VS2008) or `build_vp_clang_sdk.py` (CI, Windows SDK 7.0, no Visual Studio) |

For the Visual Studio path, both Visual C++ versions are required for different reasons:

- **Visual C++ 2008 SP1** supplies the actual compiler, CRT, and headers.
- **Visual C++ 2010 SP1** supplies the MSBuild integration that lets a modern Visual Studio discover and drive the v90 toolset.

The submodule's **[Build Toolchain Guide](../../../civ5-dll/docs/build-toolchain.md)** spells out why both are required, the archived installer download links, the install order, and the common errors (`MSB8020`, missing `<array>`, whole-program-optimization pauses). The clang scripts are the same ones CI uses; see the Alternative: Clang Build section of that guide.

CI builds with both compilers. Verify your changes compile cleanly — without new warnings — under MSVC and clang before submitting.

## Deploying a build

A successful build produces the gamecore `.dll` (and, for debug builds, a matching `.pdb`) in the project's build output. To deploy:

1. Place the DLL into the **Community Patch Core** mod folder in your Civilization V mods directory, replacing the DLL already there.
2. Launch the game with the mod loaded.

For a full Vox Deorum session the DLL also needs the rest of the stack running — the bridge service, MCP server, and agents — so the connection service has a client to talk to. The [setup guide](../setup.md) covers bringing up the whole stack, and the Vox Deorum launch scripts wire it together.

## Debugging

To debug the running DLL:

1. Build the **Debug** configuration.
2. Deploy the debug DLL and its `.pdb`.
3. Start the game with the mod.
4. Attach the Visual Studio debugger to the Civilization V process.

From there you can set breakpoints in the gamecore and inspect crashes. The relevant submodule references:

- **[DEVELOPMENT.md](../../../civ5-dll/DEVELOPMENT.md)** — the full debug-attach workflow, how to enable in-game logging for bug reports, and Visual Studio's CPU/memory diagnostic tools.
- **[Minidump Guide](../../../civ5-dll/docs/minidumps.md)** — how to read the minidump the game writes when it crashes.
- **[Database reference](../../../civ5-dll/docs/db.md)** — game-database schema questions.
