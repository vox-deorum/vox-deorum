/**
 * @module envoy/close-conversation-tool
 *
 * The diplomat's `close-conversation` tool (interactive-diplomacy stage 2).
 *
 * Closing a conversation is recorded as a special `close` transcript message rather than a
 * status flag. vox-agents derives open/closed status — and the same-turn resume lock — from
 * the presence and turn of that message: once closed, the conversation cannot be reopened on
 * the same turn (specs §8).
 *
 * The tool itself writes nothing. It stages the close, authored by the diplomat's own seat
 * (endpoint B), on the active chat turn; that turn commits it through `closeConversation` once the
 * spoken reply and any nested negotiator work have settled, so the close row is always last.
 */

import { z } from "zod";
import { Tool } from "ai";
import type { VoxContext } from "../../agents/runtime/vox-context.js";
import type { StrategistParameters } from "../../strategist/strategy-parameters.js";
import type { EnvoyThread } from "../../types/index.js";
import { createSimpleTool } from "../../agents/tools/simple-tools.js";
import { stageThreadClose } from "../../diplomacy/turn/active-turn-state.js";

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
      execute: async (input) => {
        const thread = context.currentInput as EnvoyThread | undefined;
        if (!thread || thread.player1ID === undefined || thread.player2ID === undefined) {
          return "No active conversation to close.";
        }
        // AI SDK may execute same-step tools concurrently. Defer the durable close until terminal
        // reconciliation, after any spoken message and nested negotiator work have settled.
        // Staging only fails when no chat turn owns the thread, and only that lifecycle can order the
        // close last. Throw rather than report the failure as ordinary output: an errored call is not
        // a terminal action, so the turn still archives a visible stand-in instead of ending silent.
        if (!stageThreadClose(thread, { speakerID: thread.agent, content: input.Farewell })) {
          throw new Error("A conversation can only be closed during an active chat turn.");
        }
        return "Conversation will close after this reply is recorded.";
      },
    },
    context
  );
}
