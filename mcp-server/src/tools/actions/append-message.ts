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
 * decide whether a deal is current/accepted. A pure observer's real seat is accepted the
 * same way, under the exact `Observer` role: it is a concrete slot that holds no
 * civilization, so it is exempt from the living-major check and owns no visibility column,
 * but it must be paired with one in-range major civilization. It writes one TimedKnowledge
 * row and sets visibility for the real participant(s). None of the three terminal deal answers is
 * emitted here (a pinned writer-split): `deal-accept` and `deal-enacted` go through the
 * enactment route (enact-agent-deal, stage 6) and `deal-reject` through the rejection
 * route (reject-agent-deal, stage 7.04). Each of those routes runs its own validation and
 * idempotency check inside one serialized store transaction, so proposal state is decided
 * transactionally instead of by a caller's racy read-then-write; both write their records
 * via the same store path. This tool therefore only ever writes non-terminal messages:
 * `text`, `close`, `deal-proposal`, and `deal-counter`.
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { knowledgeManager } from "../../server.js";
import { composeVisibility } from "../../knowledge/helpers/visibility.js";
import { readPublicKnowledgeBatch } from "../../knowledge/helpers/cached.js";
import { getPlayerInformations } from "../../knowledge/getters/player-information.js";
import { orderPlayerPair } from "../../knowledge/getters/diplomatic-messages.js";
import { MESSAGE_TYPES } from "../../diplomacy/transcript-schema.js";
// The same proposal vocabulary the transactional deal routes answer against: a type that carries
// Payload.Deal here is exactly a type they can enact or reject, so the set is defined once.
import { PROPOSAL_TYPES } from "../../diplomacy/deals/deal-outcome.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { assertExpectedGame } from "../../utils/expected-game.js";

/** The observer / no-seat endpoint sentinel (shared with the existing non-diplomacy chats). */
const OBSERVER_ID = -1;

/** Default role descriptor for the observer endpoint when none is provided. */
const OBSERVER_ROLE = "observer";  
/** Exact role used by the in-game pure observer's real seat. */
const REAL_OBSERVER_ROLE = "Observer";

/**
 * Terminal answers to a proposal, each owned by a transactional route rather than by this
 * archival tool: acceptance/enactment by `enact-agent-deal`, rejection/retraction by
 * `reject-agent-deal`. Mapped to the tool that owns each so the refusal points the caller
 * at the right route. No response type reaches the write path below.
 */
const TERMINAL_ROUTES: Record<string, string> = {
  "deal-accept": "the enactment route (enact-agent-deal, stage 6)",
  "deal-enacted": "the enactment route (enact-agent-deal, stage 6)",
  "deal-reject": "the rejection route (reject-agent-deal, stage 7.04)",
};

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
  ExpectedGameID: z.string().min(1).optional().describe("Optional game identity guard. Rejects the append when the active game has switched."),
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
    const { PlayerAID, PlayerBID, PlayerARole, PlayerBRole, SpeakerID, MessageType, Content, Payload, Turn, ExpectedGameID } = args;
    assertExpectedGame(this.name, ExpectedGameID);

    // No terminal answer to a proposal is written through this archival tool. Each has a
    // transactional route that serializes its own read/check/write against the store, so
    // whether a proposal is still open is decided there — never by a caller reading the
    // transcript first and appending afterwards, which two racing clients could both win.
    const terminalRoute = TERMINAL_ROUTES[MessageType];
    if (terminalRoute) {
      throw new Error(`${MessageType} is recorded by ${terminalRoute}, not append-message`);
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
    const endpointRoles = new Map([[player1ID, player1Role], [player2ID, player2Role]]);

    // Cached PlayerInformations (no live bridge call; only falls back to fetching when the
    // cache is empty). Read before the endpoints are classified, because "is this slot a real
    // observer?" and "is this slot a major civilization?" are the same question asked twice.
    const infos = await readPublicKnowledgeBatch("PlayerInformations", getPlayerInformations);
    const isLivingMajor = (id: number): boolean =>
      infos.some((info) => info.Key === id && info.IsMajor === 1);

    // A real observer endpoint is a concrete game slot that holds no civilization of its own.
    // Its slot INDEX is not a usable test for that: Civ 5 seats an observer in the first free
    // player slot, which lands inside the major-civilization range whenever the game has fewer
    // than MaxMajorCivs majors — an eight-civ game observes from slot 8. So the endpoint is
    // classified by what this server can actually verify: the exact Observer role on a slot
    // that holds no living major civilization. A real civ cannot slip past the major check by
    // claiming the role, because holding the civilization is exactly what disqualifies it.
    const observerIDs = [player1ID, player2ID].filter(
      (id) => id !== OBSERVER_ID && endpointRoles.get(id) === REAL_OBSERVER_ROLE && !isLivingMajor(id)
    );
    // A slot past the major range can only ever be here as the observer endpoint.
    if ([player1ID, player2ID].some((id) => id >= MaxMajorCivs && !observerIDs.includes(id))) {
      throw new Error("An out-of-range transcript endpoint must use the exact Observer role");
    }
    if (observerIDs.length > 0) {
      const counterpartID = player1ID === observerIDs[0] ? player2ID : player1ID;
      if (observerIDs.length !== 1 || counterpartID < 0 || counterpartID >= MaxMajorCivs) {
        throw new Error("A real observer endpoint must be paired with one in-range major civilization");
      }
    }

    // Major-civ validation. Both observer flavors — the -1 sentinel and a real observer slot —
    // are exempt; every other endpoint must be a major civilization. Skipped wholesale when the
    // cache is empty and the fallback fetch returned nothing: there is nothing to validate against.
    if (infos.length > 0) {
      for (const id of [player1ID, player2ID]) {
        if (id === OBSERVER_ID || observerIDs.includes(id)) continue;
        if (!isLivingMajor(id)) {
          throw new Error(`Player ${id} is not a major civilization`);
        }
      }
    }

    // Message-specific validation. Only proposals/counters need any: the response-type
    // branch that used to resolve and re-validate Payload.ProposalMessageID moved into
    // reject-agent-deal, which performs the same checks INSIDE its write transaction (the
    // guard here could go stale between the lookup and the append).
    if (PROPOSAL_TYPES.has(MessageType)) {
      // Proposals and counters must carry the proposed terms. Payload.Value1 / Value2
      // are optional per-item value snapshots for either ordered player — including a
      // human side, whose items the VP AI (CvDealAI) also values.
      if (!Payload || Payload.Deal === undefined) {
        throw new Error(`${MessageType} messages must include Payload.Deal`);
      }
    }

    // Write one row and recover its append ID directly (race-free; a re-query would
    // be unsafe under concurrent appends to the same pair). Visibility is set only for
    // the real participant(s): composeVisibility drops the -1 sentinel on its own, and a
    // real observer slot is filtered out here because an in-range one would otherwise claim
    // a column. Default Turn falls back to the server's current turn inside the store.
    // Repeat immediately before retaining the store reference. Earlier validation can await
    // cache-backed reads, during which a GameSwitched event may replace the active store.
    assertExpectedGame(this.name, ExpectedGameID);
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
      visibilityFlags: composeVisibility(
        [player1ID, player2ID].filter((id) => !observerIDs.includes(id))
      ),
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
