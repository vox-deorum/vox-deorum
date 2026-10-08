# Stage 2: Sections, records, and reloads

Part of the [context-records plan](../context-records.md). **Status: planned.**

## Objective

Give prompts and records one section registry, store seat files with history behind the existing bash tool, archive each processed turn and generated briefing, write a game reference before play, and rewind records and notes together when an earlier turn is recorded again. Live prompts stay inline.

## Dependencies

Stage 1 supplies the golden tests that guard the section registry's adoption. The store does not depend on the registry, so the two halves can be built in either order.

## Current state

| Area | Existing behavior and source |
| --- | --- |
| State collection | `refreshGameState` in `strategist/strategy-parameters.ts` fetches players, events, cities, options, victory progress, and military reports, and updates the seat's cached state in place. The six reports already use the seat's perspective through MCP `PlayerID` auto-completion. |
| Event windows | `state.events` holds a refresh's event slice. `withEventWindowFallback` builds `state.mergedEvents` for a decision covering several turns and narrows it on context overflow. |
| Prompts | About ten builders (strategists, briefers, `buildGameContextMessages`, envoy and negotiator contexts) write each section by hand as a heading, a description, and `jsonToMarkdown` output that uses the report's `_markdownConfig`. The same description sentences are retyped across files. |
| Workspaces | `utils/workspace/player-workspace.ts` mounts game notes (`workspaces/games/<gameID>-player-<playerID>`), optional shared folders, and scratch space from disk. Each command runs in a new just-bash `Bash` over a `MountableFs`, with `ReadWriteFs` for writable mounts and a read-only `OverlayFs` otherwise. Bash output is capped at 8,000 characters per stream. The bash tool's description in `utils/tools/bash-tool.ts` lists the seat's mounts. |
| Telemetry storage | `SQLiteSpanExporter.getDatabase` opens one database per seat under the strategist's folder, so the same seat run by a different strategist writes to a different database. The gameID persists across save and load, so a reload appends to the same database. |
| Turn processing | `strategist/vox-player.ts` calls `ensureGameState` for every processed turn, then applies pacing and optionally runs the strategist. Chat can refresh uncached state independently. |
| Briefings | `requestBriefing` in `briefer/briefing-utils.ts` deduplicates generation. Outputs enter `state.reports`; staffed strategists then assemble their combined briefing there. |
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

Each seat's store is its own better-sqlite3 database at `<workspaceRoot()>/games/<gameID>-player-<playerID>.db`, in WAL mode. The path depends only on the game and the player, never on the strategist. A seat played by `simple-strategist` and resumed in a later session with `staffed-strategist` writes spans to two telemetry databases but opens one seat store, so its notes, records, and reload history carry over. The seat keeps one connection, opened on first use and closed after its player loop stops.

| Table | Contents |
| --- | --- |
| `ws_blobs` | File contents keyed by SHA-256 hash, with size and a compressed flag. Identical contents are stored once. Contents are compressed with zlib only when that makes them smaller, following the SQLite Archive convention. |
| `ws_commits` | One row per version: parent commit, game turn, kind (`write` or `reload`), author (`host` or the agent name), the authoring span's trace and span IDs, and time |
| `ws_changes` | The paths a commit changed, each with its new blob hash, or none for a deletion |
| `ws_refs` | The `head` reference |

Paths start with `records/` or `game/`. Game notes stay one folder per seat, as today, with the seat's game access. To read a version, each path resolves to its latest change among that commit's ancestors. The head's manifest of paths and hashes is cached in memory, so most reads need only a blob lookup.

A commit is one synchronous transaction that applies its path changes on top of the current head. When two writers start from the same version, the later commit wins path by path, as files on disk do today. A writer can also supply derived files, such as the records catalog, computed inside the transaction from the resulting tree, so they always describe the commit they belong to. A reader always sees whole commits.

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

`StoreFs` subclasses just-bash's `InMemoryFs`. It is built from a commit's manifest, with each file supplied as a lazy provider that reads its blob on first access, so listing paths stays synchronous and contents load only when read. It overrides the public mutators (`writeFile`, `appendFile`, `mkdir`, `rm`, `cp`, `mv`, `chmod`, `symlink`, `link`, `utimes`, `createExclusive`) to record changed and deleted paths. The read-only variant rejects writes with the same `EROFS` error the current read-only mounts give.

`PlayerWorkspace.open` builds the views from head for each command. After the command, it commits the writable notes view's recorded changes in one commit, so the next command sees them along with any host writes committed in between. Stage 4 reuses one view per replay execution without committing.

With files enabled, a seat can have these mounts:

| Virtual path | Source | When mounted | Access |
| --- | --- | --- | --- |
| `/workspace/records` | Seat store, `records/` | Always | Read-only |
| `/workspace/reference` | Game reference folder on disk | Always | Read-only |
| `/workspace/game` | Seat store, `game/` | When the seat has game access | The seat's game access |
| `/workspace/shared/<name>` | Shared folder on disk | For each configured shared folder | The configured access |
| `/tmp` | Per-seat scratch folder on disk | Always | Writable |

Only the host writes records, through `SeatRecords`. The bash mount description still depends only on the files setting.

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

`recordTurn(state)` writes the turn's factual sections in one commit, and writes `records/game/` whenever it is missing or changed. `recordBriefing(turn, kind, text)` is the only writer of archived briefings. It commits the briefer's own output when generation resolves, before a strategist's assembled report can replace it. Both supply `CATALOG.md` as a derived file. A repeated briefing write keeps the existing file.

