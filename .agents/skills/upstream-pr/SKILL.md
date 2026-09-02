---
name: upstream-pr
description: Contribute a Vox Deorum change to Vox Populi as a clean upstream pull request, then backport it to Vox Deorum's line branches. Use when the user asks to upstream a fix, contribute a change to Vox Populi, extract VD code for an upstream PR, or backport a PR commit across line branches.
---

# Upstream PR

Prepare an upstream PR branch on the fork targeting upstream master, cleaned of Vox Deorum glue, reviewed and confirmed with the user, and optionally backported to VD's line branches. Pushing and opening the PR are the contributor's own steps; the workflow prints the commands and stops there.

Throughout, _delegate_ means hand the work to a **less expensive subagent** (e.g. Claude Sonnet, GPT-5.6-Terra/Luna) and reserve your own reasoning for synthesis and final judgment. Use editing-capable agents for the build; use read-only ones for reviews.

The `vp-pr` workflow commands and the docs page docs/developers/civ5-dll/upstream-contributions.md are the references for details. Run `npm run vp-pr -- help` before a command when the flags are unclear.

## Classify

Two scenarios are possible:

1. Scenario 1: a shared bug fix or common change that Vox Populi should also have. The default is PR-branch-first: author the fix directly on the PR branch. Use `pick` only when the fix already exists as line commits.
2. Scenario 2: extraction of existing VD code back into Vox Populi. The code lives in VD today and gets ported into the PR branch.

Before any git action, confirm the scope in one message to the user: the scenario, where the change lives today (uncommitted edits in the submodule, recent line commits, or nothing yet), the files or commits in the slice, and whether a backport is wanted at the end.

## Scope the slice

Delegate exploration to a read-only subagent:

1. Find the surface via `// Vox Deorum:` and `-- Vox Deorum:` markers plus `MOD_IPC_CHANNEL` guards.
2. Exclude VD-only files (CvConnectionService and its Schema, ArduinoJson, msinttypes) and all IPC glue.
3. Check the generic additivity rules in the docs page and apply them to the candidate hunks.
4. Cite the pull-request-1 branch as the shape target: one squashed commit off upstream/master with VD glue stripped.

## Prepare

Run `npm run vp-pr -- new <slug>` to create the branch. When the submodule has uncommitted changes, pick the flag that matches where the change lives: `--carry` when those edits are the fix and should move onto the PR branch, `--stash` when the fix is a recent line commit to `pick` and the edits are unrelated work to bring back on `restore`. Never stage the outer gitlink.

## Port and clean

Author the change directly on the PR branch, or `pick` the existing line commits and resolve conflicts. Prefer upstream context on conflict; re-add only the intended logic. Strip all Vox Deorum markers. Guard policy:

- Drop `MOD_IPC_CHANNEL` guards.
- Keep code unconditional when purely additive with no cost when unused (pull-request-1 precedent).
- Introduce a new generalized CustomMods option (VP naming, default off) only when behavior or hot-path cost demands it.

The name `MOD_IPC_CHANNEL` never appears in a PR branch.

## Verify

Run `npm run vp-pr -- status`; the marker census must read zero. Build via civ5-dll's build-and-copy.bat with no new warnings (CI adds MSVC, so both must pass). Re-run the additivity rules on the final diff.

## Finish and hand over

Run `npm run vp-pr -- finish <slug> --title "..."`. It squashes the branch to one commit and prints the push command and the GitHub compare URL. Draft the PR body: motivation for VP users, behavior summary, compatibility statement, and test notes, with no VD internals. Present the branch, diffstat, commit message, body, push command, and compare URL to the user. Do not push and do not open the PR; the contributor does both (house rule: no pushes unless asked).

## Backport (scenario 1)

Run `npm run vp-pr -- backport <squashed-sha>` for the default line, then again with `--line <X.Y>` for each other line in `scripts/vp-lines.txt`. Resolve conflicts, then add `// Vox Deorum: upstreamed <PR URL>` markers on the backported hunks. Hand the printed per-line push commands to the user; do not run them. Run `restore` afterward to return the submodule to its original checkout.

## Report

Report the scenario, slug and SHAs, diffstat, additivity result, build result, compare URL, per-line backport status, hunks needing human review, and the subagent models used (per the repo AGENTS.md rule).
