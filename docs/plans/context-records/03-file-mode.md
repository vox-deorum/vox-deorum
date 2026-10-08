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
| Bash access | `getRunTools` in `infra/vox-agent.ts` adds bash when the seat has files enabled and the agent declares at least one tool. Strategists, the diplomat, the spokesperson, and the negotiator qualify. Briefers and the diplomatic analyst declare no tools, so they never get bash. File-enabled runs use the seat's `files.quota` as a step-budget floor. |

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

The simple strategist's reduced set is its core prompt, produced by one file-mode branch in its builder. The others append a records-directions message. A strategic players summary will replace the full players section after the first revision lands; until then, full players stay inline.

### Records directions

`recordsDirections(state)` in `knowledge/` names `/workspace/records` and `/workspace/reference`, the recorded turn range, the current turn folder, and the record folders covering events since the last completed decision. That event range stays the same even if an inline retry uses a narrower window. It lists the sections the agent no longer sees inline, with their file patterns, and points to `CATALOG.md`. Its contents stay fixed during the turn, and it adds no cache breakpoint; changing file sizes and newly generated briefings belong in the catalog. This preserves the live envoy's cache boundaries.

Diplomacy background, deals, conversation rows, and historical episodes remain in their existing agent contexts. Telepathist and archivist contexts remain without files.

### Workspace telemetry

Record three facts on every agent span:

| Attribute | Meaning |
| --- | --- |
| `context.files` | The context's resolved files setting (game access, shared folders and their access, quota), or `false` |
| `context.workspace` | The seat store's head commit at the run's first model step, when files are enabled |
| `context.prompts` | The resolved custom prompt folder, or `false`, so analysis can group rows by prompt set. Replay ignores it because the recorded system text already contains the custom prompt |

Whether a run used file mode follows from `context.files` and the recorded step tools, so it is not stored separately.

`vox-execute.ts` captures `context.workspace` after preparation (system text, initial messages, run tools, and triage) and immediately before the first model step, not when the agent span opens. A staffed strategist's briefer runs finish inside `getInitialMessages` and archive their briefings; capturing at the span's start would miss them, so a replayed bash call could not find files the live run's first step could read. A run that stops before any model step records none.

The retriever carries these fields into `RetrievedRow`. Missing fields on older rows default to files disabled. Replay enables file support from `context.files`, not by inspecting prompt text.

## Work items

- Move `getRunTools` ahead of prompt preparation in `vox-execute.ts` and store the result on the execution frame for `fileMode`.
- Add `recordsDirections` and the simple strategist's file-mode branch; append the directions in the briefed, staffed, and learned strategists, `LiveEnvoy`, and `Negotiator` when in file mode.
- Record `context.files` on each agent execution and capture `context.workspace` immediately before its first model step.
- Carry the telemetry fields into `RetrievedRow` with backward-compatible defaults.

## Verify

| Area | Required checks |
| --- | --- |
| File mode | Uses the tools resolved before prompt preparation; runs without bash and agents without tools stay inline; the simple strategist's sections and record paths are correct with controlled state, including the temporary full players section; directions are appended for envoys and the negotiator without adding a cache breakpoint |
| Telemetry | Recorded files setting or `false`; a staffed strategist's recorded commit includes the briefings archived during its preparation; older rows default to files disabled |

Run the existing caching, step-budget, envoy, analyst, and negotiator suites. Confirm files-disabled prompts still pass the unchanged golden tests.

## Documentation

Update `docs/developers/vox-agents/prompts.md` with core prompts and records directions, and `docs/developers/vox-agents/oracle.md` with the recorded workspace fields.

## Risks and open questions

- **Latency:** the simple strategist may spend more steps reading reports. It uses the existing files quota and compaction behavior.
- **Players summary:** the strategic summary must be designed before the full players section leaves the simple strategist's file-mode prompt.

## Done when

Only bash-capable runs receive records directions; other runs stay inline. The simple strategist reads detailed cities, military, and events from records while keeping its core and the temporary full players section. Each run's first-step snapshot includes briefings archived during its preparation, and files-disabled behavior remains unchanged.
