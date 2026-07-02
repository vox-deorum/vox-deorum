/**
 * Tool for retrieving and updating player information from the game
 * Combines PlayerSummaries with static PlayerInformation
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger('GetPlayersTool');

import { getPlayerSummaries } from "../../knowledge/getters/player-summary.js";
import { getPlayerInformations } from "../../knowledge/getters/player-information.js";
import { PlayerOpinions, PlayerSummary } from "../../knowledge/schema/timed.js";
import { MaxMajorCivs, MINOR_CIV_LEADER } from "../../knowledge/schema/base.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { stripMutableKnowledgeMetadata } from "../../utils/knowledge/strip-metadata.js";
import { cleanEventData } from "./get-events.js";
import { getPlayerOpinions } from "../../knowledge/getters/player-opinions.js";
import { readPlayerKnowledge, readPublicKnowledgeBatch } from "../../utils/knowledge/cached.js";
import { getPlayerVisibility } from "../../utils/knowledge/visibility.js";
import { PlayerInformation } from "../../knowledge/schema/public.js";
import { Selectable } from "kysely";
import { sortBySchema } from "../../utils/schema.js";
import { stripTags } from "../../utils/database/localized.js";
import { annotateSubjects } from "./get-opinions.js";

// Re-export the minor-civ leader sentinel so `get-players` consumers can still find it here; the
// single source of truth lives in the dependency-free base schema alongside MaxMajorCivs.
export { MINOR_CIV_LEADER };

/**
 * Input schema for the GetPlayers tool
 */
const GetPlayersInputSchema = z.object({
  PlayerID: z.number().min(0).max(MaxMajorCivs - 1).optional().describe("Optional player ID to filter for a specific player")
});

/**
 * Schema for combined player data output
 */
const PlayerDataSchema = z.object({
  // PlayerInformation fields
  TeamID: z.number().optional(),
  Civilization: z.string(),
  Leader: z.string(),
  IsMajor: z.boolean(),
  // Opinion fields
  OurOpinionOfThem: z.array(z.string()).optional(),
  TheirOpinionOfUs: z.array(z.string()).optional(),
  MyEvaluations: z.array(z.string()).optional(),
  // PlayerSummary fields
  Score: z.number().optional(),
  Era: z.string().optional(),
  GoldenAge: z.string().optional(),
  Technologies: z.number().optional(),
  CurrentResearch: z.string().nullable().optional(),
  NextPolicyTurns: z.number().nullable().optional(),
  MajorAlly: z.string().nullable().optional(),
  Cities: z.number().optional(),
  Population: z.number().optional(),
  Territory: z.number().optional(),
  BestSettlementLocation: z.array(z.string()).optional(),
  Gold: z.number().optional(),
  GoldPerTurn: z.number().optional(),
  HappinessSituation: z.string().optional(),
  HappinessPercentage: z.number().optional(),
  MilitaryUnits: z.number().optional(),
  MilitarySupply: z.number().optional(),
  MilitaryStrength: z.number().optional(),
  TourismPerTurn: z.number().optional(),
  CulturePerTurn: z.number().optional(),
  FaithPerTurn: z.number().optional(),
  SciencePerTurn: z.number().optional(),
  PolicyBranches: z.union([z.record(z.string(), z.array(z.string())), z.record(z.string(), z.number())]).optional(),
  Resources: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  ResourcesAvailable: z.record(z.string(), z.number()).optional(),
  FoundedReligion: z.string().nullable().optional(),
  MajorityReligion: z.string().nullable().optional(),
  Relationships: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  OutgoingTradeRoutes: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.any())])).optional(),
  IncomingTradeRoutes: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.any())])).optional(),
  Spies: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  DiplomaticDeals: z.record(z.string(), z.array(z.object({
    TurnsRemaining: z.number(),
    WeGive: z.array(z.string()),
    TheyGive: z.array(z.string())
  }))).optional(),
  Quests: z.array(z.string()).optional(),
}).passthrough();

/**
 * Type for the tool's output.
 */
const GetPlayersOutputSchema = z.record(z.string(), z.union([PlayerDataSchema, z.string()]));
export type PlayersReport = z.infer<typeof GetPlayersOutputSchema>;

/**
 * Tool for retrieving player information and summaries
 */
class GetPlayersTool extends ToolBase {
  /**
   * Unique identifier for the tool
   */
  readonly name = "get-players";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Retrieves a list of in-game players and their summary information";

  /**
   * Input schema for the tool
   */
  readonly inputSchema = GetPlayersInputSchema;

