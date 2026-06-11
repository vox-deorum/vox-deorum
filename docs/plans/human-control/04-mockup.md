# Stage 4 — UI design: HTML mockup first

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Settle the decision panel's layout and interaction model **outside** Civ's awkward Lua UI framework before porting anything. The UI design needs more thought than the plumbing stages; an HTML mockup de-risks it cheaply. **The design is discussed and confirmed with the user during this stage — no Civ UI work starts until the mockup is approved.**

## Work items

1. **A standalone HTML/JS mockup** under `docs/plans/human-control/mockup/` that loads a sample `OptionsReport` JSON and renders the intended panel:
   - a status line making session state legible — whose turn the game is waiting on, that a decision is pending, what was decided last, and submission-accepted confirmation (spec §6);
   - per-category option lists carrying the **same descriptive text** the LLM prompts receive, with current selections pre-filled;
   - a single multiline rationale field (spec §2 — one rationale per decision turn);
   - a "Keep Status Quo" button and a "Submit" button;
   - plain-language labels throughout — no identifiers to memorize (spec §2).
2. The mockup renders **only the human civ's own data** (spec §3 — the panel itself must leak nothing about other civs).
3. Sketch which option categories the real panel should delegate to Civ's **native screens** (research, policy — see stage 6) versus render itself (strategies/flavors, persona, relationships), so the split is part of what gets approved.

## Verify

Review the mockup with the user; iterate until approved.

## Done when

The user has signed off on the mockup, including the native-vs-custom category split. The approved structure is what stages 5–7 port into the game.
