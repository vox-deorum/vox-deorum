import { AiStrategyTool, AiStrategyToolConfig } from "./ai-strategy-tool.js";
import { loadEconomicStrategies } from "../../utils/strategies/loader.js";

/**
 * Tool for querying AI economic strategies from the game database
 */
class GetEconomicStrategyTool extends AiStrategyTool {
  /**
   * Unique identifier for the get economic strategies tool
   */
  readonly name = "get-economic-strategies";

  /**
   * Human-readable description of the get economic strategies tool
   */
  readonly description = "Retrieves AI economic strategy information including production (city) and overall (player) flavors";

  /**
   * Economic strategy tables, prefix, and JSON file
   */
  protected readonly config: AiStrategyToolConfig = {
    mainTable: "AIEconomicStrategies",
    cityFlavorsTable: "AIEconomicStrategy_City_Flavors",
    playerFlavorsTable: "AIEconomicStrategy_Player_Flavors",
    strategyColumn: "AIEconomicStrategyType",
    typePrefix: "ECONOMICAISTRATEGY_",
    jsonFile: "economic.json",
    loadExisting: loadEconomicStrategies,
    loggerName: "GetEconomicStrategyTool"
  };
}

/**
 * Creates a new instance of the get economic strategies tool
 */
export default function createGetEconomicStrategyTool() {
  return new GetEconomicStrategyTool();
}
