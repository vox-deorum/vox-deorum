/**
 * @module utils/tools/terminal-tools
 *
 * Utilities for detecting terminal tool calls by inspecting tool metadata.
 * A terminal tool call signals that the calling agent's primary task is complete —
 * the agent should stop after processing a step where all tool calls are terminal.
 *
 * Terminal tool sources:
 * - MCP tools with readOnlyHint: false (write/action tools)
 * - Fire-and-forget agent tools (call-* tools where the agent has fireAndForget: true)
 */

import { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { agentRegistry } from "../../infra/agent-registry.js";

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
 * risking a repeat of the terminal action's side effects.
 */
export function hasOnlyTerminalCalls(
  step: { toolCalls: Array<{ toolName: string; providerExecuted?: boolean }> },
  mcpToolMap: Map<string, MCPTool>
): boolean {
  return step.toolCalls
    .filter(tc => !tc.providerExecuted)
    .every(tc => isTerminalTool(tc.toolName, mcpToolMap));
}
