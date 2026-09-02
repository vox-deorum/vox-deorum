# civ5-dll: Upstream Contributions

The gamecore is a fork, and a fork only pays off if the good parts flow back. This page is the playbook for contributing changes from the `civ5-dll` gamecore to **upstream Vox Populi**, the Community Patch DLL, and for keeping Vox Deorum's maintained game lines in step with what upstream accepts. It applies to any change that touches stock gamecore code, so read it before you write a PR against the fork.

## The fork, remotes, and branch model

- **The gamecore is a submodule.** Vox Deorum's C++ game layer lives in `civ5-dll`, a fork of upstream Vox Populi. Everything in this page happens inside that submodule; the outer repository only has a gitlink to it.
- **Two remotes.** `origin` points at the fork, CIVITAS-John/vox-populi. `upstream` points at the authoritative project, LoneGazebo/Community-Patch-DLL. PR branches are always based on `upstream/master`.
- **Maintained line branches.** Vox Deorum ships gamecore code on branches named `vox-deorum-<line>`, one per maintained game line, for example `vox-deorum-5.2`. `scripts/vp-lines.txt` records them: `DEFAULT_LINE` names the default line, `LINES` lists all of them.
- **A PR branch is throwaway.** A PR branch is named `pr/<slug>`, created off `upstream/master`, and is meant to hold exactly one change. It is squashed to a single commit before the PR opens. `pull-request-1` is the precedent: one squashed commit off upstream/master with all Vox Deorum glue stripped out. Match that shape.
- **The pre-workflow checkout is recorded, not tracked.** `new` stores the branch and commit that were checked out before the workflow started in the submodule's git directory (`.git/modules/civ5-dll/vp-pr-state.json` under the outer repository), so `restore` can return to it later. It never appears in any diff.
- **Watch the gitlink.** While a PR branch is checked out, the outer repository shows the `civ5-dll` gitlink as modified. That modified gitlink must never be committed in the outer repository.

## The two scenarios

There are two jobs this workflow serves, and they end differently.

- **A shared bug fix or common change.** Something is wrong upstream too, and the fix belongs in both places. End state: a PR branch on the fork targeting `upstream`, containing the fix and nothing else, plus the same patch landed in Vox Deorum's line branches. The line branches keep the change; the PR branch is what upstream reviews.
- **Extracting existing Vox Deorum code to Vox Populi.** The code works in the game today but is genuinely useful upstream. End state: a PR branch only. Vox Deorum keeps its own copy in the line branches until upstream merges the change; deleting the copy is a separate step that happens after the merge.

## The vp-pr command

`vp-pr` drives the workflow. It is exposed from the repo root as `npm run vp-pr`, and it operates inside the submodule. Every subcommand guards itself against destroying work.

An in-progress cherry-pick refuses everything except `status`, and the refusal names the conflicted files and how to continue, skip, or abort. A dirty submodule also refuses, except for `new` with one of two flags, because uncommitted gamecore edits are usually in-progress work that must not be swept away:

- `new <slug> --carry` stashes the uncommitted changes, tracked and untracked, and reapplies them on the new PR branch. Use it when the fix already exists as staged or unsaved edits on a line branch and should become the PR.
- `new <slug> --stash` stashes them and records the stash, so the PR can start from a recent line commit with `pick` while unrelated work waits. `restore` reapplies the stash on the original checkout.

If a stash does not reapply cleanly, it stays in the stash list and the command says so, so nothing is lost.

| Subcommand | What it does | When it refuses |
| --- | --- | --- |
| `new <slug>` | Fetches both remotes, records the current checkout, creates `pr/<slug>` off `upstream/master`, and checks it out. `--carry` and `--stash` handle uncommitted changes as described above. | If `pr/<slug>` already exists locally or on origin, or a workflow is already in progress. There is no force override. |
| `pick` | Cherry-picks line commits onto the current PR branch, so the branch carries exactly the intended content. | When the current checkout is not a `pr/*` branch. |
| `finish` | Runs the marker guard, squashes the PR branch to one commit, and prints the push command and compare URL. Re-running on an already squashed branch leaves the commit alone. | When markers remain unless `--allow-markers` is given. When the branch has no commits or no changes beyond the upstream base. When the current checkout is not the named `pr/<slug>` branch. |
| `backport` | Lands a squashed PR commit in the line branches named by `--line`, or in the default line when none is given, using cherry-pick with `-x` for provenance. | When a line is not in `LINES`, or the local line branch has diverged from `origin`. It never rebases published branches and only fast-forwards when local is merely behind. |
| `status` | Reports the checkout, upstream freshness, local PR branches, and the marker census of the current PR branch. | Nothing. It is the one subcommand that also runs on a dirty submodule. |
| `restore` | Returns the submodule to the checkout recorded by `new`, and reapplies changes set aside by `--stash`. | Nothing beyond the shared dirty rule. |

