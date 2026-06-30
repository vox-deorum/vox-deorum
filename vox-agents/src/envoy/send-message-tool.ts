/**
 * @module envoy/send-message-tool
 *
 * The live envoy's `send-message` tool (interactive-diplomacy refactor 05.1).
 *
 * Speaking to the counterpart is an explicit action, not raw assistant free text: the model
 * always picks a tool, so its action space is uniform and it stops narrating-instead-of-acting.
 * The `Message` argument is streamed back to the client exactly like free text used to be (see
 * `utils/models/send-message-stream.ts`), so a spoken reply still renders as a normal text bubble
 * rather than a tool-call card. This tool does not mutate the thread; streaming and archival are
 * handled by the web route and the chat-turn commit path respectively.
 */

import { z } from "zod";
import { Tool } from "ai";
import type { VoxContext } from "../infra/vox-context.js";
import type { StrategistParameters } from "../strategist/strategy-parameters.js";
import { createSimpleTool } from "../utils/tools/simple-tools.js";
import { sendMessageToolName } from "../utils/diplomacy/send-message-tool-name.js";

// The canonical name lives in a zero-dependency leaf so the archival reducer and the streamer can
// share it without pulling in this tool's heavy deps; re-export it here for tool-module importers.
export { sendMessageToolName };

/**
 * Creates the live envoy's `send-message` tool. The `Message` argument is the envoy's spoken
 * reply to the counterpart; `execute` only returns a short confirmation, because the reply is
 * delivered by streaming the argument (web route) and persisted by the commit path, not here.
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
            "What you say to the counterpart, in your own diplomatic voice. Delivered exactly as written, so write the finished reply, not a description of it."
          ),
      }),
      execute: async () => "Message delivered.",
    },
    context
  );
}
