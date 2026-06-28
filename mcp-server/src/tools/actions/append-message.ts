/**
 * Tool for appending a single message to a durable diplomatic conversation.
 *
 * There is exactly one conversation per ordered pair of players, so this tool needs
 * no thread identity. It takes endpoint-oriented input ({ PlayerAID, PlayerBID, ... })
 * and orders the two IDs server-side (Player1ID = min, Player2ID = max), remapping the
 * per-endpoint roles to match. Roles are free-form EnvoyThread-style descriptors
 * (agent name for an LLM side, UserIdentity.role for a human side, `observer` for the
 * observer endpoint). The observer sentinel (-1) is accepted as a special case: it
 * sorts to Player1ID, defaults its role to `observer`, and is exempt from the
 * living-major check (the other endpoint must still be a living major when game state
 * is available). Roles do not encode human-vs-LLM.
 *
 * The tool is archival only: it does not stream, notify, run agents, enact deals, or
 * decide whether a deal is current/accepted. It writes one TimedKnowledge row and sets
 * visibility for the real participant(s). `deal-accept` and `deal-enacted` are NOT
 * emitted here — acceptance goes through the enactment route (enact-agent-deal, stage 6),
 * which performs its own validation/idempotency check, and both records are written there
 * via the same store path. `deal-reject` is an ordinary archival message, spoken by
 * either endpoint — the counterparty declining the offer, or the original proposer
 * retracting their own offer (there is no separate `deal-retract` type).
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { knowledgeManager } from "../../server.js";
import { composeVisibility } from "../../utils/knowledge/visibility.js";
import { readPublicKnowledgeBatch } from "../../utils/knowledge/cached.js";
import { getPlayerInformations } from "../../knowledge/getters/player-information.js";
import { orderPlayerPair, getDiplomaticMessageById } from "../../knowledge/getters/diplomatic-messages.js";
import { MESSAGE_TYPES } from "../../utils/transcript-schema.js";

/** The observer / no-seat endpoint sentinel (shared with the existing non-diplomacy chats). */
const OBSERVER_ID = -1;

/** Default role descriptor for the observer endpoint when none is provided. */
const OBSERVER_ROLE = "observer";

/** Message types that carry proposed deal terms in Payload.Deal. */
const PROPOSAL_TYPES = new Set(["deal-proposal", "deal-counter"]);
/**
 * Message types that answer an earlier proposal/counter via Payload.ProposalMessageID
 * through this archival tool. Acceptance is NOT here — it goes through the enactment
 * route (see the deal-accept guard below) — so only deal-reject is a public response.
 */
const RESPONSE_TYPES = new Set(["deal-reject"]);

/**
 * Input schema for the append-message tool.
 */
const AppendMessageInputSchema = z.object({
  PlayerAID: z.number().int().min(OBSERVER_ID).describe("One endpoint's playerID (or -1 for the observer)"),
  PlayerBID: z.number().int().min(OBSERVER_ID).describe("The other endpoint's playerID (or -1 for the observer)"),
  PlayerARole: z.string().optional().describe("Free-form role of PlayerA (agent name, UserIdentity.role, or 'observer'). Defaults to 'observer' for the -1 endpoint."),
  PlayerBRole: z.string().optional().describe("Free-form role of PlayerB (agent name, UserIdentity.role, or 'observer'). Defaults to 'observer' for the -1 endpoint."),
  SpeakerID: z.number().int().min(OBSERVER_ID).describe("The endpoint authoring this message (must be one of the two players)"),
  MessageType: z.enum(MESSAGE_TYPES).describe("Message type"),
  Content: z.string().describe("Free-text message body"),
  Payload: z.record(z.string(), z.any()).optional().describe("Optional message metadata (Deal/Value1/Value2 for proposals, ProposalMessageID for responses)"),
  Turn: z.number().int().optional().describe("Game turn (defaults to the server's current turn; Web callers should omit)"),
});

/**
 * Output schema: the stored message row's canonical fields.
 */
const AppendMessageOutputSchema = z.object({
  ID: z.number(),
  Player1ID: z.number(),
  Player2ID: z.number(),
  Player1Role: z.string(),
  Player2Role: z.string(),
  SpeakerID: z.number(),
  MessageType: z.enum(MESSAGE_TYPES),
  Content: z.string(),
  Turn: z.number(),
});

/**
 * Tool that appends one message to a durable diplomatic conversation.
 */
class AppendMessageTool extends ToolBase {
  readonly name = "append-message";

  readonly description = "Append one message to the durable conversation between two players (ordered by playerID). Archival only — no streaming, notifications, agents, or deal enactment.";

  readonly inputSchema = AppendMessageInputSchema;

  readonly outputSchema = AppendMessageOutputSchema;

  readonly annotations: ToolAnnotations = { readOnlyHint: false };

  readonly metadata = {
    autoComplete: ["PlayerAID", "PlayerBID", "SpeakerID", "MessageType"],
  };

  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const { PlayerAID, PlayerBID, PlayerARole, PlayerBRole, SpeakerID, MessageType, Content, Payload, Turn } = args;

