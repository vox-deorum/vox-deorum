# Context records: a core prompt plus files

## Overview

Vox Deorum agents will build prompts from a shared set of game information. Each agent chooses a layout: which sections to show, in what order, and with which descriptions or filters.

System prompts move out of TypeScript into Mustache-templated Markdown files under `vox-agents/prompts/`. A seat, session, or root config can name a prompt folder whose files replace built-in files of the same name, so users can rewrite any agent's system prompt or a shared fragment. Oracle replay keeps using the system text recorded in telemetry.

Without file access, these layouts reproduce today's prompts. With file access, the host also writes game reports to a read-only records folder. The simple strategist keeps a smaller core prompt and reads detailed reports when needed. Other agents keep their current inline information and gain access to the records.

Records preserve the reports from each processed turn, including turns skipped by pacing. Agents can consult earlier turns after they leave the in-memory cache. A static reference, fetched once per game, supplies technology, policy, building, and unit listings.

All of these files live in a **workspace store**: a versioned file store kept in one SQLite database per game seat rather than in folders on disk. The database is named after the game and player only, so changing the seat's strategist between sessions keeps the same store. Every change creates a new version, and no version is deleted. Three problems become simpler:

- **Reloads:** when a save is loaded, the seat's records and game notes rewind to the version before the reloaded turn. The discarded timeline stays in history.
- **Oracle replay:** every agent run records the version it saw at its first model step. A replay opens exactly that version, and its own writes are discarded afterward.
- **Images:** the store is binary-safe, which leaves room to send models screenshots in the future.

Reference setup must succeed before the session runs. Record-write failures fail the strategist's turn.

Paths below are relative to `vox-agents/src/` unless they start with `vox-agents/`, `mcp-server/`, or `docs/`.

## Goal and success criteria

- Without `files`, refactored builders produce byte-identical `getSystem` and `getInitialMessages` output, make the same MCP calls, and write nothing to the workspace store.
- With `files`, each processed turn is recorded in the seat's workspace store and exposed as `/workspace/records`. The game's reference is exposed as `/workspace/reference`, and game notes, when the seat has game access, as `/workspace/game`.
- Game notes belong to agent types. Each agent type writes only its own notes folder and can read every other agent type's notes. A seat that switches strategist keeps its store, and the new strategist can read the previous strategist's notes.
- File-mode layouts are used only by runs that declare `bash`. Restricted runs, such as a live envoy's greeting, keep their inline content.
- The simple strategist moves full players, cities, military, and events out of its prompt. It keeps identity, options, strategies, victory progress, a strategic players summary, and directions to the records.
- Reference initialization failures stop the entire session. Turn-record failures prevent that strategist decision from running with missing data.
- Every reload path (a new session loading a save, crash recovery, or a manual reload) rewinds the seat's records and game notes before the reloaded turn is recorded. History is kept.
- Replays open the exact versions their source run saw at its first model step, including briefings archived while the run prepared its prompt. They stay isolated from each other and leave the stores unchanged.
- Without a `prompts` setting, the file-based prompts produce byte-identical `getSystem` output, checked by the same golden tests.
- A `prompts` folder replaces matching built-in files for every agent of the seat. Unknown file names, unknown variables or sections, and missing partials fail at session start.
- Oracle replay still uses the recorded system text and gains no prompt-file dependency.
- `npm run build:all` and `npm run test:all` pass.

## Current state

