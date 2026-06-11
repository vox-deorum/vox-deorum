# Stage 5 — In-game panel v1: keep-status-quo only

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Prove the real end-to-end pipeline through the actual game UI with the smallest possible panel — just "Keep Status Quo", the rationale field, and Submit. This replaces the `lua-executor` simulation from stages 2–3 with a genuine panel submission.

## Work items

1. **`civ5-mod/UI/VoxDeorumHumanPanel.xml` + `civ5-mod/Lua/VoxDeorumHumanPanel.lua`** (new) — a minimal panel following the approved mockup and the Community Patch `EventChoicePopup` conventions (`ContextPtr`/`Controls`/`InstanceManager`). The panel is dormant until it receives `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)`; on Submit it fires `Game.BroadcastEvent("HumanDecision", { PlayerID, Turn, keepStatusQuo = true, Rationale })` and shows the submission-accepted state.
2. **`civ5-mod/VoxDeorum.modinfo`** — register the new Lua and XML files and add an `InGameUIAddin` entry point, mirroring the existing `VoxDeorumTest` entry; run `civ5-mod/update_md5.py` to regenerate the per-file md5 entries. The addin always loads but stays dormant until the LuaEvent arrives — **no mod-side mode flag**; all human-only behaviors are launcher-side from stage 1.
3. **`civ5-mod/Text/VoxDeorum_Text.xml`** — plain-language localization keys (no identifiers — spec §2).

## Reuse

Community Patch `EventChoicePopup` UI patterns; the LuaEvent-listener + `Game.BroadcastEvent` idiom already demonstrated in `civ5-mod/Lua/VoxDeorumTest.lua`.

## Verify

Run a human-control session. On a decision turn the panel appears with the pending-decision state; clicking Keep Status Quo + Submit fires `keep-status-quo` with the typed rationale (visible in the replay log), the game resumes and advances. The status line correctly reflects waiting/pending/accepted.

## Done when

A human can play a session start to finish making only keep-status-quo decisions through the real panel, with every decision recorded like an LLM decision.
