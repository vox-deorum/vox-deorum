# Strategist Orchestrator

> This plan adds a **strategist orchestrator** to Vox Deorum. A strategist workflow becomes editable data: a sandboxed script, per-subagent manifests, and templated prompt files, executed against the seat's file workspace. A non-blocking orchestrator then reviews recent runs in repeated cycles and iteratively improves those artifacts. This document is the specification: what we want to achieve and the constraints that keep it coherent. The staged build order lives in [README.md](README.md); individual stage plans are the numbered files beside it.

## Summary

A strategist workflow stops being TypeScript compiled into the app and becomes three kinds of files: a small sandboxed **script** (control flow), a set of **sub-agents** each described by its own **manifest** JSON file, and a set of **templated markdown prompts**. The script expresses the per-turn decision logic similar to existing strategists: sequencing, conditionals on game state, parallel sub-agent calls, and plain computation. For example:

> "if the player controls more than three cities, run the briefer sub-agent (a small-tier model) with `prompts/briefer.md`, writing its output into the turn's notes; then run the strategist sub-agent with `prompts/strategist.md`, giving it all briefings and the selected status."

A **workflow runtime** in `vox-agents` executes this script on each decision turn inside the seat's **file workspace**, where game state is already laid out as files that prompts can embed. The turn machinery around it does not change: `VoxPlayer`'s loop, pacing, pause/resume, telemetry, and crash recovery keep working as they do today, and the workflow plugs in as a new `scripted-strategist` in the agent registry. Sub-agent LLM calls go through the existing model-agnostic layer, so a workflow works with any provider.

Separately, a **strategist orchestrator** reviews one workflow on one seat, reading its recent turns, run transcripts, cost, decision quality and coverage, and victory trends in repeated non-blocking cycles, and rewrites the scripts, manifests, and prompts. Its aim is to grow the seed into plausibly good variants for later selection rather than to prove convergence within one game, and both its notes and the workflow's version line follow the workflow from game to game. It never touches mcp-server and never takes a game action; its edits land on later runs, never the one in flight.

## The scripted workflow

A workflow is defined by three parts, all kept as editable files:

- A **sandboxed TypeScript script** that expresses control flow: sequencing, conditionals on game state, parallel sub-agent calls, artifact passing, and plain computation (a workflow with no LLM at all, like `null`, is just a script).
- A set of **sub-agents**, each with its own manifest JSON file.
- A set of **templated markdown prompts**, one per sub-agent role, using a simple template syntax that interpolates named inputs, such as the entirety or parts of game-state files rendered to markdown through `jsonToMarkdown`.

### Sub-agent manifest

- **Role name**: what the script refers to.
- **Model**: one of the existing model tiers (`small`/`default`/`large`), which resolve through `selectModelReference` to the model registry (`config.llms`) and per-player overrides.
- **Reasoning effort**: `minimal`/`low`/`medium`/`high`/`max`, applied through the existing `@effort` suffix.
- **Prompt template**: which prompt file it uses.
- **Actions allowlist**: which sanctioned game actions/tools it may call. A briefer calls none; a strategist calls `set-flavors`, `set-research`, `keep-status-quo`, and so on.
- **Read allowlist**: whether and where it may read workspace files (which mounts, how far back into past turns).
- **Write allowlist**: whether and where it may write files.
- **Output file**: where its free-text response goes.
- **Budget**: its per-invocation budget in cost units (below). The workflow script can also impose stop conditions on its own.

Two defaults keep sub-agents simple:

- A sub-agent's free-text response is **auto-written** by the runtime to its declared output file, so a briefer needs no file tools at all. Briefings are also archived through `SeatRecords.recordBriefing`, so they land in `records/turn-N/briefings/` like the static strategists' briefings.
- File read (or write) access is granted only when a sub-agent needs agency, for example to let it read the past-turn situation itself.

### One cost currency

Budgets, telemetry cost, and the orchestrator's cost signal all use a single unit:

> cost-weighted tokens = (input - cached) * read + cached * cache read + (output + reasoning) * write

The coefficients are set per tier in config, beside the tier list. One currency means the orchestrator never juggles multiple budget kinds, and "reward cache usage" falls out of the arithmetic instead of being a special rule.

The counts are the normalized per-step counts the agent loop already computes (`stepTokenUsage`) and records on spans, so live budgets and later cost reports agree. Each token is counted once:

