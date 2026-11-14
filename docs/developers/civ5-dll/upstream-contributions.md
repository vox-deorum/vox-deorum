# civ5-dll: Upstream contributions

The default handoff is a local `pr/<slug>` branch in `civ5-dll`, based on `upstream/master`, with selected edits left unstaged and uncommitted for manual review. The branch pushes to the Vox Deorum fork, `CIVITAS-John/vox-populi`; the eventual pull request targets `LoneGazebo/Community-Patch-DLL`. Do not commit the outer repository’s temporary `civ5-dll` gitlink change.

## 1. Scope

Inspect the outer repository and submodule status, current branch, remotes, existing `vp-pr` state, and the **index**, Git's staged changes, before changing anything. Preserve human edits, commits, and staging. Continue work on a matching existing PR branch; `new` creates a fresh branch.

| Worktree and index state | Action |
| --- | --- |
| Clean worktree | Create the branch with `vp-pr new <slug>`. |
| Dirty, every edit belongs in the PR, and the user authorized moving the edits | Use `vp-pr new <slug> --carry` to move the uncommitted edits onto the new branch. |
| Dirty, mixed selected and unrelated edits, and the user authorized stashing | Export first, then use `vp-pr new <slug> --stash` to set tracked and untracked edits aside until `restore`. Port selected hunks from the export. |
| Dirty and the user has not authorized moving or stashing edits | Preserve the dirty checkout and obtain authorization before any move or stash. |

For an existing Vox Deorum fix, reuse its candidate inventory or export and select only the requested hunks. Check the refreshed upstream tree and open pull request patches for an equivalent fix before porting it. For a new fix, author the behavior directly in the upstream-based branch.

After carrying or restoring edits, inspect the index again and preserve human staging. Stash reapplication first tries `--index`, then falls back to a plain apply, so staging may need manual recovery. If a carry cannot reapply cleanly, its saved changes remain in the stash list.

When no suitable inventory exists, export from the source checkout before changing branches. Run from the repository root, using `npm.cmd` in Windows PowerShell:

```powershell
git -C civ5-dll fetch upstream --tags --prune
npm.cmd run vp-diff -- --output temp/upstream-review/<slug>
```

`vp-diff` compares the shared upstream ancestor with the current tree, including committed, staged, unstaged, and non-ignored untracked changes. It does not modify the checkout. Read its `index.md` and patches to select the hunks.

## 2. Create the branch

Run these commands from the repository root. In Windows PowerShell, use `npm.cmd` to avoid the `npm.ps1` execution-policy issue:

```powershell
npm.cmd run vp-pr -- new <slug>
$tracking = git -C civ5-dll for-each-ref --format='%(upstream:short)' refs/heads/pr/<slug>
if ($tracking -eq 'upstream/master') {
  git -C civ5-dll branch --unset-upstream pr/<slug>
}
git -C civ5-dll config branch.pr/<slug>.pushRemote origin
```

`new` fetches both remotes and creates `pr/<slug>` from fetched `upstream/master`. The conditional removes automatic upstream tracking, while `pushRemote` always points publication at `origin`. Leave the branch checked out.

## 3. Port and validate

Edit the selected files directly in upstream context, using the source branch or saved export as a reference. For example, a tooltip argument fix needs only that line replacement, even if the exported file patch also contains observer UI changes. Do not apply the whole-file patch or use `pick`, which creates commits, in this default workflow.

- Remove `// Vox Deorum:` and Lua `-- Vox Deorum:` markers, `MOD_IPC_CHANNEL`, IPC dependencies, and VD-only connection or third-party infrastructure.
- Add no save-relevant enum values or fields. Preserve existing callers with defaulted parameters and existing Lua binding behavior.
- Keep additive, cost-free APIs unconditional. For optional features needing a switch, use a VP-style CustomMods option defaulting off. Ordinary bug fixes need no new switch.

Review the working delta and untracked files with:

```powershell
git -C civ5-dll diff upstream/master --
git -C civ5-dll status --short
git -C civ5-dll diff --check upstream/master
```

Scan changed files directly for VD residue. The marker census from `npm.cmd run vp-pr -- status` examines committed `HEAD` only, so a zero count does not validate uncommitted edits.

For C++ changes, build the upstream checkout from `civ5-dll` with the process-local PATH setup:

```powershell
$env:Path = "$(Get-Location);$env:Path"
python build_vp_clang_sdk.py --config debug
```

The VD-only `build-and-copy.bat` is absent in this checkout. Test the affected behavior where possible. Report missing MSVC v90 tooling, `MSB8020`, warnings that cannot be attributed, and unperformed in-game checks separately in the handoff. Do not install tools or claim runtime validation that was not run.

## 4. Handoff

Write `temp/upstream-review/<slug>-pr.md` with a title and concise body. Explain the player-visible behavior and reason first, then summarize the relevant files or functions. Keep validation notes, VD internals, and routine compatibility boilerplate out of the draft. Report the branch, base SHA, changed files or diffstat, draft path, validation results, limitations, and any preserved staging separately.

Leave `pr/<slug>` checked out with the selected edits unstaged and uncommitted. Preserve human commits and staging added during review. Do not run `finish`, push, open a pull request, or restore the checkout as routine cleanup.

## Later actions, when requested

After the user authorizes completion and the branch is clean and committed, run `finish` to obtain one reviewed commit:

```powershell
npm.cmd run vp-pr -- finish <slug> --title "Short upstream title"
```

Publish only when explicitly requested, using `git -C civ5-dll push -u origin pr/<slug>`. The script prints an optional compare URL; it never pushes or opens a pull request. Backport only requested fixes to maintained lines missing the change, using `scripts/vp-lines.txt`. Existing VD extractions need no backport. After preserved work and review are safely complete, use `npm.cmd run vp-pr -- restore`.

See the [upstream-pr skill](../../../.agents/skills/upstream-pr/SKILL.md) for the detailed workflow and the [vp-pr.mjs](../../../scripts/upstream/vp-pr.mjs) and [vp-diff.mjs](../../../scripts/upstream/vp-diff.mjs) implementations.
