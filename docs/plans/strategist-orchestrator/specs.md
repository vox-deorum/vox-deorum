# Strategist Orchestrator

> This plan adds a **strategist orchestrator** to Vox Deorum. A strategist workflow becomes editable data: a sandboxed script, per-subagent manifests, and templated prompt files, executed inside a per-run working folder. A non-blocking orchestrator then reviews recent runs in repeated cycles and iteratively improves those artifacts.
> This document is the specification: what we want to achieve and the constraints that keep it coherent. Design and staged implementation plans come after, in this folder.

## The feature in one paragraph

A strategist workflow stops being TypeScript compiled into the app and becomes three kinds of files: a small sandboxed **script** (control flow), a set of **sub-agents** each described by its own **manifest** JSON file, and a set of **templated markdown prompts**. The script expresses the per-turn decision logic that today lives inside the strategist agents (`simple-strategist` and its briefed/staffed/learned variants): sequencing, conditionals on game state, parallel sub-agent calls, and plain computation. For example: "if the player controls more than three cities, run the briefer sub-agent (a small-tier model) with `prompts/briefer.md`, writing its output into the run's artifacts; then run the strategist sub-agent with `prompts/strategist.md`, giving it all briefings and the selected status." A **workflow runtime** in `vox-agents` executes this script on each decision turn inside a **per-run working folder**, where game state is laid out as files that prompts can embed. The turn machinery around it does not change: `VoxPlayer`'s loop, pacing, pause/resume, telemetry, and crash recovery keep working as they do today, and the workflow plugs in as a new `scripted-strategist` in the agent registry. Sub-agent LLM calls go through the existing model-agnostic layer, so a workflow is not tied to any provider. Separately, a **strategist orchestrator** reviews recent working folders, run records, cost, decision quality, and civ-bench victory trends in repeated non-blocking cycles, then rewrites the scripts, manifests, and prompts to improve the workflow. The orchestrator never touches mcp-server and never takes a game action; its edits land on later runs, never the one in flight.

## The scripted workflow

### Anatomy

A workflow is defined by three parts, all kept as editable files:

- A **script** that expresses control flow: sequencing, conditionals on game state, parallel sub-agent calls, artifact passing, and plain computation (a workflow with no LLM at all, like `null`, is just a script). The substrate is **sandboxed JavaScript/TypeScript** — expressive enough for the whole roster, executed under the sandbox constraints below.
- A set of **sub-agents**, each with its own manifest JSON file.
- A set of **templated markdown prompts**, one per sub-agent role, using a simple template syntax that interpolates named inputs — including game-state files rendered to markdown, as `jsonToMarkdown` renders them into prompts today.

Each **sub-agent manifest** specifies at least:

- **Role name**: what the script refers to.
- **Model**: a tier chosen from a configurable list (for example `tiny`/`small`/`medium`/`large`), plus a reasoning effort from the existing `minimal`/`low`/`medium`/`high` levels. Manifests never name concrete models; a configuration maps tiers to entries in the existing model registry (`config.llms`), keeping workflows portable.
- **Prompt template**: which prompt file it uses.
- **Actions allowlist**: which sanctioned game actions/tools it may call. A briefer calls none; a strategist calls `set-flavors`, `set-research`, `keep-status-quo`, and so on.
- **File-access allowlist**: whether it may read files (which inputs, over what visibility window — how far back into past turns) and whether it may write files at all.
- **Output file**: where its free-text response goes.
- **Budget**: its per-invocation budget in cost units (below), with an optional stop condition.

Two defaults keep sub-agents simple:

- A sub-agent's free-text response is **auto-written** by the runtime to its declared output file, so a briefer needs no file tools at all.
- File read (or write) access is granted only to give a sub-agent agency, for example to let it read the past-turn situation itself.

### One cost currency

Budgets, telemetry cost, and the orchestrator's cost signal all use a single unit: **cost-weighted tokens** — token counts multiplied by a per-model **relative coefficient**, manually configured alongside the model registry. The weighting is **cache-aware**: cache-read input tokens count at roughly one tenth of uncached input, so workflows that keep their prompts cache-friendly are automatically cheaper on every measure. One currency means the orchestrator never juggles multiple budget kinds, and "reward cache usage" falls out of the arithmetic instead of being a special rule.

Capturing cached-token counts is new telemetry work: today only raw input/reasoning/output counts are recorded. Cache-aware weighting applies where the provider reports a cached-token breakdown; providers that do not report one are counted as fully uncached (a conservative overcount), and the local tokenizer estimate never substitutes for provider-reported cache counts.

### Runtime and termination