    // Acceptance and the enactment record are never written through this archival tool:
    // acceptance must go through the enactment route (enact-agent-deal, stage 6), which
    // runs its own validation/idempotency check before recording deal-accept / deal-enacted
    // via the store path. deal-reject, by contrast, is an ordinary archival message.
    if (MessageType === "deal-accept" || MessageType === "deal-enacted") {
      throw new Error(`${MessageType} is recorded by the enactment route (enact-agent-deal, stage 6), not append-message`);
    }

    // The two endpoints must be distinct.
    if (PlayerAID === PlayerBID) {
      throw new Error("The two conversation endpoints must be distinct");
    }

    // The speaker must be one of the two endpoints.
    if (SpeakerID !== PlayerAID && SpeakerID !== PlayerBID) {
      throw new Error(`SpeakerID ${SpeakerID} must be one of the two endpoints (${PlayerAID}, ${PlayerBID})`);
    }

    // Order the pair (Player1ID = min, so the observer sentinel -1 sorts to Player1ID)
    // and remap the per-endpoint free-form roles to match the ordered IDs. The observer
    // endpoint (-1) defaults to the `observer` role when the caller omits one.
    const { player1ID, player2ID } = orderPlayerPair(PlayerAID, PlayerBID);
    const roleOf = (id: number): string => {
      const provided = id === PlayerAID ? PlayerARole : PlayerBRole;
      if (provided !== undefined) return provided;
      if (id === OBSERVER_ID) return OBSERVER_ROLE;
      throw new Error(`A role is required for endpoint ${id}`);
    };
    const player1Role = roleOf(player1ID);
    const player2Role = roleOf(player2ID);

    // Major-civ validation against cached PlayerInformations (no live bridge call; only
    // falls back to fetching when the cache is empty). The observer endpoint (-1) is
    // exempt; the real civ endpoint(s) must each be a major civilization.
    const infos = await readPublicKnowledgeBatch("PlayerInformations", getPlayerInformations);
    if (infos.length > 0) {
      for (const id of [player1ID, player2ID]) {
        if (id === OBSERVER_ID) continue;
        const info = infos.find((i) => i.Key === id);
        if (!info || info.IsMajor !== 1) {
          throw new Error(`Player ${id} is not a major civilization`);
        }
      }
    }

    // Message-specific validation.
    if (PROPOSAL_TYPES.has(MessageType)) {
      // Proposals and counters must carry the proposed terms. Payload.Value1 / Value2
      // are optional per-item value snapshots for either ordered player — including a
      // human side, whose items the VP AI (CvDealAI) also values.
      if (!Payload || Payload.Deal === undefined) {
        throw new Error(`${MessageType} messages must include Payload.Deal`);
      }
    } else if (RESPONSE_TYPES.has(MessageType)) {
      // A reject must reference an earlier proposal/counter in the same conversation.
      // Either endpoint may speak it: the counterparty *declines* the offer, or the
      // original proposer *retracts* their own offer — there is no separate deal-retract
      // type. (Acceptance is handled by the enactment route, not here.)
      const proposalMessageID = Payload?.ProposalMessageID;
      if (typeof proposalMessageID !== "number") {
        throw new Error(`${MessageType} messages must include a numeric Payload.ProposalMessageID`);
      }
      const referenced = await getDiplomaticMessageById(proposalMessageID);
      if (!referenced) {
        throw new Error(`Referenced proposal message ${proposalMessageID} does not exist`);
      }
      if (referenced.Player1ID !== player1ID || referenced.Player2ID !== player2ID) {
        throw new Error(`Referenced message ${proposalMessageID} is not part of this conversation`);
      }
      if (!PROPOSAL_TYPES.has(referenced.MessageType)) {
        throw new Error(`Referenced message ${proposalMessageID} is not a deal-proposal or deal-counter`);
      }
    }

    // Write one row and recover its append ID directly (race-free; a re-query would
    // be unsafe under concurrent appends to the same pair). Visibility is set only for
    // the real participant(s); the observer (-1) has no player slot and composeVisibility
    // ignores it. Default Turn falls back to the server's current turn inside the store.
    const store = knowledgeManager.getStore();
    const resolvedTurn = Turn !== undefined && Turn >= 0 ? Turn : knowledgeManager.getTurn();
    const id = await store.storeTimedKnowledge("DiplomaticMessages", {
      data: {
        Player1ID: player1ID,
        Player2ID: player2ID,
        Player1Role: player1Role,
        Player2Role: player2Role,
        SpeakerID,
        MessageType,
        Content,
        Payload: Payload ?? {},
      },
      visibilityFlags: composeVisibility([player1ID, player2ID]),
      turn: Turn,
    });

    return {
      ID: id,
      Player1ID: player1ID,
      Player2ID: player2ID,
      Player1Role: player1Role,
      Player2Role: player2Role,
      SpeakerID,
      MessageType,
      Content,
      Turn: resolvedTurn,
    };
  }
}

/**
 * Creates a new instance of the append-message tool.
 */
export default function createAppendMessageTool() {
  return new AppendMessageTool();
}
