# Newspaper replay and evidence

Replay reads a recorded MCP SQLite database and produces authored newspaper issues without a running game, bridge, or live MCP connection. A separate offline SQLite output stores completed checks, immutable issues, article evidence, decisions, votes, preferences, and the cursor. Restarting VD and resuming the saved run continues its history.

## Generate examples from the command line

Use the newspaper command from the repository root to replay a recording without starting VD or Civilization V. Each run builds MCP's queries before loading replay, and PNG previews also build the reader. Help and argument errors skip builds:

```sh
npm run newspaper -w vox-agents -- --help
```

Preview builds replace the shared `dist-newspaper` assets. Generate previews while VD is stopped, and rerun the command if a build is interrupted before restarting VD.

This example checks a Standard pace Netherlands recording every five turns from 24 to 99. At turn 29, the stock catalogue prints the upbeat settler story from Amsterdam: “Good cheer in Amsterdam as settlers prepare to go.” The command previews that issue as a PNG and saves the audit for every check:

```sh
npm run newspaper -w vox-agents -- --database mcp-server/archive/self-play/0d749c4f-69a7-4682-81b3-8fa70f38c012_1794782175768.db --player 7 --from 24 --to 99 --every 5 --output .tmp/newspaper-examples/netherlands --render-turns 29
```

Recordings are local development data. Substitute another recorded MCP database when these files are unavailable. Paths are relative to the directory where you invoked npm. Each run needs a new or empty output directory, keeping earlier examples available for comparison.

| Option | Meaning |
| --- | --- |
| `--database`, `--player` | Source recording and receiving player ID. The source opens read-only. |
| `--output` | Directory for the replay database and generated examples. |
| `--from`, `--to` | Inclusive recorded-turn range. Start at zero to preserve the full series history. |
| `--every` | Publication frequency in Standard-equivalent turns; defaults to five. |
| `--comparison` | Comparison history in recorded turns; defaults to ten. |
| `--config` | Directory containing catalogue overrides, such as `triggers/cities.json` or an added `templates/` file. |
| `--render-turns` | Comma-separated publication cutoffs to render as PNGs. Requires installed Edge or Chrome; the command builds the reader. |

Open the output's `index.html` directly in a browser. The report opens with the selected rendered pages, grouped under their issue headings. A disclosure under each issue holds its page contents, article prose, evidence tables, and each article's editorial identity. Below the issues, one disclosure holds the run source, settings, and every editorial check with its status and audit link; issues without page images are collapsed in a separate disclosure. Issue and article links use address fragments, so opening a link expands the disclosures containing its target, including on a repeated click of the current link.

A requested preview turn that was skipped or falls outside the publication schedule appears in a note after the rendered issues instead of becoming an issue. `issue-<turn>.json` contains the publication, `audit-<turn>.json` records the editorial decision and article evidence, `run.json` indexes the run, and `replay.sqlite` retains its checks and history. Omit `--render-turns` for a faster text-and-JSON pass without a browser; every issue is then collapsed in the unrendered list.

Before a requested preview run, the command builds dependencies and checks the installed browser. A failed build stops the command before replay creates output. Ctrl+C cancels the active build or replay and returns a nonzero exit code. Once replay starts, failures retain a failed manifest and report, including completed previews. A forced termination or disk-write failure can leave partial files; `replay.sqlite` is the authority for committed checks. To continue that history in VD, choose Resume with the same recording and player, the output's `replay.sqlite`, and run ID `examples`. The CLI creates new runs; use a new output directory to rerun after fixing rules, overlays, or rendering. Its entry point is `src/newspaper/console.ts`; `cli/` owns options, artifacts, and previews.

### Stock catalogue reading examples

These samples describe the stock catalogue at Git revision `94671707a653ca0710806c50bc994e4e66b4ab95`. Use that revision and the Netherlands recording in the command above with no `--config` override to reproduce them. Give each run its own output directory. For a single cutoff, set both `--from` and `--to` to that turn and use `--every 1`.

