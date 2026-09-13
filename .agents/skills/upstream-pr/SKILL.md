---
name: upstream-pr
description: Prepare a Vox Populi PR branch and message from a shared fix or selected Vox Deorum changes, leaving the edits uncommitted for human review. Also use for explicitly requested finishing or backporting of an upstream PR.
---

# Upstream PR

Prepare the selected change in the `civ5-dll` submodule and leave it ready for manual review. The default deliverables are an upstream-based local branch, unstaged edits, a PR draft, and a separate validation report. Do not stage, commit, run `finish`, push, open a PR, or restore the checkout as part of this default handoff. Do not ask to commit as a routine next step.

Read the [contributor workflow](../../../docs/developers/civ5-dll/upstream-contributions.md) for commands, build setup, and extraction rules. Use `npm.cmd` in Windows PowerShell. Run `npm.cmd run vp-pr -- help` only when the documented flags are insufficient.

## Scope and prepare

1. Inspect the outer repository and submodule status, current branch, remotes, and any existing `vp-pr` state. Preserve human edits and commits. Resume an existing matching branch instead of creating another one.
2. State the selected behavior, source files or commits, and intended branch in a short update. A new shared fix can be authored directly against upstream. For existing VD changes, reuse the candidate inventory or export and extract only the selected hunks. Follow the user's requested grouping. Ask only when scope or preservation of existing work is unclear.
3. Create `pr/<slug>` with `vp-pr new`, which fetches both remotes. The branch lives locally in **civ5-dll**, its push destination is **origin (`CIVITAS-John/vox-populi`)**, and its base and eventual PR target are **upstream/master (`LoneGazebo/Community-Patch-DLL`)**. Remove any automatic tracking of `upstream/master` and set the branch's `pushRemote` to `origin`, using the contributor workflow commands. Never stage the outer gitlink.
4. Before porting, check the refreshed upstream code and open PR patches for equivalent fixes. Use a less expensive read-only subagent for batch exploration or an independent check, such as GPT-5.6-Luna; include the repository's tool-calling rules and report the model used. Reuse findings instead of repeating searches.

`new` requires a clean checkout by default. With authorization to move or stash edits, use `--carry` only when all edits are selected. For mixed selected and unrelated edits, export from the source checkout first, then use `--stash` and port the selected hunks from the saved export. Inspect the resulting index: stash reapplication can preserve staged changes. Never unstage work the human staged. `pick` creates commits, so reserve it for an explicitly authorized commit workflow; direct hunk editing is the default extraction path.

## Port and verify

Edit only the selected hunks in upstream context, using the source branch or export as a reference. Do not apply whole-file export patches containing unrelated changes. Remove VD markers, `MOD_IPC_CHANNEL`, and IPC dependencies; follow the contributor workflow's save, API, and optional-feature rules. Ordinary bug fixes do not need a new configuration switch.

Review the complete delta with `git -C civ5-dll diff upstream/master --` and inspect status for untracked files. Run `git diff --check` on the relevant delta and scan changed files directly for VD residue. **The marker census in `vp-pr status` checks committed HEAD only**, so a zero count does not validate uncommitted edits.

For C++ changes, build the upstream checkout using `build_vp_clang_sdk.py`; the VD-only `build-and-copy.bat` is absent there. Follow the documented process-local PATH setup. Check the affected behavior where possible. Compare against a baseline if warnings need attribution. Report missing toolchains and unperformed in-game checks accurately, without expanding the task into toolchain installation. Keep validation out of the PR body.

## Draft and hand over

Write `temp/upstream-review/<slug>-pr.md` with a title and a concise body:

- Explain what players experience and why the behavior should change, in plain game terms.
- Then explain the implementation, naming the relevant files or functions.

Omit validation notes, VD internals, and routine compatibility boilerplate. Mention compatibility only when it matters to understanding the change.

Report the branch and base SHA, changed files or diffstat, draft link, validation results and limitations, and the subagent model used. Leave the PR branch checked out with the selected edits unstaged and uncommitted. Preserve any commits or staging the human added during review. Nothing has been published merely because a local branch exists.

## Later actions, only when requested

- **Finish:** Once the user has committed, or explicitly authorized staging and committing, follow the contributor workflow to obtain one reviewed commit and run `vp-pr finish`. It requires a clean committed branch and may rewrite history. Do not rewrite human commits without authorization. `pull-request-1` is a historical example of the final one-commit shape.
- **Publish:** Supply the explicit `origin` push command and upstream compare URL. The contributor pushes and opens the PR unless they ask the agent to do so.
- **Backport:** Only to requested maintained lines missing the fix, using `scripts/vp-lines.txt`. Existing VD extractions need no backport. Use `backport` with provenance and annotate the relevant hunks with `// Vox Deorum: upstreamed <PR URL>` once the URL exists.
- **Restore:** After review work is safely preserved and the user is done with the PR checkout, use `vp-pr restore`. It returns to the recorded checkout and reapplies any saved stash. Never restore away from an unfinished review as routine cleanup.
