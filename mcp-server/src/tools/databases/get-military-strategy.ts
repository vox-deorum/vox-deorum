import { AiStrategyTool, AiStrategyToolConfig } from "./ai-strategy-tool.js";
import { loadMilitaryStrategies } from "../../utils/strategies/loader.js";

/**
 * Tool for querying AI military strategies from the game database
 */
class GetMilitaryStrategyTool extends AiStrategyTool {
  /**
   * Unique identifier for the get military strategies tool
   */
  readonly name = "get-military-strategies";

  /**
   * Human-readable description of the get military strategies tool
   */
  readonly description = "Retrieves AI military strategy information including production (city) and overall (player) flavors";

  /**
   * Military strategy tables, prefix, and JSON file
   */
  protected readonly config: AiStrategyToolConfig = {
    mainTable: "AIMilitaryStrategies",
    cityFlavorsTable: "AIMilitaryStrategy_City_Flavors",
    playerFlavorsTable: "AIMilitaryStrategy_Player_Flavors",
    strategyColumn: "AIMilitaryStrategyType",
    typePrefix: "MILITARYAISTRATEGY_",
    jsonFile: "military.json",
    loadExisting: loadMilitaryStrategies,
    loggerName: "GetMilitaryStrategyTool"
  };
}

/**
 * Creates a new instance of the get military strategies tool
 */
export default function createGetMilitaryStrategyTool() {
  return new GetMilitaryStrategyTool();
}
