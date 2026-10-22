# Prompts and tool calling

An agent request is built in three layers. Use this map to choose where a prompt change belongs.

| Layer | Responsibility | Source |
| --- | --- | --- |
| Agent hooks | Instructions, opening context, and run tools | `getSystem`, `getInitialMessages`, and `getRunTools` in `src/infra/vox-agent.ts` and each agent family |
| Step loop | Conversation history, tool permissions, reminders, and stopping | `src/infra/vox-execute.ts` |
| Model middleware | Provider capabilities, tool framing, and request adaptation | `src/utils/models/`; see [Model middleware](../models/middleware.md) |

Agent prose lives in [prompt files](prompt-files.md). Keep the start of a request stable across steps for [caching](caching.md); changing a reminder should usually affect only the end.

## One run, step by step

`executeAgent` resolves the run tools before building prompts, so every builder can detect file mode. It then prepares the system prompt and initial messages, runs optional triage, and selects the model. An empty system prompt ends the call. Evaluation agents use their [evaluation path](../models/evaluators.md) instead of the loop.

Each chat step:

1. Calls `prepareStep`, which may adjust messages, model settings, or allowed tools.
2. Resolves tool permissions and appends the closing reminder.
3. Calls the model through its middleware and appends the reply and tool results.
4. Calls `stopCheck` to decide whether to continue.

The prepared prompt is reused across steps. Later history can be changed by [compaction](compaction.md).

## What the model sees

For a native tool-calling model, the request contains the run's tool schemas, agent instructions, opening context, previous exchanges, any rescue message, and the closing reminder. Middleware adapts that request for the provider. [Prompt mode](../models/middleware.md#prompt-mode-tool-calling) moves the tool protocol into text.

The closing reminder comes after any empty-reply rescue. It asks for independent calls together and, on continuation steps, asks the model to finish through its completion tools. A finishing call ends the run, so information gathering belongs on earlier steps. When bash is available and a workspace folder is writable, the reminder allows notes to be written in the finishing response, including on the first step.

## File mode

A run is in file mode when files are enabled and its resolved tools include `bash`. `fileMode(context)` in `src/knowledge/directions.ts` reads the declaration stored on the execution frame. Tool-free agents stay inline even on file-enabled seats.

`insertRecordsDirections` adds two system messages to a file-mode run:

| Message | Position | Contents |
| --- | --- | --- |
| Records directions | Before the overview or shared game context | Mounted folders and permissions, record paths, which sections remain inline, read examples, and the game notes guide. |
| Notes, when present | After leading system messages, before the game-state user message | With a [game journal](../workspace/files.md#game-journal), its newest whole entries within 20,000 characters. Then the paths of the five most recent other notes. Other notes are listed by name only, ordered by stored modification time, and the guide is excluded. |

Directions come from `records-directions.md` and notes from `records-notes.md`. Both are built once per run. Built-in directions depend on file access, inline sections, and the guide, so writing ordinary records or notes leaves them stable across turns. Editing the guide affects later runs. Neither message adds its own cache breakpoint.

The [workspace store](../workspace/store.md#records) documents turn folders, split reports, event views, and the catalog. The guide is `/workspace/game/AGENTS.md`; when a writable game folder has no guide yet, directions show the default text that bash will seed.

| Agent | Opening context in file mode |
| --- | --- |
| Simple strategist | Overview, strategies, victory, full players report, own cities, full military, and last-decision context. Other owners' city files are named; without an own-city entry, all cities stay inline. |
| Briefed, staffed, and learned strategists | Overview, strategies, filtered players, victory, briefings, and last-decision context. The learned variant also adds retrieved episodes. |
| Diplomat, spokesperson, negotiator | Directions and notes around the shared game context, followed by conversation messages. |
| Briefers and diplomatic analyst | No file mode: they declare no bash tool. |

File-mode strategists read events from records and choose their own reading order. Their decision context names the last completed decision turn, or says none has completed on the current timeline. A failed decision leaves that cursor unchanged.

`VoxPlayer` resolves tools once per decision and shares that declaration with prompt preparation and event handling. File-mode decisions run once and fail on overflow. Inline consumers use the merged event window and retry overflow with less important events removed; see [Player loop](../agents/strategists/player-loop.md#event-windows).

## Offered and allowed tools

| List | Source | Effect |
| --- | --- | --- |
| Offered, called declared in code | `getRunTools()`, resolved once | Sent on every step. The default uses `getActiveTools()` and adds bash for a tool-using agent when available. `undefined` offers all registered tools; `[]` offers none. |
| Allowed, called executable in code | `prepareStep().activeTools`, or the offered list | Controls what may execute this step. Names outside the offered list are ignored. |

Narrowing permissions keeps the offered schemas stable for caching. `buildRemovedToolRejections` in `src/utils/tools/tool-availability.ts` rejects each removed call through the AI SDK without blocking other calls in that reply. The error joins the conversation as that call's result. Required tool choice follows the allowed list, so a step with no executable tools is never forced to call one.

Restrict tools before the first step through `getRunTools` when possible. For example, a telepathist special message offers no tools, including bash. Mid-run narrowing belongs after an earlier step; telemetry and Oracle use the first step's list as the run declaration.

## Reminders

`appendReminder` in `src/utils/prompts/reminders.ts` adds a user message unless identical text is already last.

| Reminder | Trigger | Builder |
| --- | --- | --- |
| Empty-reply rescue | No call when required, or an empty reply | `buildRescuePrompt` in `src/utils/models/text-cleaning.ts`, called by `VoxAgent.prepareStep` |
| Closing reminder | Applicable tool rules or completion instructions | `buildClosingReminder` in `src/utils/prompts/closing-reminder.ts`, called through `continuationNudge` |
| Compaction reminder | First crossing of 75 percent of the continuity threshold with files enabled | `compactionReminder` in `src/utils/prompts/message-history.ts` |

The closing reminder names narrowed permissions, states required tool use, counts remaining steps when files are enabled, and names allowed completion tools from step 2 onward. Irrelevant parts are omitted. Agents may override `continuationNudge` to change or suppress it.

## Where to edit

| Change | Location |
| --- | --- |
| Main instructions and template data | Agent prompt file and its `getSystem()`; see [Prompt files](prompt-files.md) |
| Opening context | Agent's `getInitialMessages()`; shared live context uses `buildGameContextMessages` in `src/strategist/strategy-parameters.ts` |
| Records directions and notes | `prompts/records-directions.md`, `prompts/records-notes.md`, and `src/knowledge/directions.ts` |
| Game-state titles, descriptions, and Markdown defaults | Registry in `src/knowledge/sections.ts` |
| Envoy identity hint or add-on | `getHint` in `src/envoy/live-envoy.ts` and `getDefaultAddon` in `src/envoy/envoy.ts`, plus subclass overrides |
| Telepathist special messages | `getSpecialMessages` in `src/telepathist/talkative-telepathist.ts` |
| Run tools, step permissions, completion | Agent's `getRunTools`, `prepareStep`, and `completionTools` |
| Closing or rescue wording | `src/utils/prompts/closing-reminder.ts` and `src/utils/models/text-cleaning.ts` |
| Capability and workspace text | `src/utils/models/capability-prompt.ts` and `prompts/workspace.md` |
| Provider completion instructions | `src/utils/models/providers/required-tool-choice.ts` |
| Prompt-mode protocol and model selection | `src/utils/models/tool-rescue/prompt.ts`, model `options.toolMiddleware`, and `src/utils/models/rules.ts` |

Tool-name lists share `formatToolChoiceList` in `src/utils/tools/tool-names.ts`. Keep prompt-mode instructions consistent with the tool-call schema and formatter.

## Telemetry and replay

[Step spans](../platform/observability.md) record the prepared request before model middleware:

| Attribute | Contents |
| --- | --- |
| `step.messages` | Messages after the closing reminder |
| `step.tools` | Allowed tools; the first step supplies the run declaration |
| `step.tools.choice` | Tool-choice requirement |
| `step.tool_framing` | `tool` or `action` when prompt mode ran |

[Oracle](../agents/oracle.md) extracts those messages and tools through `src/oracle/utils/prompt-extractor.ts`. Replay applies the selected model's middleware, reconstructs later tool restrictions, and excludes rejected or malformed calls from exported decisions. Batch replay applies the same rejection hooks in `src/oracle/batch/format-converter.ts`.

## Tests

The relevant suites under `tests/mock/` cover request construction (`context/`), reminders and tool rejection (`infra/`), file-mode directions (`knowledge/` and `strategist/`), provider framing (`utils/`), and replay restrictions (`oracle/`). Test behavior and data flow so prompt wording can change without rewriting assertions.
