/**
 * Tool for relaying messages from a diplomat to the leader.
 * Creates a RelayedMessage event in the GameEvents table.
 * Supports both diplomatic communications and intelligence reports.
 */

import { DynamicEventTool, resolvePlayerName } from '../abstract/dynamic-event.js';
import * as z from 'zod';
import { Selectable } from 'kysely';
import { MaxMajorCivs } from '../../knowledge/schema/base.js';
import { PlayerInformation } from '../../knowledge/schema/public.js';

/** Input schema for the message relay tool */
const RelayMessageInputSchema = z.object({
  PlayerID: z.number().min(0).max(MaxMajorCivs - 1)
    .describe('The receiving player ID (the leader being informed)'),
  FromPlayerID: z.number().min(0).max(MaxMajorCivs - 1)
    .describe('The player ID of the civilization the message concerns'),
  Message: z.enum(['Diplomatic', 'Intelligence'])
    .describe('Message type: "diplomatic" for official communications, "intelligence" for gathered information'),
  Content: z.string().min(1).max(2000)
    .describe('The message content'),
  Confidence: z.number().min(0).max(9)
    .describe('Reliability assessment (0 = unreliable rumor, 9 = authoritative leader statement)'),
  Importance: z.number().min(0).max(9)
    .describe('Strategic urgency (0 = background information, 9 = leader must reconsider strategy immediately; 7+ is considered important)'),
  Categories: z.array(z.string()).min(1)
    .describe('Searchable categories (e.g., "Military", "Economic", "Diplomacy")'),
  Memo: z.string().min(1).max(500)
    .describe("The analyst's memo: assessment, reaction, and contextual notes")
});

/**
 * Tool that relays a message from one player's diplomat to the leader.
 * Creates a RelayedMessage event in the GameEvents table.
 */
class MessageRelayTool extends DynamicEventTool {
  readonly name = 'relay-message';
  readonly description = 'Relay a message from a diplomat to the leader, stored as a game event. Supports diplomatic messages and intelligence reports.';
  readonly eventType = 'RelayedMessage';
  readonly inputSchema = RelayMessageInputSchema;

  readonly metadata = {
    autoComplete: ['PlayerID']
  };

  /**
   * Build the enriched payload with resolved player names.
   */
  protected async buildPayload(
    args: z.infer<typeof RelayMessageInputSchema>,
    playerMap: Map<number, Selectable<PlayerInformation>>
  ): Promise<Record<string, unknown>> {
    return {
      ToPlayerID: args.PlayerID,
      FromPlayerID: args.FromPlayerID,
      ToPlayer: resolvePlayerName(playerMap, args.PlayerID),
      FromPlayer: resolvePlayerName(playerMap, args.FromPlayerID),
      Message: args.Message,
      Content: args.Content,
      Confidence: `${args.Confidence}/9`,
      Importance: args.Importance,
      Categories: args.Categories,
      Memo: `Our analyst: ${args.Memo}`
    };
  }
}

/** Factory function for tool registration */
export default function createRelayMessageTool() {
  return new MessageRelayTool();
}
