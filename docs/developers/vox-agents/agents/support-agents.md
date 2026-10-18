# Support agents

Support agents do focused jobs for other agents. They do not face the player or make the final decision. A strategist or envoy hands them a task and gets a result back.

| Family | Job | Used by |
| --- | --- | --- |
| [Briefers](#briefers) | Condense the raw game state into a short strategic briefing. | Briefed and staffed strategists, envoys |
| [Analysts](#analysts) | Judge a diplomat's report in the background and decide whether the leader should hear it. | Diplomats |
| [Librarians](#librarians) | Look up game rules in Civilization V's database. | Registered and callable as a tool. No built-in agent calls it yet. |

They are ordinary agents. Code can call them with `context.callAgent()`, or a model can call them as `call-{name}` tools (see [Agents calling agents](../framework/runs.md#agents-calling-agents)).

The `Summarizer`, used by the telepathist and archivist, is described on the [telepathist](telepathist.md#the-summarizer) page.

## Briefers

The full set of reports (every player, city, unit category, and event since the last decision) quickly outgrows a model's context. Briefers (`src/briefer/`) summarize the reports first, so the deciding agent reads analysis instead of raw data.

| Briefer | Output | Used by |
| --- | --- | --- |
| `simple-briefer` | One briefing covering military, economy, and diplomacy. | The briefed strategist, and the staffed strategist for small event windows or turn 1 and earlier |
| `specialized-briefer` | A deep briefing on one area: Military, Economy, or Diplomacy. It filters both report fields and event types to that area. | The staffed strategist otherwise, running all three in parallel and joining them |

Two features make briefings work well together:

- **Steering.** Briefers give the strategist a `focus-briefer` tool. When the strategist wants the next briefing to dig into something ("watch the northern border"), the instruction is saved in the player's working memory and the next briefing follows it.
- **No duplicate work.** All briefing requests go through `requestBriefing()` (`src/briefer/briefing-utils.ts`). It caches finished briefings per turn and tracks ones in progress, so two requests for the same briefing on the same turn share one model call. Envoys reach it through `get-briefing`. Strategists call it before their first model step so the briefing is in the opening prompt.

With files enabled, each briefing is [archived in the seat's records](../workspace/store.md#records) before it is published.

## Analysts

Analysts (`src/analyst/`) work in the background. The base class is [fire-and-forget](../framework/agent-framework.md#two-special-shapes): the caller gets "submitted" right away and the analyst runs on its own, in its own telemetry trace.

The only analyst today is `diplomatic-analyst` (`src/analyst/diplomatic-analyst.ts`). It stands between the field [diplomats](envoys.md#diplomat) and the leader.

```
diplomat files a report
   │
   ├─ 1. resolve who it is from and about
   ├─ 2. read 30 turns of diplomatic history with them
   └─ 3. one evaluation: relay? what type? how important?
            │
            └─ relay ──► relay-message ──► strategist and briefers see it
```

### 1. Handoff

The diplomat files the content, the context, and its memo. It may also name the source (`FromPlayer`) and the civilizations discussed (`AboutPlayers`), by civilization or leader name. Before the analyst detaches, the names become player IDs:

- The source defaults to the conversation partner.
- Without `AboutPlayers`, the subjects are the civilizations named in the content and memo. An empty list means no subjects.
- The receiving civilization is never a subject, because every report is already addressed to it.
- Unknown or ambiguous names are rejected, so the diplomat can fix them.

### 2. Evidence

The analyst reads the last 30 turns of diplomatic history with the source and each subject, as the receiving civilization saw it. An event involving several of them is listed once. History that cannot be read is marked unavailable.

### 3. One evaluation

A single [evaluation](../models/evaluators.md) call answers:

- whether to relay the report,
- its type: Diplomatic, Intelligence, or Rumor,
- which categories apply: Diplomacy, Military, Economy, Others (any combination),
- confidence and importance, from 0 to 9.

There is no free-text step. Code acts on the answers:

| Rule | Effect |
| --- | --- |
| Relay probability is 0.5 or more | Calls `relay-message` with the source and subject IDs, up to 4,000 characters of content, and up to 500 of memo. |
| A category's probability is 0.5 or more | That category is included. |
| Importance is 7 or more | Counts as urgent for [pacing](strategists/player-loop.md#pacing). Scores keep their fractions. |
| The evaluation fails | Nothing is relayed. |

Specialized briefers pick up reports tagged Diplomacy, Military, or Economy. A report tagged only Others reaches the strategist but no briefer.

**Teammates.** Reports from a permanent teammate skip steps 2 and 3. They are relayed as they are: Diplomatic, confidence 9, importance 7 (so the strategist re-decides soon), all four categories, with the memo credited to the diplomat.

**Model.** The analyst uses its own model assignment, or the tier the diplomat picks for the call. Both a native evaluator and a chat model (through the evaluation adapter) work.

## Librarians

Librarians (`src/librarian/`) answer "what does this thing do?" from Civilization V's rules database, using the MCP server's [database tools](../../mcp-server/database.md).

`keyword-librarian` works in two phases:

1. The model reads the briefings it is given and proposes a few search keywords, as plain JSON text, without tool calls.
2. Code runs each keyword set through the `search-database` MCP tool and formats the results.

`src/librarian/librarian-utils.ts` picks suitable search topics from a player's current briefings, so a librarian can add the rule details a strategist's situation touches.
