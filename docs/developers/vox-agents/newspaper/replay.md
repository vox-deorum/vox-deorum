# Newspaper replay and evidence

Replay reads a recorded MCP SQLite database for a receiving civilization at a selected cutoff. It runs through the normal VD web server and needs no running game, bridge, or live MCP connection for evidence reads. Settings and the cursor live in memory until the server stops or another recording is opened. Publication generation and durable replay output belong to later editorial work.

## Open a recording

Build MCP before checking or running Vox Agents because replay imports its compiled queries. Build the newspaper browser assets with `npm run build:newspaper --workspace=vox-agents`, start VD as usual, and open `/newspaper/` on the address reported by the VD server. A source checkout can start the server with `npm run dev --workspace=vox-agents`. The standalone Vite preview serves the shell but does not supply replay routes.

Enter the database path as seen by the server, receiving player ID, inclusive first and last turns, and publication interval. Durations default to recorded turns. Choosing Standard pace turns converts the publication interval and comparison duration once when opening the recording. Conversion rounds to recorded turns and keeps the interval at least one turn. A zero comparison duration omits comparison history.

Pace uses a recognized recorded `gameSpeed` name first: Quick, Standard, Epic, or Marathon. Otherwise an explicit positive multiplier override applies. Missing or unrecognized names, including localized names, use a labelled Standard assumption when no override is supplied. The response retains the original name, multiplier, source, and label even when durations already use recorded turns.

Inspect cutoff queries without advancing. Before the first check it previews the first configured turn. Next check queries that first turn, then advances by the resolved interval, clamping the last check to the configured end. Events run after the previous check through the cutoff. Comparison snapshots can reach before the configured first turn, bounded at turn zero. Failed reads leave the cursor unchanged; concurrent changes run in arrival order. Opening another recording resets the cursor after its source and metadata have been read successfully. Invalid settings or failure to open the replacement keeps the previous session usable. If closing the previous source fails, replay clears the session and requires configuration again.

## Inspect evidence

The evidence panel lists national snapshots, cities, comparison versions, and supported events. Selecting a row shows its original table, insertion or event ID, recorded turn, timestamp, and permitted values. Inspection works even when no issue has been generated or fixture loading fails. The inspector shows the selected evidence fields; it does not grant access to restricted source fields.

City snapshots retire when a visible recorded capture or raze event identifies their coordinates after the latest city row and through the cutoff. Comparison rows retain their original observations. An event before the requested event window can still retire a city. Unobserved removals cannot retire snapshots. The inspector displays evidence limitations: `cityLifecycleUnresolved` for missing lifecycle coordinates and `cityLifecycleOrderUnknown` for equal same-turn timestamps. Affected snapshots may remain stale. Replay does not infer city continuity from names or nested owner labels.

Fixture selection, the fixture archive, reader state, votes, and link destinations remain available alongside replay. `app/main.ts` coordinates the shell, `api.ts` validates HTTP responses, `replay.ts` owns controls, and `inspector.ts` owns fixture and evidence details. The shared publication reader remains in `reader/mount.ts`.

## Source and HTTP ownership

`replay/database.ts` wraps `knowledge/database.ts`'s read-only opener and JSON decoder. It initializes the lazy connection without SQL so shutdown can release an unused source. Replay performs no schema setup, migrations, writes, or live refresh. `replay/session.ts` owns the connection, settings, cursor, and serialized work queue. Shutdown rejects new work, drains accepted operations, and closes the source. The export application retains its separate queue and shutdown.

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

Recorded player enrichments use their flat sibling IDs for contact checks. Barbarians count as known subjects, while events still require recorded visibility. City labels require an event-specific flat owner field; pantheon cities use `PlayerID`. Liberation events retain their city ID without inferring the city's owner. Deal terms require known subjects and either the receiver's involvement or sufficient recorded diplomat strength for both foreign parties. A third-party war or peace item uses `Data1` as its team ID. If that team is unknown, all readable and structured terms are withheld together.

Event contact uses the final summary available for the event's turn. Normal collection refreshes summaries at the end of the round, after its events, and live tools can refresh them earlier. An incomplete recording or failed final refresh can leave an earlier summary that lacks a same-turn meeting. Those events remain omitted; later-turn contact cannot grant access retroactively. Replay contracts and browser code import only browser-safe evidence contracts from MCP; query implementations stay on the server.

Small SQLite fixtures verify query equivalence, source preservation, cursor ordering, and cleanup. Browser integration exercises evidence inspection with fixture loading unavailable and retains fixture reader checks. Historical completeness and the candidate French recording's story examples still require recording-specific acceptance; replay cannot reconstruct missing observations or distinguish mixed save histories. Recordings do not persist the live alive-player list or elimination dates. A civilization's final summary can therefore remain in cutoff snapshots after elimination; its source turn identifies when it was observed.
