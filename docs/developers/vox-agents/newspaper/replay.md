# Newspaper replay and evidence

Replay reads a recorded MCP SQLite database and produces authored newspaper issues without a running game, bridge, or live MCP connection. A separate offline SQLite output stores completed checks, immutable issues, article evidence, decisions, votes, preferences, and the cursor. Restarting VD and resuming the saved run continues its history.

## Generate examples from the command line

Use the newspaper command from the repository root to replay a recording without starting VD or Civilization V. Each run builds MCP's queries before loading replay, and PNG previews also build the reader. Help and argument errors skip builds:

```sh
npm run newspaper -w vox-agents -- --help
```

PNG preview builds replace the shared `dist-newspaper` assets. Generate previews while VD is stopped, and rerun the command if a build is interrupted before restarting VD.

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

Before a requested preview run, the command builds dependencies and checks the installed browser. A failed build stops the command before replay creates output. Ctrl+C cancels the active build or replay and returns a nonzero exit code. Once replay starts, failures retain a failed manifest and report, including completed previews. A forced termination or disk-write failure can leave partial files; `replay.sqlite` is the authority for committed checks. To continue that history in the browser, open Recorded, then Recording > Saved run, and choose Resume with the same recording and player, the output's `replay.sqlite`, and run ID `examples`. The CLI creates new runs; use a new output directory to rerun after fixing rules, overlays, or rendering. Its entry point is `src/newspaper/console.ts`; `cli/` owns options, artifacts, and previews.

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

The newspaper has one browser reader for design mockups and recordings. The source preview and the normal VD server both serve it.

From the repository root, run:

```sh
npm run newspaper:preview -w vox-agents
```

The command builds MCP's queries, then serves the source reader and replay API at `http://127.0.0.1:5600/` and opens a browser. Ctrl+C stops it. The old `/preview.html` address loads the same shell and keeps its `?fixture=` query. Relative recording, output, and editorial configuration paths resolve against the directory where you invoked npm.

To use the reader on the normal VD server, build MCP and the browser assets, start VD, and open `/newspaper/`:

```sh
npm run build --workspace=mcp-server
npm run build:newspaper --workspace=vox-agents
npm run dev --workspace=vox-agents
```

Normal VD resolves relative paths against its server working directory. Running Vite alone serves the shell but does not supply replay routes.

Both hosts open in Mockups. Its design, front page layout, and tint controls build sample stories from the built-in designs. A source checkout also accepts `?fixture=` links for the developer fixtures; installed builds provide only the packaged Victorian ordinary fixture. Switch to Recorded to generate or reopen editions.

### Recorded controls

| Control | Effect |
| --- | --- |
| Recording | Set the MCP recording database, receiving Player ID, and inclusive first and last turns. A fresh form suggests the newest knowledge database under `mcp-server/archive/` when one exists. You can replace it with any recording path the host can read. |
| Generate | Opens a new run, or an evidence-only session, and checks the full requested range one interval at a time. Each publication run stores every published or skipped check. |
| Stop after current check | Finishes the check in progress, then stops the batch. Completed checks remain saved. |
| Continue | Continues the open run from its cursor. It is hidden once the run is complete. |
| Edition | Saved editions for the open run, newest first. Selecting one opens its stored prose and decision without generating again. The newest edition opens after a batch unless you selected or focused another edition. |
| Saved run | Recording > Saved run reopens a run from its run ID and, when not the default, its output path. Enter the recording path and Player ID as well. |
| Advanced | Holds the replay purpose, comparison duration, duration units, speed multiplier override, new or branch mode, parent run for a branch, editorial configuration directory, publication frequency, LLM preference, and Save preferences. |

Generate starts at the configured first turn and clamps the last check to the configured end. Events run after the previous completed check through the cutoff, including skipped checks. Comparison snapshots can reach before the first turn, bounded at turn zero. Reloading the page restores the active session. A frequency change schedules from the last completed check and leaves existing issues unchanged. Save preferences requires an open run and applies the chosen frequency and LLM setting to later checks.

