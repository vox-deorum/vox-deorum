# vox-agents — Support Agents

Not every agent faces a player or makes a decision. Briefers, analysts, and librarians are cooperative agents that the [strategists](strategist.md) and [envoys](envoy.md) delegate to — each does one focused job and hands its result back. They are ordinary `VoxAgent` subclasses registered alongside everything else, invoked either programmatically (`context.callAgent()`) or as `call-{name}` tools when the calling LLM should decide for itself.

## Briefers: condensing the game state

The raw reports a strategist could read — every player, city, military unit category, and event since its last decision — quickly outgrow a model's context window. Briefers (`src/briefer/`) solve this by summarizing the reports into strategic insight first, so the deciding agent reads analysis instead of data.

**`simple-briefer`** produces one combined briefing covering military, economic, and diplomatic affairs. **`specialized-briefer`** focuses on a single dimension — Military, Economy, or Diplomacy — and filters both the report fields and the event categories to what that lens cares about, so each briefing is deep rather than broad. The briefed strategist uses the former; the staffed strategist runs all three specialized modes in parallel and stitches the results into a sectioned report.

Two details make briefings composable:

- **Steering.** Briefers expose a `focus-briefer` tool to the strategist. When the strategist wants next turn's briefing to dig into something ("watch the northern border"), it calls the tool; the instruction lands in the player's working memory and the next briefing honors it.
- **Deduplication.** All briefing requests flow through `requestBriefing()` (`src/briefer/briefing-utils.ts`), which caches finished briefings per turn and tracks in-flight generations, so a strategist, an envoy, and an analyst asking for the same briefing in the same turn share one LLM call. Envoys and analysts reach it through a `get-briefing` tool; strategists call it before their first LLM step so the briefing is already in the opening prompt.

## Analysts: fire-and-forget assessment

Analysts (`src/analyst/`) process information in the background. The base class sets `fireAndForget`, so when another agent files something for analysis, the call returns immediately and the analyst runs detached — in its own telemetry trace — while the caller carries on.

The one concrete analyst today is **`diplomatic-analyst`**, the gatekeeper between field [diplomats](envoy.md) and the leader. A diplomat's report arrives as content, situation context, and the diplomat's own memo. The analyst categorizes it (official diplomatic communication versus gathered intelligence), validates it against briefings and the diplomatic event record, scores its confidence and importance, and then makes the call that matters: whether to invoke the `relay-message` MCP tool and put the information in front of the strategist at its next decision. Trivial, redundant, or unverifiable reports are deliberately dropped — the analyst exists precisely so the leader's context is not flooded with every conversation a diplomat has.

## Librarians: researching the rules

Librarians (`src/librarian/`) answer "what does this thing do?" questions from Civilization V's own rules database, via the MCP server's [database tools](../mcp-server/database.md). **`keyword-librarian`** works in two phases: the LLM reads the briefing contexts it is given and proposes a handful of search keywords (as plain JSON text — no tool calling), then the agent programmatically runs each keyword set through the `search-database` MCP tool and formats the hits. Helper utilities (`src/utils/librarian-utils.ts`) extract suitable search contexts from a player's current briefings, so a librarian can enrich a strategist's view with the game-rule details its situation touches.

## How agents call each other

The wiring lives in `src/utils/tools/agent-tools.ts`. Every registered agent can be wrapped as an AI SDK tool named `call-{agent}`, with its declared input schema; when the wrapped agent is fire-and-forget the tool returns "submitted" immediately and execution continues detached, otherwise the caller's loop waits for the typed result. For pre-LLM orchestration — briefings that must exist before the first prompt, summarizers run in batch loops — code calls `context.callAgent()` directly instead. Both paths run through the same `VoxContext`, so nested agents inherit the same tools, parameters, and telemetry context (modulo the detachment that fire-and-forget deliberately introduces).

The [telepathist family](telepathist.md) adds one more cooperative agent, the unified `Summarizer`, which serves both interactive analysis and the [archivist's](archivist.md) batch pipeline — it is described with the telepathist since it works over the same recorded data.
