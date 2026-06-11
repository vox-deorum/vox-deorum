# Stage 7 — In-game panel v3: the rest of the action space (full parity)

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Complete the panel to full LLM parity (spec §1): grand/economic/military strategies (or flavors, per the session's `Mode`), policy (via the native screen if stage 6 adopted it), persona (the 26 values), and per-civ relationships — organized per the approved mockup so the core decision stays fast while persona and relationships remain accessible. After this stage the human's action space exactly equals the LLM's.

## Work items

- `civ5-mod/Lua/VoxDeorumHumanPanel.lua` / `.xml` — all remaining categories, following the approved mockup's layout and the stage 6 native-vs-custom split.
- `vox-agents/src/strategist/agents/human-strategist.ts` — map every submitted field onto its action tool (`set-strategy` / `set-flavors` / `set-policy` / `set-persona` / `set-relationship`), replicating the single rationale across each call.
- Localization additions.

## Verify

A decision turn can exercise every category; each maps to its action tool with the shared rationale; selections round-trip — the next decision turn's panel pre-fills from the current state.

## Done when

Both decision modes (`Strategy` and `Flavor`) are fully expressible through the panel, and a human decision can touch the entire action space available to `simple-strategist`.
