# Stage 4: Pinned and isolated oracle workspaces

Part of the [context-records plan](../context-records.md). **Status: planned.**

## Objective

Give every replay execution its original seat files and its own disposable writes, including concurrent variants.

## Dependencies

Stage 2 provides the store and `StoreFs`. Stage 3 supplies the retrieved files setting and the commit captured at each run's first model step.

## Current state

| Area | Existing behavior and source |
| --- | --- |
| Oracle | `oracle/utils/prompt-extractor.ts` extracts the first step's prompt and tools from telemetry. It uses only the last attempt at each turn: earlier attempts at the same turn are botched retries, and a later attempt at an earlier turn means a reload discarded the turn. `oracle/replayer.ts` runs rows, models, and repetitions concurrently, each inside its own root run, using schema-only tools, so a recorded bash call currently performs no file operation. |

Because discarded turns never reach replay, replay never pins a commit from a turn that a later reload discarded. After an undetected forward load (see the main plan's limitations), a pinned commit can still include notes from an abandoned branch, as the live run saw them.

## Approach

Add a shared `Workspace` interface with `exec(command, signal)`. `PlayerWorkspace` implements it. A root run can carry its own workspace; the bash tool uses the active root run's workspace when one is set and the seat's normal workspace otherwise.

`ReplayWorkspace` rebuilds the original seat's mounts:

| Mount | Replay source |
| --- | --- |
| `/workspace/records`, `/workspace/game` | One `StoreFs` view per mount at the commit in `context.workspace`, with committing disabled. Each view is kept for the whole execution, so writes persist across that execution's bash calls. Game notes are writable when the recorded files setting grants it. |
| `/workspace/reference` | The game reference folder, read-only |
| `/workspace/shared/<name>` | An `OverlayFs` over the shared folder's current contents, with writes kept in memory |
| `/tmp` | In memory |

A replay workspace is created for each replay execution, including each model variant and repetition, passed to that task's `withRun`, and discarded when the execution ends. Concurrent variants of one source row cannot see each other's writes, and nothing on disk or in the store changes. A row fails without running if its seat store, its recorded commit, or the game reference folder is missing.

Use the existing oracle context for rows with files disabled and one file-enabled context for each distinct recorded files setting, so each bash tool description matches the original. Each file-enabled context uses the recorded quota, schema-only tools, and a real bash tool registered after schema replacement. Keep the original run's declared tool list, so restricted runs do not gain bash just because the replay context has it. Give the contexts distinct identities, register their telemetry outputs under the oracle experiment, close them all during shutdown, and report their output locations.

This stage keeps the oracle's first-step replay. A future full-history replay, which sends the complete recorded conversation so the model makes only the final decision, needs its own design.

## Work items

Introduce the `Workspace` interface, the root-run workspace, and `ReplayWorkspace`. Extend row validation (seat store, commit, and reference checks), replay routing, per-setting contexts, and context lifecycle. Preserve declared tools when restoring file support. Create and discard a replay workspace within each replay task.

## Verify

| Area | Required checks |
| --- | --- |
| Replay | Files exactly as of the recorded commit, original mounts and access, matching bash description, store unchanged, and writes preserved across commands within one replay |
| Replay checks | A row with a missing seat store, commit, or reference folder fails without running |
| Replay isolation | Two concurrent variants of one source row cannot read each other's notes, shared-folder, or scratch writes |
| Replay tools | The recorded files setting controls file support, quota, and bash description; the recorded tool list still controls whether bash is available |

Also verify that older rows default to files disabled, recorded system text needs no prompt folder, file-enabled contexts use distinct identities and report output locations, and all contexts close at shutdown. Run the existing oracle suite.

## Documentation

Update `docs/developers/vox-agents/oracle.md` with pinned workspaces, required files, disposable writes, and the fact that replay sees shared folders as they are now.

## Done when

Each replay task reads the recorded commit and keeps only its own writes across bash calls. Concurrent variants stay isolated, stores and folders stay unchanged, missing files fail before execution, and the recorded tools, access, and quota are preserved.
