import createCalculatorTool from "./general/calculator.js";
import createLuaExecutorTool from "./general/lua-executor.js";
import createGetTechnologyTool from "./databases/get-technology.js";
import createGetPolicyTool from "./databases/get-policy.js";
import createGetBuildingTool from "./databases/get-building.js";
import createGetCivilizationTool from "./databases/get-civilization.js";
import createGetUnitTool from "./databases/get-unit.js";
import createGetEconomicStrategyTool from "./databases/get-economic-strategy.js";
import createGetMilitaryStrategyTool from "./databases/get-military-strategy.js";
import createGetEventsTool from "./knowledge/get-events.js";
import createGetPlayersTool from "./knowledge/get-players.js";
import createGetOpinionsTool from "./knowledge/get-opinions.js";
import createGetCitiesTool from "./knowledge/get-cities.js";
import createGetGameSettingsTool from "./knowledge/get-game-settings.js";
import createGetMetadataTool from "./knowledge/get-metadata.js";
import createSetStrategyTool from "./actions/set-strategy.js";
import createSetPersonaTool from "./actions/set-persona.js";
import createSetRelationshipTool from "./actions/set-relationship.js";
import createSetFlavorsTool from "./actions/set-flavors.js";
import createGetFlavorsTool from "./databases/get-flavors.js";
import createUnsetFlavorsTool from "./actions/unset-flavors.js";
import createPauseGameTool from "./actions/pause-game.js";
import createResumeGameTool from "./actions/resume-game.js";
import createSetProductionModeTool from "./actions/set-production-mode.js";
import createSummarizeUnitsTool from "./knowledge/summarize-units.js";
import createSetMetadataTool from "./actions/set-metadata.js";
import createKeepStatusQuoTool from "./actions/keep-status-quo.js";
import createGetOptionsTool from "./knowledge/get-options.js";
import createSetResearchTool from "./actions/set-research.js";
import createSetPolicyTool from "./actions/set-policy.js";
import createRelayMessageTool from "./actions/relay-message.js";
import createPresentDecisionTool from "./actions/present-decision.js";
import createGetVictoryProgressTool from "./knowledge/get-victory-progress.js";
import createGetMilitaryReportTool from "./knowledge/get-military-report.js";
import createSearchDatabaseTool from "./general/search-database.js";
import createGetDiplomaticEventsTool from "./knowledge/get-diplomatic-events.js";
import createAppendMessageTool from "./actions/append-message.js";
import createReadTranscriptTool from "./knowledge/read-transcript.js";
import createInspectDealTool from "./knowledge/inspect-deal.js";
import type { MCPServer } from "../server.js";

// Tool factory configuration - one line per tool
const toolFactories = {
    calculator: createCalculatorTool,
    luaExecutor: createLuaExecutorTool,
    getGameSettings: createGetGameSettingsTool,
    getMetadata: createGetMetadataTool,
    setMetadata: createSetMetadataTool,
    searchDatabase: createSearchDatabaseTool,
    getTechnology: createGetTechnologyTool,
    getPolicy: createGetPolicyTool,
    getBuilding: createGetBuildingTool,
    getCivilization: createGetCivilizationTool,
    getUnit: createGetUnitTool,
    getEconomicStrategy: createGetEconomicStrategyTool,
    getMilitaryStrategy: createGetMilitaryStrategyTool,
    getVictoryProgress: createGetVictoryProgressTool,
    getMilitaryReport: createGetMilitaryReportTool,
    getEvents: createGetEventsTool,
    getDiplomaticEvents: createGetDiplomaticEventsTool,
    readTranscript: createReadTranscriptTool,
    inspectDeal: createInspectDealTool,
    getPlayers: createGetPlayersTool,
    getOpinions: createGetOpinionsTool,
    getCities: createGetCitiesTool,
    summarizeUnits: createSummarizeUnitsTool,
    getOptions: createGetOptionsTool,
    setStrategy: createSetStrategyTool,
    setPersona: createSetPersonaTool,
    setRelationship: createSetRelationshipTool,
    setFlavors: createSetFlavorsTool,
    getFlavors: createGetFlavorsTool,
    unsetFlavors: createUnsetFlavorsTool,
    setResearch: createSetResearchTool,
    setPolicy: createSetPolicyTool,
    keepStatusQuo: createKeepStatusQuoTool,
    relayMessage: createRelayMessageTool,
    appendMessage: createAppendMessageTool,
    presentDecision: createPresentDecisionTool,
    pauseGame: createPauseGameTool,
    resumeGame: createResumeGameTool,
    setProductionMode: createSetProductionModeTool,
} as const;
 
// Type for the tools object (inferred from factories)
type Tools = { [K in keyof typeof toolFactories]: ReturnType<typeof toolFactories[K]> };

// Cache for tool instances
let toolsCache: Tools | null = null;

/**
 * Function to get all available tool instances as an object
 * Creates and caches instances on first call, returns cached instances on subsequent calls
 * @returns Object containing cached tool instances with preserved type information
 */
export const getTools = (): Tools => {
    if (!toolsCache) {
        toolsCache = Object.fromEntries(
            Object.entries(toolFactories).map(([key, factory]) => [key, factory()])
        ) as Tools;
    }
    return toolsCache;
};

/**
 * Function to get a specific tool instance by name
 * Creates and caches instances on first call, returns cached instance on subsequent calls
 * @param name The name of the tool to retrieve
 * @returns The tool instance, or undefined if the tool doesn't exist
 */
export const getTool = <K extends keyof typeof toolFactories>(
    name: K
): ReturnType<typeof toolFactories[K]> | undefined => {
    const tools = getTools();
    return tools[name];
};

/**
 * Register every tool in the catalog with the given server.
 *
 * Tool registration lives here (driven by the transport bootstrap) rather than inside
 * MCPServer.initialize() so that server.ts never imports the concrete tool graph. The
 * tools import server.js, so a static import the other way would close the cycle and make
 * module-evaluation order fragile. The `MCPServer` import above is type-only (erased at
 * runtime), so this module adds no runtime dependency on server.ts.
 */
export const registerDefaultTools = (server: MCPServer): void => {
    const tools = getTools();
    Object.values(tools).forEach(tool => server.registerTool(tool));
};
