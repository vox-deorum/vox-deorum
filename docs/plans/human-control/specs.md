# Human Control — Specifications

This plan adds a **human strategist** condition to Vox Deorum: a person takes the seat that an LLM strategist normally occupies, steering one civilization through the same influence-level decisions, under the same rules. The purpose is measurement — establish what a motivated human can achieve as a strategist so that LLM strategist performance can be compared against a human baseline, not just against the stock AI (`none-strategist`) or a neutralized one (`null-strategist`).

This document is the specification: what we want to achieve and the constraints that make the comparison valid. Design and staged implementation plans come after, in this folder.

## The experiment in one paragraph

A human participant sits at the game client of a session running in the same auto-play mode as today's observe experiments: every civilization — including the human's — is played by the in-game AI, with animations enabled so the human can follow what happens. They do **not** play the game directly. Instead, the human steers one civilization through a new in-game decision panel that exposes the same action space the LLM strategists use: grand/economic/military strategies, next research, next policy, AI flavors, persona values, diplomatic relationships, or an explicit "keep status quo." On the human's decision turns the game pauses until they submit, giving them time to inspect the situation. The observer-facing UI that batch experiments load is **not** present, and no other player's reasoning is visible. Everything else about the session — the other civs (LLM-steered or stock AI), pacing, telemetry, outcome metrics — is identical to a normal strategist experiment, so the human's results land in the same databases and are analyzed with the same tools.

## What we want to achieve

### 1. Role parity: human as strategist, not as player

