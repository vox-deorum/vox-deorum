# vox-agents — Strategists

Strategists are the agents that actually play the game: once per AI turn (or as often as the pacing rules allow), a strategist reads the current situation and steers its civilization by adjusting grand strategy, research, policies, diplomatic stances, and AI flavors through the [MCP server's action tools](../mcp-server/tools.md). They do not micromanage units — the game's own tactical AI keeps doing that — which is why a strategist's choices are expressed as *influence* over the in-game AI (see [influence.md](../mcp-server/influence.md)) rather than direct orders.

This page covers the whole turn-playing machinery: the session that owns a game, the per-player loop, the parameters that persist across turns, and the strategist roster.

## The session: one game, start to victory

`StrategistSession` (`src/strategist/strategist-session.ts`) owns a single game's lifecycle. Started from the console entry point (`npm run strategist`, `src/strategist/console.ts`) or from the web UI's session controls, it launches Civilization V through `VoxCivilization`, connects the MCP client, creates one `VoxPlayer` per LLM-controlled player, and then reacts to MCP notifications until the game ends: `PlayerDoneTurn` drives the players' turn loops, `GameSwitched` rebinds to a new game ID, and `PlayerVictory` triggers a graceful shutdown once the game's archive is safely on disk.

Sessions are configured by JSON files in `vox-agents/configs/` (`StrategistSessionConfig`). The essentials:

- **`llmPlayers`** maps player IDs to strategist (and optionally model) assignments — which agent plays whom.
- **`gameMode`** picks how the game comes up: `start` generates a new game, `load` loads a save, and `wait` leaves launching to a human and waits for the DLL to connect.
- **`autoPlay`** selects between the two usage modes. Interactive mode (the default) pauses on human turns so a person can play alongside the AI; observe mode auto-plays everything, for watching or batch experiments. Assigning the `human-strategist` to a seat layers **human-control mode** on top of observe mode — see the roster below.
- **`repetition`** plays several games in sequence; combined with seed and seating randomization, this supports reproducible multi-game experiments where configured random seeds are written into the game's settings and verified after launch, and player seating can rotate between runs. When a new-game config omits `randomSeeds`, Vox writes Civ's seed settings as zero for that launch so stale fixed seeds in the user's `config.ini` do not carry over.
- **`production`** controls animation and recording behavior — see [media.md](media.md).

Command-line flags (`--config`, `--autoPlay`, `--players`, `--strategist`, `--load`, `--seed`, `--repetition`) override the file. The session also handles crash recovery: if the DLL disconnects and stays down, the game process is killed and relaunched (bounded attempts), the players are recreated, and play resumes from where the strategists left off — their event cursors and last-decision turns survive the restart.

## The player loop

Each LLM-controlled player gets a `VoxPlayer` (`src/strategist/vox-player.ts`) with its own `VoxContext`. When the player's turn-done notification arrives, the loop refreshes the game state through MCP knowledge tools, then decides whether this is a turn worth a full decision. That **pacing** logic mixes scheduled decisions (every N turns) with event-driven interruptions (something important happened — a war declaration, a completed wonder); on turns it skips, the player still calls `keep-status-quo` so the in-game AI knows the LLM is intentionally staying the course. The events the strategist sees are windowed by a rolling cursor, so skipped turns fold their events into the next decision rather than being lost; if the accumulated context overflows the model's window, an automatic fallback narrows the event window and retries.

State that persists across turns lives in `StrategistParameters` (`src/strategist/strategy-parameters.ts`): cached per-turn game-state snapshots (old ones are culled), a working memory for things like briefing instructions and episode requests, the event cursor, the decision mode, and game metadata. Strategists run in one of two **modes** — `Strategy`, where decisions set explicit strategies, or `Flavor`, where they tune the in-game AI's flavor weights instead — selected in the session config.

## The roster

All strategists extend the `Strategist` base class (`src/strategist/strategist.ts`) and are registered in the global agent registry (`src/infra/agent-registry.ts`):

- **`none-strategist`** does nothing — the baseline for measuring what the unmodified in-game AI achieves.
- **`null-strategist`** actively resets the in-game AI to a neutral baseline each decision (clears strategies or balances flavors, resets persona to midpoints), isolating the effect of *any* LLM steering from the steering itself.
- **`simple-strategist`** is the workhorse: it receives the formatted game state — players, cities, military, victory progress, events, and the option landscape from `get-options` — and makes a decision directly, finishing with `set-strategy` (or `set-flavors` in Flavor mode) or `keep-status-quo`, plus research, policy, persona, and relationship adjustments along the way.
- **`simple-strategist-briefed`** inserts a [briefing](support-agents.md) stage: a briefer condenses the raw reports into a strategic summary first, keeping the strategist's context small when event history is long.
- **`simple-strategist-staffed`** runs three specialized briefers (military, economy, diplomacy) in parallel and assembles their reports — the most thorough analysis, at the highest token cost. It falls back to the simple briefer when there is little to summarize.
- **`simple-strategist-learned`** extends the staffed variant with retrieval: a `find-episodes` tool lets the model ask for similar situations from past games, answered from the [archivist's](archivist.md) episode database and injected into the next turn's context.
- **`human-strategist`** puts a person in a strategist seat instead of a model — the baseline for comparing LLM play against a motivated human. Its "model call" is replaced by waiting for the human's in-game submission; everything around it (the `VoxPlayer` loop, pacing, parameters, crash recovery, MCP action tools) is reused unchanged. It follows the `null-strategist` idiom — all its work happens in `getSystem()` via `context.callTool(...)`, then it returns `""` to skip the LLM loop. See **Human-control mode** below.

Briefings are requested programmatically before the strategist's first LLM call (via `requestBriefing()` in `src/briefer/briefing-utils.ts`), not as tool calls — they have to be in the opening prompt, and the deduplication there ensures concurrent requests share one generation.

## What a decision looks like

A strategist's tool calls all carry a `Rationale` argument, and that rationale is what flows back into the game: it appears in the in-game replay log and top-panel updates (see the civ5-mod [ui.md](../civ5-mod/ui.md)), is recorded in telemetry for the [telepathist](telepathist.md) and [oracle](oracle.md) to read later, and is fuzzy-matched by the oracle when it replays the turn. The strategist also reports which model is playing via game metadata, so observers can see who is driving each civilization.

For the player's-eye view of what these agents do in a game, see the players' guide; for how the decisions travel into the game engine, see the MCP server's [tools.md](../mcp-server/tools.md) and [influence.md](../mcp-server/influence.md).

## Human-control mode

Human-control mode lets a person occupy a strategist seat and steer one civilization through the *same* influence-level action space the LLM strategists use, so a human game lands in the same telemetry, replay, and `game_outcomes` databases and is analyzed by the same tools. It is a research condition for measuring LLM play against a human baseline, not a way to play the game directly — the human steers *influence* over the in-game AI, never units or cities. The full design and the staged implementation plan live in `docs/plans/human-control/`.

There is no dedicated config flag: a session becomes a human-control session whenever any seat in `llmPlayers` is assigned the `human-strategist` (`isHumanControl()` in `src/types/config.ts`). It builds on observe mode — every civ, including the human's, is auto-played by the in-game AI — but with two adjustments forced on for fairness and usability: **animations stay on** (the production mode is normalized to `test` if unset, so the human can follow the world between decisions) and the **observer UI is not loaded** (`setAiObserver(false)`), so no other player's rationale renders. The launch also pins the view to the human's civ via `Game.SetObserverUIOverridePlayer` before auto-play activates, so the human sees only their own civ's fog of war. Seats mix freely — human, LLM, and stock AI in one game.

How a human decision flows through the otherwise-unchanged machinery:

- **Pacing is identical.** The human seat goes through the same `isScheduledDecision` / `shouldInterruptDecision` gate in `VoxPlayer` as any LLM — neither more nor fewer decision opportunities under the same pacing config, with no human-specific branch.
- **The panel learns a decision is due, and what the options are, from `present-decision`.** When the gate fires, the human-strategist triggers the [`present-decision`](../mcp-server/tools.md) action tool with just `{PlayerID, Turn}`; that tool fetches the turn's Flavor-mode option landscape server-side via `get-options` and pushes the strongly-typed `OptionsReport` into the in-game [decision panel](../civ5-mod/ui.md) — the same options and descriptive text an LLM's context is built from.
- **The wait rides the existing pause.** `VoxPlayer.execute` already pauses the game around a strategist run; the human-strategist simply `await`s the human's submission on a **per-session decision bus** (`src/strategist/human-decision-bus.ts`) — a `Map` keyed by playerID, owned by the `StrategistSession` instance and threaded to the strategist through a non-serialized `parameters._humanDecisionBus` field. Only the human-strategist touches the bus; LLM and stock-AI seats never do, so mixed seats stay isolated. There is no timeout — sessions are supervised — and an always-on MCP heartbeat keeps the SSE channel alive across the unbounded pause.
- **The submission travels the existing event path.** The panel fires `Game.BroadcastEvent("HumanDecision", …)`; that schema-registered, whitelisted event travels DLL → bridge → MCP notification (payload under the notification's `data` object) → the session's notification handler, which resolves the bus for that playerID.
- **The same action tools do the acting.** The human-strategist maps the one submission onto the same action tools an LLM issues — `set-flavors`, `set-research`, `set-policy`, `set-persona`, `set-relationship`, or `keep-status-quo` — and replicates the single free-text rationale across each call. (Human control is Flavor mode only; legacy Strategy mode is not supported.) There is no separate write path: the `*Changes` knowledge writes, replay messages, and `VoxDeorumAction` events all come from the action tools, exactly as for an LLM.
- **Decision cost is comparable.** The panel measures wall-clock deliberation time (first dialog open to submit); the human-strategist records it in the same two slots LLM token cost uses — the per-turn `deliberation.ms` turn-span attribute (alongside `tokens.*`) and an accumulated per-player `deliberationMs-<playerID>` metadata entry (via the same `set-metadata` tool that writes `inputTokens-<playerID>`).
- **Crash recovery re-requests rather than drops.** On relaunch the session cancels any pending bus request (rejecting it cleanly), recreates the players, and the human-strategist re-fires `present-decision` so the panel re-receives the options event; the observer-UI override is re-issued defensively.
