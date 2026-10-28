# Stage 4: Pinned and isolated oracle workspaces

Part of the [context-records plan](../context-records.md). **Status: implemented.**

## Objective

Give every replay execution its original seat files and its own disposable writes, including concurrent variants.

## Dependencies

Stage 2 provides the store and `StoreFs`. Stage 3 supplies the retrieved files setting and the commit captured at each run's first model step.

## Current state

| Area | Existing behavior and source |
| --- | --- |
| Oracle | `oracle/utils/prompt-extractor.ts` extracts the first step's prompt and tools from telemetry. It uses only the last attempt at each turn: earlier attempts at the same turn are botched retries, and a later attempt at an earlier turn means a reload discarded the turn. `oracle/replayer.ts` runs rows, models, and repetitions concurrently, each inside its own root run, with schema-only tools, so a recorded bash call performed no file operation. |

Because discarded turns never reach replay, replay never pins a commit from a turn that a later reload discarded. After an undetected forward load (see the main plan's limitations), a pinned commit can still include notes from an abandoned branch, as the live run saw them.

## Approach

`utils/workspace/player-workspace.ts` defines a shared `Workspace` interface with `exec`, and `PlayerWorkspace` implements it. A root run can carry its own workspace through the `workspace` option of `withRun` (`infra/vox-run.ts`), and the bash tool in `utils/tools/bash-tool.ts` prefers it over the seat's workspace. Forked runs do not inherit it.

`ReplayWorkspace` (`utils/workspace/replay-workspace.ts`) rebuilds the original seat's mounts from pinned sources. The store comes from the row's own telemetry database, where Stage 2 keeps it: the file is located with the same `discoverDbPath` lookup the retrieve phase used (`oracle/utils/db-resolver.ts`), under `OracleConfig.telemetryDir`, and opened read-only at the commit recorded in `context.workspace`.

| Mount | Replay source |
| --- | --- |
| `/workspace/records`, `/workspace/reference` | Read-only `StoreFs` views of the pinned commit |
| `/workspace/game` | A `StoreFs` view with the recorded access. When access is writable and the pinned tree has no `AGENTS.md`, the default game guide is added in memory, as `PlayerWorkspace.open` seeds it for a live command |
| `/workspace/shared/<name>` | An in-memory overlay of the shared folder's current contents under `<telemetryDir>/workspaces/shared`, read-only unless the run recorded write access. A writable folder gets the shared guide in memory, and a missing folder appears empty |
| `/tmp` | In memory |

One workspace is opened for each replay execution, including each model variant and repetition, passed to that task's `withRun`, and closed when the execution ends. Concurrent variants of one source row cannot see each other's writes. Writes persist across the bash commands of one execution, but nothing reaches disk or the store and nothing is committed. The store's initial commit is a valid recorded version with empty records and notes trees, an existing guide is preserved, and replay requires the recorded mount access. A files row with no recorded commit, no telemetry database, no store, or an unknown commit fails without calling the model.

Rows with files off use the existing oracle context, so each bash tool description matches the original. Rows with files on share a context per distinct recorded files setting and effective prompt folder: id `<experimentName>-files-<n>`, the base context's schema-only tools plus a real bash tool registered after schema replacement, the recorded quota, and telemetry at `oracle/<id>.db` under the oracle experiment. All contexts close during shutdown and their telemetry paths are logged. The effective prompt folder for workspace guidance is the row's recorded folder when it still passes validation, otherwise the built-ins with one warning per folder; the replay machine's own `prompts` setting never applies, so a replay keeps the original run's guidance wherever it runs.

`OracleAgent.getRunTools` returns the replay's declared tool list exactly, so a restricted run does not gain bash just because the replay context has it: bash is present only when the original run (or a `modifyPrompt` override) declared it.

This stage keeps the oracle's first-step replay. A future full-history replay, which sends the complete recorded conversation so the model makes only the final decision, needs its own design.

## Decisions

| Decision | Reason |
| --- | --- |
| Store inside the telemetry database | Replay opens the same file the retrieve phase read, so one copied file pins both the spans and the seat's files. |
| Shared folders read from the source telemetry folder | They live outside the store, so replay shows them as they are now. The recorded access decides read or write, and writes stay in memory. |
| Prompt folder fallback | The row's recorded folder is used when it still validates; otherwise built-ins apply, with one warning per folder, and the replay machine's own setting stays out of it. |
| Portability | To replay file-enabled rows on another machine, copy the seat's telemetry database plus any shared folders the seat used. |

## Work items

Introduce the `Workspace` interface, the root-run workspace, and `ReplayWorkspace`. Extend row validation (seat store and commit checks), replay routing, per-setting contexts, and context lifecycle. Preserve declared tools when restoring file support. Create and discard a replay workspace within each replay task.

## Verify

| Area | Required checks |
| --- | --- |
| Replay | Files from the recorded commit, including an empty initial version, plus the same missing-guide initialization as a live command; existing guides are preserved and read-only game mounts receive no guide; original mounts and access, matching bash description, store unchanged, and writes preserved across commands within one replay |
| Replay checks | A row with a missing seat store or commit fails without running |
| Replay isolation | Two concurrent variants of one source row cannot read each other's notes, shared-folder, or scratch writes |
| Replay tools | The recorded files setting controls file support, quota, and bash description; the recorded tool list still controls whether bash is available |

Also verify that older rows default to files disabled, recorded system text needs no prompt folder, file-enabled contexts use distinct identities and report output locations, and all contexts close at shutdown. Run the existing oracle suite.

## Documentation

Update `docs/developers/vox-agents/agents/oracle.md` with pinned workspaces, required files, disposable writes, and the fact that replay sees shared folders as they are now.

## Done when

Each replay task reads the recorded commit and keeps only its own writes across bash calls. Concurrent variants stay isolated, stores and folders stay unchanged, missing files fail before execution, and the recorded tools, access, and quota are preserved.
