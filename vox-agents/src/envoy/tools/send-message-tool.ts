/**
 * @module envoy/send-message-tool
 *
 * The live envoy's `send-message` tool (interactive-diplomacy refactor 05.1).
 *
 * Speaking to the counterpart is an explicit action, not raw assistant free text: the model
 * always picks a tool, so its action space is uniform and it stops narrating-instead-of-acting.
 * The `Message` argument is streamed back to the client exactly like free text used to be (see
 * `agents/models/send-message-stream.ts`), so a spoken reply still renders as a normal text bubble
 * rather than a tool-call card. A diplomat conversation archives each validated call here, after
 * its streamed argument is complete; terminal reconciliation later mirrors that durable row into
 * the thread cache.
 */

import { z } from "zod";
import { Tool } from "ai";
import type { VoxContext } from "../../agents/runtime/vox-context.js";
import type { StrategistParameters } from "../../strategist/strategy-parameters.js";
import type { EnvoyThread } from "../../types/index.js";
import { createSimpleTool } from "../../agents/tools/simple-tools.js";
import { sendMessageToolName } from "../../diplomacy/constants.js";
import { appendTranscriptMessageRow } from "../../diplomacy/transcript/transcript.js";
import { reportSpokenRow } from "../../diplomacy/turn/active-turn-state.js";
import { speakerLabel } from "../../diplomacy/transcript/transcript-utils.js";
import { stripSpokenEcho } from "../../agents/models/text-cleaning.js";

// The canonical name lives in a zero-dependency leaf so the archival reducer and the streamer can
// share it without pulling in this tool's heavy deps; re-export it here for tool-module importers.
export { sendMessageToolName };

/**
 * Creates the live envoy's `send-message` tool. The `Message` argument is the envoy's spoken
 * reply to the counterpart. Diplomacy calls are durably appended at execution time, because the
 * counterpart has already seen the streamed argument by then. Other live envoys retain the simple
 * confirmation-only behavior.
 */
export function createSendMessageTool(context: VoxContext<StrategistParameters>): Tool {
  return createSimpleTool<StrategistParameters>(
    {
      name: sendMessageToolName,
      description:
        "Speak to the counterpart. The Message you provide is delivered verbatim as your spoken reply in this conversation. This is the ONLY way to say something to them: never write a reply as free text.",
      inputSchema: z.object({
        Message: z
          .string()
          .describe(
            "What you say to the counterpart, in your own diplomatic voice."
          ),
      }),
      execute: async (input) => {
        const thread = context.currentInput as EnvoyThread | undefined;
        if (thread?.diplomacy) {
          const content = stripSpokenEcho(input.Message, speakerLabel(thread, thread.agent));
          if (content.trim() === "") {
            throw new Error("send-message requires visible message text.");
          }
          // A failed append must reject the tool call. Returning a normal confirmation would let the
          // model and client treat an undurable spoken message as delivered.
          const row = await appendTranscriptMessageRow(thread, thread.agent, content);
          // This call is the only writer that knows which durable row carries the spoken reply, so it
          // names it for the turn instead of leaving reconciliation to infer it from the row set.
          reportSpokenRow(thread, row);
        }
        return "Message delivered.";
      },
    },
    context
  );
}