  /**
   * Output schema for the tool
   */
  readonly outputSchema = GetPlayersOutputSchema;

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
    autoComplete: ["PlayerID"],
    markdownConfig: ["Player {key}"]
  }

  /**
   * Execute the tool to retrieve player data
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    // Get static player information, current player summaries, opinions, and strategies in parallel
    var [playerInfos, playerSummaries, playerOpinions] = await Promise.all([
      readPublicKnowledgeBatch("PlayerInformations", getPlayerInformations),
      getPlayerSummaries(),
      readPlayerKnowledge(args.PlayerID, "PlayerOpinions", getPlayerOpinions)
    ]);

    // Sanity check: verify all players in summary have corresponding information
    // If any player is missing information, refresh and store it
    const missingPlayers: number[] = [];
    for (const summary of playerSummaries) {
      if (!playerInfos.find(info => info.Key === summary.Key))
        missingPlayers.push(summary.Key);
    }
    if (missingPlayers.length > 0) {
      logger.warn(`Found ${missingPlayers.length} player(s) in summary without corresponding information. Refreshing player information...`);
      playerInfos = await getPlayerInformations(true);
    }

    // Get diplomat points record once for the viewing player
    let diplomatPointsRecord: Record<string, number> | undefined;
    if (args.PlayerID !== undefined) {
      const currentPlayerSummary = playerSummaries.find(s => s.Key === args.PlayerID);
      if (currentPlayerSummary?.DiplomatPoints) {
        diplomatPointsRecord = currentPlayerSummary.DiplomatPoints as Record<string, number>;
      }
    }

    // Combine the data and create dictionary
    const playersDict: PlayersReport = {};
    const requestingCivName = playerInfos.find(i => i.Key === args.PlayerID)?.Civilization ?? 'Unknown';
    for (const info of playerInfos) {
      const playerID = info.Key;
      const summary = playerSummaries.find(s => s.Key === playerID);
      // Ignore dead players or barbarians
      if (playerID == 63) {
        playersDict[playerID.toString()] = "Barbarians";
        continue;
      }
      if (playerSummaries.length > 0 && !summary) {
        playersDict[playerID.toString()] = info.IsMajor === 1 
          ? `Defeated Major Civilization ${info.Civilization}` 
          : `Defeated Minor Civilization ${info.Civilization}`;
        continue;
      }
      
      // Check visibility
      const visibility = getPlayerVisibility(playerSummaries, args.PlayerID, playerID);
      
      // If not met (visibility = 0), return unmet string
      if (visibility === 0) {
        playersDict[playerID.toString()] = info.IsMajor === 1 
          ? "Unmet Major Civilization" 
          : "Unmet Minor Civilization";
        continue;
      }
      
      // Strip metadata and rename Key to PlayerID
      const cleanSummary = stripMutableKnowledgeMetadata<PlayerSummary>(summary!);
      
      const playerData: z.infer<typeof PlayerDataSchema> = {
        // Static information
        TeamID: info.TeamID,
        Civilization: info.Civilization,
        Leader: info.IsMajor ? info.Leader : MINOR_CIV_LEADER,
        IsMajor: info.IsMajor == 1,
        // Dynamic summary (if available)
        ...cleanSummary
      } as unknown as z.infer<typeof PlayerDataSchema>;

      // Text format for happiness
      if (playerData.HappinessPercentage !== undefined) {
        if (playerData.HappinessPercentage <= 20)
          playerData.HappinessSituation = "Super unhappy - severe combat penalty, rebellion and uprising coming fast"
        else if (playerData.HappinessPercentage <= 35)
          playerData.HappinessSituation = "Very unhappy - severe combat penalty, rebellion and uprising coming"
        else if (playerData.HappinessPercentage <= 50)
          playerData.HappinessSituation = "Unhappy - combat penalty"
        else playerData.HappinessSituation = "Happy"
      }

      // Load player opinions - annotate pronouns with civilization names
      // In GetOpinionTable(ePlayer) on pkPlayer: We/Our/You/Your = ePlayer, They = pkPlayer
      if (playerOpinions) {
        if (playerID === args.PlayerID) {
          playerData.MyEvaluations = annotateSubjects(
            stripTags(playerOpinions[`OpinionFrom${info.Key}` as keyof PlayerOpinions] as string)?.split("\n"),
            requestingCivName, ''
          );
        } else {
          playerData.OurOpinionOfThem = annotateSubjects(
            stripTags(playerOpinions[`OpinionTo${info.Key}` as keyof PlayerOpinions] as string)?.split("\n"),
            info.Civilization, requestingCivName
          );
          playerData.TheirOpinionOfUs = annotateSubjects(
            stripTags(playerOpinions[`OpinionFrom${info.Key}` as keyof PlayerOpinions] as string)?.split("\n"),
            requestingCivName, info.Civilization
          );
        }
      }

      // Remove TeamID if you are your team
      if (playerID === playerData.TeamID)
        delete playerData.TeamID;

      // Get diplomat points for this target player from the pre-fetched record
      const diplomatPoints = diplomatPointsRecord?.[`Player${playerID}`];

      // Postprocess to remove things you shouldn't see
      if (visibility !== 2) postProcessData(playerData, playerInfos, playerSummaries, args.PlayerID, diplomatPoints);

      playersDict[playerID.toString()] = sortBySchema(cleanEventData(playerData, false)!, PlayerDataSchema);
    }
    
    return playersDict;
  }
}

/**
 * Creates a new instance of the get players tool
 */
