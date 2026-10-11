# Context compaction

When a seat has the `files` setting on, an agent can spend many steps running `bash` commands, and every command's output stays in the conversation. A long run would eventually be too big for the model. Compaction keeps such a run going: once the request gets large, old command output is replaced with a short note.

This is safe because the agent has a workspace. It is warned first, saves what it still needs to its notes, and can read them back later.

```
request size:   small ........ 75% of threshold ........ threshold
what happens:   nothing        reminder: "save what     old bash output
                               you need, it will be     and old reasoning
                               dropped soon"            are dropped
```

Runs without `files` never compact. They keep the normal handling for context-length errors.

## The rules

Before each step after the first, `executeAgent` (`src/infra/vox-execute.ts`) estimates the size of the conversation so far with `countRequestTokens` (`src/utils/models/token-counter.ts`). The estimate is local and counts text, tool calls, tool results, retained reasoning, and a small per-message overhead. It is not the provider's exact count.

The estimate is compared with the model's `continuityThreshold` option. The default is 300,000 tokens for Claude Code, Codex, OpenAI, and Anthropic models, and 100,000 for everything else.

| Estimate | What happens |
| --- | --- |
| Below 75 percent of the threshold | Nothing. |
| At 75 percent or more, the first time in the run | A compaction reminder is appended once. It tells the agent to save what it still needs from earlier output, because that output will soon be dropped. |
| At the threshold or more, on a step after the reminder | The history is compacted before the step runs (see below). The step span records `step.compacted` as `threshold`. |
| The provider rejects a step after the first for context length, the first time in the run | The step's request is compacted the same way and sent again once, inside the same step span. The span records `step.compacted` as `overflow`. This path does not wait for the reminder. |

Edge cases:

- A step that jumps straight past the threshold gets the reminder first, so old output is never dropped without warning.
- The overflow retry happens at most once per run. A second context-length error ends the run the normal way (`onContextLengthError`, then `throwOnError`).
- There is no overflow retry on step 1, which has no earlier output to drop, or on a step that already compacted at the threshold, which would only resend the same request.

Every run that ends on a context-length error, with or without files, logs a warning and records where the space went:

| Span attribute | Meaning |
| --- | --- |
| `overflow.step` | The step that overflowed. Step 0 means the run failed while preparing. |
| `overflow.tokens.initial` | Estimated tokens in the prepared prompt. |
| `overflow.tokens.history` | Estimated tokens in the step history after it. |

Compacting does two things, both with helpers in `src/utils/prompts/message-history.ts`:

- `compactWorkspaceTraffic` replaces the output of every `bash` result older than the last step with a one-line note saying the output was dropped and to re-run the command or read the notes. The tool calls stay, so every call still has its result.
- `dropOlderReasoning` removes reasoning from every assistant message except the most recent one, which Anthropic models need next to pending tool results.

Neither helper touches the run's initial messages (the system prompt, game context, and game state), results from other tools, or the latest step. Both work on copies.

## A worked example

A strategist seat runs with `"files": { "game": "write", "quota": 20 }` and a model whose `continuityThreshold` is 20,000 tokens, so the reminder fires at 15,000. The numbers below are rounded estimates.

**Step 1.** The agent reads its notes with three parallel `bash` calls. The conversation after step 1:

| # | Message | Tokens |
| --- | --- | --- |
| 0 | System: strategist instructions | 1,500 |
| 1 | System: game context (the strategist's own cache anchor) | 500 |
| 2 | User: game state report (the run's cache anchor, added because files are on) | 5,000 |
| 3 | User: closing reminder, "make your final decision within 20 steps" | 20 |
| 4 | Assistant: reasoning, then three `bash` calls printing the game folder's `AGENTS.md`, `notes.md`, and a turn log | 450 |
| 5 | Tool: the three outputs | 5,500 |

Before step 2 the estimate is about 13,000, below 15,000, so nothing happens.

**Step 2.** The agent runs two `sqlite3` queries on a saved table as parallel calls. The step adds a closing reminder (#6, "19 steps"), an assistant message with reasoning and both calls (#7, 400), and their outputs (#8, 3,000).

Before step 3 the estimate is about 16,400. That passes 15,000 for the first time, so the compaction reminder is appended as #9. Nothing is dropped yet.

**Step 3.** Acting on the reminder, the agent appends its findings to `notes.md` with a heredoc and runs two more queries, as three parallel calls. The step adds a closing reminder (#10, "18 steps"), an assistant message (#11, 400), and the outputs (#12, 3,500).

Before step 4 the estimate is about 20,400, at or above 20,000, and the reminder has already been sent, so the history is compacted. Step 3's response starts at #11, so everything from #11 on is kept whole:

| # | Message | Before | After compaction |
| --- | --- | --- | --- |
| 0 to 2 | Initial prompt | 7,000 | Unchanged |
| 3 | Closing reminder, 20 steps | 20 | Unchanged |
| 4 | Step 1 reasoning and calls | 450 | Reasoning dropped, calls kept (150) |
| 5 | Step 1 outputs | 5,500 | Each replaced by the dropped-output note (75) |
| 6 | Closing reminder, 19 steps | 20 | Unchanged |
| 7 | Step 2 reasoning and calls | 400 | Reasoning dropped, calls kept (100) |
| 8 | Step 2 outputs | 3,000 | Each replaced by the dropped-output note (50) |
| 9 | Compaction reminder | 40 | Unchanged |
| 10 | Closing reminder, 18 steps | 20 | Unchanged |
| 11 | Step 3 reasoning and calls | 400 | Kept, the latest step |
| 12 | Step 3 outputs | 3,500 | Kept, the latest step |
| | Total | about 20,400 | about 11,400 |

Step 4 then runs on the compacted history with a new closing reminder ("17 steps"), and its span records `step.compacted = threshold`. The notes the agent wrote in step 3 are still on disk, so if it needs the step 1 or step 2 details again, it reads them back from `notes.md` or re-runs the command.

**If the provider overflows first.** Suppose step 3's output had been much larger, and the provider rejected step 4 for context length while the local estimate was still below 20,000. The loop compacts step 4's request exactly as in the table and resends it once. Both attempts belong to step 4's span, which records `step.compacted = overflow`. If a later step overflows again, the run fails as it would without files.

## What compaction does not do

- It never shrinks the latest step. If one step's output alone is too large for the model, compaction cannot help; the `bash` tool caps each output stream at 8,000 characters to make that unlikely.
- It never rewrites the initial prompt, so the cached prefix stays valid (see [Caching](caching.md)). With files on, the run marks its last initial message (#2 above) as a cache anchor, and everything compaction changes comes after it.
- It does not carry anything across runs. Each agent run starts with a fresh history; the workspace is what persists.

On Codex, a step that compacted sends the full compacted history instead of continuing the previous step's native thread.

## Where the code lives

| Piece | File |
| --- | --- |
| Threshold default and validation | `continuityThreshold` in `src/utils/models/models.ts` |
| Request size estimate | `countRequestTokens` in `src/utils/models/token-counter.ts` |
| Dropping output and reasoning, reminder text | `src/utils/prompts/message-history.ts` |
| When to remind, compact, and retry | `executeAgent` and `executeAgentStep` in `src/infra/vox-execute.ts` |
| Tests | `tests/mock/utils/message-history.test.ts`, `tests/mock/context/vox-execute-compaction.test.ts` |
