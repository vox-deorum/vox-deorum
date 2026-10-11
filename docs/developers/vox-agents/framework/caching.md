# Prompt caching

Anthropic-family providers can cache the start of a request and reuse it on the next call, which makes repeated calls cheaper and faster. Vox Agents marks a few messages as **cache anchors**: everything up to an anchor can be reused, as long as it has not changed.

The cache matches from the start of the request. Tools come first, then system text, then messages. Any change near the start throws away the cache for everything after it. Much of the design in [Prompts and tool calling](prompts.md) exists to keep the start stable:

- The offered tool list stays the same for the whole run.
- Middleware text is built from the offered tool list and never depends on the step.
- Every per-step instruction (the rescue message and the closing reminder) goes at the end.

## Which providers use it

The marker is `cacheBreakpoint` in `src/utils/models/cache-breakpoint.ts`, added to a message's `providerOptions`. Direct Anthropic, Claude on Vertex, and OpenRouter use it. Other providers ignore it.

Claude Code is an exception. It flattens the whole prompt into one CLI user message per step, so it reuses nothing past the CLI's own system prompt between steps.

## Where agents place anchors

| Agent family | Anchor | File |
| --- | --- | --- |
| Strategists | The game-context system message | `src/strategist/agents/simple-strategist.ts` and its briefed and staffed variants |
| Briefers | Their game-context message | `src/briefer/simple-briefer.ts`, `src/briefer/specialized-briefer.ts` |
| Live envoys | Three anchors: game context, settled past conversations, and the last ongoing chat row | `buildGameContextMessages` in `src/strategist/strategy-parameters.ts`, `getInitialMessages` in `src/envoy/live-envoy.ts`, and the strategy note in `src/envoy/envoy.ts` |
| Any agent whose seat has files on | The run's last initial message, unless it already has an anchor or the request already has four | `executeAgent` in `src/infra/vox-execute.ts` |

A request can have at most four anchors (`MAX_CACHE_BREAKPOINTS`). `markBreakpointOnLast` and `countCacheBreakpoints` live in the same file as the marker. Cache entries last five minutes and are refreshed on each read.

## Runs with files on

A run with files on often takes many steps, so its whole initial prompt (instructions, game context, and game state) becomes an anchor. Step 1 writes it to the cache, and later steps within five minutes read it back. The steps-left countdown and all later traffic come after the anchor, and [compaction](compaction.md) only changes messages after it, so neither breaks the cache.

Step 1 pays the cache-write cost even when the run ends in one step.
