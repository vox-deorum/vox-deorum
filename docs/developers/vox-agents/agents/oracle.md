# Oracle

The Oracle answers counterfactual questions: _what would the AI have decided on that turn if the prompt had been different, or the model had been someone else?_

Given a CSV of game turns, Oracle extracts the original LLM calls verbatim from telemetry, re-runs them with an experiment's changes, and records the new decisions. It leaves the live game untouched. The model gets **schema-only tools**: calls are captured as decision intents without executing them. Runs recorded with [files](../workspace/files.md) on also get a real `bash` tool over a disposable workspace copy; see [Replay workspaces](#replay-workspaces).

```
recorded telemetry ──retrieve──► original prompts (JSON) ──replay with changes──► new decisions (CSV, trails)
```

The source lives in `src/oracle/`. From `vox-agents/`, run:

```bash
npm run oracle -- -c <experiment.js>
```

## Two phases

Oracle splits its work into retrieve and replay phases.

**Retrieve** (`src/oracle/retriever.ts`) reads the input CSV, locates each row's telemetry database (scanning the telemetry directory for `{gameId}-player-{playerId}.db`), and extracts the raw original prompt exactly as recorded: system messages, conversation history, active tool names, the original model, and the recorded tool framing (see _Tool framing_). No LLM is involved and nothing is modified. The extracted rows can be saved as JSON for inspection.

**Replay** (`src/oracle/replayer.ts`) takes those rows, applies the experiment's `modifyPrompt` transformation, and runs each through the chosen model via a dedicated `OracleAgent`. It writes:

- a results CSV, one row per source row per model, with the replayed decision's rationale and token usage;
- JSON and markdown "trail" files reconstructing each conversation;
- a telemetry database of the replay itself.

Running without flags does both phases in sequence. `--retrieve` and `--replay` run one side alone.

Extract once, confirm the right turns were found, then reuse the data to compare prompts or models without re-reading telemetry. Experiments can share a retrieval through a common `retrievalName`.

### Finding the right turn

Turn numbers alone are unreliable, because botched and re-run turns reuse them. The Oracle validates its target with **rationale matching**: each CSV row carries a fragment of the original decision rationale, and the extractor fuzzy-matches it against the recorded tool calls. When a turn's record doesn't match, it falls back to the previous turn and emits a warning.

Only the last attempt at each turn is replayed:

- **Retries.** Earlier attempts at the same turn are botched retries and are skipped.
- **Reloads.** A reload also discards attempts. Say a seat played to turn 60, then the player loaded a turn-50 save and played to turn 55. Every turn recorded before the reload for turns 50 and later is discarded. Turns 56 to 60 are never replayed, and their rows come back as errors without the previous-turn fallback.
- **One database.** The rule reads one telemetry database, and each database belongs to one strategist. A reload played under a different strategist is not visible to it.

Retrieved JSON and replay trails are never pruned on their own, so an older file may still hold discarded turns. Run retrieval again and replay with `--forceReplay` to rebuild it under the current rules.

## Experiments

An experiment is an ES module exporting an `OracleConfig`, defined in `src/oracle/types.ts`. See `experiments/` for examples. It requires a CSV path and experiment name, with these controls:

| Control | Effect |
| --- | --- |
| `modifyPrompt` | Receives original system prompts, messages, tools, model, CSV row, and recorded framing. Returns the fields to override; omitted fields keep their originals. |
| `modelOverride` | Chooses a model or array of models. Every row runs once per entry. Its third argument exposes the original `{ framing }` for use in `options.framing`. |
| `rewriteToolSchemas` | Rewrites the tool descriptions and schemas the model sees, useful for terminology experiments. |
| `toolChoice` | `auto` (default), `required`, or `none`. Required steps get a closing reminder; `required` becomes `auto` on the wire for Anthropic and Codex. Reminders already in recorded messages remain under any setting. |
| `completionTools` | Calls that end a strategist replay and supply decision rationales. Provider instructions and continuation reminders name them. Defaults to `set-strategy`, `set-flavors`, and `keep-status-quo`. |
| `filter` | Narrows which CSV rows run. |
| `extractColumns` | Pulls experiment-specific values out of each replay into extra CSV columns. |

### Samples and scheduling

A **sample** is one execution of a source row with a model. Duplicate `modelOverride` entries produce repetitions, identified by a repetition index. A **chain** groups one row's samples with the same full model configuration. Samples within a chain run one at a time; independent chains run in parallel up to `concurrency`.

The scheduler admits work from two queues:

| Queue | Contents | Priority |
| --- | --- | --- |
| Episode queue | Each chain's first uncached sample, in source order | Runs when the replay queue is empty |
| Replay queue | A chain's next uncached sample, added when its previous sample finishes | Always first |

For example, with concurrency one, a chain containing A1 and A2 runs both before the next independent sample B1: A1, A2, B1. If A1 is already cached, the order is A2, B1. This priority helps prompt caches warm; hits are not guaranteed. Repeated Claude streaming replays also mark the end of the prompt for caching.

Completed trail files serve as a **replay cache**. A cached sample fills its result slot without using concurrency, so a chain may start at a later repetition. Results stay in repetition-major source order: all first repetitions in source order, then second repetitions, and so on. Cache hits and out-of-order completion leave no gaps. A stopped replay resumes from its remaining samples.