Errors propagate. A record-write failure fails that processed turn, whether pacing would have chosen a decision or a skip; the existing turn-error path handles it, and the loop can process the next turn. Briefing-write failures propagate through the requesting run.

### Reloads

The records detect a reload. When `recordTurn` receives turn N and the head already has records for turn N or later, the game was reloaded. This is the only point that rewinds. It covers a new session loading a save, crash recovery through `recoverGame`, and a manual reload. Normal play processes each turn once, so it never rewinds.

To rewind, the store moves head to the last commit made before turn N, adds a `reload` commit there, and records turn N on top. Records and notes rewind together because they share one store. Nothing is carried forward: the reference lives outside the store, and `recordTurn` rewrites `records/game/` if the rewound head lacks it. Shared folders do not rewind.

For example, the strategist plays to turn 60 and writes "Babylon betrayed us on turn 55" into its notes. The player then loads a turn-50 save. When turn 50 is recorded, head moves back to the last commit from turn 49, so the turn 50-60 records and that note disappear from the seat's view. They stay in history for analysis. The oracle does not replay the discarded turns, because it keeps only the last attempt at each turn.

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

Notes and records are no longer plain folders on disk. A small materialize command writes a seat store at a chosen commit, defaulting to head, into a folder. Players use it to read notes, and developers use it to debug replays.

## Work items

- Add the section registry and `renderSection`, and adopt them in each builder while keeping the golden tests unchanged.
- Implement the store tables, commits, version reads, the head manifest cache, and rewinds. Add `StoreFs` and the materialize command.
- Switch `PlayerWorkspace` to store views for records and notes with a commit after each command, and mount the reference folder. Update the workspace capability instructions and bash descriptions.
- Implement `SeatRecords`, catalog generation, record splitting, and reload rewinds, with the cached accessor on `VoxContext`.
- In `handleGameSwitched`, prepare all players before launching their loops and write the reference there. Route setup failures through the fatal session path, including abort and completion signaling.
- After `ensureGameState` in `vox-player.ts`, record each processed turn when files are enabled, before pacing can skip or the strategist can run. In `requestBriefing`, await recording of a newly generated output and propagate write failures. Leave chat refreshes without turn-record writes.
- Check the perspective comment in `envoy/context/diplomacy-context.ts` against MCP auto-completion and correct it if stale.

## Verify

| Area | Required checks |
| --- | --- |
| Sections | Builders using the registry keep the unchanged golden tests; overrides change only the overridden heading or description |
| Events | A paced decision renders several turns while each record keeps its refresh slice; a narrowed retry changes only the rendered window |
| Store | Round-trip of text and binary files, deduplication, compression only when smaller, reads at an older commit, path-level last-writer-wins, and one store path for a seat whichever strategist runs it |
| Bash view | `>`, `>>`, `tee`, `sed -i`, `mkdir`, `rm -r`, `mv`, and `cp` are each recorded and committed; read-only mounts reject writes; the next command sees the previous command's writes and host commits made in between |
| Records | Markdown and JSON output, split files, a turn and its catalog in one commit, a complete catalog when turn and briefing commits interleave, repeat briefing writes keeping files, and correct catalog ranges and sizes |
| Reference | Four calls per file-enabled game regardless of seat count, written only after all succeed, skipped by a later session, and mounted for every file-enabled seat |
| Failures | A record-write failure fails the strategist turn before its decision; a reference failure puts the session in error and starts no player loops |
| Reloads | Recording an already-recorded turn N, as after crash recovery with the same players, moves head to the last commit before N, rewinds records and notes together, rewrites `records/game/` when missing, leaves the reference and shared folders alone, and keeps discarded commits in history |
| Hooks | Paced skips are recorded; chat refreshes do not record turns; files-disabled seats make no extra calls and write nothing to the store |

Also update the existing workspace mount, capability prompt, and bash-tool tests; test materializing head and an older commit, including binary contents; and check that the store connection closes only after the seat loop stops.

## Documentation

Update `docs/developers/vox-agents/prompts.md` with the section registry; `docs/developers/vox-agents/overview.md` with the store, bash view, records, reference, catalog, and reloads; `docs/players/configuration.md` with the records and reference mounts, notes in the seat store, materialization, notes rewinding on reload, and measured disk use; and `vox-agents/AGENTS.md` with the rules to render game-state sections through the registry and write workspace files through the store.

## Risks and open questions

- **Store growth:** full JSON, Markdown, and split Markdown accumulate, and nothing is deleted, including discarded timelines. Deduplication and compression reduce the cost. Measure the implemented output before documenting a size estimate.
- **Bash coverage:** a just-bash command that writes through a path other than the public mutators would escape the recorded changes. The bash-view checks cover the common commands.
- **First recorded view:** records keep the turn loop's refresh. Later events enter a later refresh under their real event-turn keys.

## Future image support

This plan does not capture or send images. The store is binary-safe, so the host can later commit images such as `records/turns/<N>/screens/<name>.png`. A dedicated view tool would need to return image parts to multimodal models, and the capture source needs its own design.

## Done when

Builders render sections through the registry with unchanged inline output. Each file-enabled processed turn, including paced skips, is committed before the decision or skip; new briefings archive before their callers continue; the reference is written before any loop starts. Bash reads and commits versioned notes, a strategist switch keeps the same seat store, repeated turns rewind notes and records, and the materialize command exports any version. Failure paths and files-disabled behavior pass their checks.
