# Human Control — Specifications

This plan adds a **human strategist** condition to Vox Deorum: a person takes the seat that an LLM strategist normally occupies, steering one civilization through the same influence-level decisions, under the same rules. The purpose is measurement — establish what a motivated human can achieve as a strategist so that LLM strategist performance can be compared against a human baseline, not just against the stock AI (`none-strategist`) or a neutralized one (`null-strategist`).

This document is the specification: what we want to achieve and the constraints that make the comparison valid. Design and staged implementation plans come after, in this folder.

## The experiment in one paragraph

A human participant sits at the game client of a session running in the same auto-play mode as today's observe experiments: every civilization — including the human's — is played by the in-game AI, with animations enabled so the human can follow what happens. They do **not** play the game directly. Instead, the human steers one civilization through a new in-game decision panel that exposes the same action space the LLM strategists use: grand/economic/military strategies, next research, next policy, AI flavors, persona values, diplomatic relationships, or an explicit "keep status quo." On the human's decision turns the game pauses until they submit, giving them time to inspect the situation. The observer-facing UI that batch experiments load is **not** present, and no other player's reasoning is visible. Everything else about the session — the other civs (LLM-steered or stock AI), pacing, telemetry, outcome metrics — is identical to a normal strategist experiment, so the human's results land in the same databases and are analyzed with the same tools.

## What we want to achieve

### 1. Role parity: human as strategist, not as player

