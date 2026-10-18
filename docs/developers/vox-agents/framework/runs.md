# Contexts and runs

A **context** (`VoxContext`, `src/infra/vox-context.ts`) belongs to one seat, usually one AI player in one game. It holds what that seat needs for the whole game: the MCP connection, the tool list, and the seat's settings.

A **run** is one piece of work on that seat: a strategist turn, one chat message, an automatic deal response, or a background analysis. Each run has its own cancel button, its own token count, and its own view of which turn it is working on. Several runs can be active on the same seat at once.

```
VoxContext (one seat, whole game)
 ├── run: strategist decides turn 41   (still catching up)
 ├── run: diplomat answers a chat on turn 42
 └── run: analyst assesses a report    (detached, outlives the chat)
```

Because each run carries its own state, a strategist can finish an older turn while a diplomat chats about the current one, and closing one chat window cancels only that chat.

## Where the code lives

| File | Role |
| --- | --- |
| `src/infra/vox-context.ts` | The context: seat resources, tool registry, public entry points. |
| `src/infra/vox-run.ts` | Run types and helpers. |
| `src/infra/vox-execute.ts` | The step loop that drives an agent. |
| `src/infra/vox-evaluate.ts` | The single-call evaluation path. |
| `src/infra/vox-telemetry.ts` | Spans, token counting, and model labels shared by the two paths above. |

`context.execute()` and `context.evaluate()` are thin wrappers that hand off to `vox-execute.ts` and `vox-evaluate.ts`.

## Starting and nesting runs

| Call | Use it to |
| --- | --- |
| `withRun()` | Start a run around a whole operation, including setup work before the first agent call. The callback receives a handle that can cancel just this operation. |
| `forkRun()` | Start a detached run for work that must outlive its caller, such as a [fire-and-forget](agent-framework.md#two-special-shapes) analyst. |
| `execute(agentName, input)` | Run an agent inside the current run. |
| `callAgent(name, input)` | Run a nested agent inside the current run and get its typed output. It shares the caller's cancellation and token count. |

`execute()` and `callAgent()` only work inside a run, because the run supplies their parameters. Calling them outside one is a programming error.

While the loop runs, it can stream text and tool events to a callback. The dashboard's chat view uses this.

## Parameters

Each seat has one base parameter object, installed with `setBaseParameters()`. It holds the seat's long-lived state, such as cached game states and working memory.

Inside a run, `currentParameters` gives a combined view: the run's own turn fields on top of the shared seat state. Outside a run it returns the base object.

## Cancelling

| Call | Cancels |
| --- | --- |
| `run.abort()` | One operation. |
| `context.abort()` | Every active run on the seat. Used when the player aborts, when the game switches, and at shutdown. |

## Token counting

Token usage is added to two totals: the run's own and the seat's running total. This keeps the cost of one turn separate from the cost of the whole game.

Spans record `tokens.input` as the full input count. When the provider reports cache reads, spans also record them as `tokens.input.cached`, which is part of the same total.

## Tools

Tools come from two places.

1. **MCP tools.** `registerTools()` fetches the [MCP server's tools](../../mcp-server/tools.md) and wraps each for the AI SDK. The wrapper fills fields such as player ID and turn and attaches Markdown rendering hints to results. The output path converts those results for the model. Definitions are cached on disk, so a context can start offline with `loadToolCache()`.
2. **Agent tools.** Every registered agent is also offered as a tool named `call-{name}` (see below).

Code can also skip the model and call a tool directly with `callTool()`. It takes explicit parameters and does not need a run, so setup and shutdown code can use it.

## Agents calling agents

The wrapping is in `src/utils/tools/agent-tools.ts`. Each `call-{name}` tool uses `handoffSchema`, then `inputSchema`, then a generic `Prompt` schema as fallbacks, plus an optional `Tier` (`small`, `default`, or `large`). A tier picks the called agent's model directly, without triage. The wrapper removes `Tier` before passing the input on.

- If the called agent is fire-and-forget, the tool checks the input, answers "submitted", and the agent continues in a detached run.
- Otherwise the caller waits for the typed result.

So a diplomat calling `call-diplomatic-analyst` is an ordinary tool call.

When code needs an agent's result before the first model call (for example, a briefing that must be in the opening prompt), it calls `context.callAgent()` directly. Both paths use the same context, so nested agents see the same tools, parameters, and telemetry.

## Context IDs and telemetry

Each context has a stable ID. For a strategist seat it is `{gameID}-player-{playerID}`. That ID also names the SQLite database the context's telemetry goes to. See [Observability](../platform/observability.md).
