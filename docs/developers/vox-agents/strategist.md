# vox-agents — Strategists

Strategists are the agents that actually play the game: once per AI turn (or as often as the pacing rules allow), a strategist reads the current situation and steers its civilization by adjusting grand strategy, research, policies, diplomatic stances, and AI flavors through the [MCP server's action tools](../mcp-server/tools.md). They do not micromanage units — the game's own tactical AI keeps doing that — which is why a strategist's choices are expressed as *influence* over the in-game AI (see [influence.md](../mcp-server/influence.md)) rather than direct orders.

This page covers the whole turn-playing machinery: the session that owns a game, the per-player loop, the parameters that persist across turns, and the strategist roster.

## The session: one game, start to victory

`StrategistSession` (`src/strategist/strategist-session.ts`) owns a single game's lifecycle. Started from the console entry point (`npm run strategist`, `src/strategist/console.ts`) or from the web UI's session controls, it launches Civilization V through `VoxCivilization`, connects the MCP client, creates one `VoxPlayer` per LLM-controlled player, and then reacts to MCP notifications until the game ends: `PlayerDoneTurn` drives the players' turn loops, `GameSwitched` rebinds to a new game ID, and `PlayerVictory` triggers a graceful shutdown once the game's archive is safely on disk.

Sessions are configured by JSON files in `vox-agents/configs/` (`StrategistSessionConfig`). The essentials:

- **`llmPlayers`** maps player IDs to strategist (and optionally model) assignments — which agent plays whom.
- **`gameMode`** picks how the game comes up: `start` generates a new game, `load` loads a save, and `wait` leaves launching to a human and waits for the DLL to connect.
- **`autoPlay`** selects between the two usage modes. Interactive mode (the default) pauses on human turns so a person can play alongside the AI; observe mode auto-plays everything, for watching or batch experiments.
- **`repetition`** plays several games in sequence; combined with seed and seating randomization, this supports reproducible multi-game experiments where configured random seeds are written into the game's settings and verified after launch, and player seating can rotate between runs.
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

Briefings are requested programmatically before the strategist's first LLM call (via `requestBriefing()` in `src/briefer/briefing-utils.ts`), not as tool calls — they have to be in the opening prompt, and the deduplication there ensures concurrent requests share one generation.

## What a decision looks like

A strategist's tool calls all carry a `Rationale` argument, and that rationale is what flows back into the game: it appears in the in-game replay log and top-panel updates (see the civ5-mod [ui.md](../civ5-mod/ui.md)), is recorded in telemetry for the [telepathist](telepathist.md) and [oracle](oracle.md) to read later, and is fuzzy-matched by the oracle when it replays the turn. The strategist also reports which model is playing via game metadata, so observers can see who is driving each civilization.

For the player's-eye view of what these agents do in a game, see the players' guide; for how the decisions travel into the game engine, see the MCP server's [tools.md](../mcp-server/tools.md) and [influence.md](../mcp-server/influence.md).
