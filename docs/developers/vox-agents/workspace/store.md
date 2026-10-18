# Workspace store

A seat with [files](files.md) enabled keeps records, notes, and the game reference in a versioned SQLite store. `WorkspaceStore` in `src/utils/workspace/workspace-store.ts` stores contents by hash and links each commit to its parent. Reloading an older save changes the visible history while retaining discarded commits.

The store is `<telemetryDir>/workspaces/games/<gameID>-player-<playerID>.db`. Switching strategists on the same seat keeps it. Older notes folders are not imported.

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
| `npm run workspace -- materialize <gameID> <playerID> <outDir> [commit]`, from `vox-agents/` | Export the head or a specified commit into a new or empty folder. |
| Download files in the telemetry page's past-games table | Export a zip through `GET /api/telemetry/workspace/:gameID/:playerID/download`, with an optional `commit` query. |

Both use `src/utils/workspace/materialize.ts` to read a complete commit through a separate read-only connection in one transaction. Exports work during a session and include `records/`, `game/`, and `reference/`. Editing an export does not change the store.
