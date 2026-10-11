# Stage 3: File mode and telemetry

Part of the [context-records plan](../context-records.md). **Status: planned.**

## Objective

Point bash-capable runs to the records, reduce the simple strategist's inline context, and record each run's workspace snapshot for replay.

## Dependencies

Stage 1 records `context.prompts`. Stage 2 supplies the section registry, the records and reference mounts, and authoring spans on commits.

## Current state

| Area | Existing behavior and source |
| --- | --- |
| Agent preparation | `infra/vox-execute.ts` prepares system text, initial messages, and run tools in that order, then resolves triage before the first model step. Staffed strategists request their briefings inside `getInitialMessages`, so briefer runs finish during preparation. |
| Bash access | `getRunTools` in `infra/vox-agent.ts` adds bash when the seat has files enabled and `getActiveTools` returns a nonempty list. Strategists, the diplomat, the spokesperson, and the negotiator qualify. Briefers and the diplomatic analyst return an empty active list, so they never get bash; a briefer's extra tools registered for callers do not change that. File-enabled runs use the seat's `files.quota` as a step-budget floor. |

## Approach

### Choosing file mode

`vox-execute.ts` resolves the run's tools with `getRunTools` first, then prepares the system text and initial messages, and stores the resolved list on the execution frame. `fileMode(context)` reads that list and returns true when files are enabled and the run's tools include bash. An undefined tool list means all registered tools.

### What each agent sees

| Agent | Inline content with files enabled |
| --- | --- |
| Simple strategist | Its system message as today; strategies, victory progress, players, and decision context; records directions instead of cities, military, and events |
| Briefed, staffed, and learned strategists | Today's inline content plus records directions |
| Diplomat, spokesperson, negotiator | Today's inline content plus records directions |
| Briefers, diplomatic analyst | Today's inline content (no bash, so no file mode) |

The simple strategist's reduced set is its core prompt, produced by one file-mode branch in its builder. The others append a records-directions message. Every file-mode strategist receives an explicit current turn and last completed decision turn, including when that decision was the previous turn. An unset last decision is reported as no completed decision on the current timeline. A strategic players summary will replace the full players section after the first revision lands; until then, full players stay inline.

### Records directions

`recordsDirections(parameters, state)` in `knowledge/` names `/workspace/records` and `/workspace/reference`, the recorded turn range, the current `turn-<N>/` folder, and `CATALOG.md`. For strategists, pass the current turn and `parameters.lastDecisionTurn` explicitly. List the sections omitted from inline context and their file patterns, including `turn-<N>/events-all.md` and the economic, military, diplomatic, others, and system event files from Stage 2. Explain that folders contain refresh slices with original event-turn keys and that the catalog shows gaps.

The strategist decides whether and when to read events, and which turns, categories, and portions to inspect. All recorded turns stay accessible. If its last completed decision was turn 0 and it now acts on turn 5, the same directions expose the patterns for `turn-0/events-all.md`, `turn-0/events-economic.md`, and the other categories through `turn-5/`. The last decision supplies context for its own choice of reads. No host-generated merged event file or mandatory read sequence is added.

Directions stay fixed during the turn and add no cache breakpoint; changing file sizes and newly generated briefings belong in the catalog. An inline briefer retry cannot change the directions or hide event records. This preserves the live envoy's cache boundaries.

### Event handling by input mode

Resolve the actual strategist run's tools before selecting its event-input path, using the same resolved tools as prompt preparation. A strategist whose event input comes from files runs without `withEventWindowFallback` around its decision: context overflow follows the ordinary failed-decision path, leaves `lastDecisionTurn` unchanged, and cannot trigger repeated strategist attempts with progressively filtered event input. The next scheduled or interrupted decision can read the same full history, including records older than the in-memory cache.

Keep the existing merged window and gradual importance filtering for every inline event consumer. Briefed, staffed, and learned strategists still prepare their inline briefings from the pending merged window, and each briefer keeps its own overflow retries. Pacing triage in `strategist/pacing/triage.ts` retains its own copied state and `withEventWindowFallback`; interruption checks keep reading the refresh slice. Runs without bash keep the current strategist fallback as well. Split inline event preparation from the file-mode strategist decision so an inline consumer's retry does not rerun a file-mode strategist with progressively filtered event input. Pacing, successful-decision tracking, and event-cursor advancement otherwise keep their existing contracts.