| Area | Existing behavior and source |
| --- | --- |
| State collection | `refreshGameState` in `strategist/strategy-parameters.ts` fetches players, events, cities, options, victory progress, and military reports. It updates the seat's cached state in place. |
| Turn processing | `strategist/vox-player.ts` calls `ensureGameState` for every processed turn, then applies pacing and optionally runs the strategist. Chat can refresh uncached state independently. |
| Event windows | `state.events` holds a refresh's event slice. `withEventWindowFallback` builds `state.mergedEvents` for a decision covering several turns and narrows it on context overflow. |
| Briefings | `requestBriefing` in `briefer/briefing-utils.ts` deduplicates generation. Outputs enter `state.reports`; staffed strategists subsequently assemble their own combined briefing there. |
| Prompts | Strategists, briefers, and `buildGameContextMessages` assemble Markdown by hand, using `jsonToMarkdown` and each report's `_markdownConfig`. |
| System prompts | `getSystem` implementations build JS template literals from static constants such as `SimpleStrategistBase.goalsPrompt` and `SimpleBriefer.citiesPrompt`, plus a few runtime values and conditional passages. Middleware later appends the workspace, tool-choice, and tool-protocol text. No config field accepts prompt text; the only override is the oracle's code-level `modifyPrompt`. |
| Workspaces | `utils/workspace/player-workspace.ts` mounts game notes, optional shared folders, and scratch space from disk. Game notes are one folder per seat (`workspaces/games/<gameID>-player-<playerID>`), writable by every agent of that seat. The bash tool runs on `just-bash`, a simulated shell: `PlayerWorkspace.open` combines per-mount filesystems into a `MountableFs`, using a read-write filesystem for writable mounts and a read-only `OverlayFs` otherwise. Any backend that implements just-bash's `IFileSystem` contract can be mounted. Bash output is capped at 8,000 characters per stream. The bash tool's description in `utils/tools/bash-tool.ts` lists the seat's mounts, so it depends on the files setting. |
| Telemetry storage | `SQLiteSpanExporter.getDatabase` in `utils/telemetry/sqlite-exporter.ts` opens one better-sqlite3 database per seat, named after the seat's context ID (`<gameID>-player-<playerID>.db`). `VoxPlayer` registers the folder through `createContext` under the strategist's name, so the same seat run by a different strategist writes to a different database. It uses WAL mode, caches the connection until the context closes or the exporter shuts down, and holds a single `spans` table. The gameID persists across save and load, so a reload appends spans to the same database. |
| Agent preparation | `infra/vox-execute.ts` prepares system text, initial messages, and run tools in that order, then resolves triage before the first model step. Staffed strategists request their briefings inside `getInitialMessages`, so briefer runs finish during preparation. `getRunTools` is a pure function of its inputs and adds bash to eligible runs. File-enabled contexts use the seat's `files.quota` (default `defaultFilesQuota` in `strategist/seat-config.ts`) as the step budget. |
| Session startup | `StrategistSession.handleGameSwitched` creates players, registers tools, and starts their loops. It runs only when the gameID changes. A reload of the same game, including crash recovery through `recoverGame`, keeps the existing players. vox-agents learns the loaded turn but not which save file was loaded. Fatal setup failures must use the session's error path because throwing from a notification handler alone does not stop the session. |
| Oracle | `oracle/retriever.ts` extracts the first step's prompt and tools from telemetry, taking the last root span for a turn when a reload repeated it. `oracle/replayer.ts` runs rows, models, and repetitions concurrently, each inside its own root run, using schema-only tools, so a recorded bash call currently performs no file operation. |

The six reports already use the seat's perspective through the MCP tools' `PlayerID` auto-completion. Records reuse those results. `get-opinions` and `get-diplomatic-events` add no necessary data beyond the player and event reports.

## Approach

### Shared knowledge and agent layouts

Add a `knowledge/` directory with three small modules:

- `sections.ts` defines the section keys, titles, descriptions, scope, and optional record splitting.
- `knowledge-set.ts` provides `assembleKnowledge(parameters, state)` over existing state and metadata. It separates `Options` from the remaining strategy fields.
- `layout.ts` renders ordered messages made from text parts, section parts, and a records part.

The section keys are `situation`, `civilization`, `options`, `strategies`, `victory`, `players`, `cities`, `military`, `events`, and `briefings`. Situation and civilization are game-scoped; the others are turn-scoped.

A layout message specifies its role, parts, optional cache breakpoint, and separator. A section part can override its heading, description, view, and Markdown configuration. Each part is visible in both modes, inline mode only, or file mode only. The records part appears only in file mode. Rendering preserves message order and existing whitespace, drops empty messages, and applies the requested cache breakpoint.

Keep agent-specific descriptions and filters in their layouts. Share the common game-context layout used by envoys, analysts, and the negotiator. `buildGameContextMessages` continues to default to inline rendering when called without render options. Agent `getSystem` implementations retain their existing resource descriptions.

Use one assembler rather than separate agent variants or separate file-mode prompt builders. The assembly is synchronous and does not fetch data. Reassemble for each prompt attempt so that updated briefings and the selected event window are reflected.

### Events: record the slice, render the decision window

Keep the distinction that already exists in `GameState`. The knowledge set carries the refresh's events and the selected decision events, which default to the refresh's events when no merged window exists. Record writing uses the former; an inline Events section uses the latter.

For example, after a decision on turn 20, pacing skips turns 21 and 22 and the strategist decides on turn 23:

| Consumer | Events |
| --- | --- |
| Turn 21 record | Turn 21's refresh |
| Turn 22 record | Turn 22's refresh |
| Turn 23 record | Turn 23's refresh |
| Turn 23 inline prompt | The selected decision window, initially turns 21-23 |
| Turn 23 file-mode strategist | Directions to the records covering turns 21-23 |

If an inline attempt overflows and retries with turns 22-23, rendering uses that narrower window. The records stay unchanged. A refresh can also cover a dropped turn; its events retain their real turn keys inside the report. No additional event fetching is needed.

### What each agent sees

| Agent | Inline content with files enabled |
| --- | --- |
| Simple strategist | Identity, options, strategies, victory progress, strategic players summary, decision context, and records directions |
| Briefed, staffed, and learned strategists | Today's inline content plus records directions |
| Simple and specialized briefers | Today's inline content plus records directions |
| Shared game-context users: diplomat, spokesperson, diplomatic analyst, negotiator | Today's inline content plus records directions |

The strategic players summary's fields will be designed after the first revision of this work lands. Until then, the simple strategist's file-mode layout keeps the full players section inline.

