/**
 * Tool for posting a native in-game notification to a player.
 *
 * General-purpose: a diplomacy reply sets CounterpartID so clicking the
 * notification opens the conversation; any other LLM->human message omits it, and
 * clicking then shows Message in a text dialog. The notification is delivered by
 * the (1b) Vox Deorum mod's NOTIFICATION_VOX_DEORUM_DIPLOMACY type and survives
 * across turns until the player dismisses it.
 *
 * This replaces the previously mod-registered VoxDeorumPostNotification: a UI
 * context that called Game.RegisterFunction at load ran before
 * CvConnectionService::Setup() and crashed the game. Registering through the
 * server's LuaFunction machinery (which runs in the ConnectionService Lua state
 * after the bridge connects) is the safe path.
 */

import { LuaFunctionTool } from "../abstract/lua-function.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";

/** IPC named-pipe frame delimiter; must never appear inside notification text. */
const DELIMITER = "!@#$%^!";

/** Sentinel counterpart for a notification with no diplomacy target. */
const NO_COUNTERPART = -1;

/** Normalize notification text and reject content that becomes blank at the IPC boundary. */
function normalizeNotificationText(text: string, field: "Summary" | "Message"): string {
  const normalized = text.split(DELIMITER).join("").trim();
  if (!normalized) {
    throw new Error(`${field} must contain visible text after IPC sanitization`);
  }
  return normalized;
}

/**
 * Input schema for the post-notification tool.
 */
const PostNotificationInputSchema = z.object({
  PlayerID: z.number().int().min(0).max(MaxMajorCivs - 1)
    .describe("The player who receives the notification"),
  CounterpartID: z.number().int().min(0).max(MaxMajorCivs - 1).optional()
    .describe("Optional diplomacy counterpart: when set, clicking opens the conversation with this player; when omitted, clicking shows Message in a dialog"),
  Summary: z.string().min(1).max(200)
    .describe("Short notification headline (shown in the notification panel)"),
  Message: z.string().min(1).max(2000)
    .describe("Full notification body (shown as tooltip, and in the dialog for counterpart-less notifications)"),
});

/**
 * Tool that posts one native in-game notification.
 */
class PostNotificationTool extends LuaFunctionTool<boolean> {
  readonly name = "post-notification";

  readonly description = "Post a native in-game notification to a human player. Set CounterpartID for a diplomacy reply; omit it for a general message.";

  readonly inputSchema = PostNotificationInputSchema;

  protected readonly resultSchema = z.boolean();

  protected get arguments() { return ["playerID", "counterpartID", "summary", "message"]; }

  protected readonly scriptFile = "post-notification.lua";

  readonly annotations: ToolAnnotations = { readOnlyHint: false };

  readonly metadata = {
    autoComplete: ["PlayerID"],
  };

  /** Validate notification invariants, sanitize its text, and post it through Lua. */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    if (args.CounterpartID === args.PlayerID) {
      throw new Error("CounterpartID must be different from PlayerID");
    }

    return await this.call(
      args.PlayerID,
      args.CounterpartID ?? NO_COUNTERPART,
      normalizeNotificationText(args.Summary, "Summary"),
      normalizeNotificationText(args.Message, "Message"),
    );
  }
}

/**
 * Creates a new instance of the post-notification tool.
 */
export default function createPostNotificationTool() {
  return new PostNotificationTool();
}
