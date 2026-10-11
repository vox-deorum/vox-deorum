# Tiers and triage

Not every agent call needs the same model. Small talk can run on a cheap model, and a high-stakes deal deserves a strong one. Vox Agents has three **tiers**, `small`, `default`, and `large`, and each can map to a different model.

A tier can be picked in three ways:

| How | Who decides | Example |
| --- | --- | --- |
| The agent's own `modelSize` | The agent's author | Most agents stay on `default`. |
| A caller passes `Tier` | The calling agent or code | A diplomat hands a complex deal to the negotiator with `Tier: large`. |
| **Triage** | A quick evaluator call that rates the situation first | The diplomat's small talk goes to `small`. |

Triage runs once at the start of an agent call. Its choice holds for every step of that call.

## How a tier becomes a model

For `small` and `large`, lookup tries these `llms` keys in order and uses the first that exists:

1. `<agent>.<tier>`, such as `diplomat.large`
2. `<tier>`, such as `large`
3. `<agent>`
4. `default`

For the `default` tier, lookup tries `<agent>`, then `default`.

At each key, a seat's own `llms` override is checked before the global config. Session preflight checks all three tiers for every agent the session can reach, including the configured negotiator.

## Turning triage on

Triage is off by default. The `triage` setting turns it on:

| Value | Effect |
| --- | --- |
| `false` | Off (the default). |
| `true` | On for every agent that has a triage hook, plus the strategist. |
| A list | On for the listed agent names, or the roles `strategist` and `diplomat`. |

The setting can go on a seat, in the session config, or in the root `config.json`. The highest level that sets it wins. `resolveSeatTriage` in `src/strategist/seat-config.ts` resolves it, and a malformed value fails session preflight before the game launches.

Triage also needs an evaluator model, set as `<agent>.evaluator` or the shared `evaluator` alias (see [Evaluators](evaluators.md#configuration)). Without one, triage is skipped and a warning appears at session start.

## Writing a triage hook

Use `createTriage` in `src/infra/triage.ts`. You give it:

- **Questions** for the evaluator.
- **A router** that turns the answers into a tier.
- **A projector** (optional) that builds a smaller state for the evaluator. Without one, the evaluator sees the agent's prepared prompt.
- **A shortcut** (optional, `TriageShortcut`) that decides obvious cases without calling the evaluator.

Behavior to know:

- The decision is stored per agent call, so nested and concurrent agents each see their own `context.currentTriage`.
- If the hook fails, the agent keeps its own `modelSize`, logs a warning, and the decision is marked `triage failed`. Cancelling still stops the run.
- A caller can skip the hook by passing a decision in `ExecuteOptions.triage`, or `Tier` on any `call-*` tool. Neither needs triage to be turned on.
- Triage evaluations count toward the run and seat token totals.

## Diplomat triage

The diplomat is the only agent with a hook today. It lives in `src/envoy/agents/diplomat.ts`.

- **What it reads.** The last eight spoken messages. When a proposal is open, it also gets the full deal, including items that could be added. It does not see the system prompt or the turn hint.
- **What it asks.** The speaker's intent and the stakes.
- **Where it routes.** Small talk goes to `small`. High-stakes deals and threats go to `large`. Everything else goes to `default`.

To try it, set `"triage": ["diplomat"]` (or `true`) and configure `diplomat.evaluator` or `evaluator`.

## Strategist triage

Strategists have no hook. Instead, the player loop's pacing runs triage before the strategist starts, which also lets triage skip a turn entirely.

When the `strategist` role (or the strategist's name) is in `triage` and an evaluator is configured, `runStrategistTriage` in `src/strategist/pacing/triage.ts` asks one score question, `revision`: how much do the current strategic decisions need to change? The answer levels are none, tweaks, revision, and overhaul.

- The question is about what the strategist would change, not how eventful the turns were.
- A finished research or policy counts as at least a tweak, because the next one needs choosing.
- The evaluator reads `prompts/strategist-triage.md` plus the same reports as the [evaluator strategist](../agents/strategists/evaluator-strategist.md#what-it-reads), with the events since the last decision.
- The state goes through the same [trimming](../agents/strategists/evaluator-trimming.md) as the evaluator strategist (both use `evaluateStrategistState` in `src/strategist/agents/evaluator-questions.ts`). If it still overflows, triage retries with fewer events through the same `withEventWindowFallback` the decision uses.

`resolvePacingVerdict` in `src/strategist/pacing.ts` combines the answer with the normal schedule. A turn the schedule or an interruption already calls for always runs, and triage can only raise its tier:

| Turn | none | tweaks | revision | overhaul |
| --- | --- | --- | --- | --- |
| Scheduled or interrupted | `default` | `default` | `default` | `large` |
| Any other turn | skip | `small` | `default` | `large` |

With `everyTurns` at 1 (the default), every turn is scheduled, so triage can only escalate to `large`. Raise `everyTurns` to let it skip or downsize the turns in between.

Other details:

- A triage skip calls `keep-status-quo`, like a scheduled skip.
- If the evaluation fails, or the state never fits, pacing falls back to the normal schedule. Cancelling still stops the turn.
- Without triage, pacing keeps the strategist's own tier.
- Session preflight checks the strategist's evaluator like any hooked agent's.

## Telemetry

| Where | Attributes |
| --- | --- |
| Every agent span | The starting tier. With a triage decision, also the chosen tier, where it came from (evaluator, shortcut, caller, or failed hook), and an optional note. |
| Evaluation spans | Their purpose and the requesting agent. |
| Strategist turn span | `pacing.triage`, plus `pacing.tier` on decided turns or `pacing.skip_reason` (`turn` or `evaluator`) on skipped ones. The strategist's own agent span shows the tier with source `caller`. |
