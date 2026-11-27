# Newspaper replay and evidence

Replay reads an MCP knowledge database to generate issues or inspect the evidence available to one player at a given turn. You can use the browser or CLI without Civilization V, the bridge, or a live MCP connection.

## Open a recording in the browser reader

Install the [workspace dependencies](../../setup.md) and run from the repository root:

```sh
npm run newspaper:preview -w vox-agents
```

The command builds MCP's queries and opens the source reader at [127.0.0.1:5600](http://127.0.0.1:5600/). Use **Mockups** to try designs, layouts, and tints. Press Ctrl+C in the terminal to stop the preview.

1. Switch to **Recorded** and open **Recording**. Choose a full MCP knowledge database, such as a game archive under `mcp-server/archive/`. The form can suggest the latest archive. A per-player telemetry database (`-player-<id>.db`) lacks the game evidence.
2. Enter the receiving **Player ID** (0 to 21) and the inclusive first and last turns. Click **Generate**.
3. Use **Edition** to read a saved issue. The batch opens the latest edition if you haven't changed or focused the selection. Appearance controls affect the current browser view; choose **As published** and **Design default** to restore the saved appearance.

On the normal Vox Deorum server, open `/newspaper/`. To run that server from source, build MCP and the reader before starting Vox Agents:

```sh
npm run build -w mcp-server
npm run build:newspaper -w vox-agents
npm run dev -w vox-agents
```

Relative paths resolve from the host's working directory; the source preview uses the directory where you invoked npm.

### Set the reporting window

Replay checks the first turn, advances by the interval, and checks the final turn even if it falls between intervals. The **reporting period** starts at the first configured turn. After an issue prints, it starts on the following turn. For example, if turn 100 publishes and turn 105 skips, the check at turn 110 covers turns 101 through 110.

| Setting under **Recording > Advanced** | Effect |
| --- | --- |
| **Publication frequency** | Standard pace turns (stock default: five, which becomes eight recorded turns on Epic). |
| **Comparison duration** | Lookback for comparison snapshots. Choose recorded or Standard pace turns. History can reach before the first check, down to turn zero. Use zero to omit comparison snapshots. |
| **Speed multiplier override** | Used when the recording has no recognized pace. Without an override, replay assumes Standard and labels the assumption. |
| **Inspect evidence only** | Under **Replay purpose**, check evidence without creating a run or output database. Its separate check interval follows **Duration units**. The event window starts after the preceding check. |

### Stop, resume, or start fresh

| Action | What it does |
| --- | --- |
| **Stop after current check** / **Continue** | Finish the current check and pause, or continue from the saved cursor. |
| **Save preferences** | Apply frequency and LLM preferences to future checks. The next cutoff is scheduled from the last completed check, even after a skip. The current editor still uses authored rules and records when it falls back to them. |
| **Resume** | Reopen a saved run after a server restart. Under **Recording > Saved run**, use its run ID and output path with the original recording and player. Replay checks the recording's bytes and restores the saved catalogue, preferences, and schedule. Choose **Continue** to advance. |
| **New run** / **Branch run** | Start with fresh publication history. A branch records its parent. Use a new run after changing rules or templates; an existing run keeps its saved catalogue. |

Reloading the page can restore the active server session. New runs receive a run ID if one is omitted; an existing ID for that receiver conflicts. The default store is a versioned SQLite file under `.tmp/newspaper/` in the host working directory. Keep it separate from the recording. Replay leaves unsupported store versions untouched; use a different output path to regenerate those editions.

### Read Replay diagnostics

Open **Replay diagnostics** below the paper to find out why a template never prints.

**Template coverage** groups every authored template by desk (the catalogue file that defines it, such as `cities-conflict` or `war-fronts`). You can regroup by stage or tag, filter by tag or stage, and search by template or rule ID. Each template shows the furthest stage it failed to pass across the run's checks:

| Stage | Meaning | Where to look |
| --- | --- | --- |
| Printed | Printed at least once, alone or merged into a roundup story. | |
| Passed over | Reached the editor but never printed. | The outcome counts (outranked, conflict, printed before, not positive, unpublished) and its best score against the weakest printed story in those checks. |
| Weighted out | Its rules matched, but the template weight was zero. | The template's `weight`. |
| Unprintable | No variant could fill all its placeholders, or every variant weighed zero. | Variant placeholders and weights. |
| Not together | Each of its rules fired, but never on the same subject in overlapping periods. | The partial match count and each rule's subjects. |
| Not fired | At least one of its rules never fired. | The rule funnel below. |

Expand a template to see its rules' funnels: how many subjects each rule checked over the run, how many fired, and which guard stopped the rest, with the guard's expression. For example, `city-under-siege` might check 820 city subjects, fire none, and stop 790 at `when[1]`. A rule with no subjects never saw a visible entity of its subject kind; a disabled rule never runs. Other stops are repeat memory, a failed chance draw, a group below its minimum size, or evidence hidden from the receiver.

**Skipped checks in this batch** lists cutoffs and skip reasons. **Selected edition** lists each printed article with its template, rules, subject, importance, and editor score, followed by the strongest candidates that check did not print and the score they needed. **Inspect cutoff** appears only for **Inspect evidence only** replays. It queries the current window without advancing and shows the permitted values, dates, and row IDs behind each observation.

