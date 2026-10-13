# Player loop

Each AI seat has a `VoxPlayer` (`src/strategist/vox-player.ts`) with its own [context](../../framework/runs.md). When the game says the player finished a turn, the loop refreshes the game state, decides whether this turn deserves a full decision, and runs the strategist if so.

```
PlayerDoneTurn
   │
   ├─ refresh game state (MCP knowledge tools), write seat records
   ├─ pacing: decide now?
   │     ├─ no  ──► keep-status-quo   (events roll into the next decision)
   │     └─ yes ──► strategist run     (sees all events since the last decision)
   └─ on success, move the event window forward
```

## Pacing

Pacing decides which turns get a full decision. It mixes two triggers:

- **Schedule.** Every N turns (`everyTurns`, default 1).
- **Interruptions.** Something important happened, such as a war declaration or a finished wonder.

On a skipped turn, the player still calls `keep-status-quo`, so the in-game AI knows the LLM is deliberately staying the course.

With [strategist triage](../../models/tiers-and-triage.md#strategist-triage) on, an evaluator also rates each turn. It can skip or downsize the turns between scheduled ones, and raise any turn to the `large` tier.

## Failed refreshes

If the game-state refresh fails, the turn ends without a decision and the game resumes. The event cursor stays where it was, so the next turn fetches the missed events again.

Two failed refreshes in a row **pause the session**: without game state no seat can decide, so letting the game play on would waste turns. The second failure logs an error naming the player and the cause. The player's next turn is then held in the game until someone resumes the session from the dashboard or the console. A game crash fails the refresh in flight, and [crash recovery](game-session.md#crash-recovery) of the same game keeps the players, so the count restarts when the DLL reconnects or the player reloads to an earlier turn. A refresh cut short by cancellation does not count.

## One run per turn

Each processed turn runs in its own [run](../../framework/runs.md), carrying that turn's events. This keeps the strategist's turn separate from chats on the same seat. If the strategist is still working through an older turn, a diplomat can chat about the current turn at the same time without either one disturbing the other.

## Event windows

The strategist sees all events since its last decision, not just this turn's. A rolling cursor tracks where the last decision ended, so events from skipped turns fold into the next decision instead of being lost.

```
turn:      38    39    40    41
decided:   yes   skip  skip  yes
events seen by the turn-41 decision:  39 + 40 + 41
```

How the window moves:

- It starts at the seat's first turn and moves forward only after a successful decision.
- If the decision fails, is cancelled, or nothing fits, the decision is deferred and the window stays where it was.
- Its cached snapshots are kept even when concurrent chats refresh a newer turn.
- It never reaches back further than the normal game-state cache. A seat that keeps failing drops its oldest pending turns with a warning instead of growing the cache.

Each refresh's own per-turn `events` slice never changes. The merged report is built separately.

### When the events do not fit

When a decision spans several turns, `withEventWindowFallback` in `src/strategist/strategy-parameters.ts` builds a merged event report. If the model's context overflows, it removes events by importance across the whole window and tries again.

Removal order, least important first:

1. noise (including unknown or malformed event types)
2. economy
3. combat detail
4. routine units
5. force changes
6. progress
7. diplomacy

**Turning points are never removed by these trims**, however old: war, peace, captures, messages, policy branches and ideologies, victory, and completed projects. If even they do not fit, one last attempt keeps only the current turn's turning points and logs the older turns it dropped.

Event types use the names stored by the MCP server. There is no ranking by payload.

Each failed attempt logs its window, the tiers dropped, and the event tokens it carried. Compare these with the agent's own overflow numbers (see [Compaction](../../framework/compaction.md)) to see whether events, the fixed state, or the tool loop filled the context.

Two other places use the same importance order:

- Briefers retry with the same trims (`retryWithFewerEvents`), starting from the exact report that overflowed. Retries never widen the slice or bring back removed events.
- The evaluator strategist trims before sending, mixing event tiers with report details (see [Evaluator trimming](evaluator-trimming.md)).

## Saved state

State that lasts across turns lives in the seat's base parameters, `StrategistParameters` (`src/strategist/strategy-parameters.ts`):

- Cached game-state snapshots for recent turns (older ones are dropped).
- Working memory, for things like briefing instructions and episode requests.
- The decision mode, the last-decision turn, and game metadata.

Each turn's run adds its own turn and event bounds on top of this base. The rolling event cursor belongs to the `VoxPlayer`.

## Reloads

When the player reloads an earlier save, the seat starts a new timeline from that turn: runs are cancelled, caches cleared, and the workspace rewound. See [Timeline and reloads](../../workspace/store.md#timeline-and-reloads).
