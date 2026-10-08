# Evaluators

An evaluator answers a fixed set of typed questions about one piece of state in a single model call. Vox Agents uses evaluators for three jobs:

- **Triage:** picking the model tier for an agent's turn.
- **The diplomatic analyst:** judging a diplomat's report and deciding whether to relay it.
- **The evaluator strategist:** playing a strategist seat without a chat loop.

All three go through the same call, `context.evaluate`, so they share concurrency, retries, telemetry, and token accounting with ordinary agent runs.

## Questions and answers

Evaluation follows the AI SDK's `experimental_evaluate` contract. A question has one of three types, and every answer comes with probabilities:

| Type | The question lists | The answer gives |
| --- | --- | --- |
| `choice` | Named options, each with an optional description | The most likely option and the probability of each option |
| `score` | At least two ordered levels, each with a description | A position between the levels (for example 2.5), weighted by each level's probability |
| `boolean` | Optional descriptions of true and false | The probability of true |

A score is not rounded to a level. Callers map the position onto their own values, so a score halfway between two levels lands halfway between their values. Give each level a short label as well as its value (for example `50: warm`), since the labels are what the model rates against.

## Backends

`getEvaluationModel` in `src/utils/models/evaluation.ts` builds the evaluator from a model configuration. Any configured model can be an evaluator:

- **Native evaluation models.** TypeSafe's Jev (`typesafe/jev-latest`, key `TYPESAFE_AI_API_KEY`) answers questions directly. It is evaluation-only, so chat agents cannot use it, and chat model pickers hide it.
- **Chat models.** `createLanguageModelEvaluator` turns any chat model into an evaluator. It sends the state and questions in one prompt, asks for a JSON reply with a probability for every option or level, and normalizes the reply into valid answers. The helpers live in `src/utils/models/evaluation-questions.ts`.

A feature that works with Jev also works with a chat model, without a TypeSafe key.

## Configuration

Evaluators live in the same `llms` registry as chat models, with the same alias rules, at the seat or global level.

| Key | Used by |
| --- | --- |
| `evaluator` | Triage for every agent that has it enabled |
| `<agent>.evaluator` | Triage for one agent, ahead of `evaluator` |
| `<agent>` | Evaluation agents, such as `diplomatic-analyst` and `evaluator-strategist`, which run on their ordinary model assignment |

Triage never falls back to `default`. With no evaluator alias, triage is skipped (with a warning at session start if it was enabled). An evaluation agent with no assignment runs on `default` through the chat adapter.

In the dashboard, Settings has an Evaluator dropdown for the shared `evaluator` alias, and the Setup wizard saves its optional Judge AI there.

### Input limit

The `maxInputTokens` model option caps the size of the state, in estimated tokens (`inputTokenLimit` in `src/utils/models/models.ts`). It defaults to 30,000 for TypeSafe, below Jev's 32k cap, and to no limit for other models. `src/infra/vox-evaluate.ts` refuses a larger state with a context-length error before calling the provider, so callers can trim and retry.

## The evaluate call

`context.evaluate(model, state, { questions })` delegates to `src/infra/vox-evaluate.ts`. It must run inside an active run. It opens an `evaluate` span under the run, named after the requesting agent, that records the model, state, questions, answers, confidence, and tokens. Usage counts toward the run and seat totals, and the run's abort signal cancels the call.

An agent that answers through evaluation alone implements `executeEvaluation` instead of the chat loop. The engine still resolves the agent's model, updates the in-game model label, and opens the agent span, then hands the prepared state and model to the hook.

## Triage

Triage picks a model tier (`small`, `default`, or `large`) once at the start of an agent's execution. The tier lookup itself is described under [Models and configuration](overview.md#models-and-configuration).

- **Turning it on.** The `triage` setting takes `true` (every agent with a triage hook), a list of agent names or the roles `strategist` and `diplomat`, or `false` (the default). It can be set on a seat, in the session config, or in the root `config.json`, and the highest level that sets a value wins. `triageEnabled` in `src/infra/triage.ts` reads it, and `resolveSeatTriage` in `src/strategist/seat-config.ts` resolves the levels and roles. A malformed value fails session preflight before the game launches.
- **Writing a hook.** Agents adopt triage through `createTriage` in `src/infra/triage.ts`, supplying questions and a router from answers to a tier. By default the evaluator sees the agent's prepared prompt. An optional projector builds a smaller state instead, and a `TriageShortcut` decides obvious cases without a call.
- **Failures.** If the hook fails, the agent keeps its own tier and the span notes `triage failed`. Cancellation still stops the run.
- **Bypassing it.** A caller can pass a decision through the execute options, or `Tier` on any `call-*` tool, without enabling triage.

Only the diplomat has a hook today. It rates intent and stakes from the recent conversation and any open deal, then routes small talk to `small`, high-stakes deals and threats to `large`, and everything else to `default`. See [Envoys](envoy.md). The `strategist` role is accepted, but strategists do not triage yet.

