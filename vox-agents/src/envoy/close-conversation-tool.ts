/**
 * @module envoy/close-conversation-tool
 *
 * The diplomat's `close-conversation` tool (interactive-diplomacy stage 2).
 *
 * Closing a conversation is recorded as a special `close` transcript message rather than a
 * status flag. vox-agents derives open/closed status — and the same-turn resume lock — from
 * the presence and turn of that message: once closed, the conversation cannot be reopened on
 * the same turn (specs §8). The message is authored by the diplomat's own seat (endpoint B)
 * and written through the archival `append-message` store tool, the same path the Web Close
 * control uses.
 */

import { z } from "zod";
import { Tool } from "ai";
import type { VoxContext } from "../infra/vox-context.js";
import type { StrategistParameters } from "../strategist/strategy-parameters.js";
import type { EnvoyThread } from "../types/index.js";
import { createSimpleTool } from "../utils/tools/simple-tools.js";
import { closeConversation } from "../utils/diplomacy/deal.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("close-conversation-tool");

/**
 * Creates the diplomat's `close-conversation` tool. Reads the active conversation from
 * `context.currentInput` (set by VoxContext.execute), so it always closes the conversation
 * the diplomat is currently voicing.
 */
export function createCloseConversationTool(context: VoxContext<StrategistParameters>): Tool {
  return createSimpleTool<StrategistParameters>(
    {
      name: "close-conversation",
      description:
        "End this diplomatic conversation. Records a closing message and locks the conversation for the rest of the current turn. Use this to walk away from a fruitless or meaningless exchange.",
      inputSchema: z.object({
        Farewell: z
          .string()
          .describe("A short closing remark recorded as the conversation's final message."),
      }),
      execute: async (input, parameters) => {
        const thread = context.currentInput as EnvoyThread | undefined;
        if (!thread || thread.player1ID === undefined || thread.player2ID === undefined) {
          return "No active conversation to close.";
        }
        // The diplomat voices the agent seat (thread.agent), so the close is authored by it.
        // closeConversation first retracts any open proposal so nothing is left enactable, then
        // records the close. The recorded turn comes from the store's authoritative current turn
        // (returned by append-message); parameters.turn is only a fallback, since a live agent's
        // turn is a decision-point snapshot that can be stale once a conversation outlives its pause.
        try {
          const turn = await closeConversation(thread, thread.agent, input.Farewell, parameters.turn);
          return `Conversation closed on turn ${turn}. It cannot be reopened until a later turn.`;
        } catch (error) {
          logger.error("Failed to append close message", { error });
          return `Failed to close the conversation: ${
            error instanceof Error ? error.message : "unknown error"
          }`;
        }
      },
    },
    context
  );
}