Resume restores the saved schedule, cursor, catalogue snapshot, and preferences without generating an edition. It works in the source preview and normal VD with the same recording, receiver, run ID, and output path, including a store created by the offline command. Restarting the server requires this explicit resume, which verifies the source bytes. A new run creates a run ID when one is omitted. Its default output is `.tmp/newspaper/replays.sqlite` relative to the preview or server working directory; `outputPath` selects another location. The output must be separate from the recording, including existing symbolic links and hardlinks. Keep the run ID and output path to resume later. A new run never overwrites an existing run, and reusing its run ID returns a conflict with resume guidance. An explicit branch records its parent and starts fresh from the configured first turn.

Publication frequency uses Standard-equivalent turns and defaults to five. It resolves to at least one recorded turn using the recording's pace. For example, five Standard turns become eight turns on Epic. The comparison duration uses the selected recorded or Standard duration unit; zero omits comparison history. Choose Inspect evidence only as the replay purpose to inspect a recording without publishing; the form then shows the evidence check interval, keeps no publication store or run ID, and leaves Save preferences disabled.

Pace uses a recognized recorded `gameSpeed` name first: Quick, Standard, Epic, or Marathon. Otherwise an explicit positive multiplier override applies. Missing or unrecognized names, including localized names, use a labelled Standard assumption when no override is supplied. The response retains the original name, multiplier, source, and label even when durations already use recorded turns.

Failed reads leave the cursor unchanged; concurrent changes run in arrival order. Invalid settings or failure to open a replacement keeps the previous session usable. If closing the previous source fails, replay clears the session and requires configuration again.

### Replay diagnostics

Replay diagnostics is a disclosure below the paper in Recorded mode. It starts collapsed and creates each block when opened.

| Section | Contents |
| --- | --- |
| Skipped checks in this batch | Each cutoff that produced no edition and its recorded reason. A new batch clears the list. |
| Selected edition | One disclosure per stored article with its evidence summary, template and trigger IDs, and sources, followed by the edition's stored editorial decision. |
| Evidence at the current cutoff | The Inspect cutoff action and the evidence groups it returns. |

Inspect cutoff queries the current evidence window without advancing. Before the first check, it previews the configured first turn. Evidence is not loaded automatically, is cleared when a run or batch changes, and belongs to the cutoff you inspected. The selected edition section describes what was stored with the issue on screen, not the current cutoff. Selecting an edition again, or following an article link to an earlier edition, reads the stored prose and decision without rerunning selection. Votes remain in the reader: a vote assigns, replaces, or clears one article's preference across all its page appearances.

## Inspect evidence

The Inspect cutoff action reports the recorded evidence behind a cutoff. It groups national snapshots, cities, events, tactical zones, receiver technologies, earlier players and cities, diplomacy baseline, history and gaps, and congress observations. Each group shows the original fields, identifiers, recorded turn, timestamp, and permitted values. Inspection works even when no edition has been generated or fixture loading fails. The diagnostics show the selected evidence fields; they do not grant access to restricted source fields.

City snapshots retire when a visible recorded capture or raze event identifies their coordinates after the latest city row and through the cutoff. Comparison rows retain their original observations. An event before the requested event window can still retire a city. Unobserved removals cannot retire snapshots. Inspect cutoff lists evidence limitations: `cityLifecycleUnresolved` for missing lifecycle coordinates and `cityLifecycleOrderUnknown` for equal same-turn timestamps. Affected snapshots may remain stale. Replay does not infer city continuity from names or nested owner labels.

