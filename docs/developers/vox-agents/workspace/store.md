# Workspace store

A seat with [files](files.md) enabled keeps records, notes, and the game reference in a versioned SQLite store. `WorkspaceStore` in `src/utils/workspace/workspace-store.ts` stores contents by hash and links each commit to its parent. Reloading an older save changes the visible history while retaining discarded commits.

The store's tables sit inside the seat's telemetry database, `<telemetryDir>/<strategist>/<gameID>-player-<playerID>.db`, next to the `spans` table. One file holds a seat's whole game, so archiving or copying the telemetry file carries the notes and records with it. Telemetry files sit one folder per strategist, so a seat played under one strategist and resumed under another writes to another file. `openSeatStore` in `src/strategist/vox-player.ts` brings the file up to the same-named file with the newest commit in another strategist folder (`WorkspaceStore.findSeed` in `src/utils/workspace/workspace-store.ts`, which skips the `workspaces` folder):

| The opened file | What happens |
| --- | --- |
| Has no store | The whole store is copied, with the same commit IDs and history. |
| Holds an earlier copy of the newer store, as when a seat switches back to a strategist it used before | The newer commits are appended and head moves to the newer store's head. Its own commits keep their IDs, so replays of its spans still read the versions they recorded. |
| Has a history that differs from the newer store | It is left as it is, with a warning. |

Notes, records, and reload history follow the seat, and each telemetry file stays self-contained. Stores left over in the old `workspaces/games/` folder are ignored: nothing imports or deletes them. Shared folders stay on disk at `<telemetryDir>/workspaces/shared/<name>` and scratch at `workspaces/scratch/`.

## Writers

| Writer | Stored folder | Agent access |
| --- | --- | --- |
| `SeatRecords` and the briefing archive | `records/` | Read-only at `/workspace/records` |
| Bash tool | `game/` | Notes access follows the files setting |
| `writeGameReference` | `reference/` | Read-only at `/workspace/reference` |

Write through these interfaces. Each bash command reads a view of the current head through `src/utils/workspace/store-fs.ts`. `PlayerWorkspace.exec` commits note changes afterward; a cancelled command commits nothing.

## Records

`VoxPlayer` records each processed refresh before pacing can skip its decision. A failed record write fails that turn like a failed refresh.

| Path under `records/` | Contents |
| --- | --- |
| `turn-<N>/<section>.md` and `.json` | Pairs for per-turn [game-state reports](../framework/prompt-files.md#game-state-sections). Split reports, event category views, and briefings are Markdown only. |
| `turn-<N>/players/player-<ID>.md` | Per-player reports. Unmet, defeated, and barbarian players remain in the combined report under Other players. |
| `turn-<N>/cities/player-<ID>.md` and `turn-<N>/cities/others.md` | Cities grouped by civilization; other owners share `others.md`. |
| `turn-<N>/events-*` | All events plus economic, military, diplomatic, and others views. Category views retain system events as turn markers. |
| `turn-<N>/briefings/<kind>.md` | Archived briefings. |
| `game/` | Game-wide situation and civilization reports. |
| `CATALOG.md` | Section index, recorded turn ranges and gaps, briefing-only turns, and latest file sizes. Rebuilt on turn and briefing commits. |

Each turn folder represents a processed refresh; events inside retain their actual turn keys and can include earlier turns. `requestBriefing` in `src/briefer/briefing-utils.ts` archives each briefing before publishing it to the game state. Report splitting and the catalog are defined in `src/knowledge/records.ts` and `sections.ts`.

## Game reference

Before player loops start, `StrategistSession` calls `writeGameReference` in `src/knowledge/reference.ts` for file-enabled seats. It fetches technologies, policies, buildings, and units through the MCP database tools in detailed mode and writes Markdown/JSON pairs.

| Category | Buckets |
| --- | --- |
| Technologies | Era |
| Units | Era; `other` for units with neither an unlocking technology nor a production cost |
| Buildings | `corporations` for corporation buildings; era for technology unlocks; otherwise `religious` for belief unlocks or `other` |
| Policies | Branch, or `other` without one |

Missing eras default to ancient; unknown eras go to `other` with a warning. Empty buckets have no files. Technologies, buildings, and units sort by cost then name; policies sort by level then name.

Markdown uses the game's tooltips plus facts the tooltip lacks. JSON keeps the cleaned gameplay fields, excluding internal identifiers, advice, and fields already represented by the bucket or sorting. `src/knowledge/reference-format.ts` handles Markdown formatting. Unit, building, and technology help comes from the mod's [VoxDeorumReferenceTooltips](../../civ5-mod/lua-hooks.md); a missing tooltip fails the detailed listing and session setup. Policies use localized help and may omit it when empty.

A reference is reused when its format marker is current and every category has a Markdown file with a JSON twin. An outdated or incomplete reference is replaced in one commit per store. All fetches finish before any store is written, so fetch failures preserve existing references. If a store cannot open or reference preparation fails, setup stops before player loops start and prepared players are disposed.

The reference is part of each recorded commit. Shared folders and `/tmp` remain outside the store.

## Timeline and reloads

`VoxPlayer.beginTimeline` in `src/strategist/vox-player.ts` starts the timeline when a player is created and when a real turn notification arrives at or below the last processed turn. It cancels active runs, clears cached states and working memory, resets decision and event cursors, and rewinds the store. Records and notes from the reload turn onward leave the visible history.

The rewind retains discarded commits and carries the current reference into a new reload commit, including its current deletions. Reloads therefore preserve reference updates made after the restored save.

The lowest pending reload turn is applied before the next processed turn, even if the seat was busy when it arrived. A failed rewind leaves the reload pending for retry. The human seat's first real notification for its startup turn confirms startup; a DLL reconnection clears that confirmation so a recovered notification can trigger a reload.

## Reading the store from outside

Export through the CLI or dashboard:

| Tool | Use |
| --- | --- |
| `npm run workspace -- materialize <telemetryDb> <outDir> [commit]`, from `vox-agents/` | Export the head or a specified commit of a seat telemetry database into a new or empty folder. |
| Download files in the telemetry page's past-games table | Export a zip through `GET /api/telemetry/db/<path relative to the telemetry folder>/workspace`, with an optional `commit` query. The button shows for databases that hold a store (`hasWorkspace` is read from the file itself), and the zip is named `<gameID>-player-<playerID>-<commit>.zip`. |

Both use `src/utils/workspace/materialize.ts` to read a complete commit through a separate read-only connection in one transaction. Exports work during a session and include `records/`, `game/`, and `reference/`. Editing an export does not change the store.