export default function createGetPlayersTool() {
  return new GetPlayersTool();
}

/**
 * Post process from a player's perspective based on visibility.
 */
function postProcessData(
  summary: z.infer<typeof PlayerDataSchema>,
  playerInfos: Selectable<PlayerInformation>[],
  playerSummaries: Selectable<PlayerSummary>[],
  viewingPlayerID?: number,
  // Hard-coded this impact for now
  diplomatPoints: number = 0
): z.infer<typeof PlayerDataSchema> {
  // For met players (visibility 1): only show policy branch counts, not details
  if (summary.PolicyBranches && diplomatPoints < 200) {
    const branches = summary.PolicyBranches as Record<string, string[]>;
    const counts: Record<string, number> = {};
    for (const [branch, policies] of Object.entries(branches)) {
      counts[branch] = Array.isArray(policies) ? policies.length : policies as number;
    }
    summary.PolicyBranches = counts as Record<string, number>;
  }

  // Hide settlement location
  delete summary.BestSettlementLocation;

  // Hide current research from non-team members
  delete summary.CurrentResearch;
  delete summary.NextPolicyTurns;

  // Hide FaithPerTurn and SciencePerTurn from non-team members (visibility 2 only)
  delete summary.FaithPerTurn;
  delete summary.SciencePerTurn;

  // Hide trade, spy, and diplomatic deal information
  delete summary.OutgoingTradeRoutes;
  delete summary.IncomingTradeRoutes;
  delete summary.Spies;
  if (diplomatPoints < 800) delete summary.DiplomaticDeals;
  delete summary.DiplomatPoints;

  // Hide military supply
  delete summary.MilitarySupply;
  if (diplomatPoints < 500) delete summary.MilitaryUnits;

  // Hide golden age if not in one
  if (summary.GoldenAge && !summary.GoldenAge.endsWith("turns remaining"))
    delete summary.GoldenAge;

  // Hide war weariness from relationships
  if (summary.Relationships && summary.IsMajor)
    for (var player in summary.Relationships) {
      summary.Relationships[player] = (summary.Relationships[player] as string[]).map(rel => {
        // Remove war weariness from war relationships (keep only the score)
        const warRegex = /; War Weariness: -?[\d\.]+%/;
        return rel.replace(warRegex, "");
      });
    }

  // Check for unmet civilizations in relationships
  if (summary.Relationships && viewingPlayerID !== undefined) {
    const updatedRelationships: Record<string, string[] | string> = {};

    for (const civName in summary.Relationships) {
      // Find the player info by civilization name
      const targetInfo = playerInfos.find(info => info.Civilization === civName);

      if (targetInfo) {
        // Check visibility of the target player
        const targetVisibility = getPlayerVisibility(playerSummaries, viewingPlayerID, targetInfo.Key);

        if (targetVisibility === 0) {
          // Player hasn't met this civilization
          delete updatedRelationships[civName];
        } else {
          // Player has met this civilization, keep the original relationships
          updatedRelationships[civName] = summary.Relationships[civName];
        }
      } else {
        // Keep original if we can't find the player (shouldn't happen)
        updatedRelationships[civName] = summary.Relationships[civName];
      }
    }

    summary.Relationships = updatedRelationships;
  }

  // For non-team players, expose only available resource counts.
  if (summary.Resources) {
    const resourcesAvailable = Object.fromEntries(
      Object.entries(summary.Resources)
        .map(([resource, value]) => [resource, getAvailableResourceCount(value)] as const)
        .filter(([_, value]) => value !== 0)
    );
    delete summary.Resources;
    if (Object.keys(resourcesAvailable).length > 0) {
      summary.ResourcesAvailable = resourcesAvailable;
    }
  }

  // Remove info from minor civs
  if (!summary.IsMajor) {
    delete summary.TeamID;
    delete summary.Era;
    delete summary.Cities;
    delete summary.Technologies;
    delete summary.Gold;
    delete summary.GoldPerTurn;
    delete summary.Score;
    delete summary.CulturePerTurn;
    delete summary.FaithPerTurn;
    delete summary.SciencePerTurn;
    delete summary.TourismPerTurn;
    delete summary.HappinessPercentage;
    if (viewingPlayerID !== -1 && summary.Quests)
      summary.Quests = ((summary.Quests as unknown as Record<string, string[]>)[`Player${viewingPlayerID}`]).map((Quest: string) => Quest.trim());
    else delete summary.Quests;
  } else {
    delete summary.Quests;
  }
  return summary;
}

function getAvailableResourceCount(value: string | number): number {
  if (typeof value === 'number') return value;
  const available = Number.parseInt(value.split('/')[0].trim(), 10);
  return Number.isNaN(available) ? 0 : available;
}