| Receiver and cutoffs | What to inspect |
| --- | --- |
| Netherlands (7), turns 24 to 99, every 5 | Amsterdam's settler story at turn 29 uses positive local happiness, several nations draw level in research at 59, and Rotterdam outgrows Amsterdam at 69. |
| Netherlands (7), turn 112; Austria (4), turn 125 | Utrecht has zero local happiness and gets a straight report. Salzburg has negative local happiness and gets a critical account. |
| Netherlands (7), turns 308 and 417, in separate runs | Wartime Golden Age coverage uses a straight voice at 47% national happiness and a supportive voice at 100%. |

The five stock runs produced 11 issues and 18 articles in 20 checks. Each rule appeared in the audits. The owner accepted the stock news mechanics. Use the audits to see which variants won and why before tuning coverage or voice. The [trigger examples](triggers/examples.md) explain how local and national happiness affect the writing.

### Iterate on a rule or overlay

Create an override directory and mirror the catalogue paths being changed. To tune a shipped rule, copy `vox-agents/newspaper/triggers/cities.json` into a `triggers/` subfolder and edit that rule. To tune a story, copy its template into a `templates/` subfolder and edit the prose or variants. Pair and incident rules are ordinary entries, and the stock catalogue includes war and peace coverage. Then rerun the same recording and turn range with `--config` and a new output directory:

```sh
npm run newspaper -w vox-agents -- --database mcp-server/archive/self-play/0d749c4f-69a7-4682-81b3-8fa70f38c012_1794782175768.db --player 7 --from 24 --to 99 --every 5 --config .tmp/newspaper-overlay --output .tmp/newspaper-examples/netherlands-revised --render-turns 29
```

