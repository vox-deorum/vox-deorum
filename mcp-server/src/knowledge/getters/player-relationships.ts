/**
 * Getter function to retrieve latest relationship changes for a player
 */

import { knowledgeManager } from "../../server.js";
import { createLogger } from "../../utils/logger.js";
import { readPublicKnowledgeBatch } from "../helpers/cached.js";
import { getPlayerInformations } from "./player-information.js";

const logger = createLogger("GetPlayerRelationships");

/**
 * Relationship change data for a specific target
 */
export interface RelationshipData {
  Public: number;
  Private: number;
  Rationale: string;
  UpdatedTurn: number;
}

/**
 * Gets the latest relationship changes made by a specific player
 * Returns relationship modifiers mapped by target civilization name
 *
 * @param playerId - The ID of the player who set the relationships
 * @returns Record mapping civilization names to relationship data
 * @throws Error if the player does not exist
 */
export async function getPlayerRelationships(playerId: number): Promise<Record<string, RelationshipData>> {
  const store = knowledgeManager.getStore();
  const db = store.getDatabase();

  try {
    // Get player information to map IDs to civilization names
    const playerInfos = await readPublicKnowledgeBatch("PlayerInformations", getPlayerInformations);

    // Validate that the player exists
    const playerInfo = playerInfos.find(p => p.Key === playerId);
    if (!playerInfo) {
      throw new Error(`No player found with ID ${playerId}. Player may not be alive or does not exist.`);
    }

    // Query only the latest relationship change for each target player
    // Using a subquery to get max Turn for each TargetID, then join to get full records
    const results = await db
      .selectFrom('RelationshipChanges as rc1')
      .selectAll('rc1')
      .where('rc1.PlayerID', '=', playerId)
      .where((eb) =>
        eb('rc1.Turn', '=',
          eb.selectFrom('RelationshipChanges as rc2')
            .select((eb) => eb.fn.max('rc2.Turn').as('maxTurn'))
            .where('rc2.PlayerID', '=', playerId)
            .where('rc2.TargetID', '=', eb.ref('rc1.TargetID'))
        )
      )
      .execute();

    // Map target IDs to civilization names
    const result: Record<string, RelationshipData> = {};

    for (const record of results) {
      const targetPlayer = playerInfos.find(p => p.Key === record.TargetID);
      if (targetPlayer) {
        result[targetPlayer.Civilization] = {
          Public: record.PublicValue,
          Private: record.PrivateValue,
          Rationale: record.Rationale,
          UpdatedTurn: record.Turn
        };
      }
    }

    return result;
  } catch (error) {
    // Re-throw validation errors
    if (error instanceof Error && error.message.includes('No player found')) {
      throw error;
    }
    logger.error(`Failed to retrieve relationships for player ${playerId}:`, error);
    return {};
  }
}
