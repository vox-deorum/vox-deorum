# Model middleware

Providers differ. Some cannot call tools reliably, some refuse a forced tool call, some have rate limits that need waiting out. Vox Agents hides these differences behind **middleware**: wrappers around each model that adjust the request on the way in and the reply on the way out. Agents never deal with provider quirks themselves.

`getModel` (`src/utils/models/models.ts`) builds the wrapped model. The AI SDK runs the wrappers from the outside in, so the outermost one sees the prompt first:

```
outermost
  │ capability text           (bash workspace, or Web on Codex or Claude Code)
  │ tool middleware           prompt mode, Gemma, or default rescue
  │ Claude Code demotion      (Claude Code only)
  │ think-tag extraction      (thinkMiddleware option)
  │ provider-specific         required tool choice (Anthropic, Vertex Claude, Codex),
  │                           Codex response handling
  ▼
provider
```

This is layer 3 of [Prompts and tool calling](../framework/prompts.md).

## What each wrapper changes

| Middleware | File | Effect |
| --- | --- | --- |
| Capabilities | `src/utils/models/capability-prompt.ts` | Adds an `# Extra Capabilities` section to the system text. See [Capability reminder](#capability-reminder). |
| Tool rescue, prompt mode | `src/utils/models/tool-rescue/` | Replaces native tools with text instructions. See [Prompt-mode tool calling](#prompt-mode-tool-calling). |
| Tool rescue, default | `src/utils/models/tool-rescue/middleware.ts` | Changes no prompt text. It recovers tool calls a model wrote as JSON text instead of a real call. |
| Gemma | `hermesToolMiddleware` from `@ai-sdk-tool/parser` | Hermes-style tool block for Gemma models. |
| Claude Code demotion | `src/utils/models/providers/claude-code-prompt.ts` | Turns every system message into a user message, because the provider sends the whole prompt as one CLI user turn anyway. |
| Required tool choice | `src/utils/models/providers/required-tool-choice.ts` | For providers that refuse a forced tool call, relaxes it to "tools allowed". Always adds a sentence naming the tools that end the turn, unless no offered tool does. |
| Codex response | `src/utils/models/providers/codex-response.ts` | See [Codex](#codex). |

The two wrappers that add system text use `appendSystemInstruction` (`src/utils/models/providers/system-prompt.ts`), which appends to the first system message or creates one. Both build their text from the run's offered tools and ignore whether the step requires a call, so their text stays the same on every step. The closing reminder at the end of the request says what is actually required.

## Other request handling

These wrappers do not change prompt text:

- **Concurrency limits** (`src/utils/models/concurrency.ts`) cap parallel requests per model.
- **Claude Code subscription limits** wait until the provider's reset time. If no valid reset time is given, they retry slowly.
- **Provider-executed calls.** Claude Code and Codex can run their own built-in tools (such as web search). These show in the dashboard and are recorded as built-in tool spans after the fact. Progress updates alone do not count as success: a failed or missing final result is recorded as an error.

## Capability reminder

A model call that has `bash` or CLI web access gets one system reminder, built by `capabilityInstruction` in `src/utils/models/capability-prompt.ts`.

| Part | Included when |
| --- | --- |
| Intro | Whenever the reminder is added. When the request declares completion tools, it names them and says to finish any needed reads before calling one. A successful completion ends the run once all calls in that response finish, with no further step to inspect results. |
| Workspace | The request offers the `bash` tool (any provider). Covers keeping notes current, where to save notes for later turns when a folder is writable, the step budget, and reading large records. |
| Web | Codex or Claude Code with `hostTools: ["Web"]`. |

When the game folder or a shared folder is writable, the Workspace part asks the model to save useful notes with `bash`, before or alongside terminal calls. Game observations, inferences, and plans belong only in a writable game notes folder. Writable shared folders hold only generalized lessons and reusable references. The records directions table stays the only folder listing.

The Workspace part is rendered from `vox-agents/prompts/workspace.md` through the run's prompt folder (see [Prompt files](../framework/prompt-files.md)). Its large-file advice covers the bash output limit per stream (`workspaceOutputLimit`) and read examples for `wc -c`, `grep -n`, `head` and `sed`, `jq`, and split parts of a civilization or zone. The examples use quoted shell variables for a recorded turn, initialized in each command script, and apply only after a turn has been recorded.

The text depends only on the seat's files setting and on the agent's terminal tools and their noun. It is the same across turns and runs, which keeps the tools, the system text, and the cached game-context message a cache hit on every turn (see [Caching](../framework/caching.md)).

Model-step spans record what was enabled in `host.capability`, comma-separated:

1. `write` when the seat's files include a writable folder, otherwise `read` when files are on.
2. `web` for Codex or Claude Code with `Web`.

For example, a Codex seat with `files: "write"` and `Web` records `write,web`. Steps with neither leave the attribute out.

## Prompt-mode tool calling

Some models do not call tools reliably. They run in **prompt mode**, set with `options.toolMiddleware: 'prompt'` in the model config. Claude Code always uses prompt mode. The model is taught to write tool calls as JSON text, and the middleware turns that text back into real tool calls.

```
inbound                                        outbound
┌────────────────────────────────┐              ┌────────────────────────────────┐
│ native tools ──► text          │              │ JSON text in the reply         │
│   instructions                 │              │   ──► real tool calls          │
│ earlier tool calls and results │    model     │ leftover code fences removed   │
│   ──► plain text               │ ──────────►  │   before the reply is stored   │
│ tools removed from the request │              │                                │
└────────────────────────────────┘              └────────────────────────────────┘
```

| Piece | File | Notes |
| --- | --- | --- |
| Assembly | `src/utils/models/tool-rescue/middleware.ts` | Connects the inbound and outbound halves. |
| Inbound transform | `src/utils/models/tool-rescue/transform-params.ts` | Places the instructions: before the first user message for Claude Code, inside the first system message for `systemPromptFirst` models, otherwise as a new first system message. |
| Instruction text | `createToolPrompts` in `src/utils/models/tool-rescue/prompt.ts` | Lists every offered tool with its JSON schema. Required and optional steps share one wording, since the closing reminder carries the requirement. |
| History as text | `convertPromptToolMessagesToText` in the same file | Rewrites earlier calls and results in the format the model is taught. |
| Reading replies | `generate.ts`, `stream.ts`, `extract.ts`, `recovery.ts` in `src/utils/models/tool-rescue/` | Pull tool calls out of the reply text. |
| Call text format | `formatToolCallText`, `formatToolResultText` in `src/utils/models/text-cleaning.ts` | Shared by the history rewrite and the reply parser. |
| Framing | `FRAMING_PRESETS` in `prompt.ts`; `resolveToolFraming` in `src/utils/models/models.ts` | Claude Code says "action" instead of "tool", so it does not confuse game tools with its own CLI tools. `reframeToolWording` rewrites the agent's system text to match. |
| Pinned reply shape | `buildToolCallArraySchema` in `prompt.ts` | For Claude Code on a step that requires a call, forces the reply into the tool-call JSON shape. |

Because the instructions are built from the offered tools, they do not change when a step allows fewer tools. The one exception is Claude Code: a required step pins the reply shape and an optional step does not. Claude Code gets no caching between steps anyway (see [Caching](../framework/caching.md)).

A text call to a removed tool is still recovered by name and then rejected like a native call (`tests/mock/infra/narrowed-tool-rejection.test.ts`).

## Codex

Codex responses need extra handling, done in `codex-response.ts`:

- Codex reports its own built-in activity as `tool_calls` and `tool_results`. The middleware turns these into provider-executed tool events, removes them from the history sent back next time, and leaves game tools for Vox Agents to run.
- It passes the previous step's response id as `previous_response_id` between steps of one agent run. This lets the proxy continue the same Codex thread instead of starting over. The outcome is recorded as `host.thread_reuse` (see [Codex proxy](codex.md#thread-continuation)).

How the proxy itself is started, restarted, and updated is on the [Codex proxy](codex.md) page.
