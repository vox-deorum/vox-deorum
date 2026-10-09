# vox-agents: Prompts and tool calling

This page explains how a model request is assembled, from an agent's hooks down to what the provider actually receives. The goal is to make prompt edits safe: find the piece you want to change in the map at the end, and know what else reads it.

Paths are relative to `vox-agents/src/`.

## The big picture

A request passes through three layers. Each layer adds or rewrites part of the prompt, so the text a model sees is never written in one place.

```
 ┌─────────────────────────────┐
 │ 1. Agent hooks              │  getSystem, getInitialMessages,
 │    (infra/vox-agent.ts and  │  getActiveTools, prepareStep,
 │     each agent family)      │  continuationNudge
 └──────────────┬──────────────┘
                │ system text, opening messages, tool lists
                ▼
 ┌─────────────────────────────┐
 │ 2. Step loop                │  executeAgent / executeAgentStep
 │    (infra/vox-execute.ts)   │  builds messages, resolves tools,
 │                             │  appends the closing reminder,
 │                             │  calls streamText once per step
 └──────────────┬──────────────┘
                │ messages, tools, activeTools, toolChoice
                ▼
 ┌─────────────────────────────┐
 │ 3. Model middleware         │  getModel (utils/models/models.ts)
 │    (utils/models/...)       │  wraps the provider: capability text,
 │                             │  prompt-mode tool schemas, forced-choice
 │                             │  restatement, Claude Code demotion
 └──────────────┬──────────────┘
                ▼
           provider wire
```

Layer 1 decides *what* the agent wants to say. Layer 2 decides *how the conversation grows* across steps. Layer 3 adapts the request to each provider's limits. Layer 3 only ever appends to or rearranges what the earlier layers built, so a prompt edit usually belongs in layer 1, and a tool-calling behavior change usually belongs in layer 2 or 3.

## One run, step by step

An agent run is a loop of model calls, called steps. Each step sends the whole conversation so far and gets one reply back.

```
executeAgent
 │
 ├─ getSystem()            ──► empty string? stop, nothing to do
 ├─ getInitialMessages()   ──► opening context (game state, chat record, hint)
 ├─ getRunTools()          ──► tools declared for the whole run
 ├─ triage() (optional)    ──► picks a model tier
 ├─ getModel()             ──► model config for the run
 │
 └─ loop: executeAgentStep
      ├─ prepareStep()         may rewrite messages (empty-reply rescue),
      │                        switch model, remove tools from now on
      ├─ resolve tools         declared = getRunTools()
      │                        executable = prepareStep's list, else declared
      ├─ closing reminder      continuationNudge() appended last
      ├─ streamText            one model call through getModel's middleware
      ├─ append reply          assistant message plus tool results
      └─ stopCheck()           done? otherwise loop
```

The conversation only grows by appending. A step's reply and tool results go after everything sent before, so the start of the request stays the same from step to step. That stable start is what prompt caching reuses (see [Caching](#caching)).

## What the model sees

Here is one request on step 2 of a strategist run, top to bottom, for a provider with native tool calling:

```
┌─────────────────────────────────────────────┐
│ tools: the run's declared tools             │ ◄─ getRunTools(), same every step
├─────────────────────────────────────────────┤
│ system: agent instructions                  │ ◄─ getSystem()
│   + middleware additions (see layer 3)      │
├─────────────────────────────────────────────┤
│ system: game context  [cache anchor]        │ ◄─ getInitialMessages()
│ user:   game state report                   │
├─────────────────────────────────────────────┤ ─┐
│ assistant: step 1 tool calls                │  │ appended by the loop,
│ tool:      step 1 tool results              │  │ one block per earlier step
├─────────────────────────────────────────────┤ ─┘
│ user: empty-reply rescue (only if needed)   │ ◄─ prepareStep()
│ user: closing reminder                      │ ◄─ continuationNudge()
└─────────────────────────────────────────────┘
```

The closing reminder is always the last message. It comes after any rescue message, so the model reads "your last reply was empty, try again" and then "here is what you may call and how to finish". Required steps ask for all independent tool calls together in one response; continuation steps ask for a finishing call in the current response.

