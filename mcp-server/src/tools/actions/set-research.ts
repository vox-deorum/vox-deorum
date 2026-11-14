/**
 * Tool for setting a player's next research technology in Civilization V
 */

import { ActionTool, sourceTurnField } from "../abstract/action.js";
import * as z from "zod";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { retrieveEnumValue, retrieveEnumName } from "../../knowledge/helpers/enum.js";

/**
 * Schema for the result returned by the Lua script
 */
const SetResearchResultSchema = z.object({
  Previous: z.number().optional(),
  Next: z.number().optional(), // Used for validation failures
  // This property is added by the execute method
  PreviousTech: z.string().optional()
});

type SetResearchResultType = z.infer<typeof SetResearchResultSchema>;

/**
 * Tool that sets a player's next research technology using a Lua function
 */
class SetResearchTool extends ActionTool<SetResearchResultType> {
  /**
   * Unique identifier for the set-research tool
   */
  readonly name = "set-research";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Set a player's next research technology by name. The in-game AI will start researching it after completing the current one.";

  /**
   * Input schema for the set-research tool
   */
  inputSchema = z.object({
    PlayerID: z.number().min(0).max(MaxMajorCivs - 1).describe("ID of the player"),
    Technology: z.string().describe("Technology name to research next (None to clear)"),
    Rationale: z.string().describe("Briefly explain your rationale for selecting this technology")
  }).extend(sourceTurnField);

  /**
   * Result schema - returns the previous technology selection
   */
  protected resultSchema = SetResearchResultSchema;

  /**
   * The Lua function arguments
   */
  protected arguments = ["playerID", "techID"];

  /**
   * The Lua script to execute
   */
  protected script = `
    local activePlayer = Players[playerID]

    -- Validate that the technology is available if not clearing (-1)
    if techID ~= -1 then
      -- Check if already researched
      local teamTechs = Teams[activePlayer:GetTeam()]:GetTeamTechs()
      if teamTechs:HasTech(techID) then return { Next = -2 } end

      -- Check if currently being researched
      if activePlayer:GetCurrentResearch() == techID then return { Next = -3 } end

      -- Check if the technology is possible
      local possibleTechs = activePlayer:GetPossibleTechs(true)
      local isValid = false
      for _, id in ipairs(possibleTechs) do
        if id == techID then isValid = true break end
      end
      if not isValid then return { Next = -1 } end
    end

    -- Get the previous forced research (if any)
    local previousTechID = activePlayer:GetNextResearch()

    -- Set the new research technology
    activePlayer:SetNextResearch(techID)

    -- Return the previous technology ID
    return {
      Previous = previousTechID
    }
  `;

  /**
   * Execute the set-research command
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    // Extract the arguments and trim rationale
    const { PlayerID, Technology, Rationale: rawRationale, Turn: _sourceTurn } = args;
    const Rationale = this.trimRationale(rawRationale);
    const turn = this.resolveSourceTurn(args);

    // Convert technology name to ID
    const techID = Technology.toLowerCase() === "none" ? -1 : retrieveEnumValue("TechID", Technology);

    if (techID === -1 && Technology.toLowerCase() !== "none") {
      throw new Error(`Technology "${Technology}" not found.`);
    }

    // Call the parent execute with the technology ID
    const result = await super.call(PlayerID, techID);

    if (result.Success) {
      // Check for validation failures
      if (result.Result?.Next === -1)
        throw new Error(`Technology "${Technology}" is not currently available for this player.`);
      if (result.Result?.Next === -2)
        throw new Error(`Technology "${Technology}" has already been researched. Please check your availability list.`);
      if (result.Result?.Next === -3)
        throw new Error(`Technology "${Technology}" is already being researched. Please set the NEXT technology.`);

      // Convert the previous tech ID back to a name
      if (result.Result?.Previous !== undefined) {
        const previousTechName = retrieveEnumName("TechID", result.Result.Previous);
        if (previousTechName) {
          result.Result.PreviousTech = previousTechName;
        } else if (result.Result.Previous === -1) {
          result.Result.PreviousTech = "None";
        } else {
          result.Result.PreviousTech = "Unknown";
        }
        delete result.Result.Previous;
      }

      // Store the research decision in the knowledge database
      const store = this.getStore();
      await store.storeMutableKnowledge(
        'ResearchChanges',
        PlayerID,
        {
          Technology: Technology,
          Rationale: Rationale
        },
        undefined,
        undefined,
        turn
      );

      // Send action event and replay message if the technology actually changed
      const previousTech = result.Result?.PreviousTech;
      if (Technology !== previousTech) {
        const summary = `${previousTech || "None"} → ${Technology}`;
        await this.pushAction(PlayerID, "research", summary, Rationale, "Changed next research", turn);
      }
    }

    delete result.Result;
    return result;
  }
}

/**
 * Creates a new instance of the set research tool
 */
export default function createSetResearchTool() {
  return new SetResearchTool();
}