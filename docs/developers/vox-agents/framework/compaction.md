# Context compaction

When a seat has the `files` setting on, an agent can spend many steps running `bash` commands, and every command's output stays in the conversation. A long run would eventually be too big for the model. Compaction keeps such a run going: once the request gets large, old command output is replaced with a short note.

The loop warns the agent to save needed information in its workspace before threshold compaction. The agent can read those notes later.

Runs without `files` never compact. They keep the normal handling for context-length errors.

## The rules

Before each step after the first, `executeAgent` (`src/infra/vox-execute.ts`) estimates the size of the conversation so far with `countRequestTokens` (`src/utils/models/token-counter.ts`). The estimate is local and counts text, tool calls, tool results, retained reasoning, and a small per-message overhead. It is not the provider's exact count.

The estimate is compared with the model's `continuityThreshold` option. The default is 300,000 tokens for Claude Code, Codex, OpenAI, and Anthropic providers, and for model names starting with `claude-`, `anthropic/`, or `openai/` on other providers. Other models default to 100,000.

| Estimate | What happens |
| --- | --- |
| Below 75 percent of the threshold | Nothing. |
| At 75 percent or more, the first time in the run | A compaction reminder is appended once. It tells the agent to save what it still needs from earlier output, because that output will soon be dropped. |
| At the threshold or more, on a step after the reminder | The history is compacted before the step runs (see below). The step span records `step.compacted` as `threshold`. |
| The provider rejects a step after the first for context length, the first time in the run | The step's request is compacted the same way and sent again once, inside the same step span. The span records `step.compacted` as `overflow`. This path does not wait for the reminder. |

Edge cases:

- A step that jumps past the threshold still gets the reminder first. Threshold compaction waits until a later step.
- The overflow retry happens at most once per run. A later context-length error calls `onContextLengthError` when supplied and returns `undefined`, even with `throwOnError` enabled.
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

A strategist seat runs with files on and a model whose `continuityThreshold` is 20,000 tokens, so the reminder fires at 15,000. The numbers below are rounded estimates.

Steps 1 and 2 read notes and run queries; their output grows the conversation to about 16,400 tokens. Before step 3 that passes 15,000 for the first time, so the compaction reminder is appended and nothing is dropped. Acting on the reminder, step 3 saves the findings to `notes.md` and runs two more queries, bringing the estimate to about 20,400. Before step 4 the history is compacted: the step 1 and step 2 output becomes one-line dropped-output notes, their reasoning is removed, and step 3 is kept whole as the latest step.

| Messages                                | Before       | After compaction |
| --------------------------------------- | ------------ | ---------------- |
| Initial prompt and reminders            | 7,100        | Unchanged        |
| Steps 1 and 2: calls, output, reasoning | 9,350        | 375              |
| Step 3: calls, output, reasoning        | 3,900        | Unchanged        |
| Total                                   | about 20,400 | about 11,400     |

Step 4 then runs on the compacted history and its span records `step.compacted = threshold`. The notes written in step 3 are still on disk, so if the agent needs the step 1 or step 2 details again it reads them back from `notes.md` or re-runs the command.

**If the provider overflows first.** Suppose step 3's output had been much larger and the provider rejected step 4 for context length while the local estimate was still below the threshold. The loop compacts step 4's request exactly as in the table and resends it once, inside the same step span, which records `step.compacted = overflow`.

## What compaction does not do

- It never shrinks the latest step. If one step's output alone is too large for the model, compaction cannot help; the `bash` tool caps each output stream at 30,000 characters to make that unlikely.
- It never rewrites the initial prompt, so the cached prefix stays valid (see [Caching](caching.md)). With files on, the run marks its last initial message as a cache anchor, and everything compaction changes comes after it.
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
