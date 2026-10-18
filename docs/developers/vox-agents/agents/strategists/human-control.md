# Human control

Human-control mode puts a person in a strategist seat. The person steers one civilization through the same controls an LLM strategist uses: flavors, research, policy, persona, and relationships. They never move units or manage cities directly.

This is a research setup for comparing LLM play with a motivated human. Because the human uses the same action space and the same machinery, a human game lands in the same telemetry, replay, and `game_outcomes` databases and is analyzed with the same tools. The design and staged plan are in `docs/plans/archived/human-control/`.

```
VoxPlayer pacing says "decide now"
   │
   ▼
human-strategist ──present-decision──► in-game decision panel
   │                                         │ person chooses
   │ waits on the decision bus               ▼
   ◄──────── HumanDecision event ◄── DLL ◄── panel submits
   │
   ▼
same action tools as an LLM (set-flavors, set-research, ...)
```

## Turning it on

There is no separate flag. Any session that assigns `human-strategist` to a seat in `llmPlayers` is a human-control session (`isHumanControl()` in `src/types/config.ts`). Seats can mix: human, LLM, and stock AI in one game.

The mode builds on observe mode, so every civilization, including the human's, is auto-played by the in-game AI. Two settings are forced for fairness and usability:

| Setting | Why |
| --- | --- |
| Animations stay on (production mode becomes `test` if unset) | The person can follow the world between decisions. |
| The observer UI is not loaded (`setAiObserver(false)`) | No other player's rationale is shown. |

Before auto-play starts, the launch pins the view to the human's civilization with `Game.SetObserverUIOverridePlayer`, so the person sees only their own fog of war and resource discoveries. The DLL uses the override player's technology and policies when showing map resources, plus a small fix for native reward popups that still look at the active player.

## How a human decision works

`human-strategist` reuses everything around the model call (the `VoxPlayer` loop, pacing, parameters, crash recovery, and action tools). Like `null-strategist`, it does all its work in `getSystem()` through `context.callTool(...)`, then returns an empty string to skip the model.

1. **Pacing is the same.** The seat goes through the same `isScheduledDecision` and `shouldInterruptDecision` checks as any LLM seat.
2. **The panel is told a decision is due.** The strategist calls the [`present-decision`](../../../mcp-server/tools.md) tool with `{PlayerID, Turn}`. The tool fetches the Flavor-mode options through `get-options` and pushes them into the in-game [decision panel](../../../civ5-mod/ui.md). These are the same options and text an LLM's prompt is built from.
3. **The wait uses the existing pause.** `VoxPlayer.execute` already pauses the game during a strategist run. The strategist waits for the person's submission on a decision bus (`src/strategist/human-decision-bus.ts`).
   - The bus is owned by the session, keyed by player ID, and passed to the strategist in the non-saved `parameters._humanDecisionBus` field.
   - Only the human strategist uses it, so mixed seats stay separate.
   - There is no timeout, since sessions are supervised. An MCP heartbeat keeps the connection alive during the pause.
4. **The submission travels the normal event path.** The panel fires `Game.BroadcastEvent("HumanDecision", …)`. The event goes DLL → bridge → MCP notification → the session, which resolves the bus for that player.
5. **The same action tools act.** The strategist turns the submission into `set-flavors`, `set-research`, `set-policy`, `set-persona`, `set-relationship`, or `keep-status-quo`, and copies the person's one rationale into each call. There is no separate write path, so knowledge writes, replay messages, and `VoxDeorumAction` events all come from the action tools, as for an LLM.

Human control works in Flavor mode only.

## Comparable cost

The panel measures thinking time from when the dialog first opens to submission. The strategist records it where LLM cost goes:

- `deliberation.ms` on the turn span,
- a running per-player total in the `deliberationMs-<playerID>` metadata entry.

## Crash recovery

A relaunch of the same game keeps the existing players and uses [reload handling](game-session.md#crash-recovery) to restart their timelines. Switching to a different game cancels pending decision requests and recreates the players; the next human decision presents its options again.
