# vox-agents — Telepathists

A telepathist lets you interrogate a finished game. Ask it "what happened between turns 30 and 50?", "why did the AI build a settler on turn 45?", or "show me the full conversation behind that decision." It answers from the record every live game leaves behind: each agent's prompts, tool calls, decisions, and rationales are saved to a telemetry database (see [observability.md](observability.md)). The telepathist reads that record as if it had read the AI player's mind.

Telepathists are [envoys](envoy.md). They reuse the same chat-thread machinery, special messages, and streaming, but their context is a database on disk rather than a live game. The source lives in `src/telepathist/`.

## Two databases

`createTelepathistParameters()` (`src/telepathist/telepathist-parameters.ts`) opens two connections per analyzed game:

| Database | File | Access | Holds |
| --- | --- | --- | --- |
| Telemetry | `{gameID}-player-{playerID}.db` | read-only | The raw OpenTelemetry spans from the original run. Never modified. |
| Telepathist | `.telepathist.db` (beside it) | read-write | Everything the telepathist generates: per-turn summaries, phase summaries, and a content-hash cache of summarization calls so the same material is never summarized twice. |

Setup also inspects the database to discover the available turns and the player's identity (civilization and leader), recovered from the recorded game-metadata tool output.

## Preparation: summarizing the game once

A conversation is only useful once the game has been digested. The first time a telepathist session opens, the UI sends the `{{{Initialize}}}` special message and the agent runs the preparation pipeline (`src/telepathist/preparation/`), streaming progress to the user as it goes.

The pipeline has two stages:

1. **Turn summaries.** For each turn without one, the pipeline reconstructs that turn's situation and decisions through the same query tools described below, then asks the `Summarizer` for a structured summary: the situation and the decisions, each in full and in abstract, plus a short narrative. Turns are processed in parallel with bounded concurrency, and retried with narrower input on context overflow.
2. **Phase summaries.** Turn summaries are grouped into phases of roughly ten turns and summarized again, giving the bird's-eye arc of the game.

Phase summaries and the player's identity are injected into every conversation as standing context, so the agent always knows the shape of the game without a tool call. On later sessions against the same database, the pipeline finds its work already stored and skips straight to the greeting.

The console's `--prepare` flag runs only this pipeline and then exits. That is what the [archivist](archivist.md) leans on for batch processing.

### The Summarizer

The **`Summarizer`** (`src/telepathist/summarizer.ts`) is a small, reusable, instruction-driven agent: text plus an instruction in, summary text out. It is shared by turn preparation, phase preparation, oversized tool results, and the archivist. Its caching wrapper checks the `summary_cache` table by content hash before spending tokens.

## The query tools

Three tools answer conversation-time questions, designed as zoom levels and built on a shared base class, `TelepathistTool` (`src/telepathist/telepathist-tool.ts`). The base class walks the recorded span hierarchy — each turn's root span, the agent spans beneath it, their steps, and their tool calls — and handles two awkward realities:

- A botched turn leaves multiple root spans for one turn number; only the last counts.
- Fire-and-forget agents like the diplomatic analyst live in detached traces, so they must be found by turn and name rather than by trace.

It also parses flexible turn input (`"30"`, `"10,20,30"`, `"30-50"`) and summarizes results too large to return verbatim.

| Tool | Zoom level | Returns |
| --- | --- | --- |
| `get-situation` | Wide | The world as the AI saw it — players, cities, military, resources — reconstructed from the recorded knowledge-tool outputs and formatted the way live agents saw it. The ground truth for judging a decision. |
| `get-decision` | Medium | What the AI did and why: which agents ran, the options on the table, the reasoning, and each decision with its rationale. For turn ranges it serves cached turn summaries first and digs into the detailed record only where needed. |
| `get-conversation-log` | Close | The deep dive: the full LLM conversation for a single turn, stitched per agent from system prompt through responses, optionally filtered to one agent. |

## The agents

Two agents run on top of these tools:

- **`talkative-telepathist`** (`src/telepathist/talkative-telepathist.ts`) is the conversational analyst, an in-character historian of the game who answers questions using the tools above.
- **`episode-retriever`** (`src/telepathist/episode-retriever.ts`) is a programmatic, no-LLM sibling. Give it a turn number and it fetches and formats similar historical cases from the [archivist's](archivist.md) episode archive — a direct window into what the retrieval-augmented strategist would see.

## Running it

Open a console session against a telemetry database:

```bash
npm run telepathist -- -d <database>
```

Bare filenames resolve under `telemetry/`. Use `-a` to select a different agent, and `--prepare` to run summarization only.

The same experience is available in the dashboard. Create a chat with a database path instead of a live context, and the web backend builds the telepathist context, runs initialization with streamed progress, and chats over the same SSE channel — see [ui.md](ui.md).
