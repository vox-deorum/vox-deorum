# vox-agents — Observability

LLM agents fail in ways a debugger can't show you: a subtly wrong prompt, a tool result the model misread, a decision that made sense given what it saw. Vox-agents therefore records everything. Every agent run is traced with OpenTelemetry, every span lands in a queryable SQLite database, and the rest of the system is built on top of that record:

- the [telepathist](telepathist.md) narrates it,
- the [oracle](oracle.md) replays it,
- the [archivist](archivist.md) mines it,
- and the [web UI](ui.md) browses it live.

## Tracing

Every console entry point loads `src/instrumentation.ts` before anything else. It wires the standard OpenTelemetry Node tracer to a custom exporter, batching span export so tracing stays off the hot path.

`SQLiteSpanExporter` (`src/utils/telemetry/sqlite-exporter.ts`, on the `VoxSpanExporter` base) writes spans to **one SQLite database per context**. A strategist player's run becomes `telemetry/{folder}/{gameID}-player-{playerID}.db`; a telepathist or oracle run gets its own file under its own folder.

Each row stores the span's identifiers and hierarchy (trace, span, parent), name, timing, status, and the full attribute payload as JSON. The context ID and game turn are lifted into their own indexed columns, because "everything that happened on turn 42" is the query everyone wants. The exporter also emits an event whenever spans land, which is what the web UI's live span stream rides on.

What the spans contain is the valuable part:

- **Agent executions** record the system prompt, the messages, the active tools, and the model per step.
- **Tool calls** record their inputs and outputs.
- **Turn-level spans** record pacing decisions, completion status, and token usage (input, reasoning, output — counted per step and accumulated per context).

### Span naming

The hierarchy follows a few conventions worth knowing before writing queries. The telepathist's `TelepathistTool` base encapsulates them for its own tools.

- Each player's session runs under a root `player.{gameID}.{playerID}` span. Each processed turn opens a `strategist.turn.{N}` span as the root of its own trace.
- Within a turn, each agent run has an agent span with its step spans beneath it. Each tool call is a child span of its step — `mcp-tool.{name}` for MCP tools, `simple-tool.{name}` for internal ones.
- A failed-and-retried turn leaves *multiple* root spans with the same turn number. Only the latest is the valid record, and its trace ID scopes the real children.
- Fire-and-forget agents (the diplomatic analyst) deliberately detach: they share the turn number but start their own root trace, so they are found by turn and name rather than by trace.

## Logging

Logging is Winston throughout (`src/utils/logger.ts`; `console.log` is banned in production code). Each module creates a named logger. Output goes to a color-coded console, to `logs/error.log` and `logs/combined.log`, and — when the web server is up — to every connected dashboard via the SSE log stream, where the Logs view filters by source and level in real time.

## Inspecting agent behavior

The usual workflow when an agent does something puzzling:

1. Open the dashboard's **Telemetry** view ([ui.md](ui.md)) — either the live context while the game runs, or the stored database afterward — and find the turn's trace.
2. Walk the span hierarchy. The step spans show exactly what the model was sent and what it answered; the tool spans show what the game reported back.
3. For a conversational view of the same record, open a [telepathist](telepathist.md) chat on the database and ask. `get-conversation-log` reconstructs the full exchange per agent.
4. To test a hypothesis ("would it have attacked with a different briefing?"), feed the turn to the [oracle](oracle.md) and replay it with the prompt changed.

Telemetry databases are plain SQLite. Nothing stops ad-hoc analysis with any SQLite client, and the schema in `src/utils/telemetry/schema.ts` is small enough to read in one sitting.