- The human occupies a strategist seat: their decisions are *influence* over the in-game AI (see the MCP server's influence model), never direct orders to units or cities.
- The action space available to the human is exactly the action space available to LLM strategists — the same actions that `simple-strategist` issues through the MCP action tools, including the explicit `keep-status-quo`. Human decision-makers run in **Flavor mode** only; the framework's legacy `Strategy` mode is outdated and is **not supported** for human control. (LLM seats may still run either mode, but the human panel and `human-strategist` target Flavor mode.)
- The human's civilization is auto-played by the in-game AI like every other civ; the human never gets a normal "your turn" prompt for unit moves or city choices.

### 2. Interface: in-game, on observe-mode machinery, without the observer UI

- The session reuses the existing observe-mode machinery: the game auto-plays every civilization just as batch experiments do today. What is new is that the game **pauses at the human's decision points** so a person can study the situation before steering — essentially observer mode that holds still while the human looks at it.
- **The view is pinned to the human's civ — the gamecore already supports this.** Community Patch's "AI takeover" feature does exactly what we need: setting the observer-UI override player (`Game.SetObserverUIOverridePlayer`, available from Lua) before auto-play begins makes the observer slot copy that civ's team visibility plot by plot at activation, and from then on mirror its sight, revealed tiles, met-civilization status, and notifications. Human-control mode launches like observe mode today, with the override set to the human's civ before `SetAIAutoPlay` — the ordering matters, because the initial visibility copy happens only when auto-play activates.
- The observer-facing UI is **not** loaded: no AI Observer (JFD) mod, no rationale overlays. The human watches the plain game client through their civ's fog of war.
- **Animations stay on.** Headless batch runs disable animations for speed; human-control sessions run visually, so the human can trace what happened between decision points instead of facing a teleported world state.
- The interface is a decision panel built **inside the game** as part of `civ5-mod`, loaded as an in-game UI addin when the mod runs in human-control mode. It must be genuinely easy to use: a participant who knows Civilization V but not Vox Deorum should be able to read the current options, compose a decision, and submit it in a few clicks, with plain-language labels — no identifiers to memorize, no console, no developer tooling.
- The option landscape comes from `get-options`, not the panel. On every decision turn the panel is handed the same `get-options` payload the LLM's context is built from — the currently valid options for each action type, each explained with the **same descriptive text the LLM prompts already use**. Mechanically the `human-strategist` triggers `present-decision` with the player and turn, and `present-decision` fetches the Flavor-mode options server-side before pushing them into the game. The panel holds no game logic; it renders exactly the option set and guidance the model would receive, no more and no less. This same hand-off is also how the panel learns a decision is due (see §4).
- A single free-text rationale field accompanies each decision turn. The `human-strategist` replicates that one rationale across whatever action tools it issues for the turn, keeping the replay log, telemetry, and the oracle's fuzzy matching meaningful for human games — with the understood asymmetry that a human rationale covers the whole turn's decision rather than each individual action, the way an LLM's per-tool-call `Rationale` does (see §3).

### 3. Fairness: what the human may and may not see

The comparison is only as good as its information symmetry. The human-control mode must close the leaks that observer/auto-play mode tolerates:

- **No other player's reasoning.** In observe mode, every LLM player's action summaries and rationales surface in-game — replay overlays, top-panel auto-switching, and rationale displays — but those surfaces are all rendered by the observer-facing UI (the JFD AI Observer mod). Human-control mode does not load that UI, so they never render: the `VoxDeorumAction` / `VoxDeorumPlayerInfo` LuaEvents still fire but reach no consumer, and the observer-UI override (see §2) pins the top panel to the human's civ rather than auto-switching to whoever just acted. The leak closes by omission — no dedicated suppression code is required. The only obligation on the new code is that the human-control panel itself renders nothing about civs other than the human's own.
- **Good faith over leak-proofing.** We do not audit every stock game screen for residual information (e.g., what the mid-game replay screens might show). Participants are trusted not to go digging — the spec assumes humans won't cheat, and the suppression work is scoped to what the mode actively presents, not to hardening the whole client.
- **No full-map or out-of-fog information.** The human sees their own civ's view only, via the observer-UI override described above — the client must never present a reveal-all camera.
- **Accepted asymmetries, stated up front.** The human watches the game continuously while the LLM sees periodic textual snapshots; the human sees the game's native visual presentation while the LLM reads formatted reports; the human carries cross-game experience no fresh context has; and the human annotates a whole decision turn with one rationale while an LLM attaches a `Rationale` to each individual tool call. These are inherent to "human at the game screen" — the user-facing writeup of any results must state them rather than pretend they don't exist. Conversely, the LLM's reports are all derived from the same fog-filtered knowledge the human's pinned view shows, so neither side sees state the other side is barred from.

### 4. Pacing: pause until the human decides

- On the human civ's decision turns, the strategist pauses the human's civ at a safe point (the existing bridge pacing) and signals the in-game panel via `present-decision`, which supplies the turn's `get-options` payload — so the panel knows a decision is pending and what the options are. The game stays paused until the human submits a decision or explicitly keeps the status quo. There is no timeout; sessions are supervised.
- Decision turns follow the same pacing rules as LLM strategists — scheduled every N turns plus event-driven interruptions for important events — so the human gets neither more nor fewer decision opportunities than an LLM under the same config.
- Deliberation time per human decision is recorded as simple wall-clock — from when the strategist requests the decision (the panel surfaces it) until the human submits. There is no foreground or active-time accounting: time spent with the game in the background is not excluded. The strategist already holds both timestamps (request sent, submission received), so no OS-level focus tracking is done.

### 5. Comparability: same pipeline, same metrics

- The human is wired in as a strategist implementation — a `human-strategist` registered in the agent registry and assignable in `llmPlayers` like any other — not as a parallel system. Its "model call" is replaced by waiting for the human's submission; everything around it (the `VoxPlayer` loop, `StrategistParameters`, event cursors, crash recovery, MCP action tools) is reused unchanged.
- Decisions leave the game the way render events already do: the panel fires a fire-and-forget `Game.BroadcastEvent`, which travels the existing DLL → bridge → MCP notification path. `HumanDecision` is schema-registered and whitelisted, and the validated event payload is delivered under the notification's top-level `data` object while routing metadata (`event`, `playerID`, `turn`, `latestID`) stays separate. The waiting `human-strategist` receives it and issues the same MCP action tools an LLM would. The existing pause machinery does the waiting, the existing action tools do the acting; no new bridge channel is built.
- Human decisions therefore appear in telemetry, the replay log, and the archivist's databases exactly like LLM decisions, and the existing analysis stack — telepathist, oracle, replayer, `game_outcomes` — works on human games without modification.
- A session can mix seats freely: human strategist alongside LLM strategists and/or stock AI in the same game, or a full human-only-steering game against `none-strategist` civs, depending on the experimental design.

### 6. Session ergonomics

- Starting a human-control session should be one config and one command, the same shape as `npm run strategist` today — a config that names the human seat, with the existing launch (`VoxCivilization`), crash recovery, and shutdown behavior intact. The participant should never need the developer dashboard.
- The in-game panel must make the session state legible to the participant: whose turn the game is waiting on, that a decision is pending, what they decided last, and confirmation that a submission was accepted.
- If the game or stack crashes, the existing recovery machinery applies; the human's pending decision state must survive or be cleanly re-requested after recovery.

## Component impact

- **`civ5-mod`** — the bulk of the new work: a human-control variant of the in-game addin with the decision panel. The panel renders the option landscape and descriptive text handed to it by the strategist (no option computation or game logic in the panel), makes session state legible (whose turn, decision pending, last decision, submission accepted), and submits the turn's decision — with its single rationale — via `Game.BroadcastEvent`.
- **`vox-agents`** — the `human-strategist` agent and the session-config plumbing: a human-control mode built on top of observe mode (auto-play everything, but animations on, observer UI off, pause at the human's decision points); signalling the panel when a decision is due (via `present-decision`, which supplies the turn's `get-options` payload); decision wait/submit handling; recording simple wall-clock deliberation time.
- **`bridge-service`** — expected unchanged: `Game.BroadcastEvent` already carries events out of the game, and player pausing already exists for pacing.
- **`mcp-server`** — still localized, but not just a whitelist entry: the human's decisions execute through the same action tools, the decision event reaches the strategist through the existing event-notification path, `HumanDecision` is schema-registered and whitelisted, event payloads are forwarded inside the notification's `data` object so passthrough fields cannot overwrite routing metadata, `present-decision` pushes the current Flavor-mode option landscape into the game, and a regular heartbeat keeps the SSE channel alive across an unbounded human pause.
- **`civ5-dll`** — nearly unchanged: the observer-UI override that pins the auto-play view to one civ's fog of war already exists in Community Patch (`ObserverUIOverridePlayer`, set via `Game.SetObserverUIOverridePlayer`, serialized in saves); what remains there is in-game verification, not new code. The one code change (stage 7) is a buffer-size bump in the connection service so the full `OptionsReport` always fits through the bridge's `lua_call` path.

## Out of scope

- A web-UI variant of the human strategist interface (the parity argument was considered and the in-game route chosen; a web variant could be a later condition).
- Direct human play (full unit/city control) as a measured condition — that measures a different ceiling and is not part of this plan.
- Multiple simultaneous human strategists in one game (hot-seat or networked). The design should not preclude it, but it is not a goal.
- The pilot protocol — how many games, which map/seed configs, what participant skill profile. That is experimental design, settled outside this plan; the software only needs to support repetition with the existing seed and seating machinery.

## Success criteria

- A human can complete a full game as a strategist — launch to victory/defeat — using only the game client, with the game pausing for each of their decisions and the world otherwise auto-playing with animations visible.
- During play, the client view stays pinned to the human civ's fog of war and no other player's rationale is displayed because the observer UI is not loaded (good faith covers the rest).
- A finished human game is indistinguishable from an LLM game to the analysis stack: telemetry records every human decision with rationale and timing, `game_outcomes` is populated, and the replayer can replay it.
- A mixed game (human + LLM strategists) runs to completion with both kinds of seats deciding under the same pacing config.
