# Oracle

The Oracle answers counterfactual questions: _what would the AI have decided on that turn if the prompt had been different, or the model had been someone else?_

Given a CSV of real game turns, it re-runs each turn's original LLM call, extracted verbatim from recorded telemetry, with whatever modifications an experiment specifies, then records what the model decides this time. Nothing touches a live game. The replayed model is given **schema-only tools**, so it produces tool-call intents that are captured as decisions but never executed. A replay of a run recorded with [files](../workspace/files.md) on is the exception: it gets a real `bash` tool over a disposable copy of the seat's workspace, described under _Replay workspaces_.

```
recorded telemetry ──retrieve──► original prompts (JSON) ──replay with changes──► new decisions (CSV, trails)
```

The source lives in `src/oracle/`. From `vox-agents/`, run:

```bash
npm run oracle -- -c <experiment.js>
```

## Two phases

Oracle deliberately splits its work into a retrieve phase and a replay phase.

**Retrieve** (`src/oracle/retriever.ts`) reads the input CSV, locates each row's telemetry database (scanning the telemetry directory for `{gameId}-player-{playerId}.db`), and extracts the raw original prompt exactly as recorded: system messages, conversation history, active tool names, the original model, and the recorded tool framing (see _Tool framing_). No LLM is involved and nothing is modified. The extracted rows can be saved as JSON for inspection.

**Replay** (`src/oracle/replayer.ts`) takes those rows, applies the experiment's `modifyPrompt` transformation, and runs each through the chosen model via a dedicated `OracleAgent`. It writes:

- a results CSV, one row per source row per model, with the replayed decision's rationale and token usage;
- JSON and markdown "trail" files reconstructing each conversation;
- a telemetry database of the replay itself.

Running without flags does both phases in sequence. `--retrieve` and `--replay` run one side alone.

The split is what makes iteration cheap. Extract once, confirm the right turns were found, then replay the same retrieved data repeatedly under different prompts or models without re-reading telemetry. Experiments can even share a retrieval through a common `retrievalName`.

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

Duplicate entries in `modelOverride` repeat the sample, identified by a repetition index. Every provider uses the same execution order: all first repetitions and single-model tasks, then all second repetitions, and so on, preserving original task order within each repetition. This gives prompt caches time to warm, but rounds can overlap as concurrency slots become available, so cache hits are not guaranteed. Repeated Claude streaming replays also mark the end of the prompt for caching.

Replays run with limited concurrency and reuse existing trail files to skip rows already done.

**Batch mode.** Large experiments can go through provider batch APIs (`src/oracle/batch/`). Batch requests go straight to the provider without the [tool-rescue middleware](../models/middleware.md#prompt-mode-tool-calling), so batch mode does not work with prompt-mode models (`options.toolMiddleware: 'prompt'`). Replaying one in batch mode throws an error. Switch those rows to a native tool-calling model or turn batch mode off. Tools the original run removed mid-run are still rejected in batch mode, using the same rejection hooks as the normal path. Rejected calls never count as decisions in either mode.

### Tool framing

The [tool-rescue middleware](../models/middleware.md#prompt-mode-tool-calling) uses `tool` framing, or `action` for Claude Code. Telemetry records this as `step.tool_framing`. The injected protocol is rebuilt from the replay model's framing.

Retrieve surfaces this on every row as `framing`. It is **informational**, because replay framing derives solely from the replay model: a prompt-mode model replaying a claude-code turn is told "tools", not "actions". To reproduce the original view deliberately, either return a model with `options.framing` set from `modelOverride`, or apply the exported `reframeToolWording` helper to the system prompt inside `modifyPrompt`. `framing` is `undefined` for turns that predate the telemetry, ran a native tool path, had no tools, or failed before recording.

### Workspace fields

Retrieve carries workspace metadata from the agent span onto each row:

| Row field | Span attribute | Meaning |
| --- | --- | --- |
| `files` | `context.files` | The seat's resolved files setting (game access, shared folders, quota), or `false` |
| `workspace` | `context.workspace` | The seat store's head commit just before the run's first model step, when files are on |
| `prompts` | `context.prompts` | The custom prompt folder behind the recorded system text, or `false` |

The loop captures the commit after preparation, including archived briefings. Every store starts with an empty commit, so an early chat can still pin a version. Preparation failures and evaluation runs record no commit. File mode follows from `files` and the recorded tools. Missing metadata defaults to files off and built-in prompts. The `prompts` field groups results and picks the workspace guidance folder (see _Replay workspaces_). Replay always uses the recorded system text.

### Replay workspaces

Rows that ran with files on replay against a pinned, disposable copy of their seat workspace; rows with files off replay on the base schema-only context. `ReplayWorkspace` in `src/utils/workspace/replay-workspace.ts` opens the seat's store read-only inside the row's source telemetry database, the same file the retrieve phase read (located with the `discoverDbPath` lookup in `src/oracle/utils/db-resolver.ts` under the experiment's `telemetryDir`), at the commit recorded in the row's `workspace` field. The copy mirrors the original mounts:

| Folder | Replay behavior |
| --- | --- |
| `/workspace/records`, `/workspace/reference` | Read-only store views of the pinned commit |
| `/workspace/game` | The recorded access. When game access is writable and the pinned tree has no `AGENTS.md`, the default guide is added in memory |
| `/workspace/shared/<name>` | An in-memory overlay of the folder's current contents under `<telemetryDir>/workspaces/shared`, read-only unless the run recorded write access. A writable folder gets the shared guide in memory; a missing folder appears empty |
| `/tmp` | In memory |

Writes persist across commands within one execution but never reach disk or the store, and nothing is committed. Each execution, meaning every model variant and repetition, gets its own workspace, closed when the execution ends. A files row with no recorded commit, no telemetry database, no store, or an unknown commit fails before the model is called.

The bash tool normally runs in the seat's live workspace. A root run can instead carry its own workspace, through the `workspace` option of `withRun` (`src/infra/vox-run.ts`), and the bash tool prefers it; forked runs do not inherit it.

File-enabled rows share replay contexts: each distinct combination of recorded files setting and effective prompt folder gets its own context, with id `<experimentName>-files-<n>`, the base experiment context's schema-only tools plus a real bash tool, and telemetry at `oracle/<id>.db` under the oracle experiment. All contexts close at shutdown and their telemetry paths are logged. The effective prompt folder for workspace guidance is the row's recorded folder when it still passes validation, otherwise the built-ins with one warning per folder. The replay machine's own `prompts` setting never applies, so replays keep the original run's guidance. `OracleAgent.getRunTools` returns the replay's declared tool list exactly, so bash is present only when the original run (or a `modifyPrompt` override) declared it.

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
