# Stage 2: Sections, records, and reloads

Part of the [context-records plan](../context-records.md). **Status: planned.**

## Objective

Give prompts and records one section registry, store seat files with history behind the existing bash tool, archive each processed turn and generated briefing, write a game reference before play, and give each seat one timeline start that resets its live state and rewinds records and notes together after a reload. Live prompts stay inline.

## Dependencies

Stage 1 supplies the golden tests that guard the section registry's adoption. `envoy/context/diplomacy-context.ts` has no golden test yet, so capture a local, gitignored one for it before moving it to the registry. The store does not depend on the registry, so the two halves can be built in either order.

## Current state

| Area | Existing behavior and source |
| --- | --- |
| State collection | `refreshGameState` in `strategist/strategy-parameters.ts` fetches players, events, cities, options, victory progress, and military reports, and updates the seat's cached state in place. The six reports already use the seat's perspective through MCP `PlayerID` auto-completion. |
| Event windows | `state.events` holds a refresh's event slice. `withEventWindowFallback` builds `state.mergedEvents` for a decision covering several turns and narrows it on context overflow. |
| Prompts | About ten builders (strategists, briefers, `buildGameContextMessages`, envoy and negotiator contexts) write each section by hand as a heading, a description, and `jsonToMarkdown` output that uses the report's `_markdownConfig`. The same description sentences are retyped across files. |
| Workspaces | `utils/workspace/player-workspace.ts` mounts game notes (`workspaces/games/<gameID>-player-<playerID>`), optional shared folders, and scratch space from disk. Each command runs in a new just-bash `Bash` over a `MountableFs`, with `ReadWriteFs` for writable mounts and a read-only `OverlayFs` otherwise. On the first command, it creates each mount's folder and seeds an `AGENTS.md` guide at every writable game or shared mount root without overwriting an existing one; the workspace capability prompt tells agents to read it first. Bash output is capped at 8,000 characters per stream. The bash tool's description in `utils/tools/bash-tool.ts` lists the seat's mounts. |
| Telemetry storage | `SQLiteSpanExporter.getDatabase` opens one database per seat under the strategist's folder, so the same seat run by a different strategist writes to a different database. The gameID persists across save and load, so a reload appends to the same database. |
| Turn processing | `strategist/vox-player.ts` calls `ensureGameState` for every processed turn, then applies pacing and optionally runs the strategist. Chat can refresh uncached state independently. The constructor initializes the seat's timeline state inline: the cached game states, working memory, the decision event window, and the event cursor, with `lastDecisionTurn` unset. Nothing resets that state later, so after a same-game reload from turn 60 to turn 50, `ensureGameState` returns the stale cached turn-50 state, the event cursor stays past turn 50's range, and pacing waits for turn 60's decision interval. |
| Runs | `VoxContext` registers every root run, including forked analysts, and `abort()` cancels them all. Bash commands receive their run's abort signal through `currentSignal()`. |
| Briefings | `requestBriefing` in `briefer/briefing-utils.ts` deduplicates generation through a pending-promise map. The briefers' `postprocessOutput` overrides in `briefer/briefer.ts` and `briefer/specialized-briefer.ts` write each output into `state.reports` before `requestBriefing` resolves, and they write to the state for the parameters' turn, not the state passed in. Staffed strategists then assemble their combined briefing there. |
| Session startup | `StrategistSession.handleGameSwitched` creates players, registers tools, and starts their loops. It runs only when the gameID changes; a reload of the same game, including crash recovery through `recoverGame`, keeps the existing players. Fatal setup failures must use the session's error path, because throwing from a notification handler alone does not stop the session. |

## Approach

### Section registry

`knowledge/sections.ts` defines each section's key, title, description, scope, and optional record splitting. The keys are `situation`, `civilization`, `options`, `strategies`, `victory`, `players`, `cities`, `military`, `events`, and `briefings`. Situation and civilization are game-scoped; the others are turn-scoped.