### Publishing is the contributor's job

The script never pushes, never opens a pull request, and never calls `gh`. `finish` prints the `git push` command for the PR branch and the GitHub compare URL, and `backport` prints one push command per line branch it changed. Running those is a deliberate human step, so a stray flag cannot publish anything.

### The marker guard

`finish` runs a marker guard before squashing. It lists the files the branch changes against `upstream/master`, greps those files on the branch for the strings `Vox Deorum`, `MOD_IPC_CHANNEL`, `CvConnection`, and `ArduinoJson`, and also flags any changed file whose name contains one of them. Every hit is listed as file and line, because any one of them means Vox Deorum-only code is still in the branch. The census from `status` uses the same scan, so the two always agree.

## Cleaning the branch before finish

Four kinds of Vox Deorum residue have to be gone before `finish` yields a clean PR.

### Marker stripping

Every `// Vox Deorum:` comment marker (in Lua, `-- Vox Deorum:`) is removed from the branch. Those markers are how Vox Deorum finds and audits its own deltas; upstream code carries none of them.

### The MOD_IPC_CHANNEL guard decision

`MOD_IPC_CHANNEL` is the flag that turns Vox Deorum's pipe code on and off. Whether a PR branch may keep a guard at all has exactly two allowed outcomes:

- **Drop the guard and keep the code unconditional** when the change is purely additive and costs nothing when unused. This is the `pull-request-1` precedent: the feature ships enabled, no flag, no conditionals.
- **Introduce one new generalized option in VP style, default off** when the change alters behavior or carries a hot-path cost when unused. The option follows VP naming conventions and goes through VP's CustomMods mechanism, defaulting to off so upstream behavior is unchanged until someone opts in.

The name `MOD_IPC_CHANNEL` never appears in a PR branch. If a guard is needed, it is a new VP-named option, not Vox Deorum's flag transplanted.

### The never-upstream list

Some Vox Deorum code is not upstreaming material at all; it exists only because Vox Deorum runs on top of the stock game. It never goes upstream: the `CvConnectionService` directory, including `CvConnectionService/Schema`, the bundled ArduinoJson, the `msinttypes` compatibility headers, and the IPC glue files. A change that only touches those is not an upstream candidate.

### The additivity checklist

Upstream is the authority on the stock gamecore, so a PR branch should perturb it as little as possible. Distilled and generalized, a PR change must satisfy:

- No new save-relevant enum values.
- No new save fields.
- Shared function signatures are extended only by defaulted parameters, and the default reproduces prior behavior exactly, so every existing caller keeps behaving identically without changing its call site.
- Lua bindings are plain additive registrations, meaning a new binding changes nothing about how existing bindings behave.

The [interactive-diplomacy additivity review](../../plans/interactive-diplomacy/09-additivity-review.md) is the feature-specific worked example of this discipline, inward-facing and not a template; link and read it when you want to see one pass through the checklist.

## Backport markers

When a squashed PR commit lands in a Vox Deorum line branch via `backport`, the backported hunks are annotated with `// Vox Deorum: upstreamed <PR URL>` markers. That keeps the every-Vox-Deorum-delta-is-marked invariant honest: the marker says the delta exists only until upstream merges, which lets a later upstream merge find hunks that dissolve once the merge happens. `backport` uses `git cherry-pick -x`, so the upstream commit hash stays in the history for cross-line provenance.

## Verification

Before any PR is real, three checks:

- **Marker census is zero.** `npm run vp-pr -- status` on the PR branch must report no markers.
- **Both compilers build cleanly.** Build through the civ5-dll build script, `build-and-copy.bat`, and see no new warnings. CI adds MSVC to the local clang build, so both compilers must pass.
- **Rehearse the workflow.** Run `new`, then `finish`, then `restore` as a dry run on a throwaway slug before doing it with a real slug.

## The skill

The [upstream-pr skill](../../../.agents/skills/upstream-pr/SKILL.md) carries the step-by-step procedure; this page defines the model and the rules that procedure enforces.