| Count | Where it comes from | How it is charged |
| --- | --- | --- |
| Input | The larger of the local count and the provider's figure, since some providers under-report | Read rate, minus the cached share |
| Cached | Provider-reported, a subset of input; zero when the provider gives no breakdown | Cache-read rate |
| Output | Local count of the visible response, excluding reasoning | Write rate |
| Reasoning | The provider's figure, or a local estimate when it reports none | Write rate |

Input and reasoning can therefore be estimates for some providers. The currency is a consistent relative measure for budgets and signals; it does not reconcile against invoices.

### Runtime and termination

A workflow runtime in `vox-agents` executes the script on each decision turn. It plugs into the existing machinery: a new `scripted-strategist` agent joins the registry, selectable per player like any strategist, with the workflow name as its parameter; `VoxPlayer`'s turn loop, pacing, concurrent root runs, telemetry, and crash recovery keep working as they do today. The runtime:

- Composes sub-agents with their tier-resolved models through the existing model-agnostic layer (Vercel AI SDK, any provider).
- Branches on game state, reads and writes workspace files, and calls only the sanctioned actions each sub-agent's manifest allows.

A run terminates in one of three ways:

- **Script completion**: the normal path. A script that finishes without taking any action is a successful no-op, and the runtime adds nothing to it (the `none` recreation relies on this).
- **Budget exhaustion**: per sub-agent or for the whole run, measured in cost units. It degrades gracefully instead of hard-killing anything (rules below).
- **Script failure**: a script that fails validation, throws, or exceeds its compute bound or wall-clock limit is terminated safely. The runtime first cancels every outstanding sub-agent and closes the run to actions, then calls `keep-status-quo` so the seat never stalls, and the failure lands in telemetry for the orchestrator to read, debug, and fix in a later cycle. Because the orchestrator authors these scripts, this path is a first-class requirement; the commit gate (below) keeps most broken versions from ever being adopted.

Budget rules:

- **Charged per step.** The runtime keeps a ledger per sub-agent invocation and one per run, and charges each LLM step as it finishes. (Today the agent loop credits a run's tokens only after the agent ends, which is too late for a live budget.)
- **Bounded overshoot.** Parallel children check the run ledger before each step. Steps already in flight when the budget runs out still finish and are charged, so a run can overshoot by at most one step per concurrent child.
- **Exhaustion.** An exhausted sub-agent gets the existing continuation nudge with its active tools narrowed to none, and one final step with a capped output length to write its response. Once the run budget is exhausted, every further sub-agent invocation is refused with an error the script can see, and running children wind down the same way.
- **Cancellation.** Sub-agent calls carry the run's abort signal. On failure or timeout the runtime aborts outstanding children and waits for them to settle before the fallback. Action primitives check that the run is still open, so a late child can never act after the fallback.

### Working folder

Each seat (game, player) already has a versioned file workspace: a `WorkspaceStore` in SQLite with git-like commits, mounted into a just-bash shell by `PlayerWorkspace`. The workflow runs against the same mounts, and the orchestrator inspects the same store:

- **Game state as files**: `SeatRecords.recordTurn` writes each processed turn to `records/turn-N/` as Markdown plus JSON (players, cities, military, options, victory progress, events, and briefings), drawn from the same reports the strategists consume today. They are read-only inputs, embeddable in prompts via the template.
- **Decision context**: a turn's records alone do not reproduce today's prompts. `recordTurn` writes the refresh's own event slice, while a decision reads context prepared after that: the events merged across the turns pacing skipped since the last completed decision, that last decision turn itself, and the rule that trims the event window when a prompt overflows. One shared builder prepares this context, and `SeatRecords` records it as `records/turn-N/decision.{md,json}` before the script runs. Live runs, templates, and dry-runs all read that record, and the overflow trim is a runtime rule applied the same way in each, so nothing is reconstructed twice.
- **Turn notes and the cross-turn area**: the writable `game/` notes folder holds the run's intermediate outputs (auto-written or script-written) under `game/turn-N/`, and carries state between turns elsewhere in `game/`. This is the scripted counterpart of today's working memory (`focus-briefer` requests, pending `find-episodes` queries). It is deliberately not called memory: memory is a separate expansion below.
- **Shared folders**: `shared/<name>/` folders live on disk and outlive a game, granted per seat by the files setting.
- **Run transcripts**: the SQLite telemetry pipeline is unchanged and remains the source of truth. The orchestrator reads each run as a master record (which sub-agents fired, the call hierarchy, tokens and cost per component, the workflow version the run pinned) plus one markdown transcript per sub-agent conversation, rendered from telemetry spans the way the oracle retriever reads them. Spans flush on every terminal path (completion, budget exhaustion, abandonment, script failure), so a broken run still yields a partial transcript, which is exactly what the orchestrator wants to read. Transcripts are never mounted for the workflow itself.

**One shared view per run.** Today `PlayerWorkspace` opens each shell command against a fresh store snapshot and commits that command's notes afterward, so a child's output would not show up inside an already-running script. A workflow run instead opens one **run session** at start: a single view over the store head with an overlay that holds the run's pending writes.

- The script's file access, each child's scoped view (see Sandbox), template reads, and auto-written outputs all read and write through the same overlay. A write is visible to everyone in the run as soon as it returns, so a child's briefing is readable by the script and by the next child's prompt.
- Children in one parallel batch must declare distinct output files, and the fan-out primitive rejects a batch where they collide. Overlapping free-form writes resolve last-writer-wins, and the transcript records both.
- The session commits once, at run end. After completion or budget exhaustion it commits everything. After a script failure it keeps only the run's `game/turn-N/` outputs as evidence and drops changes to cross-turn state, so the next turn starts from consistent notes.

Layout:

```
# Workflow definition (seeds versioned in-repo; resolution path configurable, like configs/):
workflows/<workflow-name>/
  workflow.ts                  # the sandboxed script (control flow)
  subagents/
    briefer.json               # sub-agent manifests
    strategist.json
  prompts/
    briefer.md                 # templated markdown prompts
    strategist.md

# Seat workspace as a run sees it (existing mounts plus the pinned workflow):
/workspace/
  workflow/                    # pinned workflow definition, read-only
  records/                     # read-only, written by SeatRecords
    turn-{N}/
      players.md, players.json
      cities.md, cities.json
      ...
      decision.md, decision.json   # prepared decision context
      briefings/
  reference/                   # read-only reference material
  game/                        # writable notes for this game
    turn-{N}/                  # run outputs (briefing.md, ...)
    ...                        # cross-turn state
  shared/<name>/               # disk folders that outlive a game, per the files setting
/tmp/                          # scratch
```

### Sandbox

Workflow scripts run in just-bash's **`js-exec`**, the QuickJS (WebAssembly) sandbox the player workspace already enables. Scripts are LLM-authored code, and the allowlists are the trust boundary:

- The sandbox root is the **seat workspace**, seen through the run session:
  - `game/`, `/tmp`, and any writable shared folder are readable and writable;
  - `records/`, `reference/`, and the workflow definition are read-only;
  - Everything outside the mounts is denied.
- The **workflow definition is read-only inside a run**: a script cannot edit its own script, manifests, or prompts, and cannot alter what a manifest grants. Permissions come only from the manifests as committed; only the orchestrator (or a human editing the seeds) changes the workflow.
- Host primitives (sub-agent calls, action tools) reach the script only through `js-exec`'s **`invokeTool`** hook, which exposes them as `tools.*`. Action allowlists are enforced there.
- **File grants are enforced in the filesystem itself.** Files are reached by more than one path (the script's own sandbox file calls, a child's shell tool, and template reads), so a check at `invokeTool` alone cannot hold. For each sub-agent invocation the runtime builds a **scoped view** over the run session: only the mounts its manifest grants, writable only where it grants writes, with past-turn visibility windows applied as read filters. That invocation's shell tool and its template reads both go through this view, so a template can only embed files its sub-agent may read. Views are built per invocation and never modify the seat-wide workspace, so concurrent agents with different grants cannot affect each other.
- It enforces token cost budgets, and bounds the script's own computation through the QuickJS memory cap and a wall-clock limit: a `while(true)` in plain code must die as surely as a runaway LLM loop. The limit is raised above the shell default for workflow runs, since a script waits on LLM calls.
- It must be **model-agnostic**: the script sees only the injected host interface. No external packages are allowed.
- It supports **parallel sub-agent calls** (the staffed strategist runs three briefers concurrently). `invokeTool` calls look synchronous inside QuickJS, so parallel calls go through one host primitive that takes a batch of sub-agent calls and runs them concurrently.
- It supports **deterministic choices** through a keyed `seededIndex` host primitive. It uses the same key scheme as the static `null` strategist (sync seed, player, turn, and a choice label), so a recreation picks exactly what the original picks; a conventional seeded random stream would not.

### Recreating the roster

We keep the static strategists and recreate them as scripted workflows, except for `human-strategist`. Recreating even the non-LLM ones proves the substrate is general, and it turns the roster into starting material. **v1 recreates `null`, `simple`, `simple-briefed`, and `simple-staffed`**; `learned` and its episode retrieval are **deferred with the workflow-memory expansion** (below), since the baseline, briefed, and staffed workflows already exercise the whole substrate.

Verification is by **static unit tests** in the existing mock test tier, with the static strategist as the reference oracle:

- **LLM strategists**: prompt equivalence. Given the same fixture `GameState`, the workflow assembles the same system and user prompts as the original's `getSystem`/`getInitialMessages`. The originals' prompt text is canonical; comparison normalizes only incidental whitespace and formatting. Fixtures cover a decision after turns skipped by pacing (merged events), and both branches of the staffed strategist (one combined briefer for a short event window, three specialized briefers otherwise).
- **`null`/`none`**: identical action tool-call sequences under a fixed seed. For `none` that sequence is empty.

These tests are a **one-time bootstrap**: they verify the in-repo seed recreations and stay as regression tests for the seeds alone. Orchestrator-adopted versions are expected to diverge and are never held to equivalence. Prompt equivalence also checks the records: `records/turn-N` plus its decision context must carry everything the original prompts consume, so a workflow can rebuild the same prompt structure from files alone.

### Expansion: workflow memory

The `game/` notes are plain files, good enough for the current roster's cross-turn needs. A later expansion gives workflows real **memory**: a RAG-backed store/retrieve tool (in the spirit of `find-episodes` over the episode database) that a manifest can grant to a sub-agent like any other tool. It is out of the core stages; it is specified here so the manifest and allowlist design leave room for it, and so "memory" stays reserved for this facility.

## The orchestrator

### Definition and objectives

The orchestrator is itself a **type of agent**, in the same sense a strategist is: a registered agent with its own sub-agents and scoped file and git tools. It runs as a **non-blocking revision loop** in the family of the existing offline tools (oracle, telepathist): each **cycle** is a one-shot review, propose, commit pass that runs to completion and exits, matching how those tools run. The _loop_ is the sequence of cycles over a **persistent conversation**: the orchestrator keeps its conversation thread and resumes it on the next cycle, with stable prompt prefixes so provider prompt caching keeps resumption cheap.

Two mechanisms bound the conversation's size:

- **Within a cycle**, the agent loop's existing compaction trims later workspace traffic and older reasoning.
- **Across cycles**, a separate **rollover** keeps the conversation from growing without end. Existing compaction protects the initial messages, and a restored history is passed in as initial messages, so compaction alone never shrinks it. At the end of a cycle whose history passes a threshold, the orchestrator writes a persisted summary note. Older cycles move to an archive file in its notes, and the next cycle resumes from the stable prefix, the summary, and the most recent cycles in full.

One orchestrator instance owns **one workflow line on one seat**. It reviews one game at a time, because a single game already spans millions of tokens of runs and records. The line, however, outlives any single game: when the workflow moves on to its next game, the next orchestrator run inherits both the version line and the accumulated notes, so artifacts and lessons carry forward together even though each game is reviewed on its own.

Its job is to review the seat's recent runs and rewrite the workflow's scripts, manifests, and prompts, and **success is diversity**: the orchestrator exists to grow a seed workflow into plausibly good variants.

- **Offline mode**: the orchestrator console runs one cycle and exits, or repeats cycles on a configurable cadence. The offline driver is the console itself (or any external scheduler that re-invokes it); nothing inside a game is involved.
- **Online mode**: the strategist session fires a cycle when a trigger condition is met during play. Initial trigger set: a cost spike against the workflow's rolling average; every N completed runs; a budget exhaustion or script failure (the graceful-degradation paths fired); a victory-trend decline.
- **Non-blocking, always**: it never pauses a running strategist. A run pins its workflow version at start; a committed edit applies from the next run onward, mid-game included. Committing immediately per seat is deliberate: the orchestrator debugs a live game, where an edit that fits the current phase only matters if it lands while that phase is still being played, and the next runs are the signal on how it landed.

The orchestrator-managed workflow folder is a **git repository** the orchestrator has scoped access to. The runtime resolves a workflow through a configurable path, either the in-repo seeds by default or this repository, whose **per-seat branch/ref** names the seat's adopted version. **Commit** is the orchestrator's adoption step, and it is gated:

- **Static checks** over the script, manifests, and prompt references.
- **Dry-run** of the workflow against a recent `records/turn-N` snapshot from the seat's store, including its recorded decision context, with stubbed models and stubbed actions. It proves control flow, template rendering, and budget wiring without spending tokens or touching a game; the same harness doubles as a testbed for developing workflows by hand.
- The **real test** is the next live run, whose transcript feeds back into the next cycle.

A commit that passes advances the seat ref atomically, and each run reads that ref once at start to pin its version. A git commit _is_ the version snapshot, its message _is_ the changelog, and `git log` _is_ the history.

If a committed version still fails in a live run, the failure lands in telemetry and the orchestrator debugs and iterates next cycle; a `git revert` stays available to it as a deliberate edit. The version history is itself input to later cycles, so the orchestrator learns from its own changes, and because run transcripts carry the version (the commit) that produced them, evidence groups by version instead of a mixed set.

### Reference signals

The orchestrator reads a defined evaluation surface instead of raw win/loss, which is too sparse. These signals are **reference material for its own judgment**: it eyeballs them and makes intuitive improvements, and no attribution protocol or automated optimization is prescribed. They do not form an objective function either: selecting among workflows by outcome (evolutionary pressure) is a separate external mechanism, out of scope here, so a variant that drifts toward cheap and shallow is a survivable outcome that downstream selection will punish. Each signal is individually enable-able so experiments can isolate one at a time:

- **Decision coverage**: a negative signal when a run leaves an available decision unaddressed, for example an empty next-research or policy slot that no sanctioned action filled. mcp-server defines the inventory: its sanctioned tools and game-state reports determine which decision slots exist on a turn. This keeps do-nothing workflows visibly bad even when they are cheap.
- **Cost**: cost-weighted tokens per workflow component (briefer vs strategist), sourced from telemetry spans as defined above. Latency is excluded: it is not a stable measurement, and compute is already accounted for through cost.
- **Victory trend**: a **single generic victory-trend interface** with pluggable providers. v1 ships the in-game **score ratio** provider (the seat's score divided by the current maximum, a 0-to-1 value in the same units as a victory probability); the external civ-bench connector is a later provider behind the same interface. Either way, the signal is consumed as a smoothed trend over a window and gated by game phase (see the calling convention below).

### What it reads and writes

The orchestrator's context is a dedicated, recorded set of inputs in its own working folder:

- The **workflow definition** it is improving: script, manifests, prompts, its version history and changelogs, and its prior notes.
- The seat's **recent turns**: the seat workspace materialized from its store (records, briefings, and `game/` notes), plus the run transcripts rendered from telemetry, grouped by the version that produced them.
- **Per-component cost** (cost-weighted tokens), grounded in real telemetry.
- The **decision-quality judge** as an on-demand capability, and the **victory trend** (civ-bench or score ratio).
- The **full tool and game-state schema**: a snapshot built from the cached MCP tool definitions the oracle already loads, extended with the game-state report schemas, produced by the runtime or a build step, never fetched live.
- The **workflow substrate reference**: the script API surface (the `tools.*` host primitives) and the template syntax, so it can author valid scripts and prompts without guessing.
- An **example game state**: a representative `records/turn-N` fixture checked in beside the workflow seeds.
- The **available model tiers and their descriptions** plus the reasoning-effort options, so it can pick a tier and effort per sub-agent without knowing concrete model names.

Its writes are strictly bounded:

- It writes **only** workflow scripts, sub-agent manifests, prompt files (as drafts and version snapshots in its own working folder), and its own **notes** (a scratch memory it keeps for itself, including the persistent conversation).
- It has no mcp-server access, no action tools, and no live game control. The boundary is enforced, and it is bounded from above: the universe of sanctioned actions is defined by Vox Deorum itself through mcp-server. The orchestrator's edits shape which of those actions later runs take (that is its purpose), but it can never grant an action that does not already exist there.

The orchestrator's own model is configured like any agent's, through the model registry. Its core stays provider-agnostic, with its file edits going through runtime-provided tools, but when its model is `claude-code`, it may use the Agent SDK's path-scoped file tools instead; that reuse is an option, never a requirement.

### civ-bench calling convention

civ-bench is an external process outside this repository, and its connector is a **deferred provider** behind the generic victory-trend interface (the score ratio ships first). This spec defines only how we talk to it:

- **What it does**: reads a game-state snapshot and returns a per-player victory-probability estimate for that turn.
- **How we call it**: vox-agents spawns the civ-bench CLI per evaluation, passing at least the game id, the current turn, and the path to a materialized `records/turn-N` folder (the same files the workflow consumed); it returns per-player estimates as JSON on stdout. Invocation cadence is configurable.
- **How we read it**: it is a noisy probability model. Oscillation is normal and early-game estimates are near meaningless, so it is never read as per-turn ground truth. The system consumes it as a smoothed, phase-gated trend.
- **When it is on**: until the connector ships, the smoothed **score ratio is the default** provider. When the connector is present it runs on the configured cadence, and disabling it falls back to the score ratio.
- The estimator's internal model is out of scope.

## Component impact

- **`vox-agents`**: the bulk of the work. The workflow format (sandboxed TypeScript script, per-subagent manifests, templated prompts) and its read-only mount in the seat workspace, the workflow runtime on `js-exec` with its `invokeTool` host primitives, the run session and per-invocation scoped views over the seat workspace, the recorded decision context, per-step cost ledgers and budgets, graceful termination with child cancellation, and the script-failure fallback, the `scripted-strategist` agent, the recreated roster and its static unit tests, the run transcripts rendered from telemetry spans, the cost-coefficient configuration, the git-backed version resolution with per-seat ref pinning, the commit gate (static checks and the stubbed dry-run testbed), the orchestrator cycles with persistent conversation and cross-cycle rollover, the decision-quality judge sub-agent (deferred), the decision-coverage and score-ratio signals, and the civ-bench CLI client (deferred provider).
- **`mcp-server`**: expected largely unchanged. The runtime uses existing tools; the schema snapshot builds on the existing cached tool-definition mechanism.
- **civ-bench**: external, outside this repo. This plan defines only the calling convention.
- **`bridge-service`**, **`civ5-dll`**, **`civ5-mod`**: expected unchanged.

## Out of scope

- Only the strategist roster (including `null`, `none`) becomes workflows; envoys, diplomats, narrators, telepathist, oracle, and archivist are untouched.
- Retiring the static strategists: deferred, optional.
- The workflow memory tool: an expansion after the core, reserved above.
- **Evolutionary pressure**: selecting, comparing, or breeding workflows by outcome is a separate, later mechanism. The reference signals exist for the orchestrator's in-context judgment only.
- **Promotion beyond the workflow line**: a line's versions and notes follow it into its next game, but feeding an improved line back into the reusable in-repo seeds, or spreading it to other lines and seats, is deliberately unspecified here.
- civ-bench internals.

## Success criteria

- A `scripted-strategist` runs a workflow through a full game, with pacing, actions, telemetry, budget-based termination, and crash recovery behaving as before.
- Every roster member has a scripted recreation that passes its one-time bootstrap equivalence tests (prompt equivalence for the LLM strategists; tool-call equivalence for `null`/`none` under a fixed seed).
- A malformed or crashing script never stalls a seat: the commit gate rejects broken versions before adoption, and a script that still fails in a live run cancels its outstanding sub-agents, then falls back to `keep-status-quo` with the failure in telemetry. No action lands after the fallback.
- Run transcripts show cache-aware, per-component cost in the single cost currency, derived from real telemetry, stamped with the workflow version.
- An offline orchestrator cycle, given the seat's recent turns and transcripts, commits a versioned, changelogged edit that lands on a later run (mid-game included) without blocking any running strategist, and its changelog cites the reference signals it read.
- The orchestrator resumes its reasoning trail across cycles and across games: the persistent conversation is observable in its working folder, stays bounded in size across many resumed cycles through rollover, a cycle's proposals reference conclusions recorded by earlier cycles, and the first cycle on a new game inherits and references the prior game's notes and version history for the same workflow line.
- Repeated cycles yield substantively distinct committed versions (changed control flow, sub-agent composition, tiers, or prompts, beyond cosmetic rewrites), giving downstream evaluation a version line of plausibly good variants to select from.
- The orchestrator loop runs online, fires on a trigger condition, and its edit lands on a subsequent run instead of the one in flight.
- The victory trend (civ-bench when available, the smoothed score ratio otherwise) is consumed as a smoothed, phase-gated trend, and runs that leave available decisions unaddressed surface as a negative coverage signal in the orchestrator's evidence.
- A test proves the orchestrator cannot reach mcp-server or issue a game action: only script, manifest, prompt, and note writes in its working folder succeed.