`renderSection(key, data, options)` renders one section: heading, description, and `jsonToMarkdown` output with the report's own configuration. Options override the heading, description, or Markdown configuration where an agent's wording differs. Builders keep their structure, message order, field filtering, and cache breakpoints, and replace their hand-written headings and descriptions with this call. Output stays byte-identical under the golden tests. There is no layout engine and no separate knowledge assembler; builders keep reading `GameState`.

### Events: record the slice, render the decision window

Records use `state.events`, the refresh's slice. Inline prompts use the decision window, `state.mergedEvents`, falling back to the slice.

For example, after a decision on turn 20, pacing skips turns 21 and 22 and the strategist decides on turn 23:

| Consumer | Events |
| --- | --- |
| Turn 21 record | Turn 21's refresh |
| Turn 22 record | Turn 22's refresh |
| Turn 23 record | Turn 23's refresh |
| Turn 23 inline prompt | The selected decision window, initially turns 21-23 |
| Turn 23 file-mode strategist (Stage 3) | Directions to the records covering turns 21-23 |

If an inline attempt overflows and retries with turns 22-23, rendering uses that narrower window and the records stay unchanged. A refresh can also cover a dropped turn; its events keep their real turn keys inside the report. No additional event fetching is needed.

### Workspace store

The workspace store is a small versioned file store in `utils/workspace/workspace-store.ts`. It follows git's object model without git itself: file contents are stored once by hash, each change is a commit pointing to its parent, and a head reference names the current version.

Each seat's store is its own better-sqlite3 database at `<workspaceRoot()>/games/<gameID>-player-<playerID>.db`, in WAL mode. The path depends only on the game and the player, never on the strategist. A seat played by `simple-strategist` and resumed in a later session with `staffed-strategist` writes spans to two telemetry databases but opens one seat store, so its notes, records, and reload history carry over. A file-enabled `VoxPlayer` opens one connection when it is created, because its first timeline start may rewind the store, and attaches the store to its `VoxContext`. The seat's workspace and `SeatRecords` read it from there. The player closes it after `context.shutdown()` in its loop's cleanup. A failure to open the store is a setup failure, and the session's fatal setup path closes the stores of players whose loops never started.

| Table | Contents |
| --- | --- |
| `ws_blobs` | File contents keyed by SHA-256 hash, with size and a compressed flag. Identical contents are stored once. Contents are compressed with zlib only when that makes them smaller, following the SQLite Archive convention. |
| `ws_commits` | One row per version: parent commit, game turn, kind, author (`host` or the agent name), the authoring span's trace and span IDs, and time |
| `ws_changes` | The paths a commit changed. Each entry is a file (blob hash, mode, and modification time), a directory (mode and modification time), or a deletion, which removes the path and everything under it. |
| `ws_refs` | The `head` reference |

Commit kinds say what a commit means:

| Kind | Written by |
| --- | --- |
| `turn` | `recordTurn`, once per processed turn |
| `briefing` | `recordBriefing` |
| `notes` | A bash command that changed the notes view |
| `reload` | A rewind |

The **last recorded turn** is the turn of the newest `turn` commit in head's ancestry. Only `turn` commits mark a turn as processed, so a briefing archived early for turn N, or a note written during turn N, never makes the store look as if turn N was already played.

Paths start with `records/` or `game/`. Game notes stay one folder per seat, as today, with the seat's game access. To read a version, each path resolves to its latest change among that commit's ancestors. A file's parent directories are implied; directory entries keep empty directories and directory metadata. The head's manifest of paths, kinds, and hashes is cached in memory, so most reads need only a blob lookup.

A commit is one synchronous transaction that applies its path changes on top of the current head. When two writers start from the same version, the later commit wins path by path, as files on disk do today. A writer can also supply derived files, such as the records catalog, computed inside the transaction from the resulting tree, so they always describe the commit they belong to. A reader always sees whole commits.

A commit made for a run carries that run's abort signal, and the transaction rejects it when the signal is aborted. Run cancellation and rewinds are synchronous, so a write from a cancelled run either landed before the rewind, which discards it, or is rejected. The run registry on `VoxContext` already tracks every ongoing command and briefing, so no separate registry or generation counter is needed. Host writes outside a run, such as rewinds, carry no signal.

