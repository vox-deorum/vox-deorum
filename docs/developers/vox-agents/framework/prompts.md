# Prompts and tool calling

The text a model receives is never written in one place. Three layers each add a part: the agent writes its instructions and opening context, the step loop grows the conversation and adds reminders, and model middleware adapts the request to each provider. This page shows how the layers fit together so you can find the right place for a prompt change.

```
 ┌─────────────────────────────┐
 │ 1. Agent hooks              │  getSystem, getInitialMessages,
 │    (src/infra/vox-agent.ts  │  getActiveTools, prepareStep,
 │     and each agent family)  │  continuationNudge
 └──────────────┬──────────────┘
                │ system text, opening messages, tool lists
                ▼
 ┌─────────────────────────────┐
 │ 2. Step loop                │  executeAgent / executeAgentStep
 │    (src/infra/vox-execute)  │  builds messages, resolves tools,
 │                             │  adds the closing reminder,
 │                             │  calls the model once per step
 └──────────────┬──────────────┘
                │ messages, tools, activeTools, toolChoice
                ▼
 ┌─────────────────────────────┐
 │ 3. Model middleware         │  getModel (src/utils/models/models.ts)
 │    (src/utils/models/...)   │  capability text, prompt-mode tools,
 │                             │  provider workarounds
 └──────────────┬──────────────┘
                ▼
           provider
```

A rule of thumb:

- To change what an agent says, edit layer 1. Most agents keep their prose in [prompt files](prompt-files.md).
- To change how tools are offered or how a run ends, look at layer 2 or 3.

Layer 3 only appends to or rearranges what the earlier layers built. It is covered in [Model middleware](../models/middleware.md). Prompt caching, which depends on all three layers keeping the start of the request stable, has its own page: [Caching](caching.md).

## One run, step by step

A run is a loop of model calls. Each call is a **step**: it sends the whole conversation so far and gets one reply.

```
executeAgent
 │
 ├─ getRunTools()          ──► tools offered for the whole run (decides file mode)
 ├─ getSystem()            ──► empty string? stop, nothing to do
 ├─ getInitialMessages()   ──► opening context (game state, chat record, hint)
 ├─ triage() (optional)    ──► picks a model tier
 ├─ getModel()             ──► model config for the run
 │
 └─ loop: executeAgentStep
      ├─ prepareStep()         may add a rescue message, switch model,
      │                        or take tools away from now on
      ├─ resolve tools         offered = getRunTools()
      │                        allowed = prepareStep's list, else offered
      ├─ closing reminder      continuationNudge() added last
      ├─ call the model        through getModel's middleware
      ├─ append reply          assistant message plus tool results
      └─ stopCheck()           done? otherwise loop
```

The conversation only grows at the end. A step's reply and tool results go after everything sent before, so the start of the request stays the same from step to step.

## What the model sees

One request on step 2 of a strategist run, top to bottom, for a provider with native tool calling:

```
┌─────────────────────────────────────────────┐
│ tools: the run's offered tools              │ ◄─ getRunTools(), same every step
├─────────────────────────────────────────────┤
│ system: agent instructions                  │ ◄─ getSystem()
│   + middleware additions (layer 3)          │
├─────────────────────────────────────────────┤
│ system: game context  [cache anchor]        │ ◄─ getInitialMessages()
│ user:   game state report                   │
├─────────────────────────────────────────────┤ ─┐
│ assistant: step 1 tool calls                │  │ added by the loop,
│ tool:      step 1 tool results              │  │ one block per earlier step
├─────────────────────────────────────────────┤ ─┘
│ user: empty-reply rescue (only if needed)   │ ◄─ prepareStep()
│ user: closing reminder                      │ ◄─ continuationNudge()
└─────────────────────────────────────────────┘
```

The closing reminder is always last. If a rescue message is needed, it comes just before, so the model reads "your last reply was empty, try again" and then "here is what you may call and how to finish". On steps that require a tool call, the reminder asks for all independent calls in one reply. On later steps it asks for all decisions together in one finishing response. Since finishing ends the run, the model never sees results of other calls in that reply, so the reminder asks it to do all reading on earlier steps. When bash can run and a workspace folder is writable, it limits `bash` in the finishing reply to writing notes. On the first step, where many runs finish, it says the same reply that acts may also call `bash` to write notes.

