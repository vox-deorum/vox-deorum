# Newspaper replay and evidence

Replay reads a recorded MCP SQLite database for a receiving civilization at a selected cutoff. It runs through the normal VD web server and needs no running game, bridge, or live MCP connection for evidence reads. Settings and the cursor live in memory until the server stops or another recording is opened. Publication generation and durable replay output belong to later editorial work.

## Open a recording

From the repository root:

1. Run `npm run build --workspace=mcp-server`. Replay imports MCP's compiled queries.
2. Run `npm run build:newspaper --workspace=vox-agents` to build the browser assets.
3. Start VD with `npm run dev --workspace=vox-agents` and open `/newspaper/` on the address reported by the server. The standalone Vite preview serves the shell but does not supply replay routes.

Enter the database path as seen by the server, receiving player ID, inclusive first and last turns, and publication interval. Durations default to recorded turns. Choosing Standard pace turns converts the publication interval and comparison duration once when opening the recording. Conversion rounds to recorded turns and keeps the interval at least one turn. A zero comparison duration omits comparison history.

Pace uses a recognized recorded `gameSpeed` name first: Quick, Standard, Epic, or Marathon. Otherwise an explicit positive multiplier override applies. Missing or unrecognized names, including localized names, use a labelled Standard assumption when no override is supplied. The response retains the original name, multiplier, source, and label even when durations already use recorded turns.

| Control | Effect |
| --- | --- |
| Open recording | Reads the source and pace metadata, then resets the cursor. |
| Inspect cutoff | Queries the current window without advancing. Before the first check, previews the configured first turn. |
| Next check | Queries the first turn, then advances by the resolved interval. The last check clamps to the configured end and disables this control. |

Events run after the previous check through the cutoff. Comparison snapshots can reach before the configured first turn, bounded at turn zero. Reloading the page restores settings and the cursor; use Inspect cutoff to reload evidence.

Failed reads leave the cursor unchanged; concurrent changes run in arrival order. Invalid settings or failure to open a replacement keeps the previous session usable. If closing the previous source fails, replay clears the session and requires configuration again.

## Inspect evidence

The evidence panel lists national snapshots, cities, comparison versions, and supported events. Selecting a row shows its original table, insertion or event ID, recorded turn, timestamp, and permitted values. Inspection works even when no issue has been generated or fixture loading fails. The inspector shows the selected evidence fields; it does not grant access to restricted source fields.

City snapshots retire when a visible recorded capture or raze event identifies their coordinates after the latest city row and through the cutoff. Comparison rows retain their original observations. An event before the requested event window can still retire a city. Unobserved removals cannot retire snapshots. The inspector displays evidence limitations: `cityLifecycleUnresolved` for missing lifecycle coordinates and `cityLifecycleOrderUnknown` for equal same-turn timestamps. Affected snapshots may remain stale. Replay does not infer city continuity from names or nested owner labels.

Fixture selection, the fixture archive, reader state, votes, and link destinations remain available alongside replay. `app/main.ts` coordinates the shell, `api.ts` validates HTTP responses, `replay.ts` owns controls, and `inspector.ts` owns fixture and evidence details. The shared publication reader remains in `reader/mount.ts`.

## Source and HTTP ownership

`replay/database.ts` wraps the read-only opener in `knowledge/database.ts`, inheriting its JSON decoding. It initializes the lazy connection without SQL so shutdown can release an unused source. Replay performs no schema setup, migrations, writes, or live refresh. `replay/session.ts` owns the connection, settings, cursor, and serialized work queue. Shutdown rejects new work, drains accepted operations, and closes the source. The export application retains its separate queue and shutdown.

`replay/http.ts` mounts through the existing newspaper host hook with its own JSON parser before API fallbacks and the server's general parser. Routes are loopback-only. Paths below are relative to `/api/newspaper/replay`.

| Method and path | Request | Response |
| --- | --- | --- |
| PUT `/` | Database path, receiver player ID, first/last turns, publication interval; optional duration unit, comparison duration, and speed multiplier override | Session settings, resolved pace, converted durations, and reset cursor |
| GET `/` | None | Current session state |
| POST `/evidence` | None | Session state and MCP evidence for the current window, without cursor change |
| POST `/advance` | None | Session state and MCP evidence after the next accepted check |

`contracts/replay.ts` names the serialized settings as `databasePath`, `receiverPlayerID`, `fromTurn`, `toTurn`, `publicationInterval`, `durationUnit`, `comparisonTurns`, and `speedMultiplierOverride`. Duration units are `recordedTurns` or `standardTurns`. Evidence responses pair `session` with `evidence`, reusing MCP's schemas. Errors use the common JSON error envelope. On first load, an unconfigured session prompts for a recording; an unavailable replay host prompts to start the normal VD server. Invalid settings or source opening return 400, absent configuration or exhaustion return 409, and shutdown returns 503. Unexpected query failures return 500 without advancing the cursor.

MCP's `newspaper/queries.ts` takes an explicit connection and recorded-turn request. It starts from the latest summaries before the requested window and folds bounded versions forward, retaining dated permission context for older national observations. Its `projection.ts` owns all historical visibility and field policy. Policy branches follow the live player report: basic access reveals branch counts, while full access or sufficient recorded diplomat strength reveals policies. Both access paths retain source references and decode JSON fields. Writable database setup adds a Turn-leading event index; replay can read older recordings without creating it.

The live-database `get-newspaper-evidence` MCP tool accepts `PlayerID`, previous-check turn, cutoff, and optional comparison range. Agent autocomplete supplies `PlayerID` from the acting civilization and the adapter maps it to the shared request's `receiverPlayerID`. The live adapter rejects cutoffs at or after the current game turn so the selected round can finish collecting events and contact. Offline replay retains the caller's cutoff semantics.