Diplomacy background, deals, conversation rows, and historical episodes remain in their existing agent contexts. Telepathist and archivist contexts remain without files.

### Workspace telemetry

Record three facts on every agent span:

| Attribute | Meaning |
| --- | --- |
| `context.files` | The context's resolved files setting (game access, shared folders and their access, quota), or `false` |
| `context.workspace` | The seat store's head commit at the run's first model step, when files are enabled, including its empty initial commit if no content has been written |
| `context.prompts` | The resolved custom prompt folder, or `false`, so analysis can group rows by prompt set. Replay ignores it because the recorded system text already contains the custom prompt |

Whether a run used file mode follows from `context.files` and the recorded step tools, so it is not stored separately.

`vox-execute.ts` captures `context.workspace` after preparation (system text, initial messages, run tools, and triage) and immediately before the first model step, not when the agent span opens. A staffed strategist's briefer runs finish inside `getInitialMessages` and archive their briefings; capturing at the span's start would miss them, so a replayed bash call could not find files the live run's first step could read. A run that stops before any model step records none.

The retriever carries these fields into `RetrievedRow`. Missing fields on older rows default to files disabled. Replay enables file support from `context.files`, not by inspecting prompt text.

## Work items

- Move `getRunTools` ahead of prompt preparation in `vox-execute.ts` and store the result on the execution frame for `fileMode`.
- Add `recordsDirections` and the simple strategist's file-mode branch; append the directions in the briefed, staffed, and learned strategists, `LiveEnvoy`, and `Negotiator` when in file mode.
- Pass current and last completed decision turns into strategist directions at every cadence. Separate inline event-window preparation and retries from the file-mode strategist decision in `strategist/vox-player.ts` and the briefing preparation path; preserve inline briefer and pacing-triage behavior in `strategy-parameters.ts` and `briefer/briefing-utils.ts`.
- Record `context.files` on each agent execution and capture `context.workspace` immediately before its first model step.
- Carry the telemetry fields into `RetrievedRow` with backward-compatible defaults.

## Verify

| Area | Required checks |
| --- | --- |
| File mode | Uses the tools resolved before prompt preparation; runs without bash and agents without tools stay inline; the simple strategist's sections and record paths are correct with controlled state, including the temporary full players section; directions are appended for envoys and the negotiator without adding a cache breakpoint |
| File events | At turn 5 after a turn-0 decision, directions identify both turns and the per-turn all/category patterns; the strategist can choose reads from turns 0-5 without merged inline events; every-turn runs use the same access rules; an unset last decision is explicit; old records remain readable after cache culling; file-mode overflow does not retry with filtered events or advance the last decision; inline briefing retries leave directions and files unchanged |
| Inline events | Files-disabled and bash-restricted strategists retain merged pending events, importance-tier retries, and the final current-turn fallback; file-enabled seats' inline briefers and pacing triage retain the same event handling |
| Telemetry | Recorded files setting or `false`; a staffed strategist's recorded commit includes the briefings archived during its preparation; an early chat before any turn, briefing, or note commit records the empty initial commit; a run with no model step records no workspace commit; older rows default to files disabled |

Run the existing caching, step-budget, envoy, analyst, and negotiator suites. Confirm files-disabled prompts still pass the unchanged golden tests.

## Documentation

Update `docs/developers/vox-agents/prompts.md` with core prompts, last-decision context, per-turn event categories, the strategist's choice of file reads, and unchanged inline event filtering; update `docs/developers/vox-agents/oracle.md` with the recorded workspace fields.

## Risks and open questions

- **Latency:** the simple strategist may spend more steps reading reports. It uses the existing files quota and compaction behavior.
- **Players summary:** the strategic summary must be designed before the full players section leaves the simple strategist's file-mode prompt.

## Done when

Only bash-capable runs receive records directions; other runs stay inline. The simple strategist reads detailed cities, military, and events from records while keeping its core and the temporary full players section. File-mode strategists know their last completed decision turn and choose their own event reads at every pacing cadence; inline consumers keep merged windows and gradual filtering. Each run's first-step snapshot includes briefings archived during its preparation, and files-disabled behavior remains unchanged.