For models in prompt mode, the tool block is removed and its content moves into the text. See [Prompt-mode tool calling](../models/middleware.md#prompt-mode-tool-calling).

## File mode

A run is in file mode when its seat has files on and its resolved run tools include `bash`. The loop resolves `getRunTools()` before any prompt text is built and keeps the result on the execution frame, so `fileMode(context)` in `src/knowledge/directions.ts` gives every prompt builder in the run the same answer. Agents without tools, or without `bash`, stay inline even when files are on.

In file mode, an agent adds **records directions** and the **latest notes** to its opening messages through `insertRecordsDirections`. The helper checks file mode, then inserts two system messages:

- The directions go first, right after the agent's system prompt and before the overview or shared game context. The overview's cache breakpoint then covers them.
- The latest notes, when the seat has any, go right after the leading system messages, before the game state that starts with `# Strategies`. They change whenever an agent writes a note, so they sit after the cached overview instead of ahead of it.

The directions text comes from `recordsDirections` and the `records-directions` prompt file. It tells the model:

- a table of the mounted folders and their access, with the records and the shared reference read-only, the game notes folder and each shared folder read-only or writable according to the seat's files setting, and `/tmp` writable. The table is the only folder listing, because the workspace section and the bash tool description leave folders out;
- that each `turn-<N>` folder is one processed refresh, and the newest is the latest recorded refresh, which can trail the current turn. It names no turn numbers;
- that the records `CATALOG.md` lists the recorded turns and gaps between them, the full section index, briefings, and file sizes;
- which sections are not given inline and the file pattern for each: the sections in `fileModeOmittedSections` (`src/knowledge/sections.ts`: cities, military, and events) that the caller does not keep in the prompt;
- which sections the caller already keeps in the prompt for the latest turn, so the model reads their files for earlier turns or where the prompt points to them. The plain simple strategist passes `simpleStrategistInlineSections`, which adds cities and military to `strategistInlineSections`. The briefed, staffed, and learned variants pass `strategistInlineSections` (options, strategies, victory progress, and players). Envoys pass none.

Events are stored in each turn folder as one file with all events, plus economic, military, diplomatic, and others views. Each view also keeps system events, such as turn starts and ends, as turn markers, and a view whose own category has no events says there are none in that category. Wherever the Players section renders, in a prompt or in `players.md`, unmet, defeated, and barbarian players are listed last under an `Other players` heading and get no split file.

Next comes the game notes guide, `/workspace/game/AGENTS.md`. It says whether the agent may edit the guide and shows the guide's text, noting that the file need not be read again. When the game folder is writable and the guide is not seeded yet, the default guide is shown, since the first bash command seeds exactly that text. An empty guide is shown as "It is empty."

The directions depend only on the files setting, the sections kept in the prompt, and the guide's text, so recording a turn, a briefing, or a note leaves them unchanged. An agent that edits the guide changes them for later runs.

The notes message comes from `recordsNotes` and the `records-notes` prompt file. It shows the text of the most recently written file in the game folder, other than the guide, and the paths of the five written before it. Recency comes from each file's modification time in the store, and the shown text is capped like bash output. Seats without a game folder or without notes get no notes message.

Both messages are built once per run, so they stay fixed across the run's steps and sit inside the prefix cached for later steps. Neither carries a cache breakpoint of its own.

| Agent | Opening messages in file mode |
| --- | --- |
| Simple strategist | The directions, then the system overview, then any notes, then a core message (strategies, victory, full players, our own cities, full military, decision context). The Cities section names the other owners' split files for the turn (`renderStrategistReports` in `src/strategist/strategy-parameters.ts`). Without an entry for our civilization, all cities stay inline. |
| Briefed, staffed, and learned strategists | The same inline content, with the directions before the system overview and any notes between the overview and the reports. |
| Diplomat, spokesperson, and negotiator | The directions come before the shared game-context system message, and any notes sit between it and its game-state user message. |
| Briefers and the diplomatic analyst | No directions. They declare no `bash` tool, so they never run in file mode. |

A file-mode strategist's decision context (`getDecisionTurnContext`) always names the last completed decision turn, even when it was the previous turn, or says that no decision has completed on the current timeline. The strategist chooses what to read. There is no merged events file and no prescribed reading order.

The input decides how events are filtered:

- A file-mode strategist runs once per decision. If its request overflows, the decision fails and the last decision turn stays where it was.
- Inline consumers keep the merged events window. On overflow they retry with fewer events, dropping the least important first. These are strategists without `bash`, briefers, and pacing triage.

`VoxPlayer` (`src/strategist/vox-player.ts`) resolves the strategist's tools once per decision and passes that declaration into each execution attempt, so event handling and prompt preparation use the same tools.

## Offered and allowed tools

Each step has two tool lists. The code calls them declared and executable.

| List | Comes from | Effect |
| --- | --- | --- |
| Offered | `getRunTools()`, chosen once before the first step. Defaults to `getActiveTools()`, adding `bash` when the seat has files on and the list is non-empty. `undefined` offers every registered tool; `[]` offers none. | Sent to the model on every step. Never changes within a run. |
| Allowed | `prepareStep()`'s `activeTools`, or the offered list if it sets none. | What may actually run on this step. Names outside the offered list are ignored. |

Keeping the offered list fixed keeps the tool block, and any text built from it, identical on every step. That matters for [caching](caching.md). The limit on allowed tools is enforced after the model replies:

```
model reply: [ get-briefing(...), send-message(...) ]
                    │                    │
          not allowed this step     allowed this step
                    │                    │
                    ▼                    ▼
          rejected: the call gets   runs normally
          an error as its result
                    │                    │
                    └────────┬───────────┘
                             ▼
                both results join the history
```

Details:

- `executeAgentStep` (`src/infra/vox-execute.ts`) computes both lists.
- `buildRemovedToolRejections` (`src/utils/tools/tool-availability.ts`) builds one rejection hook per removed tool and passes it to the AI SDK. Only removed tools get a hook. A rejected call does not block other calls in the same reply.
- The Oracle's batch mode does not go through the AI SDK, so `convertToStepResult` (`src/oracle/batch/format-converter.ts`) applies the same hooks while reading batch replies.
- Whether a tool call is required follows the allowed list, so a step that may run nothing is never forced to call a tool.
- Tools are only taken away mid-run, never added. If a limit is known before the first step, put it in `getRunTools()` so the model is never shown tools it cannot use. Today, a telepathist answering a special message offers no tools at all (`src/telepathist/telepathist.ts`), so it does not get `bash` even with files on.
- `prepareStep()` may only take tools away after an earlier step ran. No agent does this today. Telemetry and the Oracle rely on the first step always having the full offered list (see [Telemetry and replay](#telemetry-and-replay)).

## Reminders

The loop can add three reminders. All go through `appendReminder` (`src/utils/prompts/reminders.ts`), which adds a user message unless the same text is already the last message.

| Reminder | Added when | Built by |
| --- | --- | --- |
| Empty-reply rescue | The last step made no tool call when one was required, or replied with nothing. Added by `VoxAgent.prepareStep`. | `buildRescuePrompt` (`src/utils/models/text-cleaning.ts`) |
| Closing reminder | Every step where it has something to say. Added by `executeAgentStep` from `VoxAgent.continuationNudge`. | `buildClosingReminder` (`src/utils/prompts/closing-reminder.ts`) |
| Compaction reminder | Once per run with files on, when the request reaches 75 percent of the compaction threshold. See [Compaction](compaction.md). | `compactionReminder` (`src/utils/prompts/message-history.ts`) |

The closing reminder has two paragraphs: tool rules, then decisions. Parts that do not apply are left out, and an empty paragraph is dropped:

| Paragraph | Part | Included when |
| --- | --- | --- |
| Tool rules | "You must call tools on this step", asking for every call at once | The step requires a tool call. |
| Tool rules | "You may only call X or Y", or "no tools are available" | Some offered tools are not allowed on this step. |
| Decisions | "You have N steps left to make your decisions", or "this is your last step" | The seat has files on. |
| Decisions | "Make all your decisions together in one response by calling ..." | Step 2 onward, naming the agent's `completionTools` that are allowed on this step. It warns that finishing ends the run, so reading belongs on earlier steps. With bash able to run and a workspace folder writable, it limits `bash` in that same response to writing notes. |
| First-step notes | "When you act by calling ..., you may also call `bash` in that same response ..." | The first step only, with bash able to run, a workspace folder writable, and a completion tool allowed. |

The "must call" requirement lives here rather than in provider middleware, so every provider gets it and the earlier parts of the prompt never depend on it. When there is nothing to say, such as on the first step of an agent that does not require tools, no message is added. An agent can override `continuationNudge` to change or drop the reminder.

## Where to edit

| To change | Edit | Notes |
| --- | --- | --- |
| An agent's main instructions | Its file in `vox-agents/prompts/`, and the data passed by its `getSystem()` | See [Prompt files](prompt-files.md). |
| Opening game context | The agent's `getInitialMessages()` | Shared envoy and analyst context is `buildGameContextMessages` in `src/strategist/strategy-parameters.ts`. |
| Records directions in file mode | `vox-agents/prompts/records-directions.md`, and the data passed by `recordsDirections` in `src/knowledge/directions.ts` | Keep the text free of turn numbers and notes so it stays fixed across turns. Its folder table is the only folder listing. |
| Latest notes in file mode | `vox-agents/prompts/records-notes.md`, and the data passed by `recordsNotes` in `src/knowledge/directions.ts` | |
| A game-state section's title, description, or default Markdown | The registry in `src/knowledge/sections.ts` | See [Prompt files](prompt-files.md#game-state-sections). |
| Envoy hint (identity, audience, turn) | `getHint` in `src/envoy/live-envoy.ts`, overridden in `src/telepathist/talkative-telepathist.ts` | Always the last opening message for a live envoy. |
| Envoy add-on after the hint | `getDefaultAddon` in `src/envoy/envoy.ts`, overridden by the diplomat and spokesperson | |
| Special messages (telepathist only) | `getSpecialMessages` in `src/telepathist/talkative-telepathist.ts` | A special message also removes the run's tools. |
| Which tools an agent has | The agent's `getActiveTools()` | This changes the start of every request. |
| Tools for a whole run | The agent's `getRunTools()` | Decided before the first step. |
| Tools taken away mid-run | The agent's `prepareStep()`, setting `activeTools` | Only after an earlier step, and only removing. |
| Which calls end the turn | The agent's `completionTools` | Read by `stopCheck`, the closing reminder, and middleware text. |
| Closing reminder wording | `buildClosingReminder` in `src/utils/prompts/closing-reminder.ts`, or override `continuationNudge` | |
| Error text for a call to a removed tool | `buildRemovedToolRejections` in `src/utils/tools/tool-availability.ts` | The model sees it as the call's result. |
| Empty-reply rescue wording | `buildRescuePrompt` in `src/utils/models/text-cleaning.ts` | |
| Completion-tool sentence (Anthropic, Codex) | `completionToolsInstruction` in `src/utils/models/providers/required-tool-choice.ts` | Must not depend on whether the step requires a call. |
| Workspace section of the capability reminder | `vox-agents/prompts/workspace.md`, rendered through the run's prompt folder | Folders and where to find recorded turns belong to the records directions. See [Capability reminder](../models/middleware.md#capability-reminder). |
| Extra Capabilities section | `capabilityInstruction` in `src/utils/models/capability-prompt.ts` | |
| Prompt-mode tool instructions | `createToolPrompts` in `src/utils/models/tool-rescue/prompt.ts` | Keep it in step with `buildToolCallArraySchema` and `formatToolCallText`. |
| Which models use prompt mode | `options.toolMiddleware` in the model config; defaults in `src/utils/models/rules.ts` | |
| Lists of names ("`a`, `b`, or `c`") | `formatToolChoiceList` in `src/utils/tools/tool-names.ts` | Shared by every builder above. |

## Telemetry and replay

Each step span records what was sent, so you can check a prompt change against a real run (see [Observability](../platform/observability.md)):

| Attribute | Content |
| --- | --- |
| `step.messages` | The full message list after the closing reminder, before layer 3. |
| `step.tools` | The tools allowed on this step. The first step's list is the run's offered list. |
| `step.tools.choice` | Whether a tool call was required. |
| `step.tool_framing` | `tool` or `action`, only when prompt mode ran. |

Layer 3 additions are not recorded, because they are rebuilt from the model config on every call. The [Oracle](../agents/oracle.md) relies on this. It replays the first step's `step.messages` and `step.tools` (read in `src/oracle/utils/prompt-extractor.ts`) through the replay model's own middleware, so a replay on another provider gets that provider's additions. It also reads later steps' `step.tools` and removes the same tools on the same steps (`OracleAgent.prepareStep`), so it rejects the calls the original run would have rejected. Rejected or malformed calls never ran, so they are left out of the exported decisions.

## Tests

Tests build their expected text through the same builders, so a wording change does not break them. All are under `vox-agents/tests/mock/`:

| Area | Test file |
| --- | --- |
| Closing reminder | `infra/continuation-nudge.test.ts` |
| Rejecting removed tools, native and prompt mode | `infra/narrowed-tool-rejection.test.ts` |
| What the loop sends on each step | `context/vox-context-execute-runs.test.ts` |
| Run-level tool limits for envoys | `envoy/live-envoy.test.ts` |
| Oracle replay of removed tools and exported decisions | `oracle/oracle-agent-tools.test.ts`, `oracle/prompt-extractor.test.ts` |
| Rejecting removed tools in Oracle batch mode | `oracle/format-converter.test.ts`, `utils/concurrency-batch-guard.test.ts` |
| Required tool choice and completion-tool text | `utils/providers/required-tool-choice.test.ts` |
| Prompt-mode tool instructions | `utils/tool-rescue-prompt.test.ts` |
| Rescue of required tool calls | `infra/required-tool-rescue.test.ts` |
| Capability text | `utils/capability-prompt.test.ts` |
| Prompt files and custom folders | `utils/prompt-files.test.ts` |
| File mode and records directions | `knowledge/directions.test.ts`, `strategist/file-mode.test.ts` |
| Event input path per strategist | `strategist/vox-player-file-events.test.ts` |
