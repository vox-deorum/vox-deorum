/**
 * Tool for retrieving static game settings that don't change during gameplay
 */

import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { LuaFunctionTool } from "../abstract/lua-function.js";
import * as z from "zod";
import { knowledgeManager } from "../../server.js";
import path from "node:path";
import { CivilizationSummarySchema } from "../databases/get-civilization.js";
import { getTool } from "../index.js";
import { readPublicKnowledgeBatch } from "../../knowledge/helpers/cached.js";
import { getPlayerInformations } from "../../knowledge/getters/player-information.js";

/**
 * Schema for static game metadata
 */
const MetadataSchema = z.object({
  YouAre: CivilizationSummarySchema.extend({
    PlayerID: z.number(),
    PermanentTeammates: z.array(z.string()).optional()
  }).optional(),
  GameSpeed: z.string(),
  MapType: z.string(),
  MapSize: z.string(),
  Difficulty: z.string(),
  StartEra: z.string(),
  MaxTurns: z.number(),
  VictoryTypes: z.array(z.string())
});

/**
 * Export type for reuse
 */
export type GameMetadata = z.infer<typeof MetadataSchema>;

/**
 * Tool for retrieving static game settings
 */
class GetGameSettingsTool extends LuaFunctionTool<GameMetadata> {
  /**
   * Unique identifier for the tool
   */
  readonly name = "get-game-settings";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Retrieves static game metadata including game speed, map type/size, difficulty, start era, max turns, and enabled victory types";

  /**
   * Input schema for the tool (no input required)
   */
  readonly inputSchema = z.object({
    PlayerID: z.number().optional().describe("Optional player ID to get player-specific information")
  });

  /**
   * Schema for the result data
   */
  protected readonly resultSchema = MetadataSchema;

  /**
   * Lua function arguments
   */
  protected get arguments() { return ["playerID"]; }

  /**
   * Path to the Lua script file relative to the lua/ directory
   */
  protected readonly scriptFile = "get-game-settings.lua";

  /**
   * Optional annotations for the tool
   */
  readonly annotations: ToolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false
  };

  /**
   * Execute the tool to retrieve metadata and save to knowledge store
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const result = await this.call(args.PlayerID ?? -1);
    const metadata = result.Result as z.infer<typeof this.resultSchema>;
    const store = knowledgeManager.getStore();

    // Strip MapType to just filename without extension/path using Node.js path module
    metadata.MapType = path.win32.basename(metadata.MapType, path.win32.extname(metadata.MapType));

    // Don't save YouAre to knowledge store - it's transient per-request data
    await Promise.all([
      store.setMetadata('gameSpeed', metadata.GameSpeed),
      store.setMetadata('mapType', metadata.MapType),
      store.setMetadata('mapSize', metadata.MapSize),
      store.setMetadata('difficulty', metadata.Difficulty),
      store.setMetadata('startEra', metadata.StartEra),
      store.setMetadata('maxTurns', metadata.MaxTurns.toString()),
      store.setMetadata('victoryTypes', metadata.VictoryTypes.join(', '))
    ]);

    if (args.PlayerID !== undefined) {
      const summaries = await readPublicKnowledgeBatch("PlayerInformations", getPlayerInformations);
      const summary = summaries.find(summary => summary.Key == args.PlayerID);
      if (summary) {
        const civilization = (await getTool("getCivilization")?.getSummaries())?.find(current => current.Name == summary.Civilization);
        if (civilization) {
          metadata.YouAre = JSON.parse(JSON.stringify(civilization));
          metadata.YouAre!.PlayerID = args.PlayerID;
          delete metadata.YouAre!.Type;
          // Players sharing our team (fixed at game start)
          const teammates = summaries
            .filter(other => other.Key !== summary.Key && other.TeamID === summary.TeamID && other.IsMajor === 1)
            .map(other => `Player ${other.Key}: ${other.Civilization} (${other.Leader})`);
          if (teammates.length > 0) metadata.YouAre!.PermanentTeammates = teammates;
        }
      }
    }

    return result;
  }
}

/**
 * Creates a new instance of the get game settings tool
 */
export default function createGetGameSettingsTool() {
  return new GetGameSettingsTool();
}