# civ5-dll: Building and Deploying

You only need to build the DLL when you change the C++ gamecore, which for Vox Deorum mainly means the [connection service](connection.md). Day-to-day mod work is Lua, SQL, and XML, which you can edit and test without rebuilding.

`civ5-dll` is a submodule with its own upstream history (Community Patch and Vox Populi) and its own build and debugging documentation. This page covers when and why you build, and the one command you will normally run. The submodule's `docs/` and `DEVELOPMENT.md` carry the exact toolchain steps, which track upstream.

## What gets built

The gamecore is a 32-bit (Win32/x86) C++ DLL built against the legacy **v90 platform toolset**, the Visual C++ 2008 compiler. A build produces `CvGameCore_Expansion2.dll` and a matching `.pdb`.

The shared RL header `VoxRlTypes.h` sets `_SECURE_SCL=0` and `_HAS_ITERATOR_DEBUGGING=0` when compiling for the game DLL. RL sources built without the game precompiled header include it before system or STL headers so their STL object layouts match the game. The maintained source is in `vox-deorum-rl/simulator/schema/shared/`. Rebuild all objects after changing these settings; mixed layouts can crash mod loading even when RL capture is disabled.

## The normal loop: build-and-copy.bat

From the `civ5-dll` folder:

```powershell
powershell -Command "& .\build-and-copy.bat"
```

That script is the local build-and-deploy loop. It compiles with clang through `build_vp_clang_sdk.py`, then copies the resulting DLL and `.pdb` into your Civilization V mods directory, so a successful run leaves the game ready to launch.

| Flag        | Effect                                                    |
| ----------- | --------------------------------------------------------- |
| _(none)_    | Build Debug only.                                         |
| `--release` | Build Release only.                                       |
| `--both`    | Build Debug, then Release, stopping at the first failure. |

Where things land:

- Build output: `clang-output\Debug\` or `clang-output\Release\`, alongside a `build.log`.
- Deploy destination: the **`(1) Community Patch`** folder under `Documents\My Games\Sid Meier's Civilization 5\MODS`, replacing the DLL already there.
- With `--both`, the DLL and `.pdb` are also copied into `..\scripts\debug` and `..\scripts\release` for the launch scripts.

The script stops on a failed compile and prints the tail of `build.log` plus its last few `error:` lines, so start there when a build breaks. It also fails loudly if the built DLL is missing or the copy is refused; a missing `.pdb` is only a warning.

`build_vp_clang_sdk.py` needs Windows SDK 7.0 with its VC9 components, plus `clang-cl` and `lld-link` on `PATH`. It takes one option of its own, `--config release|debug`, which is what the batch file sets.

## Building from Visual Studio

The submodule also supports building from the IDE with the v90 toolset. That path needs a modern Visual Studio (2019 or 2022) as the host, plus two older compilers for different reasons:

- **Visual C++ 2008 SP1** supplies the actual compiler, CRT, and headers.
- **Visual C++ 2010 SP1** supplies the MSBuild integration that lets a modern Visual Studio discover and drive the v90 toolset.

The submodule's **[Build Toolchain Guide](../../../civ5-dll/docs/build-toolchain.md)** explains why both are required, links the archived installers, gives the install order, and covers the common errors (`MSB8020`, missing `<array>`, whole-program-optimization pauses).

CI builds with both compilers. Verify your changes compile cleanly, without new warnings, under MSVC and clang before submitting.

## Running a full session

The DLL on its own has nothing to talk to. A real Vox Deorum session also needs the bridge service, MCP server, and agents running, so the connection service has a client. The [setup guide](../setup.md) covers bringing up the whole stack, and the Vox Deorum launch scripts wire it together.

## Debugging

1. Build the Debug configuration (the default) and let the script deploy the DLL and its `.pdb`.
2. Start the game with the mod.
3. Attach the Visual Studio debugger to the Civilization V process.

From there you can set breakpoints in the gamecore and inspect crashes. The relevant submodule references:

- **[DEVELOPMENT.md](../../../civ5-dll/DEVELOPMENT.md)**: the full debug-attach workflow, how to enable in-game logging for bug reports, and Visual Studio's CPU and memory diagnostic tools.
- **[Minidump Guide](../../../civ5-dll/docs/minidumps.md)**: how to read the minidump the game writes when it crashes.
- **[Database reference](../../../civ5-dll/docs/db.md)**: game-database schema questions.
