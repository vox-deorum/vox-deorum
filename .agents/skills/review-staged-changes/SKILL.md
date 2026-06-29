---
name: review-staged-changes
description: Review Git staged changes for correctness risks and concrete maintainability, readability, and simplification opportunities without modifying files or rerunning tests. Use when asked to review the index, staged diff, pending commit, or pre-commit changes while assuming the test suite has already passed.
---

# Review Staged Changes

Review only the Git index. Treat tests as passed, remain read-only, and lead with actionable findings that improve correctness and make the code easier to understand and change safely.

## Inspect the change

1. Read the repository instructions, then any instructions scoped to changed directories.
2. Inspect `git status --short`, `git diff --cached --name-only`, and `git diff --cached --stat`.
3. Read the complete staged diff with `git diff --cached --`. Split it by component when useful.
4. Read surrounding staged source with `git show :path/to/file` when the working tree may differ from the index.
5. Trace changed behavior across callers, types, persistence, API boundaries, UI state, and staged tests. Read unchanged context only when needed to establish impact.

Do not review unstaged changes as part of the patch. Do not edit files, stage changes, run tests, builds, linters, or formatters. Read-only structural checks are acceptable when they answer a specific review question.

## Find correctness risks

Prioritize observable failures over style:

- Lost validation, changed error classification, or ambiguous request shapes
- Partial commits, unsafe retries, rollback mistakes, or duplicate side effects
- Async races, stale state, cancellation gaps, and cleanup ordering
- Fabricated or duplicated state drifting from an authoritative source
- API, type, persistence, or UI assumptions that no longer agree
- Data loss, security regressions, or behavior contradicted by repository instructions

For each risk, identify the triggering path and user-visible or operational impact in natural language, and describe how they can be reproduced. Do not infer a defect solely from missing tests.

## Improve maintainability and readability

Recommend an improvement when the staged design makes future changes harder, forces readers to hold unnecessary context, or obscures an important invariant. Prefer structural clarity over cosmetic style and require a concrete maintenance or comprehension benefit. Look especially for:

- One concept represented by multiple types, fields, callbacks, or sources of truth
- Responsibilities split across layers without a clear owner, or unrelated concerns interleaved in one function
- Names, types, comments, and runtime behavior that describe different contracts
- Important invariants enforced late, repeatedly, or only by callers instead of at one boundary
- Duplicate policy, validation, transformation, or error handling likely to drift
- Excessive indirection, pass-through wrappers, broad interfaces, or callbacks that hide the real control flow
- Long branching paths that can become a direct operation by strengthening an earlier invariant
- Authoritative data discarded and reconstructed, reread, refreshed wholesale, or fabricated later
- Tests coupled to incidental implementation details or fixtures that conceal the production contract
- Comments that narrate complexity which can instead be removed through a smaller design

Do not report formatting preferences or subjective style in isolation. For each maintainability finding, name the future change, debugging task, or invariant that is unnecessarily difficult to reason about.

## Report findings

Order findings by severity, with correctness before maintainability, readability, and optional cleanup. For each finding:

1. State the problem or improvement opportunity in one sentence.
2. Cite the staged file and line nearest the cause.
3. Explain the concrete runtime impact or maintenance/readability cost.
4. Suggest the simpler direction, not a full implementation plan.

Use `P0` through `P3` when defect severity helps prioritization; label non-defect improvements `Maintainability` when a severity would be misleading. Group small related cleanup into one item. If no concrete findings remain, say so plainly and mention only material residual uncertainty.

End by stating that no files were changed and tests were not rerun because they were assumed passing.
