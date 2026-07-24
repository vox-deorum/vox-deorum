/**
 * @module utils/diplomacy/resolve-negotiator
 *
 * Per-seat negotiator resolution for the diplomat's `call-negotiator` handoff. Each seat may
 * configure its own negotiator agent (`playerConfig.negotiator`); when it does not, the handoff
 * dispatches to the built-in `negotiator`. Kept in its own module (rather than negotiator.ts) so
 * importing the session/agent registries here does not form a cycle with the agent registry,
 * which imports the negotiator.
 */

import type { EnvoyThread } from "../../types/index.js";
import { agentRegistry } from "../../infra/agent-registry.js";
import { sessionRegistry } from "../../infra/session-registry.js";
import { createLogger } from "../logger.js";

const logger = createLogger("resolve-negotiator");

/** The built-in negotiator agent, used when a seat does not configure its own. */
export const DEFAULT_NEGOTIATOR = "negotiator";

/**
 * Resolve the negotiator agent for the LLM-voiced seat (`thread.agent`) from the active
 * strategist session's per-seat assignments, defaulting to the built-in negotiator. Falls back
 * to the default when the configured negotiator is not a registered agent.
 */
export function resolveNegotiator(thread: EnvoyThread): string {
  const configured = sessionRegistry.getActive()?.getPlayerAssignments()?.[thread.agent]?.negotiator;
  const name = configured ?? DEFAULT_NEGOTIATOR;
  if (!agentRegistry.has(name)) {
    logger.warn(`Configured negotiator "${name}" is not registered; falling back to "${DEFAULT_NEGOTIATOR}"`);
    return DEFAULT_NEGOTIATOR;
  }
  return name;
}
