/**
 * @module diplomacy/turn/live-turn
 *
 * The single authority on "which turn is this conversation acting on, and may it act at all?"
 * (interactive-diplomacy stage 7.04 work item 1).
 *
 * Every conversation action — a streamed chat turn, a deal accept, a deal reject — needs the same two
 * answers before it writes anything: the live game turn, and whether the conversation was already
 * closed on it. Those checks used to exist twice, and the two copies disagreed: `runChatTurn` treated
 * a live thread with no current turn as *unavailable*, while the Express deal routes silently fell
 * back to `thread.metadata.turn` or turn zero, which turns "the game is not running" into "turn 0,
 * definitely not closed". This module keeps the stricter behaviour and deletes the fallback.
 *
 * Both failure modes get their own error type, so the Web mapper and the in-game bridge classify them
 * by `instanceof` rather than by inspecting message text.
 */

import { contextRegistry } from "../../agents/runtime/context-registry.js";
import type { VoxContext } from "../../agents/runtime/vox-context.js";
import type { StrategistParameters } from "../../strategist/strategy-parameters.js";
import type { EnvoyThread } from "../../types/index.js";
import { isClosedThisTurn } from "../transcript/transcript-utils.js";

/**
 * Thrown when a live conversation has no current game turn yet — the session has not reported one,
 * so nothing may be committed against it. Distinct from a closed conversation because it is a
 * *transient* infrastructure state the caller should retry (the Web mapper sends 503).
 */
export class LiveTurnUnavailableError extends Error {
  constructor(
    message = "The live game turn is not available yet. Please retry once the game is running."
  ) {
    super(message);
    this.name = "LiveTurnUnavailableError";
  }
}

/**
 * Thrown when the conversation's latest `close` was recorded on the current turn or later: it cannot
 * be resumed or acted on until a later turn (specs §8). A lost-state conflict, not a failure — the
 * Web mapper sends 409.
 */
export class ConversationClosedThisTurnError extends Error {
  constructor(
    message = "This conversation was closed this turn and cannot be reopened until a later turn."
  ) {
    super(message);
    this.name = "ConversationClosedThisTurnError";
  }
}

/** The public wording used when a deal action (accept/reject) hits a conversation closed this turn. */
export const closedThisTurnDealMessage =
  "This conversation was closed this turn and cannot accept deal actions until a later turn.";

/**
 * Resolve the authoritative turn from a live session or a sessionless context's base parameters.
 * A session-bearing (live) context is trusted verbatim — including an `undefined` turn, which means
 * the game has not reported one yet and must NOT be masked by the base parameters' seeded value.
 */
export function currentTurnOf(
  context: VoxContext<StrategistParameters> | undefined
): number | undefined {
  return context?.session ? context.session.getTurn() : context?.getBaseParameters()?.turn;
}

/**
 * The turn a thread's conversation acts on right now.
 *
 * For a `live` thread the game must have reported a turn; there is deliberately no fallback, because
 * committing against a guessed turn is what let a phantom row be archived (and a closed-this-turn
 * conversation be reopened) while the game was not running. A non-live (database/observer) thread has
 * no game clock, so it acts on turn zero.
 *
 * @throws {LiveTurnUnavailableError} when a live thread has no current turn.
 */
export function requireCurrentTurn(thread: EnvoyThread): number {
  const context = contextRegistry.get<StrategistParameters>(thread.contextId);
  const liveTurn = currentTurnOf(context);
  if (thread.contextType === "live" && liveTurn === undefined) throw new LiveTurnUnavailableError();
  return liveTurn ?? 0;
}

/**
 * The shared live-turn + closed-this-turn guard every conversation action runs before it writes:
 * `runChatTurn`, {@link import("../deal/deal-actions.js").acceptDealAction}, and
 * {@link import("../deal/deal-actions.js").rejectDealAction}.
 *
 * @param thread The conversation being acted on.
 * @param options.closedMessage Wording for the closed-this-turn error, so a deal action can say
 *        "cannot accept deal actions" while a chat turn says "cannot be reopened" — both still
 *        carrying the same {@link ConversationClosedThisTurnError} type for mapping.
 * @returns the turn the action acts on.
 * @throws {LiveTurnUnavailableError} when a live thread has no current turn.
 * @throws {ConversationClosedThisTurnError} when the conversation was closed on that turn.
 */
export function requireOpenConversationTurn(
  thread: EnvoyThread,
  options: { closedMessage?: string } = {}
): number {
  const turn = requireCurrentTurn(thread);
  // The close lock is a diplomacy-transcript concept; an ordinary chat has no close row to derive.
  if (thread.diplomacy && isClosedThisTurn(thread.closeTurn, turn)) {
    throw new ConversationClosedThisTurnError(options.closedMessage);
  }
  return turn;
}
