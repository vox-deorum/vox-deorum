# vox-agents: Support Agents

Not every agent faces a player or makes a decision. Briefers, analysts, and librarians are cooperative agents that the [strategists](strategist.md) and [envoys](envoy.md) delegate to. Each does one focused job and hands its result back.

They are ordinary `VoxAgent` subclasses registered alongside everything else, and they are invoked one of two ways:

- Programmatically, through `context.callAgent()`.
- As `call-{name}` tools, when the calling LLM should decide for itself whether to invoke them.

## Briefers: condensing the game state

The raw reports a strategist could read (every player, city, military unit category, and event since its last decision) quickly outgrow a model's context window. Briefers (`src/briefer/`) solve this by summarizing the reports into strategic insight first, so the deciding agent reads analysis instead of data.

- **`simple-briefer`** produces one combined briefing covering military, economic, and diplomatic affairs.
- **`specialized-briefer`** focuses on a single dimension (Military, Economy, or Diplomacy) and filters both the report fields and the event categories to what that lens cares about, so each briefing is deep rather than broad.

The briefed strategist uses the simple briefer. The staffed strategist runs all three specialized modes in parallel and stitches the results into a sectioned report.

Two details make briefings composable:

- **Steering.** Briefers expose a `focus-briefer` tool to the strategist. When the strategist wants next turn's briefing to dig into something ("watch the northern border"), it calls the tool, the instruction lands in the player's working memory, and the next briefing honors it.
- **Deduplication.** All briefing requests flow through `requestBriefing()` (`src/briefer/briefing-utils.ts`), which caches finished briefings per turn and tracks in-flight generations. Requests for the same briefing in the same turn therefore share one LLM call. Envoys reach it through a `get-briefing` tool; strategists call it before their first LLM step so the briefing is already in the opening prompt.

## Analysts: fire-and-forget assessment

Analysts (`src/analyst/`) process information in the background. The base class sets `fireAndForget`, so when another agent files something for analysis, the call returns immediately and the analyst runs detached, in its own telemetry trace, while the caller carries on.

The one concrete analyst today is **`diplomatic-analyst`** (`src/analyst/diplomatic-analyst.ts`), the gatekeeper between field [diplomats](envoy.md) and the leader. It works in three steps.

1. **Handoff.** The diplomat files the report's content, the situation context, and its own memo. It may also name the source (`FromPlayer`) and the civilizations discussed (`AboutPlayers`) by civilization or leader. Before the analyst detaches, the handoff resolves these names to player IDs:
   - The source defaults to the conversation counterpart.
   - Without `AboutPlayers`, the subjects are the civilizations named in the content and memo. An empty list means no subjects.
   - The receiving civilization is never a subject, because every report is already addressed to it.
   - Unknown or ambiguous explicit names are rejected, so the diplomat can correct them.
2. **Evidence.** The analyst reads the last 15 turns of diplomatic history with the source and each subject, as the receiving civilization saw them. An event involving several of them is listed once. History that cannot be read is marked unavailable.
3. **One evaluation.** A single structured call decides whether to relay, the message type (Diplomatic, Intelligence, or Rumor), which categories apply (Diplomacy, Military, Economy, Others, in any combination), and confidence and importance from 0 to 9. There is no free-text step.

When the relay probability is at least 0.5, code calls `relay-message` with the source and subject IDs, up to 4,000 characters of content, and up to 500 characters of memo. Each category is included when its probability is at least 0.5. Scores keep their fractions, and importance of 7 or more still counts as an urgent report for pacing. Specialized briefers pick up reports tagged Diplomacy, Military, or Economy; a report tagged only Others reaches the strategist but no briefer. If the evaluation fails, nothing is relayed.

The analyst runs on its own model assignment, or on the tier the diplomat picks for the call. A native evaluator and a chat model (through the evaluation adapter) both work.

## Librarians: researching the rules

Librarians (`src/librarian/`) answer "what does this thing do?" questions from Civilization V's own rules database, via the MCP server's [database tools](../mcp-server/database.md).

**`keyword-librarian`** works in two phases:

1. The LLM reads the briefing contexts it is given and proposes a handful of search keywords, as plain JSON text, with no tool calling.
2. The agent programmatically runs each keyword set through the `search-database` MCP tool and formats the hits.

Helper utilities (`src/librarian/librarian-utils.ts`) extract suitable search contexts from a player's current briefings, so a librarian can enrich a strategist's view with the game-rule details its situation touches.

## How agents call each other

The wiring lives in `src/utils/tools/agent-tools.ts`. Every registered agent can be wrapped as an AI SDK tool named `call-{agent}`, with its declared input schema and an optional `Tier` (`small`, `default`, or `large`). A supplied tier selects the target agent's model without a triage evaluation; omitting it preserves normal selection. When the wrapped agent is fire-and-forget, the tool validates and maps the input before returning "submitted", then execution continues detached. Otherwise the caller's loop waits for the typed result.

For pre-LLM orchestration (briefings that must exist before the first prompt, or summarizers run in batch loops) code calls `context.callAgent()` directly instead. Both paths run through the same `VoxContext`, so nested agents inherit the same tools, parameters, and telemetry context, apart from the detachment that fire-and-forget deliberately introduces.

The [telepathist family](telepathist.md) adds one more cooperative agent, the unified `Summarizer`, which serves both interactive analysis and the [archivist's](archivist.md) batch pipeline. It is described with the telepathist since it works over the same recorded data.