In prompt mode the tool block disappears from the wire. Its content moves into the text, as described in [Prompt-mode tool calling](#prompt-mode-tool-calling).

## Declared and executable tools

Each step has two tool lists:

| List | Comes from | Effect |
| --- | --- | --- |
| Declared | `getRunTools()` on the agent, resolved once before the first step. It defaults to `getActiveTools()` (plus `bash` when the seat has files on), and to every registered tool when that returns nothing. | Sent to the model on every step of the run. Never changes within a run. |
| Executable | `prepareStep()`'s `activeTools`, else the declared list | What may actually run this step. Names outside the declared list are dropped. |

Keeping the declared list fixed means the tool block, and every prompt text built from it, stays byte-identical across steps. Middleware text also does not depend on the tool choice, so a step that drops from `required` to `auto` changes only the closing reminder at the end. Narrowing is enforced after the model replies instead.

```
model reply: [ get-briefing(...), send-message(...) ]
                    │                    │
       removed this step            allowed this step
                    │                    │
                    ▼                    ▼
          rejection hook fails      runs normally
          call marked invalid,      result goes into history
          error result returned
                    │                    │
                    └────────┬───────────┘
                             ▼
            both results join the history
```

- `executeAgentStep` (`infra/vox-execute.ts`) computes both lists and whether the step is narrowed.
- `buildRemovedToolRejections` (`utils/tools/tool-availability.ts`) builds one rejection hook per removed tool, passed to the AI SDK as `experimental_refineToolInput`. Only removed tools get a hook, so allowed calls take the normal path. The SDK handles each call separately, so a rejected call never blocks the others in the same reply.
- Oracle's batch mode never runs the SDK. `convertToStepResult` (`oracle/batch/format-converter.ts`) applies the same hooks while converting a batch response, so a rejected call comes back invalid with the same error result.
- The tool choice (`required` or `auto`) follows the executable list, so a step that may run nothing is never forced to call a tool. The closing reminder says when a call is required.
- Tools are only ever removed mid-run, never added. A restriction that is known before the first step belongs in `getRunTools()`, so the model is only shown what it may use. Current case: a telepathist in special mode declares no tools (`telepathist/telepathist.ts`), so it does not get `bash` even with files on.
- `prepareStep()` removes tools only after an earlier step ran. No agent does this today. Telemetry and Oracle depend on this assumption: the first step always runs the full declared list (see [Telemetry and replay](#telemetry-and-replay)).

## Reminders

Three reminders are added during a run. All go through `appendReminder` (`utils/prompts/reminders.ts`), which appends a user message and skips it when the same text is already the last message.

| Reminder | Added by | When | Built in |
| --- | --- | --- | --- |
| Empty-reply rescue | `VoxAgent.prepareStep` (`infra/vox-agent.ts`) | The last step made no tool call when one was required, or replied with nothing at all | `buildRescuePrompt` (`utils/models/text-cleaning.ts`) |
| Closing reminder | `executeAgentStep` (`infra/vox-execute.ts`), from `VoxAgent.continuationNudge` | Every step where it has content | `buildClosingReminder` (`utils/prompts/closing-reminder.ts`) |
| Compaction reminder | `executeAgent` (`infra/vox-execute.ts`), kept in the run history | Once per run with files on, when a request reaches 75 percent of the model's `continuityThreshold`; threshold compaction waits until a step after it | `compactionReminder` (`utils/prompts/message-history.ts`) |

The closing reminder is one template in `buildClosingReminder`, one line per sentence. Lines that do not apply are dropped and the rest are joined with spaces, in this order:

| Sentence | Included when |
| --- | --- |
| Requirement: "you must issue tool calls" | The step's tool choice is `required` |
| Tool policy: "you may only call X or Y", or "no tools are available" | Some declared tools were removed for this step |
| Steps left: "make your final decision within N steps", or "this is your last step" | Every step when the seat has `files` on |
| Finalize nudge: "make sure to call ... to finalize" | Step 2 onward, naming the agent's `completionTools` that are executable this step |

The requirement lives here rather than in provider middleware, so every provider gets it and the early prompt text never depends on the tool choice. With nothing to say (for example, the first step of an `auto` agent), no message is added. An agent can override `continuationNudge` to change or drop the reminder.

## Layer 3: model middleware

`getModel` (`utils/models/models.ts`) wraps the provider model in middleware. The AI SDK runs each wrapper's prompt transform from the outside in, so the outermost wrapper sees the prompt first and the provider sees the result of all of them.

```
outermost
  │ capability text           (bash workspace, or Web on Codex or Claude Code)
  │ tool middleware           prompt mode, gemma, or default rescue
  │ Claude Code demotion      (Claude Code only)
  │ think-tag extraction      (thinkMiddleware option)
  │ provider-specific         required-tool-choice (Anthropic, Vertex Claude, Codex),
  │                           Codex response handling
  ▼
provider
```

What each one adds to the prompt:

| Middleware | File | Adds or changes |
| --- | --- | --- |
| Capabilities | `utils/models/capability-prompt.ts` | Appends an `# Extra Capabilities` section to the first system message: a Workspace section when files are on and the request declares `bash` (any provider), a Web section for Codex or Claude Code with Web on, and the completion tools to call after them. |
| Tool rescue, prompt mode | `utils/models/tool-rescue/` (see below) | Replaces the native tool block with a text schema block and rewrites earlier tool calls as text. |
| Tool rescue, default | `utils/models/tool-rescue/middleware.ts` | Changes no prompt text. It only recovers calls a model wrote as JSON text instead of a native call. |
| Gemma | `hermesToolMiddleware` from `@ai-sdk-tool/parser` | Hermes-style tool block for Gemma models. |
| Claude Code demotion | `utils/models/providers/claude-code-prompt.ts` | Turns every system message into a user message in place, because the provider sends the whole prompt as one CLI user turn anyway. |
| Required tool choice | `utils/models/providers/required-tool-choice.ts` | For providers that reject a forced tool choice, switches it to `auto`. Whatever the tool choice, appends a sentence to the first system message naming the completion tools that end the turn and the other tools as support. Adds nothing when no declared tool completes the turn. |

Both system-text additions use `appendSystemInstruction` (`utils/models/providers/system-prompt.ts`), which appends to the first system message, or creates one if none exists. They build their tool names from the declared list and ignore the tool choice, so their text stays the same on narrowed steps. The closing reminder, which comes later in the prompt, says whether a call is required and what may actually run.

## Prompt-mode tool calling

Models without reliable native tool calling use prompt mode, set by `options.toolMiddleware: 'prompt'` on the model config. Claude Code always runs in prompt mode. The model is taught to write tool calls as JSON text, and the middleware turns that text back into real tool calls.

```
inbound (transformRescueParams)                 outbound (generate.ts / stream.ts)
┌────────────────────────────────┐              ┌────────────────────────────────┐
│ native tools  ──► text schema  │              │ JSON text in reply             │
│ block (createToolPrompts)      │              │   ──► extracted tool calls     │
│ earlier tool calls/results     │   model      │   (extract.ts, recovery.ts)    │
│   ──► plain text               │ ──────────►  │ leftover fences stripped       │
│ tools removed from the wire    │              │   before history (text-cleaning│
└────────────────────────────────┘              └────────────────────────────────┘
```

| Piece | File | Notes |
| --- | --- | --- |
| Assembly | `utils/models/tool-rescue/middleware.ts` | Wires the inbound and outbound halves. |
| Inbound transform | `utils/models/tool-rescue/transform-params.ts` | Decides where the schema block goes: before the first user message for Claude Code, merged into the first system message for `systemPromptFirst` models, otherwise as a new leading system message. |
| Schema block text | `createToolPrompts` in `utils/models/tool-rescue/prompt.ts` | `required` and `auto` share one wording, since the closing reminder carries the requirement. A named tool and Claude Code's pinned format (below) have their own. Lists every declared tool with its JSON schema. |
| History as text | `convertPromptToolMessagesToText` in the same file | Earlier calls and results become text in the same format the model is taught. |
| Framing | `FRAMING_PRESETS` in `prompt.ts`; `resolveToolFraming` in `utils/models/models.ts` | Claude Code uses "action" wording instead of "tool", so it does not confuse VD tools with its own CLI tools. `reframeToolWording` rewrites agent system prose to match. |
| Structured output | `buildToolCallArraySchema` in `prompt.ts` | For Claude Code with a required tool call, pins the reply to the tool-call JSON shape. Its tool-name list is the declared list. |
| Call text format | `formatToolCallText`, `formatToolResultText` in `utils/models/text-cleaning.ts` | Shared by the inbound history rewrite and the recovery parser. |

Because the schema block is built from the declared list and shared by `required` and `auto`, it does not change when a step is narrowed. The one exception is Claude Code: a required step pins its reply format and teaches that shape, and an `auto` step does not. Claude Code gets no cache reuse between steps anyway (see [Caching](#caching)). A text call to a removed tool is still recovered by name and then rejected like a native call. `tests/mock/infra/narrowed-tool-rejection.test.ts` covers this.

## Caching

Anthropic-family providers (direct Anthropic, Claude on Vertex, OpenRouter) cache a request prefix up to a marked message. The marker is `cacheBreakpoint` in `utils/models/cache-breakpoint.ts`, added to a message's `providerOptions`. Other providers ignore it.

The cache matches by prefix: the tools come first, then the system text, then messages, so any change early in the request invalidates everything after it. That is why:

- The declared tool list stays fixed for the whole run.
- Middleware additions are built from the declared list, not the step's executable list, and do not depend on the tool choice.
- Every per-step instruction (rescue and closing reminder) goes at the end.

Where agents place their anchors:

| Agent family | Anchor | File |
| --- | --- | --- |
| Strategists | The game-context system message | `strategist/agents/simple-strategist.ts` and its `-briefed` and `-staffed` variants |
| Briefers | Their game-context message | `briefer/simple-briefer.ts`, `briefer/specialized-briefer.ts` |
| Live envoys | Game context, settled past conversations, last ongoing chat row (three anchors, at most four allowed per request) | `buildGameContextMessages` in `strategist/strategy-parameters.ts`; `getInitialMessages` in `envoy/live-envoy.ts`; strategy note in `envoy/envoy.ts` |
| Any agent whose seat has `files` on | The run's last initial message, unless it already carries an anchor or the request already has four | `executeAgent` in `infra/vox-execute.ts` |

`markBreakpointOnLast`, `countCacheBreakpoints`, and the four-anchor ceiling `MAX_CACHE_BREAKPOINTS` live next to the marker in `utils/models/cache-breakpoint.ts`. Entries last five minutes, refreshed on each read.

With files on, a run often takes many steps, so its initial prompt (instructions, game context, and game state) becomes an anchor. Step 1 writes it to the cache, and later steps within the five-minute window read it back. The steps-left countdown and all step traffic come after it, and [compaction](compaction.md) only rewrites messages after it, so neither breaks the cached prefix. Step 1 pays the cache-write premium even when the run ends in one step.

Claude Code flattens the whole prompt into one CLI user message per step, so it does not reuse anything past the CLI's own system prompt between steps.

## System prompt files

Every authored system prompt is a Mustache file in `vox-agents/prompts/`, rendered by `renderSystemPrompt` in `utils/prompts/prompt-files.ts`. Each agent's prompt is `<agent-name>.md`, and a variant is `<agent-name>.<variant>.md` (the specialized briefer has `.military`, `.economy`, and `.diplomacy`). Fragments shared by several agents, such as the resource descriptions and the decision instructions, live under `shared/`. A template's name is its path without `.md`, such as `shared/goals`. The folder is found from the module path, so `src` and `dist` both read it, and the installer ships it.

Prose lives in the files. `getSystem` passes only data and flags in the view:

| Template | View |
| --- | --- |
| Simple, briefed, staffed, and learned strategists | `flavor` (Flavor or Strategy mode, read by `shared/decision`); `episodes` for the learned strategist |
| Diplomat and spokesperson | `user`, and a `teammate` section over the teammate's fields |
| Negotiator | `leader`, `civilization`, a `teammate` section, and `coopWarLabel` (the joint-war term name from the deal schema) |
| Diplomatic analyst and summarizer | `leader` and `civilization` |
| Talkative telepathist | `leader`, `civilization`, and an inverted `special` section around the tools passage |
| Simple and specialized briefers, keyword librarian, evaluator strategist | Static |

Rendering turns off HTML escaping, so `&` and `<` in game data stay intact, and trims the result. Partials go on their own line at column 0: Mustache removes a standalone tag's line, so each fragment file ends with exactly one newline. The summarizer's turn instructions (`telepathist/preparation/instructions.ts`) also render `shared/historian-guidelines` through the root setting, so they match its system prompt. Text added after `getSystem`, such as the workspace section, the completion-tool sentence, and prompt-mode schemas, stays in code. The oracle agent returns the recorded system text and never reads these files.

### Custom folders

The `prompts` setting names a folder relative to `vox-agents/`. `resolveSeatPrompts` in `strategist/seat-config.ts` resolves it seat over session over root, as `resolveSeatFiles` does, and `VoxPlayer` stores the result on the seat's context. Runs outside a seat use the root setting. Lookup checks the custom folder first, then the built-ins, and partials resolve the same way, so a custom `shared/goals.md` reaches every strategist that includes it.

`StrategistSession.start` calls `reloadPromptSets` with every folder the session uses, before any player loop. Runs outside a session use the root folder, which `reloadRootPrompts` validates when the web server starts and before summary preparation. A dashboard config save calls `validatePromptsSetting` on the proposed value before writing anything, and refuses an invalid folder with the reason. The root `prompts` field is part of the runtime config and the saved diff (`utils/config.ts` and `utils/config/diff.ts`). Each folder is read, parsed, and validated once, and an invalid one fails with an error naming the file:

- Every `.md` file must match a built-in path.
- Every partial must exist, and no partial may include itself. A missing partial is reported with the file that includes it. The built-ins get these checks too, since Mustache would render a missing partial as nothing.
- Each template may use only the names its built-in counterpart uses, including through partials. A name must keep its kind (variable or section) and its scope: a field the built-in reads inside `{{#teammate}}` is rejected outside it. A name the built-in reads outside a section stays valid inside one, since Mustache looks it up through enclosing sections. Inverted sections add no scope.

Seat errors name the setting's config path, such as `llmPlayers.2.prompts`.

A failed reload keeps the previous sets, and a reload leaves other folders' cached sets alone, so a second session in the same process changes a running session's text only for folders both use. Edits take effect in the next session. Each agent span records the folder in use as `context.prompts`, or `false` for built-ins only.

## Where to edit

| To change | Edit | Notes |
| --- | --- | --- |
| An agent's main instructions | Its file in `vox-agents/prompts/`; the view in that agent's `getSystem()` | Shared passages are in `prompts/shared/`. See [System prompt files](#system-prompt-files). |
| Opening game context | That agent's `getInitialMessages()` | Shared envoy and analyst context: `buildGameContextMessages` in `strategist/strategy-parameters.ts`. |
| Envoy hint (identity, audience, turn) | `getHint` in `envoy/live-envoy.ts`, overridden in `telepathist/talkative-telepathist.ts` | Always the last opening message for a live envoy. |
| Envoy add-on after the hint | `getDefaultAddon` in `envoy/envoy.ts`, overridden in `envoy/agents/diplomat.ts` and `envoy/agents/spokesperson.ts` | |
| Special messages (telepathist only) | `getSpecialMessages` in `telepathist/talkative-telepathist.ts` | A special message also removes the run's tools (`getRunTools` in `telepathist/telepathist.ts`). |
| Which tools an agent has | That agent's `getActiveTools()` | Adding a tool here changes every request's prefix. |
| Limiting tools for a whole run | That agent's `getRunTools()` | Decided from the run's input before the first step. The model sees only these tools. |
| Removing tools mid-run | That agent's `prepareStep()`, setting `activeTools` | Only after an earlier step ran, and only removing. The removed tools stay declared, and the policy sentence is added automatically. |
| Which calls end the turn | The agent's `completionTools` | Read by `stopCheck`, the finalize nudge, required-tool-choice text, and capability text. |
| Closing reminder wording and order (requirement, tool policy, steps left, finalize nudge) | The template in `buildClosingReminder`, `utils/prompts/closing-reminder.ts`; per-agent override of `continuationNudge` in `infra/vox-agent.ts` | The requirement is on every `required` step, for every provider. |
| Error text for a call to a removed tool | `buildRemovedToolRejections` in `utils/tools/tool-availability.ts` | The model sees it as that call's tool result. |
| Empty-reply rescue wording | `buildRescuePrompt` in `utils/models/text-cleaning.ts` | Triggered from `VoxAgent.prepareStep`. |
| Completion-tool sentence (Anthropic, Codex) | `completionToolsInstruction` in `utils/models/providers/required-tool-choice.ts` | Must not depend on the tool choice. |
| Extra Capabilities section | `capabilityInstruction` in `utils/models/capability-prompt.ts` | |
| Prompt-mode schema block | `createToolPrompts` in `utils/models/tool-rescue/prompt.ts` | Keep it in step with `buildToolCallArraySchema` and `formatToolCallText`; the recovery parser depends on the same shape. |
| Which models use prompt mode | `options.toolMiddleware` in the model config; defaults in `utils/models/rules.ts` | |
| A shared list format ("`a`, `b`, or `c`") | `formatToolChoiceList` in `utils/tools/tool-names.ts` | Used by every builder above. |

## Telemetry and replay

Each step span records what was sent, which is how you check a prompt change against a real run (see [observability.md](observability.md)):

| Attribute | Content |
| --- | --- |
| `step.messages` | The full message list sent, after the closing reminder and before layer 3. |
| `step.tools` | The tools that may run on this step. Since tools are only removed mid-run, the first step's list is the run's declared list. |
| `step.tools.choice` | The tool choice for the step. |
| `step.tool_framing` | `tool` or `action`, only when prompt mode ran. |

Layer 3 additions are not recorded, because they are rebuilt from the model config on every call. [Oracle](oracle.md) relies on this: it replays the first step's `step.messages` and `step.tools` (read in `oracle/utils/prompt-extractor.ts`) through the replay model's own middleware, so a replay on a different provider gets that provider's prompt-mode text and capability sections. It also reads the later steps' `step.tools` and removes the same tools on the same replay steps (`OracleAgent.prepareStep`), so a replay rejects the calls the original run would have rejected. A rejected or malformed call never ran, so `OracleAgent.getOutput` leaves it out of the exported decisions and their rationale.

## Tests

Tests check behavior and compose expected text through the same builders, so editing a wording does not break them. The main ones:

| Area | Test file in `vox-agents/tests/mock/` |
| --- | --- |
| Closing reminder and nudge | `infra/continuation-nudge.test.ts` |
| Removed-tool rejection, native and prompt mode | `infra/narrowed-tool-rejection.test.ts` |
| What the loop sends on each step | `context/vox-context-execute-runs.test.ts` |
| Run-level tool limits for envoys | `envoy/live-envoy.test.ts` |
| Oracle replay of mid-run removals and exported decisions | `oracle/oracle-agent-tools.test.ts`, `oracle/prompt-extractor.test.ts` |
| Removed-tool rejection in Oracle batch mode | `oracle/format-converter.test.ts`, `utils/concurrency-batch-guard.test.ts` |
| Required-tool-choice conversion and completion-tool text | `utils/providers/required-tool-choice.test.ts` |
| Prompt-mode schema block | `utils/tool-rescue-prompt.test.ts` |
| Rescue of required tool calls | `infra/required-tool-rescue.test.ts` |
| Capability text | `utils/capability-prompt.test.ts` |
| Prompt files, custom folders, and validation | `utils/prompt-files.test.ts` |
