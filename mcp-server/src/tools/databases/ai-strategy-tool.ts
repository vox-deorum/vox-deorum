import { gameDatabase } from "../../server.js";
import { DatabaseQueryTool } from "../abstract/database-query.js";
import * as z from "zod";
import * as changeCase from "change-case";
import * as path from "path";
import { createLogger } from "../../utils/logger.js";
import { writeJsonIfChanged } from "../../utils/file-utils.js";

/**
 * Shared shape for AI strategy information (economic and military strategies
 * are structurally identical: type, city flavors, player flavors, description)
 */
export interface AiStrategy {
  Type: string;
  Production: Record<string, number>;
  Overall: Record<string, number>;
  Description?: string;
}

/**
 * Schema for AI strategy information (summary and full are the same)
 */
export const aiStrategySchema = z.object({
  Type: z.string(),
  Production: z.record(z.string(), z.number()),
  Overall: z.record(z.string(), z.number()),
  Description: z.string().optional()
});

/**
 * Per-tool configuration: the table/column/prefix/file specifics that differ
 * between the economic and military strategy tools
 */
export interface AiStrategyToolConfig {
  /** Main strategy table, e.g. "AIEconomicStrategies" */
  mainTable: string;
  /** City (production) flavors table, e.g. "AIEconomicStrategy_City_Flavors" */
  cityFlavorsTable: string;
  /** Player (overall) flavors table, e.g. "AIEconomicStrategy_Player_Flavors" */
  playerFlavorsTable: string;
  /** Strategy FK column in the flavor tables, e.g. "AIEconomicStrategyType" */
  strategyColumn: string;
  /** Prefix stripped from strategy types before PascalCase, e.g. "ECONOMICAISTRATEGY_" */
  typePrefix: string;
  /** JSON file basename under docs/strategies, e.g. "economic.json" */
  jsonFile: string;
  /** Loader for existing strategy descriptions from the JSON file */
  loadExisting: () => Promise<AiStrategy[]>;
  /** Logger context name, e.g. "GetEconomicStrategyTool" */
  loggerName: string;
}

/**
 * Base class for AI strategy query tools. Holds all the shared query logic:
 * fetch strategies + flavors, group flavors by strategy, merge existing
 * descriptions, and sync the JSON file. Subclasses supply only the config.
 */
export abstract class AiStrategyTool extends DatabaseQueryTool<AiStrategy, AiStrategy> {
  /**
   * The table/column/prefix/file specifics for this strategy kind
   */
  protected abstract readonly config: AiStrategyToolConfig;

  /**
   * Schema for strategy summary (same as full schema)
   */
  protected readonly summarySchema = aiStrategySchema;

  /**
   * Schema for full strategy information (same as summary)
   */
  protected readonly fullSchema = aiStrategySchema;

  /**
   * Fetch strategy summaries from database and sync with JSON file
   */
  protected async fetchSummaries(): Promise<AiStrategy[]> {
    const logger = createLogger(this.config.loggerName);
    // Kysely dynamic queries: table/column names come from config, so the
    // statically-typed schema can't be used here
    const db = gameDatabase.getDatabase() as any;

    // Get all strategies
    const strategies = await db
      .selectFrom(this.config.mainTable)
      .select(['Type'])
      .execute();

    // Get ALL production (city) flavors in one query
    const allProductionWeights = await db
      .selectFrom(this.config.cityFlavorsTable)
      .select([this.config.strategyColumn, 'FlavorType', 'Flavor'])
      .execute();

    // Get ALL overall (player) flavors in one query
    const allOverallWeights = await db
      .selectFrom(this.config.playerFlavorsTable)
      .select([this.config.strategyColumn, 'FlavorType', 'Flavor'])
      .execute();

    // Group flavors by strategy type for efficient lookup
    const ProductionWeightsByStrategy = this.groupByStrategy(allProductionWeights);
    const OverallWeightsByStrategy = this.groupByStrategy(allOverallWeights);

    // Read existing descriptions from JSON file using cached loader
    const existingDescriptions = new Map<string, string>();
    const existingData = await this.config.loadExisting();

    for (const item of existingData) {
      if (item.Description) {
        existingDescriptions.set(item.Type, item.Description);
      }
    }

    // Path for writing the file (still needed for updates)
    const jsonPath = path.join(process.cwd(), 'docs', 'strategies', this.config.jsonFile);

    const results: AiStrategy[] = [];

    for (const strategy of strategies) {
      // Remove the strategy prefix and convert to PascalCase
      const ProductionWeights = ProductionWeightsByStrategy.get(strategy.Type!) || [];
      const OverallWeights = OverallWeightsByStrategy.get(strategy.Type!) || [];
      const strategyType = changeCase.pascalCase(strategy.Type!.replace(this.config.typePrefix, ''));

      results.push({
        Type: strategyType,
        Production: Object.fromEntries(
          ProductionWeights.map((f: any) => [
            changeCase.pascalCase(f.FlavorType!.replace('FLAVOR_', '')),
            f.Flavor!
          ])),
        Overall: Object.fromEntries(
          OverallWeights.map((f: any) => [
            changeCase.pascalCase(f.FlavorType!.replace('FLAVOR_', '')),
            f.Flavor!
          ])),
        Description: existingDescriptions.get(strategyType) || ""
      });
    }

    // Write back to JSON file only if content differs (ignoring whitespace)
    try {
      await writeJsonIfChanged(jsonPath, results, this.config.jsonFile);
    } catch (error: unknown) {
      logger.warn(`Warning writing ${this.config.jsonFile}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return results;
  }

  /**
   * Group flavor rows by their strategy type column
   */
  private groupByStrategy(flavors: any[]): Map<string, any[]> {
    const grouped = new Map<string, any[]>();
    for (const flavor of flavors) {
      const key = flavor[this.config.strategyColumn]!;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(flavor);
    }
    return grouped;
  }

  /**
   * Fetch full strategy information (same as summary)
   */
  protected async fetchFullInfo(identifier: string): Promise<AiStrategy> {
    // Since full schema is the same as summary, just return the cached data
    if (!this.cachedSummaries) {
      this.cachedSummaries = await this.fetchSummaries();
    }

    const strategy = this.cachedSummaries.find(s => s.Type === identifier);
    if (!strategy) {
      throw new Error(`Strategy ${identifier} not found`);
    }

    return strategy;
  }
}
