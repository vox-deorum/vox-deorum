# vox-agents — Telepathists

A telepathist lets you interrogate a finished game: "what happened between turns 30 and 50?", "why did the AI build a settler on turn 45?", "show me the full conversation behind that decision." It can answer because every live game records its agents' reasoning — prompts, tool calls, decisions, rationales — into a telemetry database (see [observability.md](observability.md)), and the telepathist has, in effect, read the AI player's mind from that record.

Telepathists are [envoys](envoy.md): the same chat-thread machinery, special messages, and streaming serve them, but their context is a database on disk rather than a live game. The source lives in `src/telepathist/`.

## Two databases

`createTelepathistParameters()` (`src/telepathist/telepathist-parameters.ts`) opens two connections per analyzed game:

- the **telemetry database** (`{gameID}-player-{playerID}.db`), opened read-only — the raw OpenTelemetry spans from the original run, never modified;
- a companion **telepathist database** (`.telepathist.db` beside it), read-write — everything the telepathist *generates* about the game: per-turn summaries, phase summaries, and a content-hash cache of summarization calls so the same material is never summarized twice.

Setup also discovers what the database contains: the available turns, and the player's identity (civilization and leader), recovered from the recorded game-metadata tool output.

## Preparation: summarizing the game once

Before a conversation is useful, the game has to be digested. The first time a telepathist session opens, the UI sends the `{{{Initialize}}}` special message, and the agent runs the preparation pipeline (`src/telepathist/preparation/`), streaming progress to the user as it goes:

1. **Turn summaries** — for each turn without one, the pipeline reconstructs that turn's situation and decisions through the same tools described below, then asks the `Summarizer` to produce a structured summary: the situation and the decisions, each in full and in abstract, plus a short narrative. Turns are processed in parallel with bounded concurrency and retried with narrower input on context overflow.
2. **Phase summaries** — turn summaries are then grouped into phases of roughly ten turns and summarized again, giving the bird's-eye arc of the game.

Phase summaries and the player's identity are injected into every conversation as standing context, so the agent always knows the shape of the game without a tool call; on later sessions with the same database the pipeline sees its work already stored and skips straight to the greeting. The console's `--prepare` flag runs just this pipeline and exits — that is what the [archivist](archivist.md) leans on for batch processing.

The **`Summarizer`** itself (`src/telepathist/summarizer.ts`) is a small, reusable, instruction-driven agent — input text plus an instruction in, summary text out — shared by turn preparation, phase preparation, oversized tool results, and the archivist. Its caching wrapper checks the `summary_cache` table by content hash before spending tokens.

## The query tools

Conversation-time questions are answered by three tools, designed as zoom levels and built on a shared base class, `TelepathistTool` (`src/telepathist/telepathist-tool.ts`). The base class knows how to walk the recorded span hierarchy — find each turn's root span, the agent spans beneath it, their steps, and their tool calls — and handles the awkward realities: botched turns leave multiple root spans for one turn number (only the last counts), and fire-and-forget agents like the diplomatic analyst live in detached traces that must be found by turn and name instead. It also parses flexible turn input (`"30"`, `"10,20,30"`, `"30-50"`) and summarizes results that would be too large to return verbatim.

- **`get-situation`** returns the world as the AI saw it — players, cities, military, resources — reconstructed from the recorded outputs of the knowledge tools, formatted the way the live agents saw them. The ground truth for judging a decision.
- **`get-decision`** returns what the AI did and why: which agents ran that turn, the options that were on the table, the reasoning, and each decision with its rationale. For ranges of turns it serves cached turn summaries first and digs into the detailed record only where needed.
- **`get-conversation-log`** is the deep dive: the full LLM conversation for a single turn, stitched per agent from system prompt through responses, optionally filtered to one agent.

## The agents

**`talkative-telepathist`** (`src/telepathist/talkative-telepathist.ts`) is the conversational analyst — an in-character historian of the game who answers questions using the tools above. **`episode-retriever`** (`src/telepathist/episode-retriever.ts`) is a programmatic (no-LLM) sibling: give it a turn number and it fetches and formats similar historical cases from the [archivist's](archivist.md) episode archive — a direct window into what the retrieval-augmented strategist would see.

## Running it

`npm run telepathist -- -d <database>` opens a console session against a telemetry database (bare filenames resolve under `telemetry/`); `-a` selects a different agent and `--prepare` runs summarization only. The same experience is available in the dashboard: create a chat with a database path instead of a live context, and the web backend builds the telepathist context, runs initialization with streamed progress, and chats over the same SSE channel — see [ui.md](ui.md).