`rewind(N)` does nothing unless the last recorded turn is N or later. Otherwise it finds the oldest `turn` commit for turn N or later in head's ancestry, moves head to that commit's parent, and adds a `reload` commit there. The cut is anchored on `turn` commits because they are the only ones in timeline order: a long chat can commit a note tagged with an older turn after later turns were recorded. Because it is a no-op when nothing needs discarding, every timeline start can call it.

Shared folders and scratch space (`/tmp`) stay plain folders on disk, unversioned, as today. Notes written before the store existed stay in the old seat folder and are not imported.

These options were considered before choosing a small in-house store:

| Option | What it offers | Decision |
| --- | --- | --- |
| just-bash filesystems | Already in use. `InMemoryFs` supports lazily loaded files, and its mutators are public and overridable. | Keep for mounting. The store view subclasses `InMemoryFs`. |
| [AgentFS](https://github.com/tursodatabase/agentfs) (Turso, MIT, beta) | A SQLite-backed agent filesystem with a just-bash adapter | Not adopted. It stores only the current state, with history listed as a future extension, and its Node SDK runs on Turso's pre-release engine, which would put a second engine on the WAL file better-sqlite3 writes. |
| [isomorphic-git](https://isomorphic-git.org/) | Real commits, branches, and refs | Not adopted. It needs a Node-style filesystem and a `.git` object store, which is heavy for a commit after every bash command. Its object model is reused. |
| [SQLite Archive](https://sqlite.org/sqlar.html) | A standard table for files inside SQLite, with zlib compression | No history. Its compression convention is reused. |
| Dolt and DoltLite | Versioned database engines | They replace the SQLite engine and cannot run under better-sqlite3. |

### Bash view of the store

`StoreFs` subclasses just-bash's `InMemoryFs`. It is built from a commit's manifest: each file is supplied through `writeFileLazy` with its stored mode and modification time and a provider that reads its blob on first access, and each directory entry is created with its stored metadata. Listing paths stays synchronous and contents load only when read.

It overrides the public mutators (`writeFile`, `appendFile`, `mkdir`, `rm`, `cp`, `mv`, `chmod`, `utimes`, `createExclusive`) only to note which paths a command touched. At commit time it saves each touched path's final state from the view: a file, a directory, or absent. A recursive copy or move is walked then. So an empty `mkdir`, a `chmod`, or a `touch` persists into the next command like a file write does. `symlink` and `link` are rejected with a clear error, because no agent needs them and the store has no link entries. The read-only variant rejects writes with the same `EROFS` error the current read-only mounts give.

`PlayerWorkspace.open` builds the views from head for each command. After the command, it commits the writable notes view's touched paths as one `notes` commit bound to the command's run signal, so the next command sees them along with any host writes committed in between. A command whose run was cancelled commits nothing and returns an error, so each command lands whole or not at all. Stage 4 reuses one view per replay execution without committing.

The game notes guide moves into the store. When the writable notes view lacks `game/AGENTS.md`, `open` adds the default guide to the view as a touched path, so it is committed with that command's `notes` commit. This covers a new seat and a rewind to a version before the guide existed, and never overwrites an agent's edits. Guides in shared folders are seeded on disk as today.

With files enabled, a seat can have these mounts:

| Virtual path | Source | When mounted | Access |
| --- | --- | --- | --- |
| `/workspace/records` | Seat store, `records/` | Always | Read-only |
| `/workspace/reference` | Game reference folder on disk | Always | Read-only |
| `/workspace/game` | Seat store, `game/` | When the seat has game access | The seat's game access |
| `/workspace/shared/<name>` | Shared folder on disk | For each configured shared folder | The configured access |
| `/tmp` | Per-seat scratch folder on disk | Always | Writable |

Only the host writes records, through `SeatRecords`. The bash mount description still depends only on the files setting. The workspace mounts the reference folder without creating it, so an existing reference folder always means a complete write.

### Records and catalog

`SeatRecords` in `knowledge/records.ts`, cached by seat and game on `VoxContext`, writes the records tree under `records/`:

| Path | Contents |
| --- | --- |
| `CATALOG.md` | Generated section index, turn ranges, file sizes, and query guidance |
| `game/<key>.md` and `.json` | Situation and civilization |
| `turns/<N>/<key>.md` and `.json` | Complete turn reports |
| `turns/<N>/<key>/<part>.md` | Markdown split by civilization, city owner, military zone, or event category |
| `turns/<N>/briefings/<kind>.md` | Generated briefing text |

Markdown uses the registry's titles and `jsonToMarkdown` with the source report's configuration and full data. JSON omits `_markdownConfig`. Agent-specific filtering affects inline rendering only. Split filenames use readable slugs with collision suffixes.

Reports can exceed the bash output cap even after splitting. The catalog explains how to select smaller pieces with `grep`, `head`, `sed -n`, or `jq`, and lists compressed turn ranges, such as `1-40, 42`, and the latest files' sizes.

`recordTurn(state)` writes the turn's factual sections in one `turn` commit, and writes `records/game/` whenever it is missing or changed. It only records; reload handling lives in `VoxPlayer`. `recordBriefing(turn, kind, text)` is the only writer of archived briefings and writes one `briefing` commit. Both supply `CATALOG.md` as a derived file. A later briefing for the same turn and kind replaces the archived file, so the archive always matches the published briefing.

The turn loop calls `recordTurn` right after `ensureGameState` and before it advances the event cursor. Errors propagate. A record-write failure fails that processed turn, whether pacing would have chosen a decision or a skip; the existing turn-error path handles it, and the loop can process the next turn. As with a failed refresh, the cursor stays put, so the next turn's refresh and record cover the missed events under their real turn keys. Briefing-write failures propagate through the requesting run.

### Briefing publication

`requestBriefing` becomes the single owner of a briefing's lifecycle. The briefers' `postprocessOutput` overrides are deleted, because every briefing already goes through `requestBriefing`. Its tracked promise generates the briefing, archives it through `recordBriefing` when files are enabled, publishes it to `state.reports`, and only then resolves. The archive uses the requested state's turn, and its kind follows the report key (`combined`, `military`, `economy`, or `diplomacy`). The lookup order (cached report, combined fallback, pending generation) stays as it is.

As a result:

- A briefer output reaches the cache only after it is archived, and it is published to the state that was requested.
- A concurrent caller finds the pending entry and waits for archiving to finish.
- A failed generation or archive publishes nothing. The pending entry is cleared as it is today, so the next request starts over, and every waiter on the failed promise sees the failure.

One existing exception stays. After awaiting its briefings, the staffed strategist overwrites the combined report key with its assembled text for the spokesperson. That assembled text is not archived; its parts already are.

### Reloads

`VoxPlayer` owns the seat's timeline. The constructor's inline initialization moves into one method, `beginTimeline(turn)`. The constructor builds the parameters once and calls it with the initial turn. `beginTimeline(N)` runs these steps synchronously:

1. Cancel the seat's active runs with `context.abort()`: chats, forked analysts, and their briefings and bash commands. At construction there are none, and on a reload the strategist is between turns.
2. Reset live state in place, because runs hold references to the base parameters. It clears the cached game states and working memory, unsets `lastDecisionTurn` so turn N decides as a new session would, starts the decision event window at N, and moves the event cursor to the start of turn N. Game metadata stays, because the game is the same.
3. Call the store's `rewind(N)` when files are enabled. Files-disabled seats make no store calls.
4. Once the rewind succeeds, note turn N - 1 as the last processed turn and clear any pending reload.

The turn loop adds one check before it reads the event cursor and `lastDecisionTurn`. If a reload is pending, or the notified turn is at or below the last processed turn, the game was reloaded, and the loop calls `beginTimeline` with the lower of the pending turn and the notified turn. The call comes before the turn's root run, because `abort()` would cancel that run too. The DLL sends `PlayerDoneTurn` once per player turn, and neither the bridge nor MCP deduplicates or repeats it, so a turn arrives twice only after a reload. That includes a reload to the current turn, which crash recovery from a fresh autosave often produces. Then the turn becomes the last processed turn, and `ensureGameState`, `recordTurn`, and pacing run unchanged. With the cache cleared, `ensureGameState`'s existing coverage rule fetches fresh state, so it needs no change.

Only the rewind can realistically fail, for example on a SQLite error. A failed rewind fails the turn instead of stopping the session:

- The loop handles it like any failed turn: it logs the error, marks the turn span as failed, resumes the game, and neither records nor decides that turn.
- The reload turn stays pending, so each later turn retries `beginTimeline` from that turn until a rewind succeeds. For example, if the rewind to turn 50 fails, turn 51 retries the cut at turn 50, so turn 50's old notes are still discarded.
- While a reload is pending, no turn is recorded. A chat note committed in the meantime lands after the old timeline's turn commits, so the eventual rewind discards it too.
- A rewind that fails in the constructor sets the same pending turn and logs the error, so the first processed turn retries it.

The two kinds of reload share this path:

| Case | How it reaches `beginTimeline` |
| --- | --- |
| A new session loads a save | The constructor calls it with the initial turn. The store rewinds if it had recorded that turn or later. |
| A same-game reload, manual or through `recoverGame` | The existing players stay. The first processed turn at or below the last processed turn calls it. |

Normal play processes each turn once, so it never rewinds. Records and notes rewind together because they share one store. Nothing is carried forward: the reference lives outside the store, and `recordTurn` rewrites `records/game/` if the rewound head lacks it. Shared folders do not rewind.

For example, the strategist plays to turn 60 and writes "Babylon betrayed us on turn 55" into its notes. The player then loads a turn-50 save while a diplomat chat is writing another note. When the strategist begins turn 50:

- The chat is cancelled, so its note commit is rejected.
- The seat's turn 50-60 game states, working memory, and pacing history are dropped. Turn 50 is fetched fresh, and the strategist decides on it.
- Head moves back to the version just before turn 50 was first recorded, so the turn 50-60 records and the Babylon note disappear from the seat's view. Notes written during turn 49 stay. The discarded commits stay in history for analysis.

The oracle does not replay the discarded turns, because it keeps only the last attempt at each turn.

### Game reference

`StrategistSession.handleGameSwitched` writes the reference once per game when at least one seat has files enabled, after registering the seats' tools and before starting any player loop or autoplay. Prepare every seat first, then start the players.

The four listing tools take no `PlayerID`, so one set of calls serves every seat:

| Tool | Arguments | Listing contents |
| --- | --- | --- |
| `get-technology` | `MaxResults: 5000`, no search | Names, help, cost, era, and technologies unlocked |
| `get-policy` | `MaxResults: 5000`, no search | Names, help, branch, level, and era |
| `get-building` | `MaxResults: 5000`, no search | Names, help, cost, prerequisite technology, era, and civilization uniqueness |
| `get-unit` | `MaxResults: 5000`, no search | Names, descriptions, combat values, cost, prerequisite technology, era, and civilization uniqueness |

These are listing results. A query that resolves to exactly one item returns a detailed report instead, so the writer must not assume every result is a listing row. Recording turns and briefings adds no MCP calls, and files-disabled games make no added calls.

The reference is written to a temporary folder and renamed to `<workspaceRoot()>/games/<gameID>/reference/`, so an existing folder always means a complete write. A later session of the same game skips the calls. Any fetch failure, error result, or write failure stops the session through its fatal setup path. Handle both MCP errors and the database tools' returned `Error` field.

### Viewing files outside the game

Notes and records are no longer plain folders on disk, so a player cannot open them in a file explorer. **Materializing** copies one version of a seat store, head by default or a chosen commit, out as ordinary files. Players use it to read their agents' notes, and developers use it to see which files a run or replay could read.

`utils/workspace/materialize.ts` walks a version's files and directories, with their modes and modification times, and hands them to a sink. It reads through its own read-only connection inside one read transaction, so it sees whole commits and works while a session is writing the store. Two entry points share it:

| Entry point | How it is used | Output |
| --- | --- | --- |
| Command line | `npm run workspace -- materialize <gameID> <playerID> <outDir> [commit]` in `vox-agents`, through `utils/workspace/console.ts` and a `workspace` and `workspace:dist` script pair like the other consoles | Writes the files into `<outDir>`, which must be new or empty |
| Telemetry page | A "Download files" button on each row of the past games table in `ui/src/views/TelemetryView.vue`. The telemetry routes add a `hasWorkspace` flag to each database row and a download route that takes the game ID, player ID, and an optional commit. | Streams a zip named after the seat and commit, using the same `yazl` streaming as the debug log bundle |

The button appears only when the row's seat store exists. Both entry points report a missing store or an unknown commit as an error, and neither changes the store. The telemetry database scan already skips the `workspaces` folder, so seat stores never appear as telemetry databases.

## Work items

- Capture a local golden test for `envoy/context/diplomacy-context.ts`. Add the section registry and `renderSection`, and adopt them in each builder while keeping the golden tests unchanged.
- Implement the store tables, commit kinds, file and directory entries, run-bound commits, version reads, the head manifest cache, the last recorded turn, and `rewind`. Add `StoreFs`.
- Add `materialize.ts`, the workspace console and its npm scripts, the telemetry download route and `hasWorkspace` flag, and the telemetry page button.
- Switch `PlayerWorkspace` to store views for records and notes with a `notes` commit after each command, bound to the command's run signal. Seed the game guide into the notes view when missing, and mount the reference folder without creating it. Update the workspace capability instructions and bash descriptions.
- Implement `SeatRecords`, catalog generation, and record splitting, with the cached accessor on `VoxContext`.
- In `vox-player.ts`, open the seat store and attach it to the context, and close it after `context.shutdown()`. Move the constructor's timeline initialization into `beginTimeline`, call it from the constructor and from the turn loop's reload check, and track the last processed turn and the pending reload turn.
- In `handleGameSwitched`, prepare all players before launching their loops and write the reference there. Route setup failures, including a failure to open a seat store, through the fatal session path, with abort and completion signaling, and close any opened stores there.
- After `ensureGameState` in `vox-player.ts` and before the event cursor advances, record each processed turn when files are enabled, before pacing can skip or the strategist can run. Leave chat refreshes without turn-record writes.
- Delete the briefers' `postprocessOutput` overrides and make the tracked promise in `requestBriefing` generate, archive, and publish in that order.
- Check the perspective comment in `envoy/context/diplomacy-context.ts` against MCP auto-completion and correct it if stale.

## Verify

| Area | Required checks |
| --- | --- |
| Sections | Builders using the registry keep the unchanged golden tests; overrides change only the overridden heading or description |
| Events | A paced decision renders several turns while each record keeps its refresh slice; a narrowed retry changes only the rendered window |
| Store | Round-trip of text and binary files, deduplication, compression only when smaller, reads at an older commit, path-level last-writer-wins, and one store path for a seat whichever strategist runs it |
| Bash view | `>`, `>>`, `tee`, `sed -i`, `mkdir`, `rm -r`, `mv`, and `cp -r` are each recorded and committed; an empty `mkdir`, a `chmod`, and a `touch` persist into the next command; `ln -s` is rejected; read-only mounts reject writes; the next command sees the previous command's writes and host commits made in between; a command whose run is cancelled leaves head unchanged |
| Records | Markdown and JSON output, split files, a turn and its catalog in one commit, a complete catalog when turn and briefing commits interleave, a repeat briefing write replacing the file, and correct catalog ranges and sizes |
| Briefings | A concurrent caller waits until the briefing is archived; a failed archive publishes nothing and the next request regenerates; each published briefer output equals its archived file and lands in the requested state under that state's turn |
| Reference | Four calls per file-enabled game regardless of seat count, written only after all succeed, skipped by a later session, and mounted for every file-enabled seat |
| Failures | A record-write failure fails the strategist turn before its decision and leaves the event cursor in place; a reference failure or a store that cannot open puts the session in error, starts no player loops, and closes opened stores |
| Reloads | Processing turn 50 after turn 60 with the same players fetches fresh state instead of the cached entry, resets the event cursor, decision window, and working memory, and decides on turn 50. A chat bash command and a chat briefing running at that moment are cancelled and commit nothing. Head moves to the parent of the first turn-50 record, even when a late chat note tagged with an earlier turn follows it, records and notes rewind together, `records/game/` is rewritten when missing, the reference and shared folders are untouched, and discarded commits stay in history. A new session at turn 50 over a store that recorded turn 60 rewinds the same way. A briefing or note committed for turn N before turn N is processed causes no rewind. A repeated notification for the same turn is treated as a reload. A failed rewind fails that turn without recording or deciding, resumes the game, and the next turn retries the cut at the original reload turn; a failed constructor rewind is retried by the first turn. Files-disabled seats reset without store calls. |
| Guide | A new seat's first command commits `game/AGENTS.md`; a rewind to before the guide existed reseeds it on the next command; an edited guide is never overwritten |
| Materialize | The command and the download each export head and an older commit, including binary contents, directories, and modes; a missing store or unknown commit is an error; the store is unchanged; the button shows only for rows with a seat store |
| Hooks | Paced skips are recorded; chat refreshes do not record turns; files-disabled seats make no extra calls and write nothing to the store |

Also update the existing workspace mount, capability prompt, and bash-tool tests, and check that the store connection closes only after the seat loop stops.

## Documentation

Update `docs/developers/vox-agents/prompts.md` with the section registry; `docs/developers/vox-agents/overview.md` with the store, bash view, records, reference, catalog, and reloads; `docs/players/configuration.md` with the records and reference mounts, notes in the seat store, the materialize command and telemetry page button, notes rewinding on reload, and measured disk use; and `vox-agents/AGENTS.md` with the rules to render game-state sections through the registry and write workspace files through the store.

## Risks and open questions

- **Store growth:** full JSON, Markdown, and split Markdown accumulate, and nothing is deleted, including discarded timelines. Deduplication and compression reduce the cost. Measure the implemented output before documenting a size estimate.
- **Bash coverage:** a just-bash command that writes through a path other than the public mutators would escape the recorded changes. The bash-view checks cover the common commands.
- **First recorded view:** records keep the turn loop's refresh. Later events enter a later refresh under their real event-turn keys.
- **Cancelled chats:** a reload cancels every chat and analyst running on the seat when the strategist begins the loaded turn. Players must reopen them.
- **Early chat briefing:** a chat can archive a briefing for turn N before the strategist records turn N. That commit sits before the cut, so a later `rewind(N)` keeps it until a new briefing of the same kind for turn N replaces it.
- **Per-command views:** each command rebuilds its views from the head manifest, and a `stat`, such as from `ls -l`, loads that file's contents. If this is slow on a large records tree, cache the read-only records view until a commit changes `records/`.
- **Busy strategist:** turn notifications that arrive while the strategist is working are dropped, as today. If the loaded turn's notification is dropped, the reload is detected on the next processed turn, and the old timeline's record for the dropped turn stays in view.

## Future image support

This plan does not capture or send images. The store is binary-safe, so the host can later commit images such as `records/turns/<N>/screens/<name>.png`. A dedicated view tool would need to return image parts to multimodal models, and the capture source needs its own design.

## Done when

Builders render sections through the registry with unchanged inline output. Each file-enabled processed turn, including paced skips, is committed before the decision or skip; new briefings are archived before they are published or their callers continue; the reference is written before any loop starts. Bash reads and commits versioned notes with their directories and metadata, a strategist switch keeps the same seat store, and the materialize command and telemetry page download export any version. A reload resets the seat's live state before fetching the loaded turn, cancels its running chats so they cannot write, and rewinds notes and records. Failure paths and files-disabled behavior pass their checks.
