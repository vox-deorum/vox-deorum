# vox-agents: Strategists

Strategists are the agents that actually play the game. Once per AI turn, or as often as the pacing rules allow, a strategist reads the current situation and steers its civilization. It adjusts grand strategy, research, policies, diplomatic stances, and AI flavors through the [MCP server's action tools](../mcp-server/tools.md).

Strategists do not micromanage units; the game's own tactical AI keeps doing that. This is why a strategist's choices are expressed as _influence_ over the in-game AI (see [influence.md](../mcp-server/influence.md)) rather than direct orders.

This page covers the whole turn-playing machinery: the session that owns a game, the per-player loop, the parameters that persist across turns, and the strategist roster.

## The session: one game, start to victory

`StrategistSession` (`src/strategist/strategist-session.ts`) owns a single game's lifecycle. It starts from the console entry point (`npm run strategist`, `src/strategist/console.ts`) or from the web UI's session controls. On start it launches Civilization V through `VoxCivilization`, connects the MCP client, and creates one `VoxPlayer` per LLM-controlled player.

The launcher starts Civilization V directly. `VoxCivilization` waits up to 30 seconds for the game process to appear, then binds to it so the session can connect and enable autoplay while the game continues running. Launcher errors or a missing game process fail startup.

It then reacts to MCP notifications until the game ends:

- `PlayerDoneTurn` drives the players' turn loops.
- `GameSwitched` rebinds to a new game ID.
- `PlayerVictory` triggers a graceful shutdown once the game's archive is safely on disk.

### Configuration

Sessions are configured by JSON files in `vox-agents/configs/` (`StrategistSessionConfig`). The top level contains curated starters; `vox-agents/configs/experiments/` contains research and recording configurations. The essentials:

| Field | Purpose |
| --- | --- |
| `llmPlayers` | Maps player IDs to strategist (and optionally model) assignments, deciding which agent plays whom. |
| `autoPlay` | Selects the usage mode. See below. |
| `repetition` | Plays several games in sequence for reproducible multi-game experiments. See below. |
| `production` | Controls animation and recording behavior. See [media.md](media.md). |

**Usage modes (`autoPlay`).** Interactive mode (the default) pauses on human turns so a person can play alongside the AI. Observe mode auto-plays everything, for watching or batch experiments. Assigning the `human-strategist` to a seat layers **human-control mode** on top of observe mode; see the roster below.

**Repetition.** Combined with seed and seating randomization, `repetition` supports reproducible multi-game experiments. Configured random seeds are written into Civ's `config.ini` before launch by `VoxCivilization` (`src/infra/vox-civilization.ts`), which also captures the previous values and restores them afterward. `StrategistSession` then verifies the seeds Civ actually reports against the ones requested, and records both for auditability. When a new-game config omits `randomSeeds`, the seed settings are written as zero for that launch, so stale fixed seeds in the user's `config.ini` do not carry over. Player seating can rotate between runs.

Start mode is supplied at launch, not persisted in a configuration: `--load`/`-l` selects a save, `--wait`/`-w` waits for manual start, and the default is a new game. Other command-line flags are `--config`/`-c`, `--players`/`-p`, `--strategist`/`-s`, `--autoPlay`/`-a`, `--repetition`/`-r`, and `--seed`.

### Crash recovery

If the DLL disconnects and stays down, the session kills and relaunches the game process (with bounded attempts), recreates the players, and resumes play from where the strategists left off. Each recreated `VoxPlayer` carries its event cursor forward, and last-decision turns survive the restart.

## The player loop

Each LLM-controlled player gets a `VoxPlayer` (`src/strategist/vox-player.ts`) with its own `VoxContext`. When the player's turn-done notification arrives, the loop refreshes the game state through MCP knowledge tools, then decides whether this is a turn worth a full decision.

That **pacing** logic mixes scheduled decisions (every N turns) with event-driven interruptions when something important happens, such as a war declaration or a completed wonder. On turns it skips, the player still calls `keep-status-quo` so the in-game AI knows the LLM is intentionally staying the course.

Each processed turn runs inside its own [root run](overview.md) carrying that turn's event window. This is what keeps the strategist's queued (and possibly lagging) decision turn independent from a diplomat chatting on the session's live turn: the two run concurrently on the same seat without disturbing each other.

### Event windows

The events the strategist sees are windowed by a rolling cursor, so skipped turns fold their events into the next decision rather than being lost. The per-turn `events` slice fetched by each refresh stays immutable.

When a decision spans several turns, an event-window fallback assembles a derived `mergedEvents` window that strategists and briefers read in preference to the raw slice. If the accumulated context still overflows the model's window, the fallback narrows that window one turn at a time and retries.

### Persistent state and decision modes

State that persists across turns lives in the seat's base parameters, `StrategistParameters` (`src/strategist/strategy-parameters.ts`):

- Cached per-turn game-state snapshots (old ones are culled).
- A working memory for things like briefing instructions and episode requests.
- The decision mode, the last-decision turn, and game metadata.

Each turn composes a run-local view over this base for its own turn and event bounds. The rolling event cursor itself is owned by the `VoxPlayer`.

Strategists run in one of two **modes**, selected in the session config: `Strategy`, where decisions set explicit strategies, or `Flavor`, where they tune the in-game AI's flavor weights instead.

## The roster

All strategists extend the `Strategist` base class (`src/strategist/strategist.ts`) and are registered in the global agent registry (`src/infra/agent-registry.ts`).

| Strategist | Role |
| --- | --- |
| `none-strategist` | Does nothing. The baseline for measuring what the unmodified in-game AI achieves. |
| `null-strategist` | Actively resets the in-game AI to a neutral baseline each decision (clears strategies or balances flavors, resets persona to midpoints), isolating the effect of _any_ LLM steering from the steering itself. |
| `simple-strategist` | The workhorse. See below. |
| `simple-strategist-briefed` | Inserts a [briefing](support-agents.md) stage: a briefer condenses the raw reports into a strategic summary first, keeping the strategist's context small when event history is long. |
| `simple-strategist-staffed` | Runs three specialized briefers (military, economy, diplomacy) in parallel and assembles their reports. The most thorough analysis, at the highest token cost. Falls back to the simple briefer when there is little to summarize. |
| `simple-strategist-learned` | Extends the staffed variant with retrieval: a `find-episodes` tool lets the model ask for similar situations from past games, answered from the [archivist's](archivist.md) episode database and injected into the next turn's context. |
| `human-strategist` | Puts a person in a strategist seat instead of a model. See below. |

**`simple-strategist`** receives the formatted game state (players, cities, military, victory progress, events, and the option landscape from `get-options`) and makes a decision directly. It finishes with `set-strategy` (or `set-flavors` in Flavor mode) or `keep-status-quo`, plus research, policy, persona, and relationship adjustments along the way.

**`human-strategist`** is the baseline for comparing LLM play against a motivated human. Its "model call" is replaced by waiting for the human's in-game submission; everything around it (the `VoxPlayer` loop, pacing, parameters, crash recovery, MCP action tools) is reused unchanged. It follows the `null-strategist` idiom: all its work happens in `getSystem()` via `context.callTool(...)`, then it returns `""` to skip the LLM loop. See **Human-control mode** below.

Briefings have to be in the opening prompt, so they are requested programmatically before the strategist's first LLM call, via `requestBriefing()` in `src/briefer/briefing-utils.ts`, rather than as tool calls. The deduplication there ensures concurrent requests share one generation.

## What a decision looks like

A strategist's tool calls all carry a `Rationale` argument, and that rationale is what flows back into the game. It appears in the in-game replay log and top-panel updates (see the civ5-mod [ui.md](../civ5-mod/ui.md)), is recorded in telemetry for the [telepathist](telepathist.md) and [oracle](oracle.md) to read later, and is fuzzy-matched by the oracle when it replays the turn.

The strategist also reports which model is playing via game metadata, so observers can see who is driving each civilization.

For the player's-eye view of what these agents do in a game, see the players' guide. For how the decisions travel into the game engine, see the MCP server's [tools.md](../mcp-server/tools.md) and [influence.md](../mcp-server/influence.md).

## Human-control mode

Human-control mode lets a person occupy a strategist seat and steer one civilization through the _same_ influence-level action space the LLM strategists use. A human game therefore lands in the same telemetry, replay, and `game_outcomes` databases and is analyzed by the same tools.

It is a research condition for measuring LLM play against a human baseline, not a way to play the game directly. The human steers _influence_ over the in-game AI, never units or cities. The full design and the staged implementation plan live in `docs/plans/human-control/`.

### How a session enters the mode

There is no dedicated config flag. A session becomes a human-control session whenever any seat in `llmPlayers` is assigned the `human-strategist` (`isHumanControl()` in `src/types/config.ts`). Seats mix freely: human, LLM, and stock AI in one game.

It builds on observe mode, so every civ including the human's is auto-played by the in-game AI, with two adjustments forced on for fairness and usability:

- **Animations stay on.** The production mode is normalized to `test` if unset, so the human can follow the world between decisions.
- **The observer UI is not loaded** (`setAiObserver(false)`), so no other player's rationale renders.

The launch also pins the view to the human's civ via `Game.SetObserverUIOverridePlayer` before auto-play activates, so the human sees only their own civ's fog of war and resource discoveries. The DLL applies the override player's reveal technology and policy when rendering map resources, plus a narrow compatibility patch for native reward popups that still key directly off the active player.

### How a human decision flows through the machinery

The machinery is otherwise unchanged from an LLM turn.

- **Pacing is identical.** The human seat goes through the same `isScheduledDecision` and `shouldInterruptDecision` gate in `VoxPlayer` as any LLM, with no human-specific branch.
- **The panel learns a decision is due from `present-decision`.** When the gate fires, the human-strategist triggers that [action tool](../mcp-server/tools.md) with just `{PlayerID, Turn}`. The tool fetches the turn's Flavor-mode option landscape server-side via `get-options` and pushes a strongly-typed `OptionsReport` into the in-game [decision panel](../civ5-mod/ui.md): the same options and descriptive text an LLM's context is built from.
- **The wait rides the existing pause.** `VoxPlayer.execute` already pauses the game around a strategist run, so the human-strategist simply awaits the human's submission on a per-session decision bus (`src/strategist/human-decision-bus.ts`). That bus is keyed by playerID, owned by the `StrategistSession`, and threaded to the strategist through a non-serialized `parameters._humanDecisionBus` field. Only the human-strategist touches the bus, so mixed seats stay isolated. There is no timeout (sessions are supervised), and an always-on MCP heartbeat keeps the SSE channel alive across the unbounded pause.
- **The submission travels the existing event path.** The panel fires `Game.BroadcastEvent("HumanDecision", …)`. That schema-registered, whitelisted event travels DLL → bridge → MCP notification → the session's notification handler, which resolves the bus for that playerID.
- **The same action tools do the acting.** The human-strategist maps the one submission onto the same action tools an LLM issues (`set-flavors`, `set-research`, `set-policy`, `set-persona`, `set-relationship`, or `keep-status-quo`) and replicates the single free-text rationale across each call. Human control is Flavor mode only. There is no separate write path: the knowledge writes, replay messages, and `VoxDeorumAction` events all come from the action tools, exactly as for an LLM.
- **Decision cost is comparable.** The panel measures wall-clock deliberation time from first dialog open to submit. The human-strategist records it in the same two slots LLM token cost uses: the per-turn `deliberation.ms` turn-span attribute and an accumulated per-player `deliberationMs-<playerID>` metadata entry.
- **Crash recovery re-requests rather than drops.** On relaunch the session cancels any pending bus request (rejecting it cleanly), recreates the players, and the human-strategist re-fires `present-decision` so the panel re-receives the options event. The observer-UI override is re-issued defensively.
