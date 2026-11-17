/**
 * Tool for retrieving static game settings that don't change during gameplay
 */

import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { LuaFunctionTool } from "../abstract/lua-function.js";
import * as z from "zod";
import { bridgeManager, knowledgeManager } from "../../server.js";
import path from "node:path";
import { createLogger } from "../../utils/logger.js";
import { CivilizationSummarySchema } from "../databases/get-civilization.js";
import { getTool } from "../index.js";
import { readPublicKnowledgeBatch } from "../../knowledge/helpers/cached.js";
import { getPlayerInformations } from "../../knowledge/getters/player-information.js";
import type { KnowledgeStore } from "../../knowledge/store.js";

const logger = createLogger("GetGameSettings");

/**
 * Schema for static game metadata
 */
const MetadataSchema = z.object({
  YouAre: CivilizationSummarySchema.extend({
    PlayerID: z.number(),
    PermanentTeammates: z.array(z.string()).optional()
  }).optional(),
  GameSpeed: z.string(),
  GameSpeedMultiplier: z.number().optional().describe("Game speed training cost multiplier"),
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

/** Recording fields used internally for wrap-aware map distances. */
export const mapGeometryMetadataSchema = z.object({
  mapWidth: z.number().int().positive(),
  mapHeight: z.number().int().positive(),
  mapWrapX: z.boolean(),
  mapWrapY: z.boolean()
});

const mapGeometryRecordings = new WeakMap<KnowledgeStore, Promise<void>>();

/** Share geometry collection across all settings requests for this store. */
function ensureMapGeometry(store: KnowledgeStore): Promise<void> {
  let recording = mapGeometryRecordings.get(store);
  if (!recording) {
    recording = saveMapGeometry(store).then(saved => {
      if (!saved) mapGeometryRecordings.delete(store);
    });
    mapGeometryRecordings.set(store, recording);
  }
  return recording;
}

/** Collect map geometry without putting it in a registered Lua function's response. */
async function saveMapGeometry(store: KnowledgeStore): Promise<boolean> {
  try {
    const keys = Object.keys(mapGeometryMetadataSchema.shape);
    const saved = await Promise.all(keys.map(key => store.getMetadata(key)));
    if (saved.every(value => value !== undefined)) return true;
    const response = await bridgeManager.executeLuaScript(`
      local width, height = Map.GetGridSize()
      return { mapWidth = width, mapHeight = height, mapWrapX = Map.IsWrapX(), mapWrapY = Map.IsWrapY() }
    `);
    if (!response.success) return false;
    const geometry = mapGeometryMetadataSchema.safeParse(response.result);
    if (!geometry.success || knowledgeManager.getStore() !== store) return false;
    await Promise.all(Object.entries(geometry.data).map(([key, value]) => store.setMetadata(key, String(value))));
    return true;
  } catch (error) {
    logger.warn('Could not record map geometry', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

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
    if (!result.Success) return result;
    if (!result.Result) {
      return { Success: false, Error: { Code: 'SETTINGS_UNAVAILABLE', Message: 'Game settings are unavailable' } };
    }
    const metadata = result.Result;
    if (args.PlayerID !== undefined && args.PlayerID >= 0 && (
      !metadata.YouAre || metadata.YouAre.PlayerID !== args.PlayerID ||
      typeof metadata.YouAre.Name !== 'string' || typeof metadata.YouAre.Leader !== 'string'
    )) {
      return { Success: false, Error: { Code: 'IDENTITY_UNAVAILABLE', Message: 'Player identity is unavailable' } };
    }
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
      store.setMetadata('victoryTypes', metadata.VictoryTypes.join(', ')),
      ensureMapGeometry(store)
    ]);

    if (metadata.YouAre) {
      const identity = metadata.YouAre;
      try {
        const civilization = (await getTool("getCivilization")?.getSummaries())?.find(current => current.Type === identity.Type);
        if (civilization?.Uniques) identity.Uniques = [...civilization.Uniques];
      } catch (error) {
        logger.warn('Could not enrich player identity with civilization uniques', { error: error instanceof Error ? error.message : error });
      }
      delete identity.Type;
      try {
        // Teammates are optional; an empty cache can recover after startup collection failed.
        const summaries = await readPublicKnowledgeBatch("PlayerInformations", getPlayerInformations);
        const summary = summaries.find(summary => summary.Key === args.PlayerID);
        if (summary) {
          const teammates = summaries
            .filter(other => other.Key !== summary.Key && other.TeamID === summary.TeamID && other.IsMajor === 1)
            .map(other => `Player ${other.Key}: ${other.Civilization} (${other.Leader})`);
          if (teammates.length > 0) identity.PermanentTeammates = teammates;
        }
      } catch (error) {
        logger.warn('Could not read permanent teammates', { error: error instanceof Error ? error.message : error });
      }
    }

    return { ...result, Result: this.resultSchema.parse(metadata) };
  }
}

/**
 * Creates a new instance of the get game settings tool
 */
export default function createGetGameSettingsTool() {
  return new GetGameSettingsTool();
}