- The human occupies a strategist seat: their decisions are *influence* over the in-game AI (see the MCP server's influence model), never direct orders to units or cities.
- The action space available to the human is exactly the action space available to LLM strategists — the same actions that `simple-strategist` issues through the MCP action tools, including the explicit `keep-status-quo`. Both decision modes the framework supports (`Strategy` and `Flavor`) should be expressible, with the session config choosing which one the experiment runs, same as for LLMs.
- The human's civilization is auto-played by the in-game AI like every other civ; the human never gets a normal "your turn" prompt for unit moves or city choices.

### 2. Interface: in-game, on observe-mode machinery, without the observer UI

- The session reuses the existing observe-mode machinery: the game auto-plays every civilization just as batch experiments do today. What is new is that the game **pauses at the human's decision points** so a person can study the situation before steering — essentially observer mode that holds still while the human looks at it.
- **The view is pinned to the human's civ — the gamecore already supports this.** Community Patch's "AI takeover" feature does exactly what we need: setting the observer-UI override player (`Game.SetObserverUIOverridePlayer`, available from Lua) before auto-play begins makes the observer slot copy that civ's team visibility plot by plot at activation, and from then on mirror its sight, revealed tiles, met-civilization status, and notifications. Human-control mode launches like observe mode today, with the override set to the human's civ before `SetAIAutoPlay` — the ordering matters, because the initial visibility copy happens only when auto-play activates.
- The observer-facing UI is **not** loaded: no AI Observer (JFD) mod, no rationale overlays. The human watches the plain game client through their civ's fog of war.
- **Animations stay on.** Headless batch runs disable animations for speed; human-control sessions run visually, so the human can trace what happened between decision points instead of facing a teleported world state.
- The interface is a decision panel built **inside the game** as part of `civ5-mod`, loaded as an in-game UI addin when the mod runs in human-control mode. It must be genuinely easy to use: a participant who knows Civilization V but not Vox Deorum should be able to read the current options, compose a decision, and submit it in a few clicks, with plain-language labels — no identifiers to memorize, no console, no developer tooling.
- The panel computes the currently valid options for each action type **from local Lua game state** — the same option landscape the LLM receives from `get-options`. Each action and option is explained with the **same descriptive text the LLM prompts already use**, so guidance stays symmetric: the human reads exactly what the model reads, no more and no less.
- A free-text rationale field accompanies each decision, mirroring the `Rationale` argument every LLM tool call carries — this keeps the replay log, telemetry, and the oracle's fuzzy matching meaningful for human games.

### 3. Fairness: what the human may and may not see

The comparison is only as good as its information symmetry. The human-control mode must close the leaks that observer/auto-play mode tolerates:

- **No other player's reasoning.** In observe mode, every LLM player's action summaries and rationales surface in-game — replay messages, top-panel auto-switching, and the `VoxDeorumAction` / `VoxDeorumPlayerInfo` LuaEvents fire for all players in the UI context. In human-control mode, none of that may be actively displayed for civs other than the human's own: the top panel must not auto-switch, and no overlay renders other players' rationales.
- **Good faith over leak-proofing.** We do not audit every stock game screen for residual information (e.g., what the mid-game replay screens might show). Participants are trusted not to go digging — the spec assumes humans won't cheat, and the suppression work is scoped to what the mode actively presents, not to hardening the whole client.
- **No full-map or out-of-fog information.** The human sees their own civ's view only, via the observer-UI override described above — the client must never present a reveal-all camera.
- **Accepted asymmetries, stated up front.** The human watches the game continuously while the LLM sees periodic textual snapshots; the human sees the game's native visual presentation while the LLM reads formatted reports; the human carries cross-game experience no fresh context has. These are inherent to "human at the game screen" — the user-facing writeup of any results must state them rather than pretend they don't exist. Conversely, the LLM's reports are all derived from the same fog-filtered knowledge the human's pinned view shows, so neither side sees state the other side is barred from.

### 4. Pacing: pause until the human decides

- On the human civ's decision turns, the game pauses (the existing bridge pacing that holds a player at a safe point) until the human submits a decision or explicitly keeps the status quo. There is no timeout; sessions are supervised.
- Decision turns follow the same pacing rules as LLM strategists — scheduled every N turns plus event-driven interruptions for important events — so the human gets neither more nor fewer decision opportunities than an LLM under the same config.
- Deliberation time per human decision is recorded — with a caveat: we only count the time human spent actively in the time, counted as follows: whenever a human's decision-making turn starts, they need to click a button; till the human completes the decision. 

### 5. Comparability: same pipeline, same metrics

- The human is wired in as a strategist implementation — a `human-strategist` registered in the agent registry and assignable in `llmPlayers` like any other — not as a parallel system. Its "model call" is replaced by waiting for the human's submission; everything around it (the `VoxPlayer` loop, `StrategistParameters`, event cursors, crash recovery, MCP action tools) is reused unchanged.
- Decisions leave the game the way render events already do: the panel fires a fire-and-forget `Game.BroadcastEvent`, which travels the existing DLL → bridge → MCP notification path. The waiting `human-strategist` receives it and issues the same MCP action tools an LLM would. Nothing new is invented for transport — the existing pause machinery does the waiting, the existing action tools do the acting.
- Human decisions therefore appear in telemetry, the replay log, and the archivist's databases exactly like LLM decisions, and the existing analysis stack — telepathist, oracle, replayer, `game_outcomes` — works on human games without modification.
- A session can mix seats freely: human strategist alongside LLM strategists and/or stock AI in the same game, or a full human-only-steering game against `none-strategist` civs, depending on the experimental design.

### 6. Session ergonomics

- Starting a human-control session should be one config and one command, the same shape as `npm run strategist` today — a config that names the human seat, with the existing launch (`VoxCivilization`), crash recovery, and shutdown behavior intact. The participant should never need the developer dashboard.
- The in-game panel must make the session state legible to the participant: whose turn the game is waiting on, that a decision is pending, what they decided last, and confirmation that a submission was accepted.
- If the game or stack crashes, the existing recovery machinery applies; the human's pending decision state must survive or be cleanly re-requested after recovery.

## Component impact

- **`civ5-mod`** — the bulk of the new work: a human-control variant of the in-game addin with the decision panel; suppression of other-player rationale surfaces (top-panel switching, overlays) in this mode; computing the valid option lists from local Lua game state; reusing the LLM prompts' descriptive text for in-panel guidance; submitting decisions via `Game.BroadcastEvent`.
- **`vox-agents`** — the `human-strategist` agent and the session-config plumbing: a human-control mode built on top of observe mode (auto-play everything, but animations on, observer UI off, pause at the human's decision points); decision wait/submit handling; foreground-aware deliberation timing via the game process the stack already owns.
- **`bridge-service`** — expected unchanged: `Game.BroadcastEvent` already carries events out of the game, and player pausing already exists for pacing.
- **`mcp-server`** — expected unchanged or nearly so: the human's decisions execute through the same action tools, and the decision event reaches the strategist through the existing event-notification path.
- **`civ5-dll`** — expected unchanged: the observer-UI override that pins the auto-play view to one civ's fog of war already exists in Community Patch (`ObserverUIOverridePlayer`, set via `Game.SetObserverUIOverridePlayer`, serialized in saves); what remains is in-game verification, not new code.

## Out of scope

- A web-UI variant of the human strategist interface (the parity argument was considered and the in-game route chosen; a web variant could be a later condition).
- Direct human play (full unit/city control) as a measured condition — that measures a different ceiling and is not part of this plan.
- Multiple simultaneous human strategists in one game (hot-seat or networked). The design should not preclude it, but it is not a goal.
- The pilot protocol — how many games, which map/seed configs, what participant skill profile. That is experimental design, settled outside this plan; the software only needs to support repetition with the existing seed and seating machinery.

## Success criteria

- A human can complete a full game as a strategist — launch to victory/defeat — using only the game client, with the game pausing for each of their decisions and the world otherwise auto-playing with animations visible.
- Recorded deliberation times demonstrably exclude time the game spent in the background (e.g., alt-tabbing away during a pending decision stops the foreground timer).
- During play, the client view stays pinned to the human civ's fog of war and the mode actively displays no other player's rationale (good faith covers the rest).
- A finished human game is indistinguishable from an LLM game to the analysis stack: telemetry records every human decision with rationale and timing, `game_outcomes` is populated, and the replayer can replay it.
- A mixed game (human + LLM strategists) runs to completion with both kinds of seats deciding under the same pacing config.