Replay uses the [recorded roster and network balance](triggers/facts.md#covert-presence-and-roster-points) to infer agent presence and access to detail. Event insight uses the latest roster from an earlier turn. Try the optional stories with `--config vox-agents/newspaper/probes`.

`newspaper/src/app/main.ts` coordinates the source switch and reader mounts, `mockups.ts` builds design samples, `replay.ts` owns recording controls and batches, `inspector.ts` builds Replay diagnostics, and `api.ts` validates HTTP responses. `newspaper/src/preview/issue.ts` builds mockups from the built-in designs, and `src/newspaper/cli/preview.ts` hosts the source preview. The shared publication reader remains in `newspaper/src/reader/mount.ts`.

## Source and HTTP ownership

`replay/database.ts` wraps the read-only opener in `knowledge/database.ts`, inheriting its JSON decoding. It initializes the lazy connection without SQL so shutdown can release an unused source. The recording receives no schema setup, migrations, writes, or live refresh. `replay/store.ts` versions the separate offline output and commits each check's content or skip, evidence summaries, decision, rule repeat state, series state, and cursor in one transaction, with a unique cutoff per run and receiver.

`replay/session.ts` owns both connections and serializes configuration, queries, checks, archive reads, votes, preferences, and shutdown. Required publication advance scope is checked within that queue, after any earlier configuration. The offline SQLite store uses `user_version` 5 and stores a checkpoint revision; an output database with an unsupported version is rejected, so regenerate older local replay output. This storage version is separate from publication-state schema 6 and IssueDocument schema 2. Every check, vote, and preference write must match the revision captured when that process created or resumed the run. If another VD process has changed it, the write returns 409 and its transaction rolls back; resume the run to reload the latest cursor and votes before continuing. Reusing an existing run ID also returns 409 with resume guidance. Shutdown rejects new work, drains accepted operations, and closes both databases. The export application retains its separate queue and shutdown.

`replay/http.ts` mounts through the existing newspaper host hook with its own JSON parser before API fallbacks and the server's general parser. Routes are loopback-only. Paths below are relative to `/api/newspaper/replay`.

| Method and path | Request | Response |
| --- | --- | --- |
| PUT `/` | Source settings plus optional output path, run ID, mode, and preferences | Session settings, run ID, output path, saved preferences, pace, and cursor |
| GET `/` | None | Current session state |
| GET `/latest-recording` | None | Latest archived knowledge database path, or `null` if none exists |
| POST `/evidence` | Optional run/receiver scope | Session state and MCP evidence without cursor change |
| POST `/advance` | Required run/receiver scope for publication runs | Session state, MCP evidence, and saved published or skipped check |
| POST `/advance?view=summary` | Required run/receiver scope for publication runs | Session state and summary `check` with `status`, optional `reason`, and optional `issueId` |
| GET `/issues` | Optional run/receiver query scope | Ordered issue index in `issues` |
| GET `/issues/:issueId` | Optional run/receiver query scope | Immutable `issue`, `index`, `decision`, article evidence in `articles`, and current numeric `votes` |
| PUT `/votes` | Required `runId`, `receiverPlayerID`, `itemId`, and `value` (-1, 0, or 1) | Current session state |
| PUT `/preferences` | Required scope, `frequencyStandardTurns`, and `llmEnabled` | Updated session state |

`contracts/replay.ts` defines source and timing fields `databasePath`, `receiverPlayerID`, `fromTurn`, `toTurn`, `publicationInterval`, `durationUnit`, `comparisonTurns`, and `speedMultiplierOverride`. Publication settings include `outputPath`, `runId`, `mode` (`new`, `resume`, or `branch`), `branchFromRunId`, `editorialConfigDirectory`, `frequencyStandardTurns`, and `llmEnabled`. Resume requires a run ID; branch requires a parent run ID. Publication frequency uses `frequencyStandardTurns`. In evidence-only mode (`publicationEnabled: false`), `publicationInterval` and `durationUnit` control the in-memory inspection schedule. `replayAdvanceSummaryResponseSchema` defines the short advance result.

The Recorded batch calls the summary advance so each step returns only the saved status, skip reason, and issue ID. After a publication it refreshes the edition picker, and at the end of a batch it opens the newest edition when the selection is unchanged. The reader requests full evidence only through Inspect cutoff, and a selected edition is read from the store. Evidence responses pair `session` with `evidence`, reusing MCP's schemas; advances also return `check` when publication is enabled. Archive payloads in `contracts/archive.ts` reuse MCP's browser-safe `newspaper/protocol.ts`. Scope mismatches return 409. Errors use the common JSON envelope: invalid settings or source opening return 400, absent configuration or exhaustion return 409, missing archived articles or issues return 404, and shutdown returns 503. Query, editorial configuration, validation, and transaction errors leave the cursor unchanged for retry. A skipped result for unavailable eligible content or design completes the check and advances its boundary. Saved votes affect future checks; old content retains its original prose and decision.

MCP's `newspaper/queries.ts` takes an explicit connection and recorded-turn request. It starts from the latest summaries before the requested window and folds bounded versions forward, retaining dated permission context for older national observations. Its `projection.ts` owns all historical visibility and field policy. Policy branches follow the live player report: basic access reveals branch counts, while full access or sufficient recorded diplomat strength reveals policies. Both access paths retain source references and decode JSON fields. Writable database setup adds a Turn-leading event index; replay can read older recordings without creating it.

Diplomacy evidence keeps a baseline, dated relationship history, and interpretation gaps apart from the raw summaries. Names resolve only to unique identities visible on the observation date. The projected facts include city-state influence and protection. War weariness requires full access to the civilization's summary.

The projection keeps `OriginatingPlayerID` and `TargetTeamID` for `MakePeace`; `DeclareWar` also keeps `IsAggressor`. It omits the acting team, the cause of recursive calls, and the peace event's `PacifierFlag`. Native events retain their sequence within each turn. Dynamically generated events use a separate range and do not establish native call order. [War and peace coverage](triggers/war-and-peace.md) explains how the editor uses these observations and preserves pair history across skipped checks.

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

Local verification artifacts are under `.tmp/newspaper-plan3/`: `acceptance.json` identifies the output database, `browser-acceptance.json` records the browser result, and `browser-latest.png` shows the final issue. Use the command-line workflow above for reproducible new runs. To inspect the measured archive manually, open Recorded, then Recording > Saved run, and choose Resume with that output path, run ID `netherlands-acceptance`, and receiver `7`.

## Replaying private espionage reports

Use the Netherlands recording below with the `vox-agents/newspaper/probes` overlay. Replay turn 216 for India (player 1) and the Ottomans (player 5). India's operation at Istanbul (row `216000196`) is followed by the team's Civil Service gain (`216000197`). The Ottoman report names India and cites the operation and its next recorded turn (`216000654`); the technology inference is private to India. The inspected cutoff evidence shows the original date and the report date when they differ. See [event facts](triggers/facts.md#event) for what these records can establish.

## Replaying front reports and ship launches

Use the same recording and the `vox-agents/newspaper/probes` overlay for the Netherlands (player 7). Replay each cutoff separately to isolate these observations:

| Cutoff | Expected result | Source rows |
| --- | --- | --- |
| 179 | No launch for the Trireme bought with gold at Amsterdam. | Training `179000692`, creation `179000691` |
| 235 | The Stuttgart sea zone records a Withdraw assessment and sightings, including a German Galleass. | Tactical zone `2426` |
| 282 | The Rotterdam report names a newly trained Frigate. | Training `282001079`, creation `282001078`, city `14913` |

The inspected cutoff evidence lists tactical zones from the cutoff turn and shows the recorded counts and posture. See [tactical observations](triggers/facts.md#tactical-observations) and [inferred city facts](triggers/facts.md#inferred-city-facts) for the limits of the reports.

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

Inspect cutoff exposes concrete inputs for rule authors:

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
