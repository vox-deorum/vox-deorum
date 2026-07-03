# Strategist Orchestrator

> This plan adds a **strategist orchestrator** to Vox Deorum. A strategist workflow becomes editable data: a sandboxed script, per-subagent manifests, and templated prompt files, executed inside a per-run working folder. A non-blocking orchestrator then reviews recent runs in repeated cycles and iteratively improves those artifacts.
> This document is the specification: what we want to achieve and the constraints that keep it coherent. Design and staged implementation plans come after, in this folder.

## Summary

A strategist workflow stops being TypeScript compiled into the app and becomes three kinds of files: a small sandboxed **script** (control flow), a set of **sub-agents** each described by its own **manifest** JSON file, and a set of **templated markdown prompts**. The script expresses the per-turn decision logic similar to existing strategists: sequencing, conditionals on game state, parallel sub-agent calls, and plain computation. For example:

> "if the player controls more than three cities, run the briefer sub-agent (a small-tier model) with `prompts/briefer.md`, writing its output into the run's artifacts; then run the strategist sub-agent with `prompts/strategist.md`, giving it all briefings and the selected status."

A **workflow runtime** in `vox-agents` executes this script on each decision turn inside a **per-run working folder**, where game state is laid out as files that prompts can embed. The turn machinery around it does not change: `VoxPlayer`'s loop, pacing, pause/resume, telemetry, and crash recovery keep working as they do today, and the workflow plugs in as a new `scripted-strategist` in the agent registry. Sub-agent LLM calls go through the existing model-agnostic layer, so a workflow is not tied to any provider.

Separately, a **strategist orchestrator** reviews one workflow on one seat, reading its recent working folders, run records, cost, decision quality and coverage, and victory trends in repeated non-blocking cycles, and rewrites the scripts, manifests, and prompts. Its aim is to grow the seed into plausibly good variants for later selection rather than to prove convergence within one game, and both its notes and the workflow's version line follow the workflow from game to game. It never touches mcp-server and never takes a game action; its edits land on later runs, never the one in flight.

## The scripted workflow

A workflow is defined by three parts, all kept as editable files:

- A **sandboxed TypeScript script** that expresses control flow: sequencing, conditionals on game state, parallel sub-agent calls, artifact passing, and plain computation (a workflow with no LLM at all, like `null`, is just a script).
- A set of **sub-agents**, each with its own manifest JSON file.
- A set of **templated markdown prompts**, one per sub-agent role, using a simple template syntax that interpolates named inputs, e.g., the entirety or parts of game-state files rendered to markdown through `jsonToMarkdown`.

### Sub-agent manifest

- **Role name**: what the script refers to.
- **Model**: a tier chosen from a configurable list (for example `tiny`/`small`/`medium`/`large`), which in turn maps to existing model registry (`config.llms`).
- **Reasoning effort**: `minimal`/`low`/`medium`/`high` levels.
- **Prompt template**: which prompt file it uses.
- **Actions allowlist**: which sanctioned game actions/tools it may call. A briefer calls none; a strategist calls `set-flavors`, `set-research`, `keep-status-quo`, and so on.
- **Read allowlist**: whether and where it may read files (which inputs, how far back into past turns).
- **Write allowlist**: whether and where it may write files.
- **Output file**: where its free-text response goes.
- **Budget**: its per-invocation budget in cost units (below). The workflow script can also impose stop conditions on its own.

Two defaults keep sub-agents simple:

- A sub-agent's free-text response is **auto-written** by the runtime to its declared output file, so a briefer needs no file tools at all.
- File read (or write) access is granted only when a sub-agent needs agency, for example to let it read the past-turn situation itself.

### One cost currency

Budgets, telemetry cost, and the orchestrator's cost signal all use a single unit:

> cost-weighted tokens = token counts * per-token cost coefficients (per tier, with separate weights for cache reads, reads, and writes)

One currency means the orchestrator never juggles multiple budget kinds, and "reward cache usage" falls out of the arithmetic instead of being a special rule. Capturing cached-token counts is new telemetry work: today only raw input/reasoning/output counts are recorded. Cache-aware weighting applies where the provider reports a cached-token breakdown; providers that do not report one are estimated by comparing with adjacent calls in the same turn.

