/**
 * Tool for retrieving diplomatic opinions between players with static player information
 * Gets opinions both TO and FROM a specific player with all other alive major civilizations
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { getPlayerOpinions } from "../../knowledge/getters/player-opinions.js";
import { getPlayerInformations } from "../../knowledge/getters/player-information.js";
import { getPlayerSummaries } from "../../knowledge/getters/player-summary.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { PlayerOpinions } from "../../knowledge/schema/timed.js";
import { stripTags } from "../../database/helpers/localized.js";
import { cleanEventData } from "./get-events.js";

/**
 * Annotates leading pronouns in opinion strings with civilization names.
 * In GetOpinionTable(ePlayer) on pkPlayer: We/Our/You/Your = ePlayer, They = pkPlayer.
 */
export function annotateSubjects(
  opinions: string[] | undefined,
  ePlayerLabel: string,
  pkPlayerLabel: string
): string[] | undefined {
  if (!opinions) return undefined;
  return opinions.map(s =>
    s.trim()
     // Special cases
     .replace(/^Our real approach /, `${pkPlayerLabel}'s real approach to ${ePlayerLabel} `)
     .replace(/^Our leader has expressed a public opinion of you /, `${pkPlayerLabel}'s leader has expressed a public opinion of ${ePlayerLabel} `)
     .replace(/^Our leader has formed a private opinion of you /, `${pkPlayerLabel}'s leader has formed a private opinion of ${ePlayerLabel} `)
     // Regular cases
     .replace(/\bus\b/, `us (${ePlayerLabel})`)
     .replace(/\bour empire\b/, `${ePlayerLabel}`)
     .replace(/^You /, `You (${ePlayerLabel}) `)
     .replace(/\byou\b/, `you (${ePlayerLabel})`)
     .replace(/^Your /, `Your (${ePlayerLabel}) `)
     .replace(/\byour\b/, `your (${ePlayerLabel})`)
     .replace(/^They /, `${pkPlayerLabel} `)
     .replace(/\bthey\b/, `${pkPlayerLabel}`)
     .replace(/\bthem\b/, `${pkPlayerLabel}`)
     .replace(/^Their /, `${pkPlayerLabel}'s `)
     .replace(/\btheir\b/, `${pkPlayerLabel}'s`)
  );
}

/**
 * Input schema for the GetOpinions tool
 */
const GetOpinionsInputSchema = z.object({
  PlayerID: z.number().min(0).max(MaxMajorCivs - 1).describe("Player ID whose opinions to retrieve"),
  RevealAll: z.boolean().optional().describe("Optional flag to reveal all players regardless of met status (default: false)")
});

/**
 * Schema for opinion data with player information
 */
const OpinionDataSchema = z.object({
  // Static player information fields
  TeamID: z.number(),
  Civilization: z.string(),
  Leader: z.string(),
  IsMajor: z.boolean(),
  // Opinion fields
  OurOpinionOfThem: z.array(z.string()).describe("Opinion from the requesting player OF the target player").optional(),
  TheirOpinionOfUs: z.array(z.string()).describe("Opinion FROM the target player of the requesting player").optional(),
  MyEvaluations: z.array(z.string()).describe("My evaluation of other players").optional(),
});

/**
 * Tool for retrieving diplomatic opinions between players
 */
class GetOpinionsTool extends ToolBase {
  /**
   * Unique identifier for the tool
   */
  readonly name = "get-opinions";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Retrieves diplomatic opinions TO and FROM a player with all other alive major civilizations along with their static player information";

  /**
   * Input schema for the tool
   */
  readonly inputSchema = GetOpinionsInputSchema;

  /**
   * Output schema for the tool
   */
  readonly outputSchema = z.record(z.string(), z.union([OpinionDataSchema, z.string()]));

  /**
   * Optional annotations for the tool
   */
  readonly annotations: ToolAnnotations = {
    readOnlyHint: true
  }

  /**
   * Optional metadata for the tool
   */
  readonly metadata = {
    autoComplete: ["PlayerID", "RevealAll"],
    markdownConfig: ["{key}"]
  }

  /**
   * Execute the tool to retrieve opinion data with player information
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const { PlayerID, RevealAll = false } = args;
    
    // Get all player information, summaries, and opinions in parallel
    const [playerInfos, playerSummaries, playerOpinions] = await Promise.all([
      getPlayerInformations(),
      getPlayerSummaries(),
      getPlayerOpinions(PlayerID, false)
    ]);
    
    if (!playerOpinions) {
      return {};
    }
    
    // Build the result dictionary
    const opinionsDict: Record<string, z.infer<typeof this.outputSchema>[string]> = {};
    const requestingCivName = playerInfos.find(i => i.Key === PlayerID)?.Civilization ?? 'Unknown';

    // Iterate through all players to extract opinions
    for (const info of playerInfos) {
      const targetPlayerID = info.Key;
      
      // Skip non-major civs and non-alive players
      if (info.IsMajor !== 1) continue;
      
      // Check if the player has been met (unless RevealAll is true)
      if (!RevealAll) {
        const summary = playerSummaries.find(s => s.Key === targetPlayerID);
        if (summary) {
          // Get the visibility field for the requesting player
          const visibilityField = `Player${PlayerID}`;
          const visibility = (summary as Record<string, unknown>)[visibilityField];
          
          // If not met (visibility = 0), return unmet string
          if (visibility === 0) {
            opinionsDict[targetPlayerID.toString()] = "Unmet Major Civilization";
            continue;
          }
        }
      }
      
      // Extract opinions from the PlayerOpinions object
      const fromOpinion = playerOpinions[`OpinionFrom${targetPlayerID}` as keyof(PlayerOpinions)] as string;
      const toOpinion = playerOpinions[`OpinionTo${targetPlayerID}` as keyof(PlayerOpinions)] as string;
      
      // Only add if we have valid opinions
      if (toOpinion || fromOpinion) {
        const playerData: z.infer<typeof OpinionDataSchema> = {
          // Include static player information
          TeamID: info.TeamID,
          Civilization: info.Civilization,
          Leader: info.Leader,
          IsMajor: info.IsMajor === 1,
          // Opinion data - annotate pronouns with civ names
          // In GetOpinionTable(ePlayer) on pkPlayer: We/Our/You/Your = ePlayer, They = pkPlayer
          OurOpinionOfThem: annotateSubjects(
            stripTags(toOpinion)?.split("\n"),
            info.Civilization,    // ePlayer = target
            requestingCivName     // pkPlayer = us
          ),
          TheirOpinionOfUs: targetPlayerID === args.PlayerID ? undefined : annotateSubjects(
            stripTags(fromOpinion)?.split("\n"),
            requestingCivName,    // ePlayer = us
            info.Civilization     // pkPlayer = target
          ),
          MyEvaluations: targetPlayerID !== args.PlayerID ? undefined : annotateSubjects(
            stripTags(fromOpinion)?.split("\n"),
            requestingCivName,    // "Our" = requesting player
            ''                    // No "They" in evaluation strings
          )
        };
        
        const checkedData = OpinionDataSchema.safeParse(playerData).data;
        opinionsDict[targetPlayerID.toString()] = cleanEventData(checkedData, false)!;
      }
    }
    
    return opinionsDict;
  }
}

/**
 * Creates a new instance of the get opinions tool
 */
export default function createGetOpinionsTool() {
  return new GetOpinionsTool();
}