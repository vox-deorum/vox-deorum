/** Shared MCP helpers for the deal suites, which all trade between seats 3 and 1. */
import type { ToolBase } from '../../../src/tools/base.js';
import type { ToolClient } from '../tool-client.js';

/** Bind the transcript reader and proposal seeder to a suite's current client. */
export function dealHelpers(getClient: () => ToolClient, tools: { append: ToolBase; read: ToolBase }) {
  return {
    /** Read transcript rows for a pair through the read-transcript tool. */
    async readMessages(playerAID: number, playerBID: number, messageType?: string): Promise<any[]> {
      const result = await getClient().call({
        PlayerAID: playerAID,
        PlayerBID: playerBID,
        ...(messageType ? { MessageType: messageType } : {}),
      }, tools.read.name);
      return result.messages;
    },
    /** Seed a deal proposal in the 3 to 1 pair and return its append ID. */
    async seedProposal(speakerID = 3, deal: unknown = { version: 1, items: [], promises: [] }): Promise<number> {
      const row = await getClient().call({
        PlayerAID: 3,
        PlayerBID: 1,
        PlayerARole: 'negotiator',
        PlayerBRole: 'the leader',
        SpeakerID: speakerID,
        MessageType: 'deal-proposal',
        Content: 'Offer',
        Payload: { Deal: deal },
      }, tools.append.name);
      return row.ID;
    },
  };
}