**Batch mode.** Large experiments can go through provider batch APIs (`src/oracle/batch/`). Batch requests go straight to the provider without the [tool-rescue middleware](../models/middleware.md#prompt-mode-tool-calling), so batch mode does not work with prompt-mode models (`options.toolMiddleware: 'prompt'`). Replaying one in batch mode throws an error. Switch those rows to a native tool-calling model or turn batch mode off. Tools the original run removed mid-run are still rejected in batch mode, using the same rejection hooks as the normal path. Rejected calls never count as decisions in either mode.

### Tool framing

The [tool-rescue middleware](../models/middleware.md#prompt-mode-tool-calling) uses `tool` framing by default. Telemetry records it as `step.tool_framing` when prompt mode ran; native tool calls, including Claude Code turns, leave it unset. The injected protocol is rebuilt from the replay model's framing.

Retrieve surfaces the recorded framing on every row as `framing`. It is **informational**, because replay framing derives solely from the replay model. To reproduce an action view deliberately, either return a model with `options.framing` set from `modelOverride`, or apply the exported `reframeToolWording` helper to the system prompt inside `modifyPrompt`. Claude Code calls tools natively and cannot replay in prompt mode, so `action` framing is available only to prompt-mode replay models. `framing` is `undefined` for turns that predate the telemetry, ran a native tool path, had no tools, or failed before recording.

### Workspace fields

Retrieve carries workspace metadata from the agent span onto each row:

| Row field | Span attribute | Meaning |
| --- | --- | --- |
| `files` | `context.files` | The seat's resolved files setting (game access, shared folders, quota), or `false` |
| `workspace` | `context.workspace` | The seat store's head commit just before the run's first model step, when files are on |
| `prompts` | `context.prompts` | The custom prompt folder behind the recorded system text, or `false` |

The loop captures the commit after preparation, including archived briefings. Every store starts with an empty commit, so an early chat can still pin a version. Preparation failures and evaluation runs record no commit. File mode follows from `files` and the recorded tools. Missing metadata defaults to files off and built-in prompts. The `prompts` field groups results and picks the workspace guidance folder (see _Replay workspaces_). Replay always uses the recorded system text.

### Replay workspaces

Rows recorded with files on replay against a pinned, disposable copy of their seat workspace; rows with files off use the base schema-only context. `ReplayWorkspace` in `src/agents/workspace/replay-workspace.ts` opens the source telemetry database's seat store read-only at the row's recorded `workspace` commit. It locates that database through `discoverDbPath` in `src/oracle/utils/db-resolver.ts` under the experiment's `telemetryDir`, just as retrieval does. The copy mirrors the original mounts:

| Folder | Replay behavior |
| --- | --- |
| `/workspace/records`, `/workspace/reference` | Read-only store views of the pinned commit |
| `/workspace/game` | The recorded access. When game access is writable and the pinned tree has no `AGENTS.md`, the default guide is added in memory |
| `/workspace/shared/<name>` | An in-memory overlay of the folder's current contents under `<telemetryDir>/workspaces/shared`, read-only unless the run recorded write access. A writable folder gets the shared guide in memory; a missing folder appears empty |
| `/tmp` | In memory |

Writes persist across commands within one execution but never reach disk or the store, and nothing is committed. Each execution, meaning every model variant and repetition, gets its own workspace, closed when the execution ends. A files row with no recorded commit, no telemetry database, no store, or an unknown commit fails before the model is called.

The bash tool normally runs in the seat's live workspace. A root run can instead carry its own workspace, through the `workspace` option of `withRun` (`src/agents/runtime/vox-run.ts`), and the bash tool prefers it; forked runs do not inherit it.

#### Replay contexts

A **replay context** supplies tools, prompt guidance, and telemetry. File-enabled rows share one for each distinct combination of recorded files setting and effective prompt folder. Each sample still gets its own disposable workspace.

| Context property | Value                                              |
| ---------------- | -------------------------------------------------- |
| ID               | `<experimentName>-files-<n>`                       |
| Tools            | Base experiment's schema-only tools plus real bash |
| Telemetry        | `oracle/<id>.db` under the app's telemetry root    |
| Lifetime         | Closes at shutdown; its telemetry path is logged   |

For workspace guidance, the effective prompt folder is the recorded folder when it passes validation. Otherwise, replay uses the built-ins and warns once per folder. The replay machine's `prompts` setting never applies, and replay always uses the recorded system text.

`OracleAgent.getRunTools` uses the replay's tool selection without adding bash. A nonempty recorded list or an explicit `modifyPrompt` tool override is used as given, so bash must be declared there. An empty recorded list with no override falls back to all registered tools.

Portability: to replay file-enabled rows on another machine, copy the seat's telemetry database plus any shared folders the seat used.

## Where things land

Outputs default under `temp/oracle/`: the per-experiment results CSV next to a directory of retrieved JSONs and replay trails. Replay telemetry goes under the app's telemetry root, in `oracle/` (`telemetry/oracle/` by default), and can be inspected in the telemetry browser.

CLI flags override the output directory, retrieval source directory (`--telemetryDir`), and target agent. Bare experiment filenames resolve to `experiments/`.

### Stopping a run

| Key | Effect |
| --- | --- |
| Ctrl+A | Graceful stop, and the same key the strategist console uses. No new work starts, work already started finishes (including requests the batch manager accepted), and later phases are skipped. Press Ctrl+A again before the work drains to continue normally. |
| Ctrl+C | Shuts down right away, using the normal interrupted-task behavior. Press it again to force-quit. |

What survives a stop:

- Retrieved JSON files and replay trails that finished are kept. The next replay reuses trails as a cache. Retrieved JSON is kept for inspection only and is not reused as a cache.
- After a graceful stop, the results CSV is left untouched if any queued task was held back. If every task had already started, the CSV is written normally.

The Oracle shuts down through its process manager when the run ends, whether it stopped early or finished.