## Diplomatic analyst

The [diplomatic analyst](support-agents.md) judges each report from a diplomat in one evaluation: whether to relay it, its message type, its categories, and its confidence and importance. Code then decides from the answers whether to call `relay-message`. There is no free-text step.

## Evaluator strategist

`evaluator-strategist` (`src/strategist/agents/evaluator-strategist.ts`) plays a seat with one evaluation per decision and issues the action tools straight from the answers. A seat uses it by setting its `strategist` and assigning a model to `evaluator-strategist` in its `llms`. It is not offered in setup.

- It supports Flavor mode only, and refuses Strategy mode with an error.
- It decides on every turn the player loop runs it, but only sends the parts of the decision that change something.

### What it reads

The evaluator gets the same reports the simple strategist reads, as JSON: the situation, your civilization, options, current strategies, victory progress, players, cities, military, events since the last decision, and the turn context.

Events are the only difference. The strategist counts the tokens of everything else, takes 95% of the model's input limit minus that as the budget for events, and drops the least important events until they fit. Events are grouped by importance in `src/utils/prompts/event-importance.ts`, from turning points such as wars and deals down to noise such as revealed tiles. The top group is never dropped. When anything is dropped, an `EventsTrimmed` note tells the model the history is partial.

### What it asks

`buildStrategistQuestions` in `src/strategist/agents/evaluator-questions.ts` builds the questions from the `get-options` report and the MCP tool schemas:

| Question | Type | Asked for | Levels or options |
| --- | --- | --- | --- |
| `grand_strategy` | choice | The offered grand strategies | Grand strategy names |
| `flavor_<Name>` | score | Each offered flavor | The scale in the `set-flavors` schema (0 forbid, 30 enough, 50 balanced, 70 prioritize, 100 emergency focus) |
| `research` | choice | The offered technologies | Technology names |
| `policy` | choice | The offered policies and branches | Policy names |
| `persona_<Axis>` | score | Each axis in the `set-persona` schema, described by the schema | 1 minimal, 3 low, 5 typical, 7 high, 10 extreme |
| `relationship_public_<ID>` | score | Each met major civilization | -100 open hostility, -50 cold, 0 neutral, 50 warm, 100 close friendship |
| `relationship_private_<ID>` | score | Each met major civilization | -100 deep enmity, -50 distrust, 0 indifferent, 50 goodwill, 100 trusted ally |

A question with nothing to choose from is left out. The strategist fails with a clear error if the MCP server does not provide the `set-flavors`, `set-persona`, or `set-relationship` schema.

### What it does

`strategistActionsFromAnswers` turns the answers into tool calls, comparing each answer with the current values in the `get-options` report. Each score becomes the probability-weighted average of its level values, so a relationship side answered neutral 51%, warm 38%, warmest 8%, cold 1% and coldest 2% becomes +25.

Sampling noise moves scores by a point or two from turn to turn, so flavors and relationships use a **deadband** (`scoreDeadband`, 2 points): a value counts as changed only when it moves more than 2 points from the in-game value, or has none yet. Persona values are whole numbers and compare exactly. The calls, in order:

1. `set-flavors` with only the changed flavors, plus the grand strategy when it changed. When neither changed, `keep-status-quo` instead, which re-applies the current flavors so the in-game AI does not take over.
2. `set-persona` with only the changed axes. It is dropped when none changed.
3. `set-relationship` for each civilization with a side that changed. Both sides are sent, and a side inside the deadband keeps its current value.
4. `set-research` and `set-policy` when the choice differs from the game's. Policies compare by name, ignoring the kind in parentheses, so `Sovereignty (Policy)` matches `Sovereignty (Continuing Tradition Branch)`.

Every action carries the same fixed rationale, with no probabilities, because `get-options` feeds rationales back into later decisions. Each call goes through `context.callTool`. A failed call is logged and skipped, so one rejected action does not void the rest of the decision.

### Telemetry

The evaluate span holds the raw questions, answers, and confidence. The strategist adds a `strategist.decision` attribute to its agent span: a JSON record with each question's current value, proposed value, and whether it was sent, and the list of calls with their status (applied, failed, or dropped). The shapes live in `src/types/evaluation.ts`, and `labelEvaluation` in `src/utils/models/evaluation-record.ts` labels the raw answers for display.

## Tests

- `tests/mock/utils/evaluation-questions.test.ts` and `tests/mock/utils/evaluation.test.ts` cover both backends.
- `tests/mock/context/vox-context-evaluate.test.ts` covers the evaluate call.
- `tests/mock/strategist/evaluator-questions.test.ts` and `tests/mock/strategist/evaluator-strategist.test.ts` cover the evaluator strategist.
- `tests/mock/utils/event-importance.test.ts` covers event trimming.
- `tests/mock/utils/evaluation-record.test.ts` covers answer labeling.
