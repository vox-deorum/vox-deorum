# Strategists

Strategists are the agents that play the game. Each turn (or as often as pacing allows), a strategist reads its civilization's situation and steers it: grand strategy, research, policies, diplomatic stances, and AI flavors. It does this through the [MCP server's action tools](../../../mcp-server/tools.md).

Strategists do not move units or manage cities. The game's own AI keeps doing that. A strategist's choices act as _influence_ on the in-game AI (see [influence.md](../../../mcp-server/influence.md)), like a leader setting priorities for their generals.

```
StrategistSession (one game)
 └── VoxPlayer (one per AI seat)
      └── each turn: refresh game state ──► pacing: decide this turn? ──► strategist agent ──► action tools
```

## Pages in this folder

| Page | Covers |
| --- | --- |
| [Game session](game-session.md) | Starting a game, session configs, repeated games, crash recovery. |
| [Player loop](player-loop.md) | What happens each turn for one seat: pacing, event windows, and saved state. |
| [Human control](human-control.md) | Letting a person play a seat through the same controls the LLM uses. |
| [Evaluator strategist](evaluator-strategist.md) | A strategist that decides with one evaluation call instead of a chat. |
| [Evaluator trimming](evaluator-trimming.md) | How that strategist's input is shortened to fit the model. |

## The roster

All strategists extend `Strategist` (`src/strategist/strategist.ts`) and register in `src/infra/agent-registry.ts`.

| Strategist | Role |
| --- | --- |
| `none-strategist` | Does nothing. The baseline for what the unmodified in-game AI achieves. |
| `null-strategist` | Resets the in-game AI to a neutral baseline every decision: clears strategies or balances flavors, and sets persona values to the midpoint. This separates the effect of steering at all from the effect of good steering. |
| `simple-strategist` | The main strategist. It reads the game state and decides directly. |
| `simple-strategist-briefed` | Adds a [briefer](../support-agents.md#briefers) that condenses the reports first, so the strategist's context stays small when the event history is long. |
| `simple-strategist-staffed` | Uses the simple briefer for small event windows or turn 1 and earlier; otherwise combines three specialized briefings in parallel. See [Briefers](../support-agents.md#briefers). |
| `simple-strategist-learned` | The staffed strategist plus memory: `find-episodes` requests similar situations from the [archivist's](../archivist.md) database for the next decision's context. |
| `evaluator-strategist` | Decides with one evaluation call. Flavor mode only, and not offered in setup. See [Evaluator strategist](evaluator-strategist.md). |
| `human-strategist` | Puts a person in the seat. See [Human control](human-control.md). |

### The simple strategist

`simple-strategist` receives the formatted game state: players, cities, military, victory progress, events, and the options from `get-options`. It finishes with `set-strategy` (or `set-flavors` in Flavor mode) or `keep-status-quo`, and can adjust research, policy, persona, and relationships along the way.

### Briefings come first

Briefings must be in the opening prompt, so the briefed and staffed strategists request them in code before the first model call. They are not tool calls. Briefing generation, request sharing, and caching are covered on the [briefers](../support-agents.md#briefers) page.

## Decision modes

The session config picks one of two modes:

| Mode       | Decisions set                    |
| ---------- | -------------------------------- |
| `Strategy` | Explicit strategies.             |
| `Flavor`   | The in-game AI's flavor weights. |

## What a decision leaves behind

Every strategist tool call carries a `Rationale`, and that text travels on:

- It shows in the in-game replay log and top-panel updates (see the civ5-mod [ui.md](../../../civ5-mod/ui.md)).
- It is recorded in telemetry for the [telepathist](../telepathist.md) and [oracle](../oracle.md).
- The oracle fuzzy-matches it to find the right turn when replaying.

The strategist also reports which model is playing through game metadata, so observers can see who drives each civilization.

For how decisions reach the game engine, see the MCP server's [tools.md](../../../mcp-server/tools.md) and [influence.md](../../../mcp-server/influence.md).
