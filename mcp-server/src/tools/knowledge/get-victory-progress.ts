/**
 * Tool for retrieving victory progress information
 * Shows progress towards all victory types for all players
 * Filters player data based on diplomatic visibility
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { getVictoryProgress } from "../../knowledge/getters/victory-progress.js";
import { readPublicKnowledgeBatch } from "../../knowledge/helpers/cached.js";
import { stripMutableKnowledgeMetadata } from "../../knowledge/helpers/strip-metadata.js";
import {
  VictoryProgress,
  PlayerSummary,
  DominationVictoryDataSchema,
  ScienceVictoryDataSchema,
  CulturalVictoryDataSchema,
  DiplomaticVictoryDataSchema
} from "../../knowledge/schema/timed.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getPlayerSummaries } from "../../knowledge/getters/player-summary.js";
import { getPlayerInformations } from "../../knowledge/getters/player-information.js";
import { getPlayerVisibility } from "../../knowledge/helpers/visibility.js";
import { Selectable } from "kysely";
import { PlayerInformation } from "../../knowledge/schema/public.js";
import { sortBySchema } from "../../utils/schema.js";

/**
 * Interface for visibility filtering context
 */
interface VisibilityContext {
  playerSummaries: Selectable<PlayerSummary>[];
  playerInfos: Selectable<PlayerInformation>[];
  viewingPlayerID: number;
}

/**
 * Input schema for the GetVictoryProgress tool
 */
const GetVictoryProgressInputSchema = z.object({
  PlayerID: z.number().min(0).max(MaxMajorCivs - 1).optional().describe("Optional player ID to filter victory progress based on diplomatic visibility")
});

/**
 * Output schema for the GetVictoryProgress tool
 */
const GetVictoryProgressOutputSchema = z.object({
  DominationVictory: z.any(),
  ScienceVictory: z.any(),
  CulturalVictory: z.any(),
  DiplomaticVictory: z.any(),
});

/**
 * Type for the tool's output.
 */
export type VictoryProgressReport = z.infer<typeof GetVictoryProgressOutputSchema>;

/**
 * Tool for retrieving victory progress information
 */
class GetVictoryProgressTool extends ToolBase {
  /**
   * Unique identifier for the tool
   */
  readonly name = "get-victory-progress";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Retrieves progress towards all victory types for all players, filtered by diplomatic visibility";

  /**
   * Input schema for the tool
   */
  readonly inputSchema = GetVictoryProgressInputSchema;

  /**
   * Output schema for the tool
   */
  readonly outputSchema = GetVictoryProgressOutputSchema;

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
    markdownConfig: ["{key}"]
  }

  /**
   * Execute the tool to retrieve victory progress data
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    // Get victory progress data (single row with Key = 0) and player summaries for visibility
    const [victoryProgress, playerSummaries, playerInfos] = await Promise.all([
      getVictoryProgress(),
      args.PlayerID !== undefined ? getPlayerSummaries() : Promise.resolve([]),
      args.PlayerID !== undefined ? readPublicKnowledgeBatch("PlayerInformations", getPlayerInformations) : Promise.resolve([])
    ]);

    if (!victoryProgress) {
      throw new Error("No victory progress data available");
    }

    // Strip metadata (readPlayerKnowledge already strips it, but ensure clean data)
    const cleanProgress = victoryProgress as unknown as Omit<VictoryProgress, keyof typeof stripMutableKnowledgeMetadata>;

    // Parse and filter victory fields based on visibility
    const filterContext: VisibilityContext | undefined = args.PlayerID !== undefined && playerSummaries.length > 0 && playerInfos.length > 0
      ? { playerSummaries, playerInfos, viewingPlayerID: args.PlayerID }
      : undefined;

    return {
      DominationVictory: parseVictoryField(cleanProgress.DominationVictory, DominationVictoryDataSchema, filterContext),
      ScienceVictory: parseVictoryField(cleanProgress.ScienceVictory, ScienceVictoryDataSchema, filterContext),
      CulturalVictory: parseVictoryField(cleanProgress.CulturalVictory, CulturalVictoryDataSchema, filterContext),
      DiplomaticVictory: parseVictoryField(cleanProgress.DiplomaticVictory, DiplomaticVictoryDataSchema, filterContext),
    };
  }
}

/**
 * Parse victory field and apply visibility filtering and sorting
 * Parses JSON strings, filters out unmet players if visibility data is provided, and sorts by schema
 */
function parseVictoryField(
  field: string | object,
  schema: z.ZodObject<any, any>,
  filterContext?: VisibilityContext
): string | object {
  // Parse JSON if it's a string
  let parsed: string | object = field;
  if (typeof field === "string") {
    try {
      parsed = JSON.parse(field);
    } catch {
      // Not JSON, return as a simple string array (status string like "Not available")
      return [field];
    }
  }

  // Apply visibility filtering and sorting if it's an object
  if (typeof parsed === "object") {
    let result = parsed;

    // Apply visibility filtering if context provided
    if (filterContext) {
      result = filterVictoryData(
        result,
        filterContext.playerSummaries,
        filterContext.playerInfos,
        filterContext.viewingPlayerID
      );
    }

    // Apply sorting based on schema
    return sortBySchema(result, schema);
  }

  return parsed;
}

/**
 * Helper to check if a player is visible to the viewing player
 */
function isPlayerVisible(
  civName: string,
  context: VisibilityContext
): boolean {
  const playerInfo = context.playerInfos.find(info => info.Civilization === civName);
  if (!playerInfo) return true;

  const visibility = getPlayerVisibility(
    context.playerSummaries,
    context.viewingPlayerID,
    playerInfo.Key
  );
  return visibility > 0;
}

/**
 * Filter influence details to only show visible civilizations
 */
function filterInfluenceDetails(
  influenceDetails: Record<string, string>,
  context: VisibilityContext
): Record<string, string> {
  const filtered = { ...influenceDetails };

  for (const civName in filtered) {
    // Delete invisible civilizations
    if (!isPlayerVisible(civName, context)) {
      delete filtered[civName];
    }
  }

  return filtered;
}

/**
 * Filter player-keyed victory data based on visibility
 * Removes data for unmet players and filters nested influence information
 */
function filterVictoryData<T extends Record<string, any>>(
  data: T,
  playerSummaries: Selectable<PlayerSummary>[],
  playerInfos: Selectable<PlayerInformation>[],
  viewingPlayerID: number
): T {
  const context: VisibilityContext = {
    playerSummaries,
    playerInfos,
    viewingPlayerID
  };

  const filtered = { ...data };

  for (const key in filtered) {
    // Delete invisible players
    if (!isPlayerVisible(key, context)) {
      delete filtered[key];
      continue;
    }

    // Filter nested Influences for visible players
    const playerData = filtered[key] as { Influences?: Record<string, string> };
    if (playerData?.Influences && typeof playerData.Influences === 'object') {
      playerData.Influences = filterInfluenceDetails(
        playerData.Influences,
        context
      );
    }
  }

  return filtered;
}

/**
 * Creates a new instance of the get victory progress tool
 */
export default function createGetVictoryProgressTool() {
  return new GetVictoryProgressTool();
}
