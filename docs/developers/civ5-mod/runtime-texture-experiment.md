# Loading generated textures during play

**In the tested VP + EUI DX11 session, a UI image control loaded newly generated DDS files by absolute filesystem path during play.** This worked inside and outside the mod folder, without registering the new files in the manifest or restarting the game. The user visually confirmed the results on November 13, 2026.

The practical route is an external process writing a DDS file, then an existing Lua UI context assigning its absolute path to an image control with `SetTexture()`. When replacing a texture that has already been displayed, `UnloadTexture()` followed by `SetTexture()` refreshed the tested control. Calling `SetTexture()` alone with the same name retained the old pixels.

## What was tested

A temporary Lua/XML panel displayed an unchanged reference beside a candidate image. An external process generated 256 by 256 opaque DXT1 DDS files with one mip level during play. Distinct red checks, cyan vertical stripes, magenta horizontal stripes, and green diagonal stripes let the user distinguish fresh pixels from a retained image. Results below are visual observations, rather than conclusions drawn from successful Lua calls. The probe, generator, and test assets were removed after the experiment.

| Operation | Observed result |
| --- | --- |
| Load registered reference and candidate textures | Both showed the expected red checks. |
| Replace the displayed candidate's file, then set the same registered name | Old red checks remained. |
| Unload that candidate, then set its registered name | New cyan stripes appeared. |
| Replace another registered file before its first display | New magenta stripes appeared on first display. |
| Create an unregistered file inside the mod folder, then request its bare filename | This file was not found by basename. A modal Texture Load Error appeared, and the bridge request timed out after 15 seconds. |
| Request the same new file by absolute path, after dismissing the error | New green stripes appeared. |
| Create another new file outside the mod folder, then use its absolute path on the first request | Candidate changed from green to cyan stripes, without a preceding basename attempt or VFS registration. |

The absolute-path calls used unload followed by set. They used Windows drive-qualified paths with forward slashes, including a path with spaces and an apostrophe. The second file was on a different drive from the installed mod folder. Both were created after the test game was loaded, and neither was added to the manifest.

## Implications for implementation

1. **Write a complete DDS before notifying the UI.** The tested external writer finished a temporary file and replaced the destination before sending the path. The UI received a local filename; no pixel upload API or new DLL texture binding was needed.
2. **Load from a UI context.** The bridge's raw Lua execution context had no `ContextPtr`, `Controls`, or `UIManager`. The experiment sent Lua events to an already loaded UI context, which owned the image control and called its texture methods. Existing lifecycle examples remain in `civ5-mod/UI/LeaderHeadRoot.lua`.
3. **Use an absolute path for newly generated files.** A producer can keep files in a dedicated local artwork directory. For retained newspaper illustrations, prefer a distinct file per illustration and resolve its path on the current machine. This is a design recommendation; archive retention was not tested.
4. **Release a displayed texture before reloading changed contents.** The tested sequence was `UnloadTexture()` then `SetTexture(path)`. This establishes a refresh route for one control, without establishing global cache eviction or VFS rescanning.
5. **Check availability before loading.** The unresolved basename opened a modal engine dialog and blocked the bridge call beyond its 15-second client timeout. Lua error handling did not prevent the dialog. A production loader should verify the file and provide a known packaged fallback; that fallback behavior still needs testing.

## Limits of the result

The renderer was `CivilizationV_DX11`; the exact VP build was not recorded. The test covered one texture size and encoding. It did not establish PNG/JPEG loading, URLs, encoded image strings, in-memory pixel buffers, relative paths, other renderers, or support across VP versions.

Two new images loaded consecutively, but revisiting the first image, reopening the panel, save reloads, game restarts, memory use, and large archives were not tested. A nonexistent filesystem path was also not tested: the observed error concerned an existing file requested through an unresolved basename. Generated artwork will need its own retention and save-portability policy.