### Runtime and termination

A workflow runtime in `vox-agents` executes the script on each decision turn. It plugs into the existing machinery rather than replacing it: a new `scripted-strategist` agent joins the registry, selectable per player like any strategist, with the workflow name as its parameter; `VoxPlayer`'s turn loop, pacing, concurrent root runs, telemetry, and crash recovery keep working as they do today. The runtime:

- Composes sub-agents with their tier-resolved models through the existing model-agnostic layer (Vercel AI SDK, any provider).
- Branches on game state, reads and writes working-folder files, and calls only the sanctioned actions each sub-agent's manifest allows.

A run terminates in one of three ways:

- **Script completion**: the normal path.
- **Budget exhaustion**: per sub-agent or for the whole run, measured in cost units. Exhaustion degrades gracefully: the runtime asks the sub-agent to respond now and strips its action tools, so it finishes with a final text response rather than being hard-killed. A runaway loop of LLM calls can never stall the game.
- **Script failure**: a script that fails validation, throws, or exceeds its compute bound is terminated safely. The runtime falls back to `keep-status-quo` so the seat never stalls, and the failure lands in the run record for the orchestrator to read, debug, and fix in a later cycle. Because the orchestrator authors these scripts, this path is a first-class requirement, not an afterthought; the commit gate (below) keeps most broken versions from ever being adopted.

### Working folder

Each seat (game, player) gets a working folder, fully inspectable by the orchestrator; each run (one decision turn) gets a subfolder inside it:

- **Game state as files**: the runtime writes per-component snapshots (`players.json`, `cities.json`, `military.json`, `options.json`, `victory.json`, `events.json`) from the same reports the strategists consume today. They are read-only inputs, embeddable in prompts via the template.
- **Shared cross-turn artifacts**: a `shared/` area beside the turn folders carries state between turns, the scripted counterpart of today's working memory (`focus-briefer` requests, pending `find-episodes` queries). Deliberately *not* called memory: memory is a separate expansion below.
- **Artifacts**: intermediate outputs of the run's sub-agents, auto-written or script-written.
- **Run record**: derived from the telemetry spans; the SQLite telemetry pipeline is unchanged and remains the source of truth. A renderer produces a markdown master record (which sub-agents fired, the call hierarchy, tokens and cost per component, the workflow version the run pinned) plus one markdown transcript per sub-agent conversation. The record is rendered on every terminal path (completion, budget exhaustion, abandonment, script failure) from whatever spans were flushed; a partial record for a broken run is expected and is exactly what the orchestrator wants to read.
- **Retention**: working folders are retained over a configurable window that covers the orchestrator's review horizon and pruned beyond it.

Proposed layout, to be confirmed in design:

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

# Per-seat working folder (produced by the runtime):
<gameId-playerId>/
  shared/                      # cross-turn artifacts (focus requests, episode queries, ...)
  turn-{N}/                    # one run = one decision turn
    state/                     # read-only per-component game-state snapshots, readable by workflows when granted permission
      players.json
      cities.json
      ...
    artifacts/                 # sub-agent outputs, readable/writable by workflows when granted permission
      briefing.md
      ...
    record/                    # derived from telemetry spans, hidden from workflows
      run.md                   # master record: sub-agents fired, hierarchy, tokens + cost, version
      briefer.md               # one transcript per sub-agent conversation
      ...