Rule and template entries merge by ID. Arrays without IDs, such as a rule's `when` list or a variant's paragraphs, replace the inherited array. The [editorial guide](editorial.md#authoring-choices) describes template eligibility, weights and placeholders.

If a story is missing, open the check's audit. The [trigger audit](triggers/overview.md) shows what each subject matched and which facts it used. `choiceErrors` lists runtime errors once per expression and records when the check's execution limit prevented further choices from running. False conditions and hidden facts are ordinary reasons to leave a choice out. The decision also shows which candidates competed for space.

Always generate a fresh run after changing the catalogue: resuming an existing run restores its saved configuration. Keep the same source, receiver, range, and frequency when comparing edits, since these determine the series history.

## Open a recording in the browser reader

From the repository root:

1. Run `npm run build --workspace=mcp-server`. Replay imports MCP's compiled queries.
2. Run `npm run build:newspaper --workspace=vox-agents` to build the browser assets.
3. Start VD with `npm run dev --workspace=vox-agents` and open `/newspaper/` on the address reported by the server. The standalone Vite preview serves the shell but does not supply replay routes.

Enter the database path as seen by the server, receiving player ID, and inclusive first and last turns. Publication frequency uses Standard-equivalent turns, defaults to five, and resolves to at least one recorded turn using the recording's pace. For example, five Standard turns become eight turns on Epic. The comparison duration uses the selected recorded or Standard duration unit; zero omits comparison history.

The server creates a run ID when one is omitted. Its default output is `.tmp/newspaper/replays.sqlite` relative to the server's working directory; `outputPath` selects another location. The output must be separate from the recording, including existing symbolic links and hardlinks. Keep the run ID and output path to resume later. A new run never overwrites an existing run. An explicit branch records its parent and starts fresh from the configured first turn.

Pace uses a recognized recorded `gameSpeed` name first: Quick, Standard, Epic, or Marathon. Otherwise an explicit positive multiplier override applies. Missing or unrecognized names, including localized names, use a labelled Standard assumption when no override is supplied. The response retains the original name, multiplier, source, and label even when durations already use recorded turns.

| Control | Effect |
| --- | --- |
| Open recording | Starts a new run or resumes the requested run and receiving player. |
| Inspect cutoff | Queries the current window without advancing. Before the first check, previews the configured first turn. |
| Next check | Queries evidence, runs the editor, and atomically stores an issue or skipped check. The last check clamps to the configured end. |
| Read issue | Opens saved prose and its original decision without rerunning selection. |
| Vote | Assigns, replaces, or clears one article's preference across all its page appearances. |
| Preferences | Changes frequency and the saved LLM preference for later checks. |

Events run after the previous completed check through the cutoff, including skipped checks. Comparison snapshots can reach before the first turn, bounded at turn zero. A frequency change schedules from the last completed check and leaves existing issues unchanged. Reloading the page restores the active session; restarting the server requires an explicit resume using its output path, run ID, source, and receiver. Resume verifies the source bytes and restores the saved catalogue snapshot and preferences.

Failed reads leave the cursor unchanged; concurrent changes run in arrival order. Invalid settings or failure to open a replacement keeps the previous session usable. If closing the previous source fails, replay clears the session and requires configuration again.

## Inspect evidence

The evidence panel lists national snapshots, cities, comparison versions, and supported events. Selecting a row shows its original table, insertion or event ID, recorded turn, timestamp, and permitted values. Inspection works even when no issue has been generated or fixture loading fails. The inspector shows the selected evidence fields; it does not grant access to restricted source fields.

City snapshots retire when a visible recorded capture or raze event identifies their coordinates after the latest city row and through the cutoff. Comparison rows retain their original observations. An event before the requested event window can still retire a city. Unobserved removals cannot retire snapshots. The inspector displays evidence limitations: `cityLifecycleUnresolved` for missing lifecycle coordinates and `cityLifecycleOrderUnknown` for equal same-turn timestamps. Affected snapshots may remain stale. Replay does not infer city continuity from names or nested owner labels.

Replay uses the [recorded roster and network balance](triggers/facts.md#covert-presence-and-roster-points) to infer agent presence and access to detail. Event insight uses the latest roster from an earlier turn. Try the optional stories with `--config vox-agents/newspaper/probes`.

Fixture selection and link destinations remain available alongside the persisted replay archive. `app/main.ts` coordinates the shell, `api.ts` validates HTTP responses, `replay.ts` owns controls, and `inspector.ts` owns fixture and evidence details. The shared publication reader remains in `reader/mount.ts`.

## Source and HTTP ownership

`replay/database.ts` wraps the read-only opener in `knowledge/database.ts`, inheriting its JSON decoding. It initializes the lazy connection without SQL so shutdown can release an unused source. The recording receives no schema setup, migrations, writes, or live refresh. `replay/store.ts` versions the separate offline output and commits each check's content or skip, evidence summaries, decision, rule repeat state, series state, and cursor in one transaction, with a unique cutoff per run and receiver.

`replay/session.ts` owns both connections and serializes configuration, queries, checks, archive reads, votes, preferences, and shutdown. Required publication advance scope is checked within that queue, after any earlier configuration. The offline SQLite store uses `user_version` 5 and stores a checkpoint revision; an output database with an unsupported version is rejected, so regenerate older local replay output. This storage version is separate from publication-state schema 6 and IssueDocument schema 2. Every check, vote, and preference write must match the revision captured when that process created or resumed the run. If another VD process has changed it, the write returns 409 and its transaction rolls back; resume the run to reload the latest cursor and votes before continuing. Reusing an existing run ID also returns 409 with resume guidance. Shutdown rejects new work, drains accepted operations, and closes both databases. The export application retains its separate queue and shutdown.

`replay/http.ts` mounts through the existing newspaper host hook with its own JSON parser before API fallbacks and the server's general parser. Routes are loopback-only. Paths below are relative to `/api/newspaper/replay`.

| Method and path | Request | Response |
| --- | --- | --- |
| PUT `/` | Source settings plus optional output path, run ID, mode, and preferences | Session settings, run ID, output path, saved preferences, pace, and cursor |
| GET `/` | None | Current session state |
| POST `/evidence` | Optional run/receiver scope | Session state and MCP evidence without cursor change |
| POST `/advance` | Required run/receiver scope for publication runs | Session state, MCP evidence, and saved published or skipped check |
| GET `/issues` | Optional run/receiver query scope | Ordered issue index in `issues` |
| GET `/issues/:issueId` | Optional run/receiver query scope | Immutable `issue`, `index`, `decision`, article evidence in `articles`, and current numeric `votes` |
| PUT `/votes` | Required `runId`, `receiverPlayerID`, `itemId`, and `value` (-1, 0, or 1) | Current session state |
| PUT `/preferences` | Required scope, `frequencyStandardTurns`, and `llmEnabled` | Updated session state |

`contracts/replay.ts` defines source and timing fields `databasePath`, `receiverPlayerID`, `fromTurn`, `toTurn`, `publicationInterval`, `durationUnit`, `comparisonTurns`, and `speedMultiplierOverride`. Publication settings include `outputPath`, `runId`, `mode` (`new`, `resume`, or `branch`), `branchFromRunId`, `editorialConfigDirectory`, `frequencyStandardTurns`, and `llmEnabled`. Resume requires a run ID; branch requires a parent run ID. Publication frequency uses `frequencyStandardTurns`. In evidence-only mode (`publicationEnabled: false`), `publicationInterval` and `durationUnit` control the in-memory inspection schedule.

Evidence responses pair `session` with `evidence`, reusing MCP's schemas; advances also return `check` when publication is enabled. Archive payloads in `contracts/archive.ts` reuse MCP's browser-safe `newspaper/protocol.ts`. Scope mismatches return 409. Errors use the common JSON envelope: invalid settings or source opening return 400, absent configuration or exhaustion return 409, missing archived articles or issues return 404, and shutdown returns 503. Query, editorial configuration, validation, and transaction errors leave the cursor unchanged for retry. A skipped result for unavailable eligible content or design completes the check and advances its boundary. Saved votes affect future checks; old content retains its original prose and decision.

MCP's `newspaper/queries.ts` takes an explicit connection and recorded-turn request. It starts from the latest summaries before the requested window and folds bounded versions forward, retaining dated permission context for older national observations. Its `projection.ts` owns all historical visibility and field policy. Policy branches follow the live player report: basic access reveals branch counts, while full access or sufficient recorded diplomat strength reveals policies. Both access paths retain source references and decode JSON fields. Writable database setup adds a Turn-leading event index; replay can read older recordings without creating it.

Derived diplomacy evidence includes a baseline, dated relationship history, and interpretation gaps separately from raw snapshot values. Names resolve only to unique visible identities. Shared relationship helpers extract war score, friendship, pacts, alliances, and master/vassal status without exposing influence or war weariness. The newspaper projection keeps `OriginatingPlayerID` and `TargetTeamID` for `MakePeace`; `DeclareWar` also keeps `IsAggressor`. It does not expose the acting team or the cause of recursive calls, and it omits `PacifierFlag` from peace. [War and peace coverage](triggers/war-and-peace.md) explains how the editor combines these observations with the recorded event sequence, and how skipped checks preserve pair history for later progress reports. Native game events use their recorded sequence within each turn; dynamically generated events use a separate sequence range and do not establish native call order.

Offline replay calls the shared query directly. MCP also exposes it as `get-newspaper-evidence` for future live publication. The tool takes `PlayerID`, previous-check turn, cutoff, and optional comparison range. Its cutoff must precede the current turn so that round's observations can finish recording.

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

## Historical heuristic replay verification

This historical run used retired detectors and templates. Its results cover replay storage, votes, and the reader workflow.

On November 16, 2026, the Netherlands recording described below completed 89 publication checks from turn 0 through 440 at five-turn intervals, with a ten-turn comparison window. The run produced 81 issues containing 362 canonical articles, including three authored composites and nine breaking front pages; eight checks skipped publication. Saved designs comprised seven early accounts, 51 Victorian issues, and 23 modern issues. Useful reading samples include composites at cutoffs 120, 125, and 200, and incoming-war coverage beginning at cutoff 275.

The HTTP run assigned the same vote twice, stopped after cutoff 95, reopened both connections, and resumed the named run. The saved article remained unchanged, and its vote survived restart before being replaced and cleared. Focused tests separately verify unchanged historical decisions and vote-driven selection changes. Source SHA-256 matched before and after all checks. The separate replay output occupied 13,119,488 bytes, about 12.5 MiB.

An installed Edge browser (`157.0.8103.51`) opened the 81-issue archive, read the final issue, saved a vote, reloaded the page, and reopened identical prose with the saved vote selected. No page errors occurred. Focused browser tests additionally cover delayed votes before advancing, switching issues during queued saves, save failures, and font fallback. These automated checks leave editorial quality and broader in-game reading acceptance open.

Local verification artifacts are under `.tmp/newspaper-plan3/`: `acceptance.json` identifies the output database, `browser-acceptance.json` records the browser result, and `browser-latest.png` shows the final issue. Use the command-line workflow above for reproducible new runs. To inspect the measured archive manually, choose Resume with that output path, run ID `netherlands-acceptance`, and receiver `7`.

## Replaying private espionage reports

Use the Netherlands recording below with the `vox-agents/newspaper/probes` overlay. Replay turn 216 for India (player 1) and the Ottomans (player 5). India's operation at Istanbul (row `216000196`) is followed by the team's Civil Service gain (`216000197`). The Ottoman report names India and cites the operation and its next recorded turn (`216000654`); the technology inference is private to India. The source inspector shows the original date and the report date when they differ. See [event facts](triggers/facts.md#event) for what these records can establish.

## Historical evidence-query verification

This historical run measures recorded evidence retrieval and replay behavior.

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

The source inspector exposes concrete inputs for rule authors:

| Example | Source | Recorded evidence |
| --- | --- | --- |
| Domestic city | `CityInformations` row `9162`, turn 200 | Amsterdam has population 17, science per turn 92, and University production with one turn left. |
| Trade | `PlayerSummaries` row `6486`, turn 200 | Amsterdam to Istanbul yields `FromGold: 38.03`; Amsterdam to Groningen carries `ToProduction: 11.25`. Unavailable yields retain their `-1` sentinels. |
| Foreign culture | `PlayerSummaries` row `6484`, turn 200 | The Ottomans have culture per turn 279 and tourism per turn 56.5. Basic access exposes policy branch counts. |
| City capture | `GameEvents` row `247000938`, turn 247, inspected at cutoff 250 | The Netherlands captures Stuttgart from barbarians at coordinates `(6, 14)`. The evidence retains the original event date. |

For the separate browser pass, set first turn to 125 and last turn to 138, keeping the other settings above. Headless browser checks verified source selection at turn 125 without advancing, checks at 125, 130, 135, and the clamped endpoint 138, and restoration of the finished session after reload. The HTTP pass also confirmed that preview succeeds after exhaustion and a missing replacement path returns 400 while preserving the existing cursor.

Local acceptance artifacts are in `.tmp/newspaper-replay-20261116/`: the runner, `report.json`, selected cutoff responses, and a browser screenshot. Use the command-line workflow above to generate new examples and audit records.

Small SQLite fixtures separately cover query equivalence, cleanup, failure ordering, and visibility boundaries. Browser integration also covers evidence inspection when fixture loading fails.

This evidence-only recording run returned no city-lifecycle limitation flags. Historical completeness remains limited by missing observations and mixed save histories. Recordings omit the live alive-player list and elimination dates, so final summaries can persist after elimination. At cutoff 440, India's retained summary is from turn 266 and Assyria's is from turn 327. Read each source turn as the observation date. The 89-check run verifies historical queries.
