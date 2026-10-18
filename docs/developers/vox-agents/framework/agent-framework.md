# Agents

Every agent in Vox Agents extends one base class, `VoxAgent` (`src/infra/vox-agent.ts`). An agent is a set of hooks: small methods the framework calls while it runs a conversation with a model. The agent says what the prompt is, which tools it may use, and when it is done. The framework does the rest.

The registry shares agent instances across calls. Keep execution state in the context and its runs, so concurrent calls do not overwrite each other (see [Runs](runs.md)).

## One agent call, in short

```
build the prompt  ──►  pick a model  ──►  loop: call model, run tools  ──►  turn the result into output
 getSystem()           triage()           prepareStep()                     getOutput()
 getInitialMessages()  getModel()         stopCheck()                       postprocessOutput()
```

Each loop pass is called a **step**: one model call plus the tool calls it asked for. [Prompts and tool calling](prompts.md) shows exactly what is sent on each step.

## The hooks

| Hook | What it decides |
| --- | --- |
| `getSystem()` | The system prompt. An empty string ends the call before initial messages or model selection. Run tools have already been resolved. |
| `getInitialMessages()` | The opening messages. For a strategist, this is the formatted game state. |
| `triage()` | Optional. Rates the prepared prompt to pick a model tier. The choice is readable as `context.currentTriage`. See [Tiers and triage](../models/tiers-and-triage.md). |
| `getModel()` | The model to use, based on the tier and the agent's `modelSize`. |
| `executeEvaluation()` | Optional. Answers with one evaluation call instead of the chat loop. See [Evaluators](../models/evaluators.md). |
| `getActiveTools()` | The agent's full tool list. |
| `getRunTools()` | The tools offered for this particular run, chosen once before the first step. Defaults to `getActiveTools()`, adding `bash` when the seat has files on and the list is non-empty. `undefined` offers every registered tool; `[]` offers none. |
| `getExtraTools()` | Tools that belong only to this agent, beyond the shared MCP tools. |
| `prepareStep()` | Runs before each step. It can trim messages, switch models, or take tools away for later steps. It never adds tools. |
| `stopCheck()` | Runs after each step and decides whether the loop is done. |
| `getOutput()`, `postprocessOutput()` | Turn the final exchange into a typed result, optionally checked against a Zod schema. |

The framework prepares the system prompt and initial messages once and shares them between triage and the main loop. If several hooks need the same expensive read, they can share it through `context.memoizeForExecution`.

## When an agent stops

Most agents list `completionTools`. The loop ends once one succeeds. A simple strategist finishes through `set-strategy`, `set-flavors`, or `keep-status-quo`. A maximum step count stops runaway loops.

Some providers (Anthropic and Codex) refuse a request that forces a tool call. For those, the middleware relaxes the request to "tools allowed", and the reminder at the end of every step states the requirement in words instead. That reminder is added for every provider, so the prompt reads the same everywhere.

Taking a tool away mid-run does not remove it from the request. The model can still see it, but a call to it comes back as an error, and the closing reminder says which tools may run. [Prompts and tool calling](prompts.md) explains why.

## Two special shapes

Two flags change how an agent runs:

| Flag | Effect | Example |
| --- | --- | --- |
| `fireAndForget` | The caller gets an answer right away and the agent keeps running on its own, with its own cancellation and token accounting. Cancelling the caller does not stop it. | A diplomat hands a report to the [diplomatic analyst](../agents/support-agents.md) and keeps talking. |
| `programmatic` | The agent never calls a model. It implements `handleMessage()` itself. | The telepathist's episode retriever. |

## Registering an agent

All built-in agents register at startup in `src/infra/agent-registry.ts`. Once registered, an agent can be run by name and is also offered to other agents as a `call-{name}` tool (see [Runs](runs.md#agents-calling-agents)).
