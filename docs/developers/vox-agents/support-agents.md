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

The one concrete analyst today is **`diplomatic-analyst`**, the gatekeeper between field [diplomats](envoy.md) and the leader. A report carries content, situation context, and the diplomat's memo. Optional `FromPlayer` and `AboutPlayers` fields name the source and subjects by civilization or leader. The source defaults to the conversation counterpart. When subjects are omitted, the analyst extracts names mentioned in the content and memo; an explicit empty list means no subjects. It resolves names to player IDs before the background handoff and rejects unknown or ambiguous explicit names.

The analyst fetches diplomatic history for the source and subjects over the previous 15 turns, viewed from the receiving civilization. It combines that evidence with the report and game context, then makes one evaluation: whether to relay, the message type (Diplomatic, Intelligence, or Rumor), relevant categories, and confidence and importance scores from 0 to 9. Missing history is marked as unavailable evidence.

When the relay probability is at least 0.5, code submits up to 4,000 characters of content and 500 characters of memo through `relay-message`, with source and subject IDs in separate fields. Each category (Diplomacy, Military, Economy, and Others) is included when its probability reaches 0.5, so reports can belong to several categories. Specialized briefers filter reports by these categories. Scores retain fractional values; importance of 7 or more keeps the existing urgent-report behavior. There is no extra text-generation step. The analyst uses its normal model assignment or the caller's tier, supporting either a native evaluator or the chat-model adapter. Evaluation failure produces no relay.

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