Event policy lives in one config table, `newspaperEventConfigs` in `projection.ts`. An event type without a config is never reported. Each event needs recorded visibility, and its config sets the remaining rules:

| Config setting | Effect | Used by |
| --- | --- | --- |
| Fields | Payload fields copied into evidence. Other fields never reach the editor. | Every event |
| Subjects | Player and team ID fields the receiver must have met. A team counts as met only when every member has been met. Barbarians always count as met. | Every event |
| Report when involved | Report the event when the receiver or its team is a subject, even if another subject is unmet. | War declarations and peace, which share one policy |
| Insight | Full recorded access to the subject player, or enough recorded diplomat points (200). | Policy adoption |
| Cities | Nested city labels, each kept only when the owner field the config names is a met player. Liberation keeps its city ID but no label, because the city's owner at that point is not recorded. | Captures, flips, trade routes, plunder, pantheons, holy cities, conversions |
| Deal terms | Readable and structured terms are copied together, or not at all. They need every party and every named team met, plus the receiver as a party or enough diplomat points (800) with both foreign parties. A third-party war or peace item names its team in `Data1`. | Deals |

Recorded player names and civilizations are kept only for met subjects, matched through their flat sibling ID fields.

Event contact uses the final summary available for the event's turn. Normal collection refreshes summaries at the end of the round, after its events, and live tools can refresh them earlier. An incomplete recording or failed final refresh can leave an earlier summary that lacks a same-turn meeting. Those events remain omitted; later-turn contact cannot grant access retroactively. Replay contracts and browser code import only browser-safe evidence contracts from MCP; query implementations stay on the server.

## Verified self-play recording

On November 16, 2026, replay was exercised through the normal VD web server against `mcp-server/archive/self-play/0d749c4f-69a7-4682-81b3-8fa70f38c012_1794782175768.db`. Use the full knowledge database; the accompanying `-player-7.db` contains agent telemetry. The recording reports VP 5.2.7, DLL build `build-5.2.7-20261108-042403-54caaa5`, and Standard pace.

To repeat the run, enter the database's absolute path and these settings:

| Setting                   | Value                                          |
| ------------------------- | ---------------------------------------------- |
| Receiver                  | `7`, the Netherlands                           |
| First / last turn         | `0` / `440`                                    |
| Publication interval      | `5`                                            |
| Comparison duration       | `10`                                           |
| Duration units            | Recorded turns                                 |
| Speed multiplier override | Leave empty; recorded Standard resolves to `1` |

All 89 checks succeeded, returning 4,048 distinct events. Source checks matched 68,039 returned references, including repeated comparison observations, to 30,805 original SQLite rows. IDs, turns, timestamps, recorded visibility, and sampled raw values matched; events stayed within their windows without duplication. At cutoff 250, HTTP evidence exactly matched a direct call to MCP's shared query. The source database's SHA-256 was identical before and after replay.

Selected results below count all permitted subjects, including city-states. Events cover the five turns after the preceding check; comparison rows fall within the inclusive ten-turn lookback.

| Cutoff | National snapshots | City snapshots | Comparison national / city rows | Events |
| --- | --- | --- | --- | --- |
| 125 | 9 | 24 | 99 / 262 | 6 |
| 200 | 14 | 31 | 116 / 305 | 60 |
| 300 | 25 | 75 | 264 / 815 | 57 |
| 440 | 25 | 74 | 141 / 750 | 113 |

The source inspector exposes concrete inputs for later story detectors:

| Example | Source | Recorded evidence |
| --- | --- | --- |
| Domestic city | `CityInformations` row `9162`, turn 200 | Amsterdam has population 17, science per turn 92, and University production with one turn left. |
| Trade | `PlayerSummaries` row `6486`, turn 200 | Amsterdam to Istanbul yields `FromGold: 38.03`; Amsterdam to Groningen carries `ToProduction: 11.25`. Unavailable yields retain their `-1` sentinels. |
| Foreign culture | `PlayerSummaries` row `6484`, turn 200 | The Ottomans have culture per turn 279 and tourism per turn 56.5. Basic access exposes policy branch counts. |
| City capture | `GameEvents` row `247000938`, turn 247, inspected at cutoff 250 | The Netherlands captures Stuttgart from barbarians at coordinates `(6, 14)`. The evidence retains the original event date. |

For the separate browser pass, set first turn to 125 and last turn to 138, keeping the other settings above. Headless browser checks verified source selection at turn 125 without advancing, checks at 125, 130, 135, and the clamped endpoint 138, and restoration of the finished session after reload. The HTTP pass also confirmed that preview succeeds after exhaustion and a missing replacement path returns 400 while preserving the existing cursor.

Local acceptance artifacts are in `.tmp/newspaper-replay-20261116/`: the runner, `report.json`, selected cutoff responses, and a browser screenshot. Repeat the local scripted checks from the repository root with `node --import tsx .tmp/newspaper-replay-20261116/acceptance.ts`.

Small SQLite fixtures separately cover query equivalence, cleanup, failure ordering, and visibility boundaries. Browser integration also covers evidence inspection when fixture loading fails.

This recording returned no city-lifecycle limitation flags. Historical completeness remains limited by missing observations and mixed save histories. Recordings omit the live alive-player list and elimination dates, so final summaries can persist after elimination. At cutoff 440, India's retained summary is from turn 266 and Assyria's is from turn 327. Read each source turn as the observation date. Publication generation and editorial story acceptance remain pending.
