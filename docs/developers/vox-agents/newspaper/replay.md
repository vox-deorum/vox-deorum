# Newspaper replay and evidence

Replay turns a saved MCP knowledge database into newspaper editions without Civilization V, the bridge, or a live MCP connection. Use the browser to read editions and inspect evidence, or the command line to save a report and compare catalogue changes.

## Open a recording in the browser reader

From the repository root, run:

```sh
npm run newspaper:preview -w vox-agents
```

The command builds MCP's queries, serves the reader and replay API at [127.0.0.1:5600](http://127.0.0.1:5600/), and opens a browser. Ctrl+C stops it. The reader starts in **Mockups**. Pick a design, front page layout, and tint, or enter a civilization such as Nubia to try a customized masthead. The source preview accepts `?fixture=` links to developer fixtures, including through the old `/preview.html` address. Installed builds serve the Victorian ordinary sample as a separate fixture.

Switch to **Recorded**, open **Recording**, and enter the full MCP knowledge database, receiving player ID, and inclusive first and last turns. The form suggests the latest archived knowledge database when one is available. Click **Generate**, then choose an **Edition** to read its saved articles. The batch opens the newest edition unless you chose or focused another one. The design, front page layout, and tint controls apply to this browser tab; choose **As published** and **Design default** to restore the saved appearance.

On the normal Vox Deorum server the reader is at `/newspaper/`. For a source checkout of that server, build the dependencies and reader before starting it:

```sh
npm run build -w mcp-server
npm run build:newspaper -w vox-agents
npm run dev -w vox-agents
```

Relative paths resolve from the directory where you launched the source preview, or from the normal server's working directory. Use absolute paths to share a run across hosts. Vite alone serves the reader shell without the replay API.

### Set the reporting window

Replay checks the first turn, advances at the chosen interval, and checks the last turn even when it falls between intervals. For example, if turn 100 publishes and turn 105 skips, the turn 110 check covers events from 101 through 110. Until a first edition publishes, the window starts at the first configured turn.

Under **Recording > Advanced**, set the publication frequency in Standard pace turns. The stock default is five, which becomes eight recorded turns on Epic. Comparison history can use recorded or Standard pace turns, can reach before the first check as far as turn zero, and is omitted when set to zero. Replay uses a recognized recorded pace (Quick, Standard, Epic, or Marathon), then an explicit positive multiplier if the pace is unknown, then a labelled Standard assumption.

Choose **Inspect evidence only** to check a source without an output database or run ID. Its event window starts after the preceding check, and its own evidence check interval follows the selected duration units.

### Stop, resume, or start fresh

- **Stop after current check** finishes the current step and saves the latest checkpoint with any edition. **Continue** starts from the saved cursor. **Save preferences** applies frequency and LLM preferences to future checks, scheduling from the last completed check even if it skipped. The current editor uses authored rules and records a fallback if LLM use was requested.
- Reloading the page can restore the server's active session. After a server restart, use **Recording > Saved run > Resume** with the recording, player ID, run ID, and output path. Resume checks the recording's bytes and restores the saved schedule, preferences, and catalogue before any further checks.
- Start a **New run** after changing rules or templates so the new checks use the changes. A **Branch run** records its parent and starts from the configured first turn with fresh history. A run ID is assigned if omitted; reusing an existing ID for the same receiver returns a conflict. The default store is `.tmp/newspaper/replays-v9.sqlite` relative to the host working directory. Keep it separate from the read-only recording, including symlinks and hardlinks.
- Replay only opens the current output version at the chosen path. An older or newer newspaper output is rejected with an unsupported version message and left unchanged. Outputs from earlier versions are not migrated, so choose a new output file and start a **New run** to generate editions there from the MCP recording.

### Read Replay diagnostics

Expand **Replay diagnostics** below the paper. **Skipped checks in this batch** lists each skipped cutoff and its reason. **Selected edition** shows the evidence, sources, and trigger and template IDs for each article. The archive keeps article provenance with the prose so older editions can reopen directly. For the full editorial decision and trigger trace, use the CLI audit. Votes are saved separately and can influence future checks.

