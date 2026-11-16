import { ToolBase } from '../base.js';
import * as z from "zod";
import { knowledgeManager } from '../../server.js';
import { newspaperEvidenceRequestSchema, newspaperEvidenceSchema } from '../../newspaper/evidence.js';
import { queryNewspaperEvidence } from '../../newspaper/queries.js';

// Use the agent's existing PlayerID binding while leaving the shared replay contract unchanged.
const { receiverPlayerID, ...requestFields } = newspaperEvidenceRequestSchema.shape;
const inputSchema = z.object({ ...requestFields, PlayerID: receiverPlayerID });

/** MCP adapter for the same dated evidence query used by offline replay. */
class GetNewspaperEvidenceTool extends ToolBase {
  readonly name = 'get-newspaper-evidence';
  readonly description = 'Retrieves permitted recorded newspaper evidence through a game-turn cutoff';
  readonly inputSchema = inputSchema;
  readonly outputSchema = newspaperEvidenceSchema;
  readonly annotations = { readOnlyHint: true };
  readonly metadata = { autoComplete: ['PlayerID'] };

  /** Query the open knowledge database without refreshing any live game data. */
  async execute({ PlayerID, ...args }: z.infer<typeof inputSchema>) {
    if (args.cutoffTurn >= knowledgeManager.getTurn()) {
      throw new Error('Newspaper evidence requires a cutoff before the current game turn');
    }
    return queryNewspaperEvidence(knowledgeManager.getStore().getDatabase(), { ...args, receiverPlayerID: PlayerID });
  }
}

/** Create the historical newspaper evidence adapter. */
export default function createGetNewspaperEvidenceTool() {
  return new GetNewspaperEvidenceTool();
}
