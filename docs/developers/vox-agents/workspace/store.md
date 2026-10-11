# Workspace store

A seat with [files](files.md) on keeps its records and notes in one SQLite file, the **workspace store**. It works like a small version-control system: file contents are stored once by hash, and every change is a commit with a parent. So the store keeps full history, can be read at any past version, and can be rewound when the player reloads an older save.

```
commit 1 (records, turn 1) ──► commit 2 (notes) ──► commit 3 (records, turn 2) ──► ...
                                                         ▲
                                     a reload to turn 2 rewinds the head here
```

`WorkspaceStore` (`src/utils/workspace/workspace-store.ts`) is the class. The file is `<telemetryDir>/workspaces/games/<gameID>-player-<playerID>.db`.

## Who writes it

Only two things write to the store:

| Writer | Writes | Where it is mounted |
| --- | --- | --- |
| `SeatRecords` (`src/knowledge/records.ts`) and the briefing archive | `records/` | `/workspace/records`, read-only to agents |
| The bash tool | `game/` (the agents' notes) | `/workspace/game` |

The bash view is `src/utils/workspace/store-fs.ts`. Each command rebuilds its folders from the head version. A command that changes notes makes one `notes` commit afterward. A cancelled command commits nothing.

Switching strategists on the same seat keeps the same store. Notes folders from before the store existed are not imported.

## Records

Each processed turn is recorded before pacing decides whether to skip, so skipped turns have records too. A failed record write fails that turn, like a failed game-state refresh.

| Path | Holds |
| --- | --- |
| `records/turn-<N>/<section>.md` and `.json` | One pair per [game-state section](../framework/prompt-files.md#game-state-sections). |
| `records/turn-<N>/...` (extra parts) | Players, cities, and military are also split into smaller Markdown files. |
| `records/turn-<N>/events-*` | Events as `events-all`, plus economic, military, diplomatic, others, and system files. |
| `records/turn-<N>/briefings/<kind>.md` | Briefings. See below. |
| `records/game/` | Game-wide `situation` and `civilization` files. |
| `records/CATALOG.md` | A list of what exists. |

**Briefings.** `requestBriefing` in `src/briefer/briefing-utils.ts` writes each briefing to the records before publishing it to the game state. So no caller ever sees a briefing that was not archived.

## Game reference

The reference is separate from the store. It is written once per game and shared by every seat.

Before any player loop starts, `StrategistSession` calls `writeGameReference` (`src/knowledge/reference.ts`). It writes technologies, policies, buildings, and units from the game database, as Markdown and JSON, into `games/<gameID>/reference/`. It writes to a temporary folder first and renames it, so seats never see a half-written reference. Every file-enabled seat mounts it read-only.

**Setup failures.** If a store cannot open or the reference write fails, the session stops before any loop starts. A session stopped during setup starts none. In both cases `VoxPlayer.dispose` shuts down each prepared player's context and closes its store.

## Timeline and reloads

When the player loads an earlier save, the seat should forget what happened after that point. `VoxPlayer.beginTimeline` (`src/strategist/vox-player.ts`) starts the seat's timeline at a given turn:

1. Cancels the seat's active runs.
2. Clears its cached game states, working memory, and decision cursor.
3. Resets the event window.
4. Rewinds the store, so records and notes from that turn onward disappear from the seat's view.

Nothing is deleted. The discarded commits stay in the file.

**When it runs:**

- When the player is created.
- On a reload: a real turn notification at or below the last processed turn.

**Details:**

- The lowest reload turn stays pending, even while the seat is busy. The next processed turn begins the new timeline from there, before its run starts.
- A failed rewind fails that turn and is retried on the next one.
- The human seat's early turn-0 notification only confirms startup and does not count as a reload. A DLL reconnection clears that confirmation, so a notification recovered afterward does count as a reload.

## Reading the store from outside

The store file is not meant to be opened by hand. Two tools export it as ordinary files:

| Tool | Use |
| --- | --- |
| `npm run workspace -- materialize <gameID> <playerID> <outDir> [commit]` | Writes the head version, or the given commit, into a new or empty folder. Code: `src/utils/workspace/console.ts`. |
| "Download files" on the dashboard's telemetry page (past games table) | The same, as a zip, through `GET /api/telemetry/workspace/:gameID/:playerID/download` with an optional `commit` query. Code: `src/web/routes/telemetry.ts`. |

Both read through a separate read-only connection inside one transaction (`src/utils/workspace/materialize.ts`), so they see a whole commit and work while a session is writing. The output has `records/` and `game/` folders. Editing the output does not change the store.