Click **Inspect cutoff** to query the current window without advancing. The result stays tied to the inspected cutoff and can differ from the cutoff of the edition on screen. It shows the original dates, row IDs, and permitted values for national and city summaries, events, tactical zones, receiver technologies, comparison rows, diplomacy, and congress observations.

## Generate examples from the command line

Run this from the repository root to check a Standard pace Netherlands recording from turns 24 through 99. It saves an audit for each check and requests a PNG if turn 29 publishes:

```sh
npm run newspaper -w vox-agents -- --database mcp-server/archive/self-play/0d749c4f-69a7-4682-81b3-8fa70f38c012_1794782175768.db --player 7 --from 24 --to 99 --every 5 --output .tmp/newspaper-examples/netherlands --render-turns 29
```

The local recording may be unavailable in your checkout. Substitute the full knowledge database from another game and set its player ID and turn range. Relative paths resolve from the directory where you invoked npm. Omit `--render-turns 29` when adapting the command to check a different cutoff.

| Option | Effect |
| --- | --- |
| `--database`, `--player` | Read-only source recording and receiving player ID (0 to 21). |
| `--output` | New or empty directory for the replay database and report. |
| `--from`, `--to` | Inclusive first and last turns. The first defaults to zero. Starting later omits earlier publication history. |
| `--every` | Check frequency in Standard pace turns. Defaults to five. |
| `--comparison` | Comparison duration in recorded turns. Defaults to ten; use zero to omit. |
| `--config` | Editorial catalogue overlay directory. |
| `--render-turns` | Comma-separated cutoffs inside the requested range. Requires installed Edge or Chrome. |
| `--help` | List the options without building dependencies. |

The command builds MCP's queries before replay creates output. For PNGs it also rebuilds the shared reader assets, so stop Vox Deorum before running it. If that build is interrupted, rebuild the reader before restarting the server. Omit `--render-turns` for a faster text and JSON pass without a browser.

Open `index.html` directly in a browser. Rendered issues appear first; expand the other issues to read their prose and evidence. The run disclosure links to each check's `audit-<turn>.json` and identifies any requested preview that did not publish. `issue-<turn>.json` holds each publication and `run.json` indexes the run. If replay fails after it starts, the report and manifest retain work completed so far when they can be written. `replay.sqlite` stores the published editions, their article evidence, and the latest checkpoint. To continue a partial run in the browser, resume with its source and player, `replay.sqlite` as the output path, and run ID `examples`. A CLI rerun needs a fresh output directory.

### Iterate on a rule or overlay