A workflow runtime in `vox-agents` executes the script on each decision turn. It plugs into the existing machinery rather than replacing it: a new `scripted-strategist` agent joins the registry, selectable per player like any strategist, with the workflow name as its parameter; `VoxPlayer`'s turn loop, pacing, concurrent root runs, telemetry, and crash recovery keep working as they do today. The runtime:

- Composes sub-agents with their tier-resolved models through the existing model-agnostic layer (Vercel AI SDK, any provider).
- Branches on game state, reads and writes working-folder files, and calls only the sanctioned actions each sub-agent's manifest allows.
- Exposes a **blocking human-decision primitive** (present the turn's options, await the submission) as a host-side capability the script awaits across the sandbox boundary — the script calls it like any other runtime primitive; it does not run inside the sandbox. It is built on the existing human-control machinery; while it blocks, the game stays paused exactly as today, and concurrent runs (chats, analysts) proceed. This is what makes `human` a workflow too.

A run terminates in one of three ways:

- **Script completion**: the normal path.
- **Budget exhaustion**: per sub-agent or for the whole run, measured in cost units. Exhaustion degrades gracefully: the runtime asks the sub-agent to respond now and strips its action tools, so it finishes with a final text response rather than being hard-killed. A runaway loop of LLM calls can never stall the game.
- **Script failure**: a script that fails validation, throws, or exceeds its compute bound is terminated safely. The runtime falls back to `keep-status-quo` so the seat never stalls, and the failure lands in the run record. Because the orchestrator authors these scripts, this path is a first-class requirement, not an afterthought: a newly adopted version whose runs fail this way is rolled back automatically to the last-known-good version.

### Working folder

Each seat (game, player) gets a working folder, fully inspectable by the orchestrator; each run — one decision turn — gets a subfolder inside it:

- **Game state as files**: the runtime writes per-component snapshots (`players.json`, `cities.json`, `military.json`, `options.json`, `victory.json`, `events.json`) from the same reports the strategists consume today. They are read-only inputs, embeddable in prompts via the template.
- **Shared cross-turn artifacts**: a `shared/` area beside the turn folders carries state between turns — the scripted counterpart of today's working memory (`focus-briefer` requests, pending `find-episodes` queries). Deliberately *not* called memory: memory is a separate expansion below.
- **Artifacts**: intermediate outputs of the run's sub-agents, auto-written or script-written.
- **Run record**: derived from the telemetry spans — the SQLite telemetry pipeline is unchanged and remains the source of truth. A renderer produces a markdown master record (which sub-agents fired, the call hierarchy, tokens and cost per component, the workflow version the run pinned) plus one markdown transcript per sub-agent conversation. The record is rendered on every terminal path — completion, budget exhaustion, abandonment, script failure — from whatever spans were flushed; a partial record for a broken run is expected and is exactly what the orchestrator wants to read.
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

# Per-seat working folder (produced by the runtime; the workflow's sandbox root):
<gameId-playerId>/
  shared/                      # cross-turn artifacts (focus requests, episode queries, ...)
  turn-{N}/                    # one run = one decision turn
    state/                     # read-only per-component game-state snapshots
      players.json
      cities.json
      ...
    artifacts/                 # sub-agent outputs
      briefing.md
      ...
    record/                    # derived from telemetry spans
      run.md                   # master record: sub-agents fired, hierarchy, tokens + cost, version
      briefer.md               # one transcript per sub-agent conversation
      ...
```

### Sandbox

The script substrate is sandboxed JavaScript/TypeScript; the isolation mechanism is chosen in design, but its requirements are pinned. Scripts are treated as untrusted, LLM-authored code — the allowlists are the trust boundary:

- The sandbox root is the **seat working folder**: the current run's `artifacts/` and the seat's `shared/` area are writable; `state/` and prior turns' folders are readable but read-only; everything outside the seat folder is denied, with read-only access to the workflow definition itself. Manifest visibility windows are enforced as read filters within this root.
- It enforces the per-sub-agent action and file-access allowlists.
- It enforces cost budgets, and separately bounds the script's own computation (wall-clock/CPU) — a `while(true)` in plain code must die as surely as a runaway LLM loop.
- It must be **model-agnostic**: sub-agent LLM calls go through the existing Vercel AI SDK layer, never a provider-locked path. The Agent SDK (claude-code) is Anthropic-only, so it cannot be the general sandbox.
- It supports **parallel sub-agent calls** (the staffed strategist runs three briefers concurrently) and **deterministic computation** (a seeded RNG, for the `null` recreation).
- Host-side primitives (LLM calls, action tools, the human-decision capability) are awaited across the sandbox boundary; a blocked human turn must not starve concurrent chat or analyst runs.

Candidate isolation approaches to weigh in design: a restricted interpreter, V8-level isolation (`isolated-vm` / worker with a capability shim), or OS/container isolation with models still routed through the app.

### Recreating the roster

We keep the static strategists and recreate every one as a scripted workflow: `simple-strategist`, `simple-strategist-briefed`, `simple-strategist-staffed`, `simple-strategist-learned`, `none-strategist`, `null-strategist`, and `human-strategist`. Recreating even the non-LLM ones proves the substrate is general. (The recreations target the registered agents; `VoxPlayer`'s separate hard-coded `"none"` fast-path stays as-is.)

Verification is by **static unit tests** in the existing mock test tier, with the static strategist as the reference oracle:

- **LLM strategists**: prompt equivalence — given the same fixture `GameState`, the workflow assembles the same system and user prompts as the original's `getSystem`/`getInitialMessages`. The originals' prompt text is canonical; comparison normalizes only incidental whitespace and formatting, not content.
- **`null`/`none`**: identical action tool-call sequences under a fixed seed.
- **`human`**: the workflow presents the same decision payload and maps a submission onto the same action calls (deliberately scoped to payload and action mapping).

Replaying recorded prompts through the oracle tooling is a complementary check. Retiring the static versions is deferred and optional; for now they stay as the verification reference.

### Expansion: workflow memory

The `shared/` folder is plain files — good enough for the current roster's cross-turn needs. A later expansion gives workflows real **memory**: a RAG-backed store/retrieve tool (in the spirit of `find-episodes` over the episode database) that a manifest can grant to a sub-agent like any other tool. It is out of the core stages; it is specified here so the manifest and allowlist design leave room for it, and so "memory" stays reserved for this facility rather than the shared folder.

## The orchestrator

### Definition and objectives

The orchestrator is a **non-blocking improvement loop** in the family of the existing offline tools (oracle, telepathist): each **cycle** is a one-shot review→propose→adopt pass that runs to completion and exits, matching how those tools run. The *loop* is the sequence of cycles over a **persistent conversation**: the orchestrator keeps its reasoning trail in its own working folder and resumes it on the next cycle, with stable prompt prefixes so provider prompt caching keeps resumption cheap. One orchestrator instance is responsible for one workflow, reviewing that workflow's runs across all seats and games. Its job: review recent runs and rewrite the workflow's scripts, manifests, and prompts to improve it.

- **Offline mode**: the orchestrator console runs one cycle and exits, or repeats cycles on a configurable cadence — the offline driver is the console itself (or any external scheduler that re-invokes it); nothing inside a game is involved.
- **Online mode**: the strategist session fires a cycle when a trigger condition is met during play. Initial trigger set: a cost spike against the workflow's rolling average; every N completed runs; a budget exhaustion or script failure (the graceful-degradation paths fired); a civ-bench trend decline (when enabled).
- **Non-blocking, always**: it never pauses a running strategist. A run pins its workflow version at start; an adopted edit applies from the next run onward, mid-game included.
- **Versioned, with a pinned adoption mechanism**: the runtime resolves a workflow through a configurable path — the in-repo seeds by default, or an orchestrator-managed folder whose `current` pointer names the adopted version. Every adopted edit becomes a numbered version snapshot with a changelog; **adopt** is an atomic update of the `current` pointer, read once by each run at start. Rollback is the same pointer moved back — and happens automatically when a fresh version's runs fail. The version history is itself input to later cycles, so the orchestrator learns from its own changes. Because run records carry the version that produced them, the orchestrator can group evidence by version instead of reasoning over a mixed set.
- **No separate approval gate**: the in-repo seed workflows change only by hand, the orchestrator writes only drafts and versions inside its own working folder, and rollback is cheap — that separation is the safety mechanism.
- Both modes are config-gated; offline ships first.

### Improvement signals

The orchestrator optimizes against a defined evaluation surface, not raw win/loss (too sparse). Each signal is individually enable-able so experiments can isolate one at a time:

- **Decision quality**: an LLM-judge critique of individual strategist decisions and rationales, independent of eventual outcome. Judging is a **capability the orchestrator invokes at its own discretion** — like a developer reaching for a debugger — not a fixed pipeline stage; it decides when, on which decisions, and whether to judge at all.
- **Cost**: cost-weighted tokens per workflow component (briefer vs strategist), sourced from telemetry, cache-aware as defined above. Latency is excluded: it is not a stable measurement.
- **Victory-probability trend**: civ-bench estimates, consumed as a smoothed trend over a window and gated by game phase (see the calling convention below).

### What it reads and writes

The orchestrator's context is a dedicated, recorded set of inputs in its own working folder:

- The **workflow definition** it is improving: script, manifests, prompts, its version history and changelogs, and its prior notes.
- **Recent seat working folders** for runs of that workflow: state snapshots, artifacts, the shared cross-turn area, and the derived run records and sub-agent transcripts — grouped by the version that produced them.
- **Per-component cost** (cost-weighted tokens), grounded in real telemetry.
- The **decision-quality judge** as an on-demand capability, and **civ-bench trends** when enabled.
- The **full tool and game-state schema**: a snapshot built from the cached MCP tool definitions the oracle already uses, extended with the game-state report schemas — produced by the runtime or a build step, never fetched live.
- An **example game state**: a representative `state/` snapshot fixture checked in beside the workflow seeds.
- The **available model tiers and their descriptions** plus the reasoning-effort options, so it can pick a tier and effort per sub-agent without knowing concrete model names.

Its writes are strictly bounded:

- It writes **only** workflow scripts, sub-agent manifests, prompt files — as drafts and version snapshots in its own working folder — and its own **notes** (a scratch memory it keeps for itself, including the persistent conversation).
- It has no mcp-server access, no action tools, and no live game control. The boundary is enforced, not merely conventional.

The orchestrator's own model is configured like any agent's, through the model registry. Its core stays provider-agnostic — its file edits go through runtime-provided tools — but when its model is `claude-code`, it may use the Agent SDK's path-scoped file tools instead; that reuse is an option, never a requirement.

### civ-bench calling convention

civ-bench is an external process, not part of this repository. This spec defines only how we talk to it:

- **What it does**: reads a game-state snapshot and returns a per-player victory-probability estimate for that turn.
- **How we call it**: vox-agents spawns the civ-bench CLI per evaluation, passing at least the game id, the current turn, and the path to the run's `state/` snapshot folder (the same per-component files the workflow consumed); it returns per-player estimates as JSON on stdout. Invocation cadence is configurable.
- **How we read it**: it is a noisy probability model. Oscillation is normal and early-game estimates are near meaningless, so it is never read as per-turn ground truth. The system consumes it as a smoothed, phase-gated trend.
- **When it is on**: optional and configurable, off by default until validated.
- The estimator's internal model is out of scope.

## Component impact

- **`vox-agents`**: the bulk of the work. The workflow format (sandboxed JS/TS script, per-subagent manifests, templated prompts), the working-folder model with the shared cross-turn area and retention, the workflow runtime with cost-unit budgets, graceful termination, and the script-failure fallback, the human-decision primitive, the `scripted-strategist` agent, the recreated roster and its static unit tests, the run-record renderer over telemetry spans, cached-token telemetry capture, the tier-to-model and cost-coefficient configuration, the version-pointer resolution, the orchestrator cycles with persistent conversation, the decision-quality judge capability, and the civ-bench CLI client.
- **`mcp-server`**: expected largely unchanged. The runtime uses existing tools; the schema snapshot builds on the existing cached tool-definition mechanism.
- **civ-bench**: external, not in this repo. This plan defines only the calling convention.
- **`bridge-service`**, **`civ5-dll`**, **`civ5-mod`**: expected unchanged.

## Out of scope

- Only the strategist roster (including `human`, `null`, `none`) becomes workflows; envoys, diplomats, narrators, telepathist, oracle, and archivist are untouched.
- Retiring the static strategists: deferred, optional.
- The workflow memory tool: an expansion after the core, reserved above.
- civ-bench internals.

## Success criteria

- A `scripted-strategist` runs a workflow through a full game, with pacing, actions, telemetry, budget-based termination, and crash recovery behaving as before.
- Every roster member has a scripted recreation that passes its static equivalence tests (prompt equivalence for the LLM strategists; tool-call equivalence for `null`/`none`; decision-payload mapping for `human`).
- A malformed or crashing script never stalls a seat: the run falls back to `keep-status-quo`, the failure appears in the run record, and a failing newly-adopted version rolls back automatically.
- Run records show cache-aware, per-component cost in the single cost currency, derived from real telemetry, stamped with the workflow version.
- An offline orchestrator cycle, given recent working folders and records, adopts a versioned, changelogged edit that lands on a later run — mid-game allowed — without blocking any running strategist; over repeated cycles, at least one adopted edit measurably improves an enabled signal (for example, lower cost at equal decision quality — no particular attribution protocol is prescribed).
- The orchestrator resumes its reasoning trail across cycles: the persistent conversation is observable in its working folder, and a cycle's proposals reference conclusions recorded by earlier cycles.
- The orchestrator loop runs online, fires on a trigger condition, and its edit lands on a subsequent run rather than the one in flight.
- When civ-bench is enabled, its signal is consumed as a smoothed, phase-gated trend and proposals cite that trend data.
- A test proves the orchestrator cannot reach mcp-server or issue a game action: only script, manifest, prompt, and note writes in its working folder succeed.
