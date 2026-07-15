---
name: implement-plan
description: Implement an already-approved plan through an orchestrated, independently-reviewed build-and-revise loop. Use this after a plan (not just an instruction) exists and the user wants it built — "implement the plan", "execute the approved plan", "carry out the plan". The skill distills the plan into an executive plan, asks any clarifying questions, delegates the implementation to subagents (cheaper models for mechanical edits, stronger models for hard reasoning), has fresh-context subagents review the result, then loops — reconcile findings, re-align with the user, revise, re-review — until both the review and the user are satisfied. It is the counterpart to plan-changes. Prefer it over implementing inline whenever the change is non-trivial, spans multiple files or systems, or benefits from independent review.
---

# Implement Plan

Turn an approved plan into correct, reviewed code. The plan is the input; working, verified code that faithfully matches it is the deliverable.

Two principles run through every phase:

- **Delegate.** Hand editing and reviewing to **less expensive subagents** (e.g. Sonnet, GPT-5.5-medium); spend your own reasoning on synthesis and final judgment. Use editing agents to build, read-only agents to review.
- **Loop, don't sprint.** Build → review → revise until review surfaces nothing material _and_ the user signs off. Match depth to the work: a small, localized change may need one implementer, no questions, and one review lap; a large change earns the full loop. Track work units in a `TodoWrite` list to hold the breakdown across laps.

**Flow:** orient → align → implement → review → decide → ⟳ (reconcile → re-align → revise → re-review) → land.

## Phase 1 — Orient

Read the approved plan and the relevant repo/context instructions. Then write yourself a tight **executive plan**:

- **End state** — in a sentence or two, what is true and verifiable when this is done.
- **Work breakdown** — the plan's steps grouped into delegable units, ordered by dependency, parallelizable ones flagged.
- **Unknowns** — anything ambiguous about _how_ to execute (patterns, where edits land, how to verify), or where the plan's cited state may have drifted from current code.
- **Decisions** — execution choices the user may have opinions on.

Unknowns become exploration briefs (delegate a `sonnet` `Explore` agent to confirm ground truth); decisions become questions.

## Phase 2 — Align

A wrong assumption becomes wrong code, so resolve ambiguity before editing. Use `AskUserQuestion`: batch related questions (up to four per call), ask follow-up rounds as new forks appear, and put your recommended option first.

Ask only what the user decides and the codebase can't tell you — scope boundaries, edge-case behavior the plan left open, how aggressively to refactor adjacent code, which of several viable executions they prefer. Don't ask what a subagent can find out; find it out. If nothing is genuinely ambiguous, say so and move on.

Fold the answers into the executive plan.

## Phase 3 — Implement

Hand the work units to subagents. Spawn independent units in one message to run concurrently; sequence dependent ones. Since implementers _edit files_, keep concurrent agents from colliding — give each a disjoint set of files, or run them with `isolation: "worktree"` and reconcile after. Reserve your own editing for the small cross-unit seams subagents can't see.

Write each brief so the subagent can act alone: the exact plan step(s) it owns, the files/area, patterns to follow (cite `path:line`), and the bar for done — compiles, matches the plan, tests updated alongside. Their context is discarded, so demand a distilled report of what changed and what they had to decide.

Then **verify** as the plan and repo expect — build, tests, linters (delegate this too). Capture every failure as input to review; don't paper over it.

## Phase 4 — Review

Spawn fresh-context subagent(s) with no prior conversation — that blindness to your reasoning is exactly why they catch what you've stopped seeing. Give each the diff, the plan, and the goal, with an adversarial brief on two axes:

- **Fidelity** — do the changes actually implement the plan? Which steps are missing, partial, or done differently — and is each deviation justified or a mistake?
- **Correctness & maintainability** — the same risks `review-staged-changes` hunts: lost validation, unsafe partial commits, async races, state duplicated away from its source of truth, contracts that no longer agree — plus genuine simplifications. Fold in any Phase 3 verification failures.

Ask for a prioritized list of concrete findings, each with evidence and the nearest `path:line`, defaulting to skepticism over praise. For large or high-stakes changes, spawn several reviewers with different lenses (fidelity, correctness, simplicity) in one message.

## Phase 5 — Decide

Read the findings and judge — _both_ review and user must be satisfied to pass this gate.

- **Land** when review surfaces nothing material and verification is green: summarize what was built and how it was checked, and confirm the user is satisfied. If yes, done.
- **Loop** when findings are material, verification is red, or the user wants changes: go to Phase 6.

Don't declare done over unresolved material findings; don't loop forever over cosmetic ones — name the residual minor items plainly and let the user call it.

## Phase 6 — Revision loop

Each lap repeats the cycle, tightened to what's left:

1. **Reconcile** — turn findings and user feedback into a fresh **revision plan**: concrete fixes ordered by dependency, with anything deliberately rejected noted and why. Rewrite the executive plan rather than layering edits onto the old one.
2. **Re-align** — if a finding exposed a real fork or a fix carries a trade-off the user should weigh, ask (Phase 2). Otherwise proceed.
3. **Revise** — delegate the fixes (Phase 3), same file-collision discipline, then re-verify.
4. **Re-review** — delegate a fresh review of the new changes (Phase 4), focused on the fixed areas and any regressions the fixes introduced.

Return to Phase 5. Repeat until review is clean and the user is satisfied — then land.