`infra/vox-execute.ts` resolves the run's tools with `getRunTools` first, then prepares the system text and initial messages, and stores the resolved list on the execution frame. `contextLayoutMode(context)` reads that list and selects file mode when files are enabled and the run's tools include bash. An undefined tool list means all registered tools. Otherwise it selects inline mode.

The records part names `/workspace/records` and `/workspace/reference`, the recorded turn range, the current turn folder, and the record folders covering events since the last completed decision. That event range stays the same even if an inline retry uses a narrower window. It lists moved sections and their file patterns and points to `CATALOG.md`. Its contents stay fixed during the turn; changing file sizes and newly generated briefings belong in the catalog. This preserves the live envoy's cache boundaries.

Diplomacy background, deals, conversation rows, and historical episode presentation remain in their existing agent contexts. Telepathist and archivist contexts remain without files.

### Prompt files and custom system prompts

Built-in system prompts live in `vox-agents/prompts/`. Each agent's prompt is `<agent-name>.md`, and a variant is `<agent-name>.<variant>.md`. Shared fragments live under `shared/`. The folder is resolved from the module path, so `src` and `dist` both find it without a build copy step.

Files use [Mustache](https://mustache.github.io/mustache.5.html) with HTML escaping turned off, so `&` and `<` in game data stay intact. Mustache is small, has no dependencies, and is logic-less, so a prompt file cannot run code. Its variables, partials, sections, and inverted sections cover every conditional passage in today's prompts. `Mustache.parse` also exposes a token tree for validation. A hand-rolled replacer would need conditionals and a parser for the same result. Handlebars and LiquidJS add more than this needs, and EJS or Eta would execute code from user files.

Prose lives in files. Code passes only data, such as the formatted user description, and flags. Rendered output is trimmed, as today's `.trim()` does. Today's runtime values become these template names:

| Prompt | Runtime values today | In a prompt file |
| --- | --- | --- |
| Simple, briefed, staffed, and learned strategists | `getDecisionPrompt(mode)` picks the decision tool and adds Flavor guidance | A `shared/decision` fragment with a `flavor` section and its inverse |
| Learned strategist | An episodes line when working memory holds an episode request | `episodes` section |
| Specialized briefer | `input.mode` picks Military, Economy, or Diplomacy text | `specialized-briefer.military.md`, `.economy.md`, and `.diplomacy.md` |
| Diplomat and spokesperson | `formatUserDescription` and teammate passages from `getTeammateCounterpart` | `user`, and a `teammate` section over the teammate's fields |
| Negotiator | Leader, civilization, and teammate stance | `leader`, `civilization`, and `teammate` section |
| Diplomatic analyst and summarizer | Leader and civilization | `leader` and `civilization` |
| Talkative telepathist | Leader and civilization; a special message drops the tools passage | `leader`, `civilization`, and an inverted `special` section around the tools text |
| Simple briefer, keyword librarian, evaluator strategist | None | Static |
| None, null, and human strategists; episode retriever; oracle agent | No authored system text, or the recorded text | No file |

A custom prompt does not need to restate text added after `getSystem`. That includes the workspace section, which lists the records and reference mounts, the completion-tool instruction, and the tool protocol added by middleware. The records directions belong to the initial-message layout. Triple-brace special messages, now used only by the telepathist, are user-turn triggers and never appear in system text.

The `prompts` setting names a folder, relative to `vox-agents/` like `configs/`. `resolveSeatPrompts` in `strategist/seat-config.ts` resolves it seat over session over root, as it does for `files`. Runs outside a seat, such as the summarizer and telepathist, use the root setting. Lookup checks the custom folder first, then the built-in one. Partials resolve the same way, so overriding `shared/goals.md` changes every strategist that includes it.

Validation runs at session start and fails through the session's fatal setup path. It requires the following:

- Every `.md` file in the custom folder matches a built-in path, which catches misspelled names.
- Every partial exists.
- A file uses only the names its built-in counterpart uses, including through its partials. The check walks each file's parsed token tree.

Files are read and parsed once per session. Edits take effect in the next session.

Custom prompts replace system text only. Layouts, section descriptions, records directions, reminders, and middleware text stay in code. The resource descriptions become shared fragments, so file mode keeps them. The oracle agent keeps returning the recorded system text, and `modifyPrompt` remains the replay-time override.

### Workspace store

The workspace store is a small versioned file store, implemented in `utils/workspace/workspace-store.ts`. It follows git's object model without git itself: file contents are stored once by hash, each change is a commit pointing to its parent, and a head reference names the current version.

Each seat's store is its own better-sqlite3 database at `<workspaceRoot()>/games/<gameID>-player-<playerID>.db`, in WAL mode. The path depends only on the game and the player, never on the strategist or the telemetry folder. For example, a seat played by `simple-strategist` and resumed in a later session with `staffed-strategist` writes spans to two telemetry databases but opens one seat store, so its notes, records, and reload history carry over. The store keeps one cached connection per path, opened on first use and closed when the seat's context shuts down, after its player loop stops. Copying a seat's game history therefore means copying the seat store alongside its telemetry databases.

| Table | Contents |
| --- | --- |
| `ws_blobs` | File contents keyed by SHA-256 hash, with size and a compressed flag. Identical contents are stored once. Contents are compressed with zlib only when that makes them smaller, following the SQLite Archive convention. |
| `ws_commits` | One row per version: parent commit, game turn, kind (`write`, `reload`, or `import`), author (`host` or the agent name), the authoring span's trace and span IDs, and time |
| `ws_changes` | The paths a commit changed, each with its new blob hash, or none for a deletion |
| `ws_refs` | The `head` reference |

Paths inside a seat store start with `records/`, `game/`, or `reference/`. Game notes sit under `game/<agent>/`, where `<agent>` is the registered name of the agent type that owns them (`VoxAgent.name`, such as `simple-strategist` or `diplomat`). To read a version, each path resolves to its latest change among that commit's ancestors. Keep the head's manifest of paths and hashes cached in memory, so most reads need only a blob lookup.

A commit is one synchronous transaction that applies its path changes on top of the current head. When two writers start from the same version, the later commit wins path by path, as files on disk do today. A writer can also supply derived files, such as the records catalog, that are computed inside the transaction from the resulting tree, so they always describe the commit they belong to. A reader always sees whole commits, never a partly written turn.

**Shared folders** span games, so they cannot live in one seat's database. Each shared folder gets its own store with the same schema at `<workspaceRoot()>/shared/<name>.db`. Shared stores never rewind. Scratch space (`/tmp`) stays an unversioned per-seat folder on disk.

On first open, an empty store imports any existing physical folder for it as one `import` commit, so current notes carry over. A shared store imports its shared folder as is. A seat store imports the seat's old game-notes folder under `game/legacy/`, since those notes predate per-agent ownership. No agent type owns `legacy`, so every agent can read it and none can change it.

### Open-source options

These options were considered before choosing a small in-house store:

| Option | What it offers | Decision |
| --- | --- | --- |
| just-bash filesystems (`MountableFs`, `OverlayFs`, `InMemoryFs`) | Already in use, with a pluggable `IFileSystem` contract | Keep for mounting. The new backend implements the same contract. |
| [AgentFS](https://github.com/tursodatabase/agentfs) (Turso, MIT, beta) | A SQLite-backed agent filesystem with a just-bash adapter and copy-on-write overlays | Not adopted. It stores only the current state, and its [specification](https://github.com/tursodatabase/agentfs/blob/main/SPEC.md) lists history as a future extension. Its Node SDK runs on Turso's pre-release database engine, which would put a second engine on the same WAL file that better-sqlite3 writes. Its overlay idea, which records deletions as whiteouts over a read-only base, is reused. |
| [isomorphic-git](https://isomorphic-git.org/) | Real commits, branches, and refs | Not adopted. It needs a Node-style filesystem and a `.git` object store, so keeping it in the seat store means a filesystem adapter over SQLite beneath git. That is heavy for a commit after every bash command. Its object model is reused. |
| [SQLite Archive](https://sqlite.org/sqlar.html) | A standard table for files inside SQLite, with zlib compression | No history. Its compression convention is reused. |
| Dolt and DoltLite | Versioned database engines | They replace the SQLite engine itself and cannot run under better-sqlite3. |

### Mounting the store

Add `VersionedFs`, a just-bash `IFileSystem` over one store, a path prefix, a base commit, and an access level, optionally limited to one writable subfolder. Reads come from the base version. Writes go to an in-memory overlay of changed paths and deletion whiteouts. Read-only views reject writes with the same error the current read-only mounts give.

`PlayerWorkspace.open` loads the head manifest before constructing the shell, since just-bash lists paths synchronously. After each bash command, it commits the writable views' overlays: one commit to the seat store for game notes, and one per changed shared store. Each command sees one consistent version, and the next command sees the previous command's writes and any host writes committed in between.

With files enabled, a seat can have these mounts:

| Virtual path | Source | When mounted | Access |
| --- | --- | --- | --- |
| `/workspace/records` | Seat store, `records/` | Always | Read-only |
| `/workspace/reference` | Seat store, `reference/` | Always | Read-only |
| `/workspace/game` | Seat store, `game/` | When the seat has game access | Read-only, except the calling agent's own folder |
| `/workspace/shared/<name>` | That shared store | For each configured shared folder | The configured access |
| `/tmp` | Per-seat scratch folder on disk | Always | Writable |

Only the host writes records and the reference, through the store's API.

**Notes by agent type.** `/workspace/game` shows every agent type's notes folder. The calling agent's own folder, `/workspace/game/<agent>`, gets the seat's game access; every other folder is read-only. The bash tool takes the calling agent's name from the active execution frame, so a briefer running inside a strategist's preparation writes to the briefer's folder, not the strategist's. The view rejects writes outside the own folder with the same read-only error as other read-only mounts. For example, `diplomat` can write `/workspace/game/diplomat/relations.md` and read `/workspace/game/simple-strategist/plan.md`, but cannot edit the strategist's file.

The host keeps a read-only `/workspace/game/AGENTS.md` explaining this layout, and seeds the per-folder guide when an agent's own folder is first used. Add the new folders and the ownership rule to the workspace capability instructions, which name the calling agent's own folder, and to the bash mount description, which states the rule without naming an agent so it still depends only on the files setting.

### Records and catalog

Add `SeatRecords` in `knowledge/records.ts`, cached by seat and game on `VoxContext`, writing to the seat store.

The records tree, rooted at `records/` in the seat store, contains:

| Path | Contents |
| --- | --- |
| `CATALOG.md` | Generated section index, turn ranges, file sizes, and query guidance |
| `game/<key>.md` and `.json` | Situation and civilization, written on the first recorded turn |
| `turns/<N>/<key>.md` and `.json` | Complete turn reports |
| `turns/<N>/<key>/<part>.md` | Markdown split by civilization, city owner, military zone, or event category |
| `turns/<N>/briefings/<kind>.md` | Generated briefing text |

Markdown uses `jsonToMarkdown` with the source report's rendering configuration and full data. JSON omits `_markdownConfig`. Agent-specific views affect inline rendering only. Split filenames use readable slugs with collision suffixes.

Reports can exceed the bash output cap even after splitting. The catalog explains how to select smaller pieces with `grep`, `head`, `sed -n`, or `jq`. It lists compressed turn ranges, such as `1-40, 42`, and the latest files' sizes.

`recordTurn(knowledge)` writes the factual sections in one commit. The knowledge set's briefings section is for inline rendering; `recordBriefing(turn, kind, text)` is the sole writer of archived briefings. It commits the briefer's own output when generation resolves, before a strategist's assembled report can replace it. Both supply `CATALOG.md` as a derived file, so the catalog always matches the tree it is committed with. A repeated briefing write keeps the existing file.

Errors propagate to the caller. A record-write failure fails that processed turn, whether pacing would have selected a decision or a skip. The existing turn-error path handles the failure, and the loop can process the next turn. Briefing-write failures propagate through the requesting run as well.

### Reloads

A reload is detected by the records themselves. When `recordTurn` receives turn N and the head already has records for turn N or a later turn, the game was reloaded. This is the only point that rewinds; session and DLL events do not. It covers a new session loading a save, crash recovery through `recoverGame`, and a manual reload. Normal play processes each turn once, so it never triggers a rewind.

To rewind, the store moves head to the last commit made before turn N, adds a `reload` commit there, and then records turn N on top. Records and game notes rewind together because they share one store. The `reload` commit carries forward the static game data, `reference/` and `records/game/`, from the abandoned head, because it describes game settings rather than a point in time and may have been written after turn N. Shared folders do not rewind.

The rewind assumes the seat records the loaded turn first. The turn loop records every processed turn, including paced skips, so this holds in normal play.

For example, the strategist plays to turn 60 and writes "Babylon betrayed us on turn 55" into its notes. The player then loads a turn-50 save. When turn 50 is recorded, head moves back to the last commit from turn 49, so both the turn 50-60 records and that note disappear from the seat's view. They remain in history for analysis and replay.

Between a load and the first processed turn, chats still read and write the old head. Their writes end up only in the abandoned branch.

### Game reference

`StrategistSession.handleGameSwitched` initializes the reference once per game, after registering the seats' tools and before starting any player loops or autoplay, when at least one seat has files enabled. Prepare every seat first, then start the players.

The four listing tools take no `PlayerID`, so one set of calls serves every seat:

| Tool | Arguments | Listing contents |
| --- | --- | --- |
| `get-technology` | `MaxResults: 5000`, no search | Names, help, cost, era, and technologies unlocked |
| `get-policy` | `MaxResults: 5000`, no search | Names, help, branch, level, and era |
| `get-building` | `MaxResults: 5000`, no search | Names, help, cost, prerequisite technology, era, and civilization uniqueness |
| `get-unit` | `MaxResults: 5000`, no search | Names, descriptions, combat values, cost, prerequisite technology, era, and civilization uniqueness |

These are listing results, not complete detailed dependency reports. A query that resolves to exactly one item returns a detailed report instead, so the writer must not assume every result is a listing row. Without files there are no added calls; recording turns and briefings adds no MCP calls.

After all four calls succeed, commit the reference under `reference/` in every file-enabled seat's store. Identical contents are stored once per database, and each seat's database stays self-contained. Skip the calls when every file-enabled seat's head already has a reference, as on a later session of the same game. Any fetch failure, error result, or commit failure stops the entire session through its fatal setup path. Handle both MCP errors and the database tools' returned `Error` field. There is no per-turn reference retry mechanism.

### Telemetry and oracle replay

Record four facts on every agent span:

| Attribute | Meaning |
| --- | --- |
| `context.files` | The context's resolved files setting (game access, shared folders and their access, quota), or `false` |
| `context.layout` | `inline` or `files`: how this run's initial messages were rendered |
| `context.workspace` | The seat store's head commit and each mounted shared store's head commit at the run's first model step, when files are enabled |
| `context.prompts` | The resolved custom prompt folder, or `false`, so analysis can group rows by prompt set. Replay ignores it because the recorded system text already contains the custom prompt |

For example, a file-enabled envoy greeting records its files setting and `context.layout = inline`, because that run cannot use bash.

`vox-execute.ts` captures `context.workspace` after preparation (system text, initial messages, run tools, and triage) and immediately before the first model step, not when the agent span opens. A staffed strategist's briefer runs finish inside `getInitialMessages` and archive their briefings, and briefers may write their own notes. Capturing at the span's start would miss both, so a replayed bash call could not find files the live run's first step could read. Each nested briefer run captures its own snapshot before its own first model step. A run that stops before any model step records none.

Commits also record their authoring span, so a note can be traced back to the run that wrote it. The retriever carries these fields into `RetrievedRow`. Missing fields on older rows default to `false` and inline. Replay enables file support from `context.files`, not by inspecting prompt text or inferring it from the layout.

Add a shared `Workspace` interface with `exec(command, signal)`. `PlayerWorkspace` implements it. A root run can carry its own workspace; the bash tool uses the active root run's workspace when one is set and the seat's normal workspace otherwise.

`ReplayWorkspace` builds the original seat's mounts from `VersionedFs` views pinned to the commits in `context.workspace`, with committing disabled, and `/tmp` held in memory. It opens the seat store by the row's game and player, and grants write access only to the notes folder of the row's recorded agent, as the live run had. It is created for each replay execution, including each model variant and repetition, and passed to that task's `withRun`. Writes stay in the views' overlays, persist across that replay's bash calls, and are discarded when the execution ends. Concurrent variants of one source row cannot see each other's writes, and the stores are never modified.

The model sees exactly what the original run saw at its first model step: the turn's records, briefings archived before or during preparation, and every agent type's notes and the shared folders as they were then. Because history is never deleted, rows from a timeline that a reload later discarded replay normally. A row fails without running if its seat store is missing or lacks the recorded commit, or a referenced shared store is missing.

Use the existing oracle context for rows with files disabled and one file-enabled context for each distinct recorded files setting, so each bash tool description matches the original. Each file-enabled context uses the recorded quota, schema-only tools, and a real bash tool registered after schema replacement. Keep the original run's declared tool list, so restricted runs do not gain bash just because the replay context has it. Give the contexts distinct identities, register their telemetry outputs under the oracle experiment, close them all during shutdown, and expose their output locations in the replay result logging.

Replays will more often send the complete recorded conversation, including the original bash calls and their results, so the model makes only the final decision. This plan keeps the oracle's current first-step replay. The pinned workspace still matters for full-history replay, because a model can issue new bash calls after the recorded history ends. Full-history replay needs its own design, especially around which step to cut at and how the replay overlay should reflect writes made by the recorded calls.

### Viewing files outside the game

Notes and records are no longer plain folders on disk. Add a small materialize command that writes a seat store or shared store at a chosen commit, defaulting to head, into a folder. Players use it to read notes, and developers use it to debug replays.

### Screenshots (future work)

This plan does not capture or send images, but the store is designed so that a later change can:

- The host can commit images, such as `records/turns/<N>/screens/<name>.png`, because blobs are binary-safe and the commit API accepts bytes.
- Bash can list images but cannot show them, so a dedicated view tool would return image parts to multimodal models.
- Telemetry would reference an image by its blob hash instead of embedding it in step messages, and replay would load it from `ws_blobs`.
- The capture source, possibly the existing OBS integration, needs its own design.

## Implementation steps

### 1. Capture existing prompts

Create a compact recorded game-state fixture under `vox-agents/tests/fixtures/game-state/`, using local telemetry and cached tool definitions. Include metadata with `YouAre`, all six reports, and their Markdown configurations. Keep any capture script local.

Add temporary golden tests under `vox-agents/tests/mock/prompts/` for the four LLM strategists, the simple briefer, all three specialized briefer modes, and `buildGameContextMessages`. Pre-fill briefings, include a past briefing, fix working-memory instructions, and mock episode retrieval. Capture `getSystem` and `getInitialMessages` before refactoring. Also capture `getSystem` for the diplomat and spokesperson (with and without a teammate), negotiator, diplomatic analyst, talkative telepathist (normal and special message), summarizer, and keyword librarian, and both decision modes for the strategists, since step 2 moves all of them into files.

### 2. Move system prompts into files

Add `mustache` and its types to `vox-agents` from the repository root. Add the prompt loader and renderer in `utils/prompts/prompt-files.ts`, then port every `getSystem` listed above to it while keeping the golden tests unchanged. Remove the old prompt constants and `getDecisionPrompt`.

Add `prompts` to `PlayerConfig` and `StrategistSessionConfig` in `types/config.ts`, the root default in `utils/config/defaults.ts`, and `resolveSeatPrompts`. Add startup validation and the `context.prompts` attribute.

### 3. Introduce sections and layouts

Add the knowledge registry, assembler, and renderer. Port each builder while keeping the golden tests unchanged. Preserve the separate turn and decision event inputs, and render each overflow retry from the current selected window.

Keep `buildGameContextMessages` inline by default. Move `getRunTools` ahead of prompt preparation in `vox-execute.ts` and store the result on the execution frame for `contextLayoutMode`. Add the records part to adopting layouts and mark the simple strategist's moved reports as inline-only.

### 4. Add the workspace store

Implement the store tables, commits, version reads, the head manifest cache, and rewinds in `utils/workspace/workspace-store.ts`, with one database file per seat, keyed by game and player, and one per shared folder. Add `VersionedFs`, the import of existing physical folders (seat notes under `game/legacy/`), and the materialize command.

Switch `PlayerWorkspace` to versioned mounts with a commit after each command. Add the read-only records and reference mounts, and the per-agent notes view that takes the calling agent from the active execution frame. Update workspace capability instructions and bash descriptions.

### 5. Add records and the reference

Implement `SeatRecords`, catalog generation, record splitting, and reload rewinds on top of the store, with the cached records accessor on `VoxContext`.

In `StrategistSession.handleGameSwitched`, register and prepare all players before launching their execution loops, and initialize the game reference there. Route setup failures through the existing fatal session path, including abort and completion signaling; do not rely on an exception escaping a notification callback.

### 6. Connect turn and briefing hooks

- After `ensureGameState` in `vox-player.ts`, record each processed turn when files are enabled, before pacing can skip or the strategist can run.
- In `requestBriefing`, await recording of a newly generated output. Propagate write failures instead of treating them as an unavailable briefing.
- Leave chat state refreshes without turn-record writes.
- Check the perspective comment in `envoy/context/diplomacy-context.ts` against MCP auto-completion and correct it if stale.
- Record `context.files` and the rendered `context.layout` per agent execution, `context.workspace` immediately before the first model step, and the authoring span on each commit.

### 7. Add replay workspaces

Introduce the `Workspace` interface, the root-run workspace, and the pinned replay workspace. Extend oracle retrieval, row types, commit and shared-store checks, replay routing, per-setting contexts, and context lifecycle. Preserve declared tools when restoring file support. Create and discard a replay workspace within each replay task.

### 8. Document and finish

Update these documents alongside implementation:

- `docs/developers/vox-agents/prompts.md`: shared knowledge, layouts, core prompts, records directions, prompt files, Mustache usage, template names per agent, and lookup order.
- `docs/developers/vox-agents/overview.md`: the workspace store, records, the game reference, the catalog, and reload rewinds.
- `docs/developers/vox-agents/oracle.md`: file telemetry, pinned replay workspaces, and replay limitations.
- `docs/players/configuration.md`: records and reference under File workspace, notes stored per seat and per agent type, read-only access to other agents' notes, the materialize command, notes rewinding on reload, and disk use. Also the `prompts` setting: copying and editing a built-in file, the names each agent offers, and a link to the Mustache manual.
- `vox-agents/AGENTS.md`: use layouts over the knowledge set, write workspace files only through the store, and keep system prompt prose in `vox-agents/prompts/` with code passing only data and flags.
- `docs/plans/strategist-orchestrator/02-working-folder.md`: Stage 2 should reuse the knowledge assembler, records, and workspace store.

Remove the temporary golden tests and snapshots after the refactor passes them and file mode is complete. Keep the behavior tests below.

## Verification

Use Vitest with existing mock contexts and temporary telemetry directories. Cover behavior rather than exact prompt wording after removing the golden tests.

| Area | Required checks |
| --- | --- |
| Prompt files | Byte-identical output without a custom folder; Strategy and Flavor modes, teammate, episodes, and special-message sections; overrides of agent files and shared fragments; partials resolved through the custom folder; `&` and `<` in game data left unescaped; independent per-seat folders; the root setting outside seats |
| Prompt validation | An unknown file, an unknown variable or section, and a missing partial each fail at session start, before any player loop |
| Layouts | Placement, ordering, cache breakpoints, empty messages, and inline fallback for runs without bash, using the tools resolved before prompt preparation |
| Events | A paced decision renders several turns while each record keeps its own refresh slice; narrowed retries change only the rendered window |
| Store | Round-trip of text and binary files, deduplication of identical contents, compression only when smaller, reads at an older commit, path-level last-writer-wins, and the same store path for a seat whichever strategist runs it |
| Records | Markdown and JSON output, split files, a turn and its catalog appearing in one commit, a catalog that stays complete when turn and briefing commits interleave, repeat briefing writes preserving files, and correct catalog ranges and sizes |
| Failures | Record-write failure fails the strategist turn before its decision; reference call or commit failure puts the session in error and starts no player loops |
| Reference | Four initialization calls per file-enabled game regardless of seat count, committed only after success, skipped by a later session, and mounted for every file-enabled seat |
| Reloads | Recording an already-recorded turn N, as after crash recovery with the same players, moves head to the last commit before N, rewinds records and notes together, carries forward the reference and `records/game/` even when they were written after N, leaves shared stores alone, and keeps the discarded commits in history |
| Mounts | Records and reference reject writes; each bash command commits its writes, and the next command sees them and any host commits made in between |
| Notes ownership | An agent writes only its own `game/<agent>/` folder and reads other agents' folders; a nested briefer writes to its own folder, not the strategist's; a seat resumed with a different strategist reads the previous strategist's notes and reload history |
| Import | An empty store imports an existing physical notes folder under `game/legacy/`, or a shared folder as is, once |
| Hooks | Paced skips are recorded; chat refreshes do not record turns; files-disabled seats make no extra calls and write nothing to the store |
| Telemetry | Recorded files setting or `false`, correct layout including a file-enabled greeting with an inline layout, and authoring spans on commits; a staffed strategist's recorded commit includes the briefings and briefer notes written during its preparation |
| Replay | Files exactly as of the recorded commits, original mounts and access including the recorded agent's own notes folder, matching bash description, stores unchanged, and writes preserved across commands within one replay |
| Replay checks | A row from a discarded timeline replays; a row with a missing seat store, commit, or shared store fails without running |
| Replay isolation | Two concurrent variants of one source row cannot read each other's notes, shared folder, or scratch writes |
| Replay tools | Recorded files setting controls file support, quota, and bash description; the recorded tool list still controls whether bash is available |

Update existing workspace mount, capability prompt, and bash-tool tests. Run the existing caching, step-budget, envoy, analyst, negotiator, pacing, and oracle suites, then `npm run build:all` and `npm run test:all` from the repository root.

Manually run several turns with a file-enabled simple strategist. Check the core prompt, bash reads, records, reference, catalog, and note commits. Kill the game process mid-run and let crash recovery reload an earlier autosave; verify that, once the reloaded turn is processed, the discarded records and notes disappear from the seat's view and remain in history. Replay a recorded decision and confirm its pinned files and mounts. Materialize a seat store and check the notes. Start a seat with a custom strategist prompt and confirm the recorded system text and `context.prompts`. Restart the same game with a different strategist for that seat and confirm it opens the same store and can read, but not edit, the earlier strategist's notes. Finally, check a files-disabled seat for unchanged prompts and an untouched store.

## Risks and limitations

- **Store growth:** full JSON, Markdown, and split Markdown accumulate throughout a game, and nothing is deleted, including discarded timelines. Deduplication and compression reduce the cost. Measure the implemented output before documenting a size estimate.
- **Manifest cost:** each bash command loads the head manifest. The in-memory cache keeps this cheap for the live seat; replays build their pinned manifest once per execution.
- **Latency:** the simple strategist may spend more steps reading reports. It uses the existing files quota and compaction behavior.
- **First recorded view:** records keep the turn loop's refresh. Later events enter a later refresh, under their real event-turn keys.
- **Reload window:** the rewind happens when the reloaded turn is first processed, so chats in between can still read the discarded records and write notes that end up in the abandoned branch.
- **Shared folders across reloads:** shared stores never rewind, so they can keep knowledge from a discarded timeline.
- **Portability:** the seat store is a separate file from telemetry. Replaying a file-enabled row needs its telemetry database, its seat store, and any shared stores it mounted.
- **Separate notes per agent:** agent types no longer edit a common notes folder. Knowledge one agent wants another to act on must be written in its own folder and read by the other. A new strategist on a resumed seat starts with an empty own folder and reads the previous strategist's notes.
- **Snapshot gap:** a live run's first bash call can see commits made after its snapshot, such as host writes during its first model call. Replay shows the snapshot, so such files can differ.
- **Custom prompt quality:** a replacement can drop essential instructions, such as which decision tool to call. Including `shared/decision` and the other shared fragments avoids this. Validation checks names and partials, not meaning.
- **Notes off disk:** players read notes through the materialize command instead of opening a folder directly.

## Out of scope

- Configurable core-section lists or new agent variants.
- Moving briefing inputs, conversation history, or deal context out of their current prompts.
- Additional reference-detail queries beyond the four listings.
- Retention, pruning, or compaction of store history, and cross-game continuity of notes.
- Screenshot capture, the image view tool, and image references in telemetry.
- A file browser in the web UI.
- Custom initial-message layouts and section descriptions; the same Mustache files can carry them later.
- Prompt editing in the web UI.
- The telepathist's special-message instructions, which are user-turn text rather than system text.
- Re-rendering recorded file-mode prompts inline for oracle experiments.
- Full-history oracle replay that continues from a later recorded step.
- The orchestrator's offline renderer; it should reuse this work later.
