# Observability

Vox Agents records agent requests, responses, tools, and decisions with OpenTelemetry. Spans are stored in SQLite for live debugging and post-game analysis.

```
agent runs ──spans──► SQLite (one file per seat) ──► dashboard, telepathist, oracle, archivist
```

Other parts of the system are built on that record:

| Tool | Uses the record to |
| --- | --- |
| [Telepathist](../agents/telepathist.md) | Explain what happened. |
| [Oracle](../agents/oracle.md) | Replay turns with changes. |
| [Archivist](../agents/archivist.md) | Mine past games for similar situations. |
| [Web UI](ui.md) | Browse it live. |

## Tracing

Every console entry point loads `src/instrumentation.ts` before anything else. It wires the standard OpenTelemetry Node tracer to a custom exporter, batching span export so tracing stays off the hot path.

`SQLiteSpanExporter` (`src/utils/telemetry/sqlite-exporter.ts`, on the `VoxSpanExporter` base) writes spans to **one SQLite database per context**. A strategist player's run becomes `telemetry/{folder}/{gameID}-player-{playerID}.db`; a telepathist or oracle run gets its own file under its own folder.

Each row stores the span's identifiers and hierarchy (trace, span, parent), name, timing, status, and the full attribute payload as JSON. The context ID and game turn are lifted into their own indexed columns, because "everything that happened on turn 42" is the query everyone wants. The exporter also emits an event whenever spans land, which is what the web UI's live span stream rides on.

What the spans contain is the valuable part:

- **Agent executions** record their starting tier, even when triage does not run or the system prompt is empty. As the run gets that far, they also record the system prompt, the messages, the active tools, and the model for each step.
- **Agent triage** records the chosen tier, where it came from, and an optional note (see [Tiers and triage](../models/tiers-and-triage.md#telemetry)).
- **Evaluations** record their purpose (`triage` or `execution`), the requesting agent, the state, questions, answers, and token usage. A triage evaluation is nested under its agent span, so its cost and latency can be analyzed alongside the resulting tier.
- **Tool calls** record their inputs and outputs.
- **Turn-level spans** record pacing decisions, completion status, and token usage (input, reasoning, and output, counted per step and accumulated per context).

### Span naming

The hierarchy follows a few conventions worth knowing before writing queries. The telepathist's `TelepathistTool` base encapsulates them for its own tools.

- Each player's session runs under a root `player.{gameID}.{playerID}` span. Each processed turn opens a `strategist.turn.{N}` span as the root of its own trace.
- Within a turn, each agent run has an agent span with its step spans beneath it, and each tool call is a child span of its step: `mcp-tool.{name}` for MCP tools, `simple-tool.{name}` for internal ones. A failing MCP call is marked as an error span whether it throws or returns an error result (an `isError` envelope or `Success: false`).
- A failed-and-retried turn leaves _multiple_ root spans with the same turn number. Only the latest is the valid record, and its trace ID scopes the real children.
- Fire-and-forget agents (the diplomatic analyst) deliberately detach: they share the turn number but start their own root trace, so they are found by turn and name rather than by trace.

## Logging

Modules use named Winston loggers from `src/utils/logger.ts`; `console.log` is banned in production code. Output goes to the console, `logs/error.log`, and `logs/combined.log`. When the web server runs, an SSE stream feeds the dashboard's Debug page, with source and level filters.

Startup version information comes from `version.json`. `src/utils/config/version.ts` adds a Git commit hash only when the project root has `.git` metadata, and skips it silently otherwise, so installed builds need no Git.

## Inspecting agent behavior

The usual workflow when an agent does something puzzling:

1. Open the dashboard's **Telemetry** view ([ui.md](ui.md)), either the live context while the game runs or the stored database afterward, and find the turn's trace.
2. Walk the span hierarchy. The step spans show exactly what the model was sent and what it answered; the tool spans show what the game reported back.
3. For a conversational view of the same record, open a [telepathist](../agents/telepathist.md) chat on the database and ask. `get-conversation-log` reconstructs the full exchange per agent.
4. To test a hypothesis ("would it have attacked with a different briefing?"), feed the turn to the [oracle](../agents/oracle.md) and replay it with the prompt changed.

Use any SQLite client for ad-hoc analysis. The schema is in `src/utils/telemetry/schema.ts`.
