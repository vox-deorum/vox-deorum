/**
 * @module utils/tools/terminal-tools
 *
 * Utilities for inspecting a step's tool calls when checking stopping conditions.
 * A terminal tool call signals that the calling agent's primary task is complete —
 * the agent should stop after processing a step where all tool calls are terminal.
 *
 * Terminal tool sources:
 * - MCP tools with readOnlyHint: false (write/action tools)
 * - Fire-and-forget agent tools (call-* tools where the agent has fireAndForget: true)
 */

import { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { agentRegistry } from "../../infra/agent-registry.js";

/**
 * Returns the step's valid tool calls — the ones that actually execute. The SDK surfaces
 * invalid calls (unparsable input or a nonexistent tool) in `toolCalls` with `invalid: true`
 * so their error reaches the model, but they never run: stopping conditions must ignore
 * them, as they are neither completed work nor pending work.
 */
export function getValidCalls<TCall extends { invalid?: boolean }>(
  step: { toolCalls: TCall[] }
): TCall[] {
  return step.toolCalls.filter(call => !call.invalid);
}

/** Checks if a single tool call is terminal based on its name and metadata */
export function isTerminalTool(toolName: string, mcpToolMap: Map<string, MCPTool>): boolean {
  // Agent tools: terminal if the agent is fire-and-forget
  if (toolName.startsWith("call-")) {
    const agentName = toolName.slice("call-".length);
    const agent = agentRegistry.get(agentName);
    return agent?.fireAndForget === true;
  }

  // MCP tools: terminal if readOnlyHint is explicitly false
  const mcpTool = mcpToolMap.get(toolName);
  if (mcpTool) {
    return mcpTool.annotations?.readOnlyHint === false;
  }

  return false;
}

/**
 * Checks if ALL game tool calls in a step are terminal (or there are none).
 *
 * Provider-executed calls are the host CLI's own tools (e.g. claude-code's Read), not
 * game actions, so they are excluded from the check: they must never keep the agent
 * loop alive. Without this exclusion a non-terminal built-in call sharing a step with
 * a terminal game action would read as non-terminal and wrongly force another step,
 * risking a repeat of the terminal action's side effects. Invalid calls are excluded
 * for the same reason: they never execute, so they must not force another step either.
 */
export function hasOnlyTerminalCalls(
  step: { toolCalls: Array<{ toolName: string; providerExecuted?: boolean; invalid?: boolean }> },
  mcpToolMap: Map<string, MCPTool>
): boolean {
  return getValidCalls(step)
    .filter(tc => !tc.providerExecuted)
    .every(tc => isTerminalTool(tc.toolName, mcpToolMap));
}

/**
 * Formats a name list into a grammatical, backtick-quoted fragment:
 *   1 -> "`a`"   2 -> "`a` or `b`"   N -> "`a`, `b`, or `c`" (Oxford comma).
 * Returns undefined for an empty list.
 */
export function formatToolChoiceList(names: string[]): string | undefined {
  const q = names.map(n => `\`${n}\``);
  if (q.length === 0) return undefined;
  if (q.length === 1) return q[0];
  if (q.length === 2) return `${q[0]} or ${q[1]}`;
  return `${q.slice(0, -1).join(", ")}, or ${q[q.length - 1]}`;
}

/**
 * Builds the default continuation nudge for an agent from its required tools: a one-sentence
 * reminder to finalize by calling one of them. Returns undefined for an empty list so the
 * injection site skips naturally.
 */
export function buildRequiredToolsNudge(names: string[]): string | undefined {
  const list = formatToolChoiceList(names);
  return list ? `Make sure to call ${list} to finalize your decisions.` : undefined;
}
