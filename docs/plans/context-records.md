# Context records: a core prompt plus files

This implementation plan gives Vox Deorum agents durable game reports and editable system prompts. The detailed work is split into four stages below. Each stage owns its design, work items, verification, and completion criteria.

## Goals

- Render game-state sections through one **section registry**, so prompts and records share section keys, titles, and descriptions.
- Move system prompt prose into Mustache-templated Markdown under `vox-agents/prompts/`. Support validated prompt-folder overrides at seat, session, and root level.
- Preserve default system text and inline messages byte for byte when `files` and custom `prompts` are disabled, with the same MCP calls and no workspace-store writes.
- With `files`, archive every processed turn, including paced skips, and generated briefings. Expose reports through read-only `/workspace/records` and a once-per-game listing reference through `/workspace/reference`.
- Give the simple strategist a smaller core prompt and access to detailed reports through bash. The diplomat, spokesperson, and negotiator keep their inline content and gain records directions. Runs without bash, including every briefer and the diplomatic analyst, stay inline.
- Preserve records and notes across reloads and strategist changes, and let oracle replay read the files its source run saw without changing stored files.

## Overall approach

A **workspace store** keeps versioned files in one SQLite database per game and player, independent of the chosen strategist. Bash reads and writes it through a small subclass of just-bash's `InMemoryFs` that loads files lazily and records what each command changed. Shared folders and scratch space stay plain folders on disk. The game reference is a plain read-only folder written once per game. A materialize command and a telemetry page download export a stored version for reading outside the game.

Each seat starts a timeline when its player is created and again when the strategist begins a turn at or below its last processed turn, which means the game was reloaded. Starting a timeline cancels the seat's running chats, resets its cached state and pacing, and rewinds its records and notes together to before that turn. Shared folders and the reference never rewind. Discarded timelines remain in the store's history for analysis. The oracle replays only the last attempt at each turn, so turns lost to a reload are never replayed (see `docs/developers/vox-agents/oracle.md`).

Each agent run records its files setting and prompt folder, then captures the seat store's head commit immediately before its first model step, after preparation. Oracle uses recorded system text and that pinned commit, with disposable writes isolated per replay execution. Reference setup failures stop the session. Record, briefing, and rewind failures propagate to the affected turn or requesting run, and a failed rewind is retried on the next turn.

## Conventions

- Source paths in the stage files are relative to `vox-agents/src/` unless they start with `vox-agents/`, `mcp-server/`, or `docs/`.
- Tests use Vitest with existing mock contexts and temporary telemetry directories.
- Each stage updates the documentation for its behavior and runs its focused checks.

## Work stages

Implement in order. Keep prompts inline through Stage 2 so agents retain their reports until records are ready.

| Stage | Coherent batch | Completion gate |
| --- | --- | --- |
| [1. System prompt files](context-records/01-system-prompts.md) | Capture compatibility fixtures; move prose to templates; add overrides and validation. | Default output is unchanged and invalid templates stop setup. |
| [2. Sections, records, and reloads](context-records/02-records.md) | Add the section registry; store seat files with history; write records, catalog, briefings, and the game reference; rewind on reload. | Inline prompts are unchanged, every processed turn is recorded before pacing or decisions, and bash commits its writes. |
| [3. File mode and telemetry](context-records/03-file-mode.md) | Resolve run tools before prompt preparation; add records directions and the simple strategist's core prompt; capture each run's first-step commit. | Bash-capable agents can read records; other runs stay inline. |
| [4. Oracle workspaces](context-records/04-oracle-replay.md) | Restore pinned seat files and per-execution writes using recorded metadata. | Concurrent replays stay isolated and leave stores unchanged. |

## Acceptance

Use the checks in each stage as the acceptance checklist. Confirm all default prompts passed the temporary golden tests, then delete the local copies. They are gitignored and never committed. Keep the behavior and contract tests.

Run the existing caching, step-budget, envoy, analyst, negotiator, pacing, and oracle suites, then `npm run build:all` and `npm run test:all` from the repository root.

Manual checks:

1. Run several turns with a file-enabled simple strategist. Check the core prompt, bash reads, records, reference, catalog, and note commits.
2. Kill the game process mid-run and let crash recovery reload an earlier autosave. Once the strategist begins the reloaded turn, it decides on fresh state, open chats are cancelled, and the discarded records and notes disappear from the seat's view and remain in history. The oracle skips the discarded turns.
3. Replay a recorded decision and confirm its pinned files and mounts.
4. Materialize a seat store from the command line and download it from the telemetry page, then check the notes.
5. Start a seat with a custom strategist prompt and confirm the recorded system text and `context.prompts`.
6. Restart the same game with a different strategist for that seat and confirm it opens the same store and reads the earlier strategist's notes.
7. Check a files-disabled seat for unchanged prompts and an untouched store.

Finally, confirm the documentation describes the final behavior:

| File | Covers |
| --- | --- |
| `docs/developers/vox-agents/prompts.md` | Section registry, core prompts, records directions, prompt files, Mustache usage, template names, lookup order |
| `docs/developers/vox-agents/overview.md` | Workspace store, bash view, records, game reference, catalog, reload rewinds |
| `docs/developers/vox-agents/oracle.md` | File telemetry, pinned replay workspaces, last-attempt rule, replay limitations |
| `docs/players/configuration.md` | Records and reference mounts, notes in the seat store, the materialize command and telemetry page download, notes rewinding on reload, disk use, the `prompts` setting |
| `vox-agents/AGENTS.md` | Render game-state sections through the registry; write workspace files only through the store; keep system prompt prose in `vox-agents/prompts/` |
| `docs/plans/strategist-orchestrator/02-working-folder.md` | Its working folder should reuse the section registry, records, and workspace store |

## Open decision and limitations

The simple strategist's strategic players summary will be designed after the first revision lands. Until then, its file-mode prompt keeps full players inline while cities, military, and events move to records.

- **Growth:** history grows without pruning.
- **Reload timing:** a same-game reload takes effect when the strategist begins the loaded turn. Chats before then still use the abandoned timeline, and any still running at that point are cancelled.
- **Forward loads:** only loads to an earlier turn are detected. Loading an earlier save and then a later save from the original timeline does not rewind. Notes from the branch in between carry over, and the catalog shows a gap in turns.
- **Shared folders:** they never rewind, so they can keep knowledge from a discarded timeline. Replay sees their current contents.
- **Snapshot gap:** a live run's first bash call can see commits made after its first-step snapshot, such as host writes during its first model call. Replay shows the snapshot, so such files can differ.
- **Portability:** replaying a file-enabled row needs its telemetry database, its seat store, and the game reference folder.
- **Old notes:** notes written before the store existed stay in the old seat folder on disk and are not imported.

## Out of scope

Configurable core-section lists, a generic layout system, new agent variants, moving briefing inputs or conversation/deal/history context, and reference-detail queries beyond the four listings. Also excluded: per-agent note ownership, versioned shared folders, history pruning or compaction, cross-game note continuity, screenshots and image tools, a web file browser or prompt editor, telepathist special-message instructions, inline re-rendering of recorded file prompts, full-history oracle replay, and the orchestrator's offline renderer.
