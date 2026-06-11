# Forced Choices

How `set-research` and `set-policy` override the AI's normal tech and policy selection.

For tool schemas and arguments, see [tools.md](../tools.md).

---

## set-research

### What it writes

`CvTechAI::m_iNextResearch` on the caller's per-player `CvTechAI` instance.

### How it works

`CvTechAI::ChooseNextTech` checks `m_iNextResearch` before evaluating any weight-based selection. If set:

1. Returns the forced tech immediately, bypassing all flavor-weighted candidate ranking.
2. Clears `m_iNextResearch` back to `NO_TECH`.

This is a **one-shot** mechanism -- each forced pick requires its own tool call. If the LLM wants consecutive forced research picks, it must call `set-research` again after each tech completes.

### When it takes effect

On the next call to `ChooseNextTech`, which occurs:
- At the start of the player's turn if no research is queued.
- When the current tech completes mid-turn.

The forced tech does not interrupt a tech already in progress -- it queues for the next selection.

### What it does NOT do

- No flavor deltas are applied.
- No game events are fired.
- No opinion cascade.
- No cross-civ getter exists for `m_iNextResearch`. Other civs see the tech only once it becomes the player's current research via `CvPlayerTechs::GetCurrentResearch` (same visibility as any normal research pick).

### Validation

The tool validates the tech is available and not already researched before calling the Lua binding. Invalid inputs are rejected without mutating state.

---

## set-policy

### What it writes

`CvPolicyAI::m_iNextPolicy` on the caller's per-player `CvPolicyAI` instance.

The stored value is a combined encoding: branch IDs are stored directly; individual policy IDs are offset by `GC.getNumPolicyBranchInfos()`.

### How it works

`CvPolicyAI::ChooseNextPolicy` checks `m_iNextPolicy` (only for normal policy choices where `bIgnoreCost == false`). If set:

1. Validates the forced policy or branch is still adoptable.
2. Returns it, bypassing all flavor-weighted candidate ranking.
3. Clears `m_iNextPolicy` back to `NO_POLICY`.

This is a **one-shot** mechanism -- same as `set-research`.

### What it covers

- **Branch unlocks** -- opening a new policy tree.
- **Individual policy adoption** -- selecting a specific policy within a branch.
- **Ideology picks** -- policies within ideology trees.
- **Free-tenet selection** -- forced policies can steer free tenet choices if the policy is a tenet (level > 0).

Mutually exclusive branches are rejected at validation time.

### When it takes effect

When culture accumulates enough to open a policy slot (game-dependent timing). The forced policy does not accelerate adoption -- it only ensures the selection when a choice becomes available.

### What it does NOT do

- No flavor deltas are applied.
- No game events are fired.
- No opinion cascade.
- No cross-civ getter exists. Visibility only through adopted-policy side effects (ideology disputes, happiness/yield modifiers) after the policy is actually adopted.

### Free policy exception

The forced value only applies to normal policy choices (`bIgnoreCost == false`). Free policy grants (from wonders, social progress, etc.) bypass the check entirely.