Coverage is saved with each check. Checks run before coverage existed have none, so the summary counts the editions they printed separately; start a new run to cover them.

## Generate examples from the command line

From the repository root, replace `recordings/game.db`, the player ID, and the turns with values from your recording. Use a new or empty output directory:

```sh
npm run newspaper -w vox-agents -- --database recordings/game.db --player 7 --from 24 --to 99 --output .tmp/newspaper-examples
```

Use `--help` for all options. Paths resolve from the directory where you invoked npm.

| Option | When to use it |
| --- | --- |
| `--from`, `--to` | Check an inclusive range. The first turn defaults to zero. Use the same turn for both to inspect one cutoff without earlier publication history. |
| `--every` | Change the frequency in Standard pace turns (default: five). |
| `--comparison` | Change the comparison history in recorded turns (default: ten; zero omits it). |
| `--config` | Add an editorial catalogue overlay. |
| `--render-turns` | Request PNGs for comma-separated cutoffs in the range, for example `--render-turns 29` when the example recording uses Standard pace. Only published editions render. Stop the Vox Deorum server first: PNG mode rebuilds the shared reader and launches installed Edge or Chrome. If the build is interrupted, rebuild the reader before restarting the server. |

Open the output's `index.html` to read the issues and find the audit for each check. `audit-<turn>.json` records the editorial decision even when the check skips, including its template `coverage`; `issue-<turn>.json` holds a published issue. `run.json` indexes the results, and `replay.sqlite` holds the editions, article sources, and checkpoint. If the CLI stops partway through, resume in the browser with run ID `examples` and `replay.sqlite` as the output path. A CLI rerun needs a fresh directory.

### Iterate on a rule or overlay

An **overlay** is a folder that mirrors the stock catalogue. To change settler coverage, for example, put a rule with the existing ID under `triggers/cities-settlement.json` in that folder. Follow the [catalogue merge rules](editorial.md#catalogue-and-eligibility) and pass the folder with `--config` or **Recording > Advanced > Editorial config directory**.

Compare fresh runs with the same recording, player, turn range, and frequency. For a missing story, start with its stage in **Template coverage** or in the audit's `coverage` field. Then trace its [trigger match](triggers/overview.md#how-a-check-evaluates-triggers) and check the candidate decision, `mergedInto`, and `choiceErrors`. For appearance changes, inspect `designSelection` for the previous design, reason, and candidate weights. The audit's `mastheadRuleId` identifies the rule that supplied the title when one won.

## Historical evidence-query verification

Use **Inspect evidence only** to verify dated visibility. Compare a city's row date with the cutoff, and check that each visible event has the expected participants. A recording can keep a final national summary after a civilization is eliminated. A city can disappear after a visible capture or raze, even when the event is outside the requested window. The diagnostics distinguish unresolved lifecycle coordinates from ambiguous same-turn ordering. See [evidence and visibility](triggers/facts.md#evidence-the-facts-rely-on).

### Replaying private espionage reports

Run the same turn range twice with separate outputs, once as the spy's owner and once as the defender. Use the [probe catalogue](triggers/examples.md#probe-catalogue-examples) or inspect the evidence directly. Compare the same operation in both audits. The owner can infer a technology from a matching gain; the defender's account uses its own evidence. See [event facts](triggers/facts.md#event) for the matching rules.

### Replaying front reports and ship launches

With the [probe catalogue](triggers/examples.md#probe-catalogue-examples), inspect a cutoff with a known tactical zone and one with a naval unit completion. Check that the front report cites a dated zone observation. A launch cites the training, earlier creation, and city observations; a purchase cannot qualify. See [tactical observations](triggers/facts.md#tactical-observations) and [inferred city facts](triggers/facts.md#inferred-city-facts).

## Source, storage, and API

| Source | Responsibility |
| --- | --- |
| `mcp-server/src/newspaper/queries.ts`, `projection.ts` | Read dated evidence with visibility and field filtering. Replay opens the recording read-only. The MCP tool uses the same query and requires a cutoff before the current game turn. |
| `replay/session.ts`, `replay/store.ts` | Serialize requests and save each edition, its sources, the check's template coverage, and the latest checkpoint together. The archive keeps editions, coverage, and votes; use CLI audits for full per-cutoff decisions. Failed reads or writes leave the cursor unchanged. Resume after a conflict from a concurrent write. |
| `editorial/coverage.ts`, `contracts/coverage.ts` | Summarize where each template stopped in one check (rule stops, template matching, editor outcomes) and combine the saved checks into one stage per template. Desks come from the catalogue file names. |
| `replay/http.ts`, `contracts/replay.ts`, `contracts/archive.ts` | Loopback API under `/api/newspaper/replay`. Use `POST /advance` to step the session and add `?view=summary` to omit the full evidence and decision. `POST /evidence` inspects the cutoff. `GET /issues` and `GET /issues/:issueId` read the archive. `GET /coverage` returns the run's template coverage, and `GET /coverage/:turn` returns one check's coverage with every candidate's outcome and score. Publication advances, vote writes, and preference writes carry a run ID and receiver, and archive and coverage reads accept the same scope; a stale scope returns 409. |

Relative source paths start in `vox-agents/src/newspaper/`. For tests, see [catalogue and projection checks](triggers/overview.md#verify-changes) and [reader and export tests](renderer.md#run-the-tests).
