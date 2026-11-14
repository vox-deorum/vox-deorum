/**
 * @module diplomacy/ingame/notify
 *
 * The one place a durable conversation outcome becomes a native in-game notification
 * (interactive-diplomacy stage 7.04 work item 7).
 *
 * Decision 5 of the wiring plan is the whole of this module's policy: **reaching `done` is necessary
 * but not sufficient.** A turn that streamed, committed, and completed cleanly still says nothing to
 * the player unless it actually produced something new to read — a counterpart reply, a closure, or a
 * deal state transition. So the eligibility test is over the *durable rows the action created*, never
 * over "did the call succeed": an idempotent rejection acknowledgement, a validation error, a
 * proposal conflict, an unavailable turn, and a transport failure all deliver no notification, because
 * none of them wrote anything the player has not already been told about.
 *
 * Delivery itself is best-effort and deliberately swallows its own failures. By the time this runs the
 * conversation action has already committed to an append-only store; turning a failed notification
 * into the action's failure would tell the player their message was lost when it was not. A posting
 * failure is therefore logged and reported through the return value, never thrown.
 */

import type { VoxContext } from "../../agents/runtime/vox-context.js";
import type { StrategistParameters } from "../../strategist/strategy-parameters.js";
import { civIdentity } from "../../web/chat/enrichment.js";
import { createLogger } from "../../utils/logger.js";
import { mcpClient } from "../../agents/mcp/mcp-client.js";
import { unwrapMcpResponse } from "../../agents/mcp/mcp-response.js";
import { markdownToPlain } from "./civ5-markup.js";
import { isDealRow, type TranscriptPushMessage } from "../transcript/transcript-utils.js";
import { eventPipeDelimiter } from "../../../../mcp-server/dist/bridge/protocol.js";

const logger = createLogger("diplomacy-notify");

/** `post-notification`'s `Summary` schema limit (mcp-server/src/tools/actions/post-notification.ts). */
export const summaryLimit = 200;

/** `post-notification`'s `Message` schema limit. */
export const messageLimit = 2000;

/**
 * Stand-in body for an eligible outcome whose own text is empty once converted (a `close` row with no
 * spoken line, say). The tool rejects a blank `Message`, and an eligible outcome must still reach the
 * player, so the notification degrades to a generic prompt rather than being dropped.
 */
export const defaultOutcomeMessage = "A new diplomatic message is waiting.";

/** One durable outcome offered to the notification channel. */
export interface DiplomacyOutcomeNotice {
  /** The seat that receives the notification: the human caller, observer slots included. */
  playerID: number;
  /** The LLM-voiced major civilization whose conversation produced the outcome. */
  counterpartID: number;
  /** The counterpart's live context, used only to resolve its leader name for the headline. */
  counterpartContext?: VoxContext<StrategistParameters>;
  /** The durable rows this action committed — a turn's terminal rows, or a direct action's result. */
  rows: TranscriptPushMessage[];
  /**
   * A direct deal action's state-transition flag. `false` marks an idempotent acknowledgement, which
   * re-delivers an existing row to release the client's pending editor but announces nothing new.
   * Omitted for a chat turn, whose rows are newly committed by construction.
   */
  changed?: boolean;
}

/**
 * The last row in `rows` worth announcing, or undefined when nothing is.
 *
 * Eligible rows are a counterpart-spoken `text` or `close` row (the player's own committed message is
 * not news to them, and a turn's caller row never reaches a terminal row set anyway) and any `deal-*`
 * row (a proposal, counter, rejection, acceptance, or enactment is a state transition regardless of
 * which endpoint spoke it). The **last** eligible row is returned because the message body should be
 * the final thing the action produced — the archived reply that closes a turn, or the enactment that
 * closes an accept — not the first intermediate step.
 */
export function findNotifiableOutcome(
  rows: TranscriptPushMessage[],
  counterpartID: number
): TranscriptPushMessage | undefined {
  let outcome: TranscriptPushMessage | undefined;
  for (const row of rows) {
    if (isDealRow(row)) {
      outcome = row;
      continue;
    }
    const speaks = row.MessageType === "text" || row.MessageType === "close";
    if (speaks && row.SpeakerID === counterpartID) outcome = row;
  }
  return outcome;
}

/** Convert one durable field for the notification channel and fit it to the tool's schema limit. */
function toNotificationText(raw: string, limit: number): string {
  // markdownToPlain first (the durable transcript is raw markdown), then the IPC delimiter, which is
  // stripped at every game-bound edge because raw delimiter framing is content-sensitive.
  const plain = markdownToPlain(raw).replaceAll(eventPipeDelimiter, "").trim();
  return plain.length > limit ? plain.slice(0, limit).trim() : plain;
}

/** The first line with visible text, so a multi-paragraph reply becomes a one-line notification. */
function firstNonEmptyLine(content: string): string {
  for (const line of markdownToPlain(content).split("\n")) {
    if (line.trim() !== "") return line;
  }
  return "";
}

/**
 * Post one native notification for a durable outcome, or return without posting when the outcome is
 * not an announceable one.
 *
 * @returns true when a notification was posted; false when the outcome was ineligible or the post
 *          failed. Never throws: the conversation action has already committed.
 */
export async function notifyDiplomacyOutcome(notice: DiplomacyOutcomeNotice): Promise<boolean> {
  if (notice.changed === false) return false;
  const outcome = findNotifiableOutcome(notice.rows, notice.counterpartID);
  if (!outcome) return false;

  const identity = civIdentity(notice.counterpartContext, notice.counterpartID);
  const identitySummary = identity?.leader && identity.name
    ? `${identity.leader} of ${identity.name}`
    : identity?.leader || identity?.name || `Player ${notice.counterpartID}`;
  const summary = toNotificationText(identitySummary, summaryLimit);
  const message = toNotificationText(firstNonEmptyLine(outcome.Content), messageLimit)
    || defaultOutcomeMessage;

  try {
    const result = await mcpClient.callTool("post-notification", {
      PlayerID: notice.playerID,
      CounterpartID: notice.counterpartID,
      Summary: summary,
      Message: message,
    });
    // A Lua-level refusal is reported inside a transport-level success, exactly as the bridge's own
    // push path handles it, so a silently unposted notification cannot read as a delivered one.
    const response = unwrapMcpResponse(result, "post-notification") as { Success?: unknown };
    if (response.Success !== true) throw new Error("post-notification reported no success");
    return true;
  } catch (error) {
    // Best-effort by contract: the write already happened, so a failed announcement is logged and
    // nothing else. Telling the player their action failed would be a lie.
    logger.warn("Failed to post a diplomacy outcome notification", {
      error,
      playerID: notice.playerID,
      counterpartID: notice.counterpartID,
      messageID: outcome.ID,
    });
    return false;
  }
}
