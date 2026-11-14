# Prompt caching

Anthropic-family providers can cache the start of a request and reuse it on the next call, which makes repeated calls cheaper and faster. Vox Agents marks a few messages as **cache anchors**: everything up to an anchor can be reused, as long as it has not changed.

The cache matches from the start of the request. Tools come first, then system text, then messages. Any change near the start throws away the cache for everything after it. Much of the design in [Prompts and tool calling](prompts.md) exists to keep the start stable:

- The offered tool list stays the same for the whole run.
- Middleware text is built from the offered tool list and never depends on the step.
- Every per-step instruction (the rescue message and the closing reminder) goes at the end.

## Which providers use it

The marker is `cacheBreakpoint` in `src/agents/models/cache-breakpoint.ts`, added to a message's `providerOptions`. Direct Anthropic, Claude on Vertex, and OpenRouter use it. Other providers ignore it, except Claude Code.

### Claude Code

One live CLI query spans an agent run, and the session hands each step's tool results back to that query, so the CLI caches within its own query. Reuse across runs needs anchors too, because each run opens a fresh query.

The CLI places two of the four markers itself, so Claude Code honours only the first two anchors on system or user messages. The prompt middleware in `src/agents/models/providers/claude-code-prompt.ts` turns them into Claude Code markers with a one-hour lifetime. The API rejects a longer lifetime after a shorter one, and the CLI would drop its own markers to five minutes outside the subscription's limits, so `buildClaudeCodeModel` pins the CLI to the same lifetime through `CLAUDE_CODE_PROMPT_CACHE_TTL`.

The Claude Code provider normally joins the whole prompt into one block, which leaves no place for a marker. A patch to that provider (`patches/ai-sdk-provider-claude-code+4.3.2.patch`, applied by `patch-package` on `npm install`) splits the prompt into separate blocks after each marked message and sends the prompt as content blocks. The provider version is pinned so the patch keeps applying. Recreate the patch when upgrading the provider, and rerun `npm run test:claude-code`, which checks that a fresh session reads an anchored opening from the cache.

## Where agents place anchors

| Agent family | Anchor | File |
| --- | --- | --- |
| Any agent in file mode | The records directions, right after the agent's instructions. Both stay the same in every run of a seat. Skipped when the request already has four anchors. | `insertRecordsDirections` in `src/knowledge/directions.ts` |
| Strategists | The game-context system message | `src/strategist/agents/simple-strategist.ts` and its briefed and staffed variants |
| Briefers | Their game-context message | `src/briefer/simple-briefer.ts`, `src/briefer/specialized-briefer.ts` |
| Live envoys | Three anchors: game context, settled past conversations, and the last ongoing chat row (four with the records directions) | `buildGameContextMessages` in `src/strategist/strategy-parameters.ts`, `getInitialMessages` in `src/envoy/live-envoy.ts`, and the strategy note in `src/envoy/envoy.ts` |
| Any agent whose seat has files on | The run's last initial message, unless it already has an anchor or the request already has four | `executeAgent` in `src/agents/runtime/vox-execute.ts` |

A request can have at most four anchors (`MAX_CACHE_BREAKPOINTS`). `markBreakpointOnLast` and `countCacheBreakpoints` live in the same file as the marker. Cache entries last five minutes (one hour on Claude Code) and are refreshed on each read.

## Runs with files on

A run with files on often takes many steps, so its whole initial prompt (instructions, game context, and game state) becomes an anchor. Step 1 writes it to the cache, and later steps read it back. The steps-left countdown and all later traffic come after the initial prompt, and [compaction](compaction.md) only changes messages after it, so neither breaks the cache.

The last initial message gets no anchor when the request already has four. A live envoy in file mode can reach four with its own three plus the records directions. Its initial prompt is then cached only up to the last ongoing chat row.

Step 1 pays the cache-write cost even when the run ends in one step.