Mirror the catalogue paths in an overlay directory. For example, place a copy of `vox-agents/newspaper/triggers/cities.json` under `triggers/` in the overlay, edit a rule there, and add `--config .tmp/newspaper-overlay` to the command. Run it with a new `--output` and keep the same source, player, range, and frequency. See [catalogue merging](editorial.md#catalogue-and-eligibility) for which fields carry over.

If a story is missing, read the [trigger audit](triggers/overview.md) for matched subjects and their evidence. The decision shows how the candidates competed for space. A `mergedInto` entry points to the combined story that covered a candidate. `choiceErrors` records expression failures and whether the check hit its execution limit. For [design weights](designs.md#which-design-runs), compare runs with the same recording, receiver, and first cutoff. Use matching shorter windows if a long replay reaches its memory limit; a fresh window starts with no publication history.

The audit also explains the design and title. `designSelection` shows the previous design, its run length, why the editor kept it or drew again, and each candidate's raw weight and weight in that draw. A zero draw weight means the editor kept the old design without drawing or left that candidate out. `mastheadRuleId` names a rule that supplied the printed title; without one the design supplied it.

### Stock catalogue reading examples

These outcomes describe the stock catalogue at Git revision `94671707a653ca0710806c50bc994e4e66b4ab95`. Use that revision, the recording above, and no overlay to reproduce them. The current catalogue can select different stories. For an isolated cutoff, give `--from` and `--to` the same turn and use `--every 1`.

| Receiver and cutoffs | What to read |
| --- | --- |
| Netherlands (7), 24 to 99, every five turns | Amsterdam's settler story uses positive local happiness at 29; nations draw level in research at 59; Rotterdam outgrows Amsterdam at 69. |
| Netherlands (7) at 112; Austria (4) at 125 | Utrecht's zero local happiness yields a straight account; Salzburg's negative local happiness yields a critical one. |
| Netherlands (7), 308 and 417 in separate runs | Wartime Golden Age coverage uses a straight voice at 47% national happiness and a supportive voice at 100%. |

## Historical evidence-query verification

Use the full knowledge database from the CLI example above. The accompanying `-player-7.db` contains agent telemetry. To reproduce the evidence checks in the browser, choose **Inspect evidence only** for the Netherlands (7) with turns 0 through 440, an interval of five, comparison duration ten in recorded turns, and no speed override.

To inspect Amsterdam at turn 200, set both turns to 200 in evidence-only mode, click **Generate**, then **Inspect cutoff**. City row `9162` records population 17, science per turn 92, and one turn left on its University. For a capture, generate evidence checks from 245 to 250 and inspect cutoff 250: event `247000938` records the capture of Stuttgart from barbarians at `(6, 14)` on turn 247. Source dates show when an observation was made; a recording can retain a civilization's final summary after elimination.

### Replaying private espionage reports

Use the same recording with `--from 215 --to 216 --every 1 --config vox-agents/newspaper/probes`. Run it once for India (player 1) and once for the Ottomans (player 5), each with its own output. Open `audit-216.json`. India's operation at Istanbul (row `216000196`) is followed by its team's Civil Service gain (`216000197`). The Ottoman report identifies India and cites the operation and the defender's next recorded turn (`216000654`). The technology inference is private to India. See [event facts](triggers/facts.md#event) for the conditions behind these reports.

### Replaying front reports and ship launches

Use the same probe overlay for the Netherlands (player 7). Give `--from` and `--to` the same cutoff, set `--every 1`, and use a new output directory each time. Inspect the audit or cutoff evidence:

| Cutoff | Observation |
| --- | --- |
| 179 | Amsterdam's Trireme purchase produces no launch report. Training row `179000692` and creation row `179000691` record the purchase. |
| 235 | The Stuttgart sea zone (row `2426`) records a Withdraw assessment and sightings, including a German Galleass. |
| 282 | Rotterdam's report identifies a newly trained Frigate. Its sources include training row `282001079`, creation row `282001078`, and city row `14913`. |

See [tactical observations](triggers/facts.md#tactical-observations) and [inferred city facts](triggers/facts.md#inferred-city-facts) for what these records support.

## Source, storage, and API

Replay calls MCP's shared `newspaper/queries.ts` directly with a read-only connection and explicit recorded-turn bounds. `projection.ts` owns historical visibility and field filtering: a later meeting cannot reveal an earlier event, and a missing observation can leave a city or national snapshot stale. A visible later capture or raze can retire a city even if the event falls before the requested window. Look for `cityLifecycleUnresolved` (missing lifecycle coordinates) and `cityLifecycleOrderUnknown` (equal same-turn timestamps) in diagnostics. See [evidence and visibility](triggers/facts.md#evidence-the-facts-rely-on) for the reporting rules. The live MCP `get-newspaper-evidence` tool shares the query, with a cutoff before the current turn so the round can finish recording.

`replay/session.ts` serializes requests. In one transaction, `replay/store.ts` saves any published edition with its article evidence and updates the latest checkpoint. The output holds editions, article evidence, and the latest checkpoint with its saved catalogue for resume. It does not keep a per-cutoff history or editorial decisions. Failed reads and writes leave the cursor unchanged. A stale revision after another process writes to the same run returns a conflict; resume before retrying.

The loopback-only routes in `replay/http.ts` live under `/api/newspaper/replay`. Use `contracts/replay.ts` for settings and evidence responses and `contracts/archive.ts` for edition, vote, and article provenance payloads. The browser batches through `POST /advance?view=summary`, which returns status, any skip reason, and the issue ID when one publishes. `POST /evidence` reads the current cutoff; `GET /issues` and `GET /issues/:issueId` read the archive. Publication advances, vote writes, and preference writes require the run ID and receiver; stale scopes return 409.

For changes to replay, run `npm test -w vox-agents -- tests/mock/newspaper` from the repository root. For MCP projection changes, also run `npm run test:mock -w mcp-server -- tests/newspaper`. See [reader and export tests](renderer.md#run-the-tests) for browser setup.
