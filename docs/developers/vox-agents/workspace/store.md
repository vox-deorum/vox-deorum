# Workspace store

A seat with [files](files.md) on keeps its records, notes, and game reference in one SQLite file, the **workspace store**. It works like a small version-control system: file contents are stored once by hash, and every change is a commit with a parent. So the store keeps full history, can be read at any past version, and can be rewound when the player reloads an older save.

```
commit 1 (records, turn 1) ──► commit 2 (notes) ──► commit 3 (records, turn 2) ──► ...
                                                         ▲
                                     a reload to turn 2 rewinds the head here
```

`WorkspaceStore` (`src/utils/workspace/workspace-store.ts`) is the class. The file is `<telemetryDir>/workspaces/games/<gameID>-player-<playerID>.db`.

## Who writes it

Only three things write to the store:

| Writer | Writes | Where it is mounted |
| --- | --- | --- |
| `SeatRecords` (`src/knowledge/records.ts`) and the briefing archive | `records/` | `/workspace/records`, read-only to agents |
| The bash tool | `game/` (the agents' notes) | `/workspace/game` |
| `writeGameReference` (`src/knowledge/reference.ts`) | `reference/` | `/workspace/reference`, read-only to agents |

The bash view is `src/utils/workspace/store-fs.ts`. Each command rebuilds its folders from the head version. A command that changes notes makes one `notes` commit afterward. A cancelled command commits nothing.

Switching strategists on the same seat keeps the same store. Notes folders from before the store existed are not imported.

## Records

Each processed turn is recorded before pacing decides whether to skip, so skipped turns have records too. A failed record write fails that turn, like a failed game-state refresh.

| Path | Holds |
| --- | --- |
| `records/turn-<N>/<section>.md` and `.json` | One pair per [game-state section](../framework/prompt-files.md#game-state-sections). |
| `records/turn-<N>/...` (extra parts) | Players and cities are also split into smaller Markdown files, by civilization and by city owner. Unmet, defeated, and barbarian players get no split file; the shared Players section renderer (`src/knowledge/sections.ts`) lists them at the end under an `Other players` heading, in every prompt and in `players.md`. |
| `records/turn-<N>/events-*` | Events as `events-all`, plus four category views: economic, military, diplomatic, and others. Each view also keeps system events, such as turn starts and ends, as turn markers. A view whose own category has no events says there are no events in that category. |
| `records/turn-<N>/briefings/<kind>.md` | Briefings. See below. |
| `records/game/` | Game-wide `situation` and `civilization` files. |
| `records/CATALOG.md` | Rebuilt in each turn and briefing commit. It holds the section index, listing the Briefings section only when the seat has briefing files, the note that each complete report has a JSON twin, recorded turn ranges, missing processed-turn folders, turns that have only briefings, and the latest file sizes. |

**Briefings.** `requestBriefing` in `src/briefer/briefing-utils.ts` writes each briefing to the records before publishing it to the game state. So no caller ever sees a briefing that was not archived.

## Game reference

Before any player loop starts, `StrategistSession` calls `writeGameReference` (`src/knowledge/reference.ts`) for file-enabled seats. It fetches technologies, policies, buildings, and units through the MCP database tools in `Detailed` mode. Technologies, buildings, and units get one Markdown and JSON pair per era, such as `reference/units/ancient.md` and `.json`; the eras are `ancient`, `classical`, `medieval`, `renaissance`, `industrial`, `modern`, `atomic`, and `information`. Policies get one pair per branch, such as `reference/policies/tradition.md`. Buildings get two extra buckets: `corporations.md` holds a corporation's headquarters, offices, and franchises, and `religious.md` holds buildings no technology unlocks that a belief opens for faith purchase, such as the Cathedral and the Apostolic Palace. A building no technology unlocks and no belief opens, such as the Palace, the Monument, or a policy building, goes in `other.md`, as do units no technology unlocks and that have no production cost, such as great people and faith units, and branchless policies. A technology building stays in its era even when a belief also lets players buy it with faith. Entries without an era, such as starting units, go in `ancient`, matching what the database tools report for the other categories. An unknown era goes in `other` and logs a warning. Empty buckets get no file.

`hasGameReference` keeps an existing reference when the store holds the current `reference/.format-version` marker and at least one Markdown file with its JSON twin in every category folder. The version is now 4, so stores written in the earlier format rebuild. A refresh replaces the entire reference in one commit per store. All four fetches finish before any store is written, so a fetch failure preserves the previous reference.

The help text comes from the game itself: units, buildings, and technologies carry the in-game tooltip as `Help`, fetched through the bridge from the mod's `VoxDeorumReferenceTooltips` (see [lua-hooks.md](../../civ5-mod/lua-hooks.md)). Policies keep their localized help with the line that only repeats the policy name removed. A policy without help text has no `Help` field. A missing or blank game tooltip for any requested unit, building, or technology fails the detailed listing and reference write, naming the affected entry. A tooltip problem stops the session during setup like any other reference failure.

Each entry drops nulls, empty strings, false, -1, `None`, and empty arrays or objects. Zero is dropped for combat, range, maintenance, happiness, defense, and hit-point fields. `Type`, `AIType`, `Strategy`, and `Description` are omitted, and entries drop the `Era` and `Branch` fields because the file name carries them. Policy `Level` is used only for sorting. Gameplay facts such as costs, prerequisites, resources, promotions, and upgrades remain, and a unique unit or building names the standard one it replaces in `Replaces`. Barbarian-only units never reach the reference because `get-unit` doesn't list them. Within a file, technologies, buildings, and units are ordered by cost then name, and policies by level then name.

Each file opens with a title naming the category and the bucket, such as `# Units: Ancient Era` or `# Policies: Fealty (Medieval Era)`. A Markdown entry is a level-two name heading, a blank line, then one list: first the facts the game's tooltip lacks, with plain labels, then the tooltip. Every tooltip line becomes a list item, and a label ending in a colon ahead of bullets becomes an item with those bullets nested under it. Separator and blank lines are dropped, so blank lines appear only around headings, and the label "List of possible boosts to this Building" is shortened to "Possible Boosts". The facts kept per category when a tooltip exists are: technologies, Cost and prerequisite techs; policies, prerequisite policies; buildings, none, because the tooltip already names the unique civilization, the replaced building, and the wonder limits; units, upgrade source and target and maintenance. An entry without a tooltip lists every fact. Entries that share a name each get a heading suffix: their civilization, or else their position among the duplicates. The JSON twin keeps every fact: an indented array with `Name` first, gameplay facts next, and `Help` last. Both formats end with a newline.

Because the reference lives in the store, a recorded commit holds everything the seat's bash workspace showed except shared folders and `/tmp`. Oracle replay and the exports below need no other files.

**Setup failures.** If a store cannot open or the reference write fails, the session stops before any loop starts. A session stopped during setup starts none. In both cases `VoxPlayer.dispose` shuts down each prepared player's context and closes its store.

## Timeline and reloads

When the player loads an earlier save, the seat should forget what happened after that point. `VoxPlayer.beginTimeline` (`src/strategist/vox-player.ts`) starts the seat's timeline at a given turn:

1. Cancels the seat's active runs.
2. Clears its cached game states, working memory, and decision cursor.
3. Resets the event window.
4. Rewinds the store, so records and notes from that turn onward disappear from the seat's view.

Nothing is deleted. The discarded commits stay in the file. The reference does not depend on the turn, so the `reload` commit keeps the store's current reference: files the discarded commits added or changed come back at that state, and files they deleted stay deleted. This matters for stores that got the reference only after some turns were recorded.

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

Both read through a separate read-only connection inside one transaction (`src/utils/workspace/materialize.ts`), so they see a whole commit and work while a session is writing. The output includes the stored `records/`, `game/`, and `reference/` folders. Editing the output does not change the store.
