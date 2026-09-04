# Stage 1 — Launcher human-control mode + stub `human-strategist` ✅ DONE

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: implemented.** All five work items landed. Type-check passes; `isHumanControl` unit tests added to `config-helpers.test.ts` (18 pass); the `human-strategist` registers correctly. What was built:
> - [`vox-agents/src/strategist/agents/human-strategist.ts`](../../../vox-agents/src/strategist/agents/human-strategist.ts) — `NullStrategist`-style stub. `getSystem` calls `keep-status-quo` with `parameters.mode` and a real rationale, then returns `""` (skips the LLM loop via `VoxContext`'s empty-system path).
> - [`agent-registry.ts`](../../../vox-agents/src/infra/agent-registry.ts) — registered after `NullStrategist`.
> - [`config.ts`](../../../vox-agents/src/types/config.ts) — `isHumanControl(config)` scans `llmPlayers` for `strategist === "human-strategist"`, using the same hardcoded-strategist-name convention already used for `"none-strategist"`.
> - [`strategist-session.ts`](../../../vox-agents/src/strategist/strategist-session.ts) — production normalized to `'test'` early in `start()` (mutates `this.config.production`, which all the existing `isVisualMode` gating reads live); `humanPlayerID` getter (seating-mapped); `setAiObserver(!isInteractiveMode && !isHumanControl)`; `Game.SetObserverUIOverridePlayer(<id>)` prepended before `Game.SetAIAutoPlay` in the `turn === 0` autoplay block; re-issued defensively in `recoverGame`.
> - [`configs/human-standard-fixed-per-5.json`](../../../vox-agents/configs/human-standard-fixed-per-5.json) — one `human-strategist` seat in Flavor mode (slot 7 → 8-player game, rest VPAI), `production` left unset to exercise the `'test'` normalization.

## Objective

A session with a `human-strategist` seat launches in observe/autoplay with animations ON, the normal (non-strategic) view, the JFD AI Observer mod OFF, and the view pinned to the human's civ via `Game.SetObserverUIOverridePlayer` issued **before** `Game.SetAIAutoPlay`. The `human-strategist` exists as a **stub** — registered, keeping the status quo each decision turn so the game plays through — which is enough for the launcher to key off `strategist === "human-strategist"` and validate the whole launch shape before any decision logic exists.

## Approach: ride the existing `production` visual-mode gating

Animations, strategic view, and the DLL AI-turn cooldown are all already keyed off `isVisualMode(production)` in `StrategistSession`: animation skipping in `start()`, the `ToggleStrategicView()` calls after autoplay starts and after crash recovery (which would otherwise flip a human session into the wireframe strategic view — a gap if animations alone were forced), and the `set-production-mode` tool call. So: when a human seat exists and `production` is unset or `'none'`, **normalize it to `'test'`** with a logged warning. Explicit `'livestream'`/`'recording'` pass through unchanged — recording a human session is legitimate. No per-site special-casing.

## Work items

1. **`vox-agents/src/strategist/agents/human-strategist.ts`** (new) — stub extending `Strategist` with `name = "human-strategist"`. `getSystem` calls `keep-status-quo` with the player's `Mode` and a real rationale (not the `"[skipped]"` sentinel — see stage 3), then returns `""`. This deliberately follows the `NullStrategist` no-model-call path; during the stub stage, `VoxContext` records the existing no-model metadata label (`"VPAI"`) for the turn, which is accurate for the automatic keep-status-quo behavior until stage 3 replaces the stub with the real human wait path.
2. **`vox-agents/src/infra/agent-registry.ts`** — register the stub in `initializeDefaults`, beside `NullStrategist`.
3. **`vox-agents/src/types/config.ts`** — add an `isHumanControl(config)` helper beside `isVisualMode`/`isObsMode`, scanning `llmPlayers` for the hardcoded `"human-strategist"` name. No shared constant is needed; this matches the existing convention for strategist-name checks. No new config flag: the human seat is identified purely by seat assignment, keeping "one config, one command" (spec §6). Human configs should set `mode` explicitly (`VoxPlayer` defaults it to `"Flavor"`).
4. **`vox-agents/src/strategist/strategist-session.ts`**:
   - Normalize `production` to `'test'` early in `start()` when `isHumanControl(config)` and the config isn't already a visual mode.
   - Add a derived `humanPlayerID` getter: scan `llmPlayers` for the human seat and map the config slot through `seatingClaim.seatingMap`, the same way VoxPlayer creation does in `handleGameSwitched`.
   - Never enable the AI Observer mod for human control: extend the `setAiObserver(...)` condition in `start()` so it stays off even though autoplay is on (spec §3 — no observer overlays).
   - In `handleGameSwitched`, **prepend** `Game.SetObserverUIOverridePlayer(<humanPlayerID>);` to the autoplay Lua script, before `Game.SetAIAutoPlay` — ordering matters, the visibility copy happens at autoplay activation. Re-issue the override in `recoverGame` (defensive; the override — like autoplay itself, which recovery also doesn't re-issue — is serialized in saves).
5. **`vox-agents/configs/human-control-test.json`** (new) — example launch config with one Flavor-mode `human-strategist` seat and `production` left unset, so verification exercises the automatic normalization to `'test'`.

## Reuse

The seating-map slot mapping, `setAiObserver` / `updateSkipAnimations` / `buildRequiredModsLua` in `vox-agents/src/infra/vox-civilization.ts`, the whole `isVisualMode` gating chain, and the existing autoplay Lua block.

## Verify

Launch with a human-seat config (production unset → normalized to `'test'` with a warning). In-game: animations play; normal view (no strategic-view wireframe); no JFD observer overlays; camera and top panel pinned to the human civ's fog of war with no auto-switching to whoever just acted; the game auto-plays through with the stub's keep-status-quo decisions visible in replay messages. The generated launch script omits the AI Observer mod GUID. The pinned-view, animations-on, and no-overlays checks require a manual Civ V launch; automated verification covers the config helper, registration, and type-checking only.

## Done when

A human-seat config launches and auto-plays a game indistinguishable from observe mode except for the three human tweaks (animations, no observer UI, pinned view), with the stub seat recording keep-status-quo decisions.