```

### Sandbox

The script substrate is sandboxed TypeScript. Scripts are treated as untrusted, LLM-authored code, and the allowlists are the trust boundary:

- The sandbox root is the **seat working folder**:
  - `artifacts/` and the seat's `shared/` area are readable and writable;
  - `state/` and prior turns' folders are read-only;
  - Everything outside the seat folder is denied, while manifest visibility windows are enforced as read filters within this root.
- The **workflow definition is read-only inside a run**: a script cannot edit its own script, manifests, or prompts, and cannot alter what a manifest grants. Permissions come only from the manifests as committed; only the orchestrator (or a human editing the seeds) changes the workflow.
- It enforces the per-sub-agent action and file-access allowlists.
- It enforces token cost budgets, and bounds the script's own computation (wall-clock/CPU): a `while(true)` in plain code must die as surely as a runaway LLM loop.
- It must be **model-agnostic**: will design a simple interface for the script to operate on. No external packages allowed.
- It supports **parallel sub-agent calls** (the staffed strategist runs three briefers concurrently) and **deterministic computation** (a seeded RNG, for the `null` recreation).
- Host-side primitives (LLM calls, action tools) are awaited across the sandbox boundary.

Candidate sandboxes:

- **QuickJS compiled to WASM** (`quickjs-emscripten`, preferably on the `quickjs-ng` engine variant): the leading candidate. Isolation comes from the WASM memory model; it exposes a memory limit, a stack cap, and an interrupt handler for the compute bound, and host-resolved promises cover awaited and parallel sub-agent calls. Pure WASM means no native build step, which matters on Windows.
- **Hardened JS in a worker** (`ses` from the Endo project, run inside `worker_threads`): capability-based Compartments mirror the manifest allowlist model and run at native V8 speed with ordinary async/await; the worker supplies what lockdown does not, a kill switch and memory caps for the compute bound.

### Recreating the roster

We keep the static strategists and recreate every one as a scripted workflow, except for `human-strategist`. Recreating even the non-LLM ones proves the substrate is general, and it turns the whole roster into starting material.

Verification is by **static unit tests** in the existing mock test tier, with the static strategist as the reference oracle:

- **LLM strategists**: prompt equivalence. Given the same fixture `GameState`, the workflow assembles the same system and user prompts as the original's `getSystem`/`getInitialMessages`. The originals' prompt text is canonical; comparison normalizes only incidental whitespace and formatting, not content.
- **`null`/`none`**: identical action tool-call sequences under a fixed seed.

These tests are a **one-time bootstrap**: they verify the in-repo seed recreations and stay as regression tests for the seeds alone. Orchestrator-adopted versions are expected to diverge and are never held to equivalence. Prompt equivalence also doubles as a requirement on the snapshot writer: the per-component `state/` files must carry everything the original prompts consume, so a workflow can rebuild the same prompt structure from files alone.

Replaying recorded prompts through the oracle tooling is a complementary check. Retiring the static versions is deferred and optional; for now they stay as the verification reference.

### Expansion: workflow memory

The `shared/` folder is plain files, good enough for the current roster's cross-turn needs. A later expansion gives workflows real **memory**: a RAG-backed store/retrieve tool (in the spirit of `find-episodes` over the episode database) that a manifest can grant to a sub-agent like any other tool. It is out of the core stages; it is specified here so the manifest and allowlist design leave room for it, and so "memory" stays reserved for this facility rather than the shared folder.

## The orchestrator

### Definition and objectives

The orchestrator is a **non-blocking revision loop** in the family of the existing offline tools (oracle, telepathist): each **cycle** is a one-shot review, propose, commit pass that runs to completion and exits, matching how those tools run. The *loop* is the sequence of cycles over a **persistent conversation**: the orchestrator keeps its converation thread and resumes it on the next cycle, with stable prompt prefixes so provider prompt caching keeps resumption cheap. Compaction of a long conversation, in the manner of agentic coding tools, happens whenever necessary.

One orchestrator instance owns **one workflow line on one seat**. It reviews one game at a time, because a single game already spans millions of tokens of runs and records. The line, however, outlives any single game: when the workflow moves on to its next game, the next orchestrator run inherits both the version line and the accumulated notes, so artifacts and lessons carry forward together even though each game is reviewed on its own.

Its job is to review the seat's recent runs and rewrite the workflow's scripts, manifests, and prompts, and **success is diversity**: the orchestrator exists to grow a seed workflow into plausibly good variants.

- **Offline mode**: the orchestrator console runs one cycle and exits, or repeats cycles on a configurable cadence. The offline driver is the console itself (or any external scheduler that re-invokes it); nothing inside a game is involved.
- **Online mode**: the strategist session fires a cycle when a trigger condition is met during play. Initial trigger set: a cost spike against the workflow's rolling average; every N completed runs; a budget exhaustion or script failure (the graceful-degradation paths fired); a victory-trend decline.
- **Non-blocking, always**: it never pauses a running strategist. A run pins its workflow version at start; a committed edit applies from the next run onward, mid-game included. Committing immediately per seat is deliberate: the orchestrator debugs a live game, where an edit that fits the current phase only matters if it lands while that phase is still being played, and the next runs are the signal on how it landed.
- **Versioned, with a commit gate**: the runtime resolves a workflow through a configurable path, either the in-repo seeds by default or an orchestrator-managed folder whose `current` pointer names the seat's adopted version. **Commit** is the orchestrator's adoption step, and it is gated: **static checks** over the script, manifests, and prompt references, then a **dry-run** of the workflow against a recent `state/` snapshot with stubbed models and stubbed actions. The dry-run proves control flow, template rendering, and budget wiring without spending tokens or touching a game; the same harness doubles as a testbed for developing workflows by hand. The real test is the next live run, whose record feeds back into the next cycle. A commit that passes becomes a numbered version snapshot with a changelog and an atomic update of the `current` pointer, read once by each run at start. There is **no automatic rollback**: if a committed version still fails in a live run, the failure lands in the run record and the orchestrator debugs and iterates next cycle; moving the pointer back stays available to it as a deliberate edit. The version history is itself input to later cycles, so the orchestrator learns from its own changes, and because run records carry the version that produced them, evidence groups by version instead of a mixed set.
- Both modes are config-gated; offline ships first.

### Reference signals

The orchestrator reads a defined evaluation surface, not raw win/loss (too sparse). These signals are **reference material for its own judgment**: it eyeballs them and makes intuitive improvements, and no attribution protocol or automated optimization is prescribed. Nor do they form an objective function: selecting among workflows by outcome (evolutionary pressure) is a separate external mechanism, out of scope here, so a variant that drifts toward cheap and shallow is a survivable outcome that downstream selection, not the orchestrator, will punish. Each signal is individually enable-able so experiments can isolate one at a time:

- **Decision quality**: an LLM-judge critique of individual strategist decisions and rationales, independent of eventual outcome. Judging is a **capability the orchestrator invokes at its own discretion** (like a developer reaching for a debugger), not a fixed pipeline stage; it decides when, on which decisions, and whether to judge at all.
- **Decision coverage**: a negative signal when a run leaves an available decision unaddressed, for example an empty next-research or policy slot that no sanctioned action filled. mcp-server defines the inventory: its sanctioned tools and game-state reports determine which decision slots exist on a turn. This keeps do-nothing workflows visibly bad even when they are cheap.
- **Cost**: cost-weighted tokens per workflow component (briefer vs strategist), sourced from telemetry, cache-aware as defined above. Latency is excluded: it is not a stable measurement, and compute is already accounted for through cost.
- **Victory trend**: civ-bench estimates when available; otherwise the in-game **score ratio** (the seat's score divided by the current maximum, a 0-to-1 value in the same units as a victory probability). Either way, the signal is consumed as a smoothed trend over a window and gated by game phase (see the calling convention below).

### What it reads and writes

The orchestrator's context is a dedicated, recorded set of inputs in its own working folder:

- The **workflow definition** it is improving: script, manifests, prompts, its version history and changelogs, and its prior notes.
- The seat's **recent working folders**: state snapshots, artifacts, the shared cross-turn area, and the derived run records and sub-agent transcripts, grouped by the version that produced them.
- **Per-component cost** (cost-weighted tokens), grounded in real telemetry.
- The **decision-quality judge** as an on-demand capability, and the **victory trend** (civ-bench or score ratio).
- The **full tool and game-state schema**: a snapshot built from the cached MCP tool definitions the oracle already uses, extended with the game-state report schemas, produced by the runtime or a build step, never fetched live.
- The **workflow substrate reference**: the script API surface and the template syntax, so it can author valid scripts and prompts without guessing.
- An **example game state**: a representative `state/` snapshot fixture checked in beside the workflow seeds.
- The **available model tiers and their descriptions** plus the reasoning-effort options, so it can pick a tier and effort per sub-agent without knowing concrete model names.

Its writes are strictly bounded:

- It writes **only** workflow scripts, sub-agent manifests, prompt files (as drafts and version snapshots in its own working folder), and its own **notes** (a scratch memory it keeps for itself, including the persistent conversation).
- It has no mcp-server access, no action tools, and no live game control. The boundary is enforced, not merely conventional, and it is bounded from above: the universe of sanctioned actions is defined by Vox Deorum itself through mcp-server. The orchestrator's edits shape which of those actions later runs take (that is its purpose), but it can never grant an action that does not already exist there.

The orchestrator's own model is configured like any agent's, through the model registry. Its core stays provider-agnostic, with its file edits going through runtime-provided tools, but when its model is `claude-code`, it may use the Agent SDK's path-scoped file tools instead; that reuse is an option, never a requirement.

### civ-bench calling convention

civ-bench is an external process, not part of this repository. This spec defines only how we talk to it:

- **What it does**: reads a game-state snapshot and returns a per-player victory-probability estimate for that turn.
- **How we call it**: vox-agents spawns the civ-bench CLI per evaluation, passing at least the game id, the current turn, and the path to the run's `state/` snapshot folder (the same per-component files the workflow consumed); it returns per-player estimates as JSON on stdout. Invocation cadence is configurable.
- **How we read it**: it is a noisy probability model. Oscillation is normal and early-game estimates are near meaningless, so it is never read as per-turn ground truth. The system consumes it as a smoothed, phase-gated trend.
- **When it is on**: assumed available and on by default; it can be disabled, in which case the smoothed score ratio substitutes as the victory trend.
- The estimator's internal model is out of scope.

## Component impact

- **`vox-agents`**: the bulk of the work. The workflow format (sandboxed TypeScript script, per-subagent manifests, templated prompts), the working-folder model with the shared cross-turn area and retention, the workflow runtime with cost-unit budgets, graceful termination, and the script-failure fallback, the `scripted-strategist` agent, the recreated roster and its static unit tests, the run-record renderer over telemetry spans, cached-token telemetry capture, the tier-to-model and cost-coefficient configuration, the version-pointer resolution, the commit gate (static checks and the stubbed dry-run testbed), the orchestrator cycles with persistent conversation, the decision-quality judge capability, the decision-coverage and score-ratio signals, and the civ-bench CLI client.
- **`mcp-server`**: expected largely unchanged. The runtime uses existing tools; the schema snapshot builds on the existing cached tool-definition mechanism.
- **civ-bench**: external, not in this repo. This plan defines only the calling convention.
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
- A malformed or crashing script never stalls a seat: the commit gate rejects broken versions before adoption, and a script that still fails in a live run falls back to `keep-status-quo` with the failure in the run record.
- Run records show cache-aware, per-component cost in the single cost currency, derived from real telemetry, stamped with the workflow version.
- An offline orchestrator cycle, given the seat's recent working folders and records, commits a versioned, changelogged edit that lands on a later run (mid-game included) without blocking any running strategist, and its changelog cites the reference signals it read.
- The orchestrator resumes its reasoning trail across cycles and across games: the persistent conversation is observable in its working folder, a cycle's proposals reference conclusions recorded by earlier cycles, and the first cycle on a new game inherits and references the prior game's notes and version history for the same workflow line.
- Repeated cycles yield substantively distinct committed versions (changed control flow, sub-agent composition, tiers, or prompts, not cosmetic rewrites), giving downstream evaluation a version line of plausibly good variants to select from.
- The orchestrator loop runs online, fires on a trigger condition, and its edit lands on a subsequent run rather than the one in flight.
- The victory trend (civ-bench when available, the smoothed score ratio otherwise) is consumed as a smoothed, phase-gated trend, and runs that leave available decisions unaddressed surface as a negative coverage signal in the orchestrator's evidence.
- A test proves the orchestrator cannot reach mcp-server or issue a game action: only script, manifest, prompt, and note writes in its working folder succeed.
