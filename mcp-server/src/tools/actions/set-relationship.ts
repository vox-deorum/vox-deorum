/**
 * Tool for setting diplomatic relationship modifiers between players in Civilization V
 * Uses both ScenarioModifier1 (Public) and ScenarioModifier2 (Private) for nuanced diplomacy
 */

import { ActionTool, sourceTurnField } from "../abstract/action.js";
import * as z from "zod";
import { readPublicKnowledgeBatch } from "../../knowledge/helpers/cached.js";
import { getPlayerInformations } from "../../knowledge/getters/player-information.js";

/**
 * Schema for the result returned by the Lua script
 */
const SetRelationshipResultSchema = z.object({
  PreviousPublic: z.number(),
  PreviousPrivate: z.number(),
  TargetPlayerName: z.string()
});

type SetRelationshipResultType = z.infer<typeof SetRelationshipResultSchema>;

/**
 * Tool that sets diplomatic relationship modifiers using Lua functions
 */
class SetRelationshipTool extends ActionTool<SetRelationshipResultType> {
  /**
   * Unique identifier for the set-relationship tool
   */
  readonly name = "set-relationship";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Set additive diplomatic modifiers between you and another MAJOR (non-city-state) civilization. Public or private modifiers add up in calculation.";

  //  Public affects visible diplomacy, Private affects hidden attitudes. The values are additive in diplomacy calculations.
  /**
   * Input schema for the set-relationship tool
   */
  inputSchema = z.object({
    PlayerID: z.number().min(0).describe("ID of the player setting the relationship"),
    TargetID: z.number().min(0).describe("ID of the target MAJOR civilization"),
    Public: z.number().default(0).describe("Visible diplomatic stance (-100 to 100)"),
    Private: z.number().default(0).describe("Hidden feelings/attitudes (-100 to 100)"),
    Rationale: z.string().describe("Briefly explain your rationale for this relationship change")
  }).extend(sourceTurnField);

  /**
   * Result schema - returns the previous values
   */
  protected resultSchema = SetRelationshipResultSchema;

  /**
   * The Lua function arguments
   */
  protected arguments = ["playerID", "targetPlayerID", "publicValue", "privateValue"];


  /**
   * The Lua script to execute
   */
  protected script = `
    local activePlayer = Players[playerID]
    local targetPlayer = Players[targetPlayerID]

    -- Civ 5's score is defined reversely: +100 means very unhappy

    -- Get previous values
    local previousPublic = activePlayer:GetScenarioModifier1(targetPlayerID)
    local previousPrivate = activePlayer:GetScenarioModifier2(targetPlayerID)

    -- Set new values
    activePlayer:SetScenarioModifier1(targetPlayerID, -1 * publicValue)
    activePlayer:SetScenarioModifier2(targetPlayerID, -1 * privateValue)

    -- Get target player name
    local targetPlayerName = targetPlayer:GetCivilizationShortDescription()

    -- Return the previous values and target player name
    return {
      PreviousPublic = -1 * previousPublic,
      PreviousPrivate = -1 * previousPrivate,
      TargetPlayerName = targetPlayerName
    }
  `;

  /**
   * Execute the set-relationship command
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    // Extract the arguments and trim rationale
    const { PlayerID, TargetID, Public, Private, Rationale: rawRationale, Turn: _sourceTurn } = args;
    const Rationale = this.trimRationale(rawRationale);
    const turn = this.resolveSourceTurn(args);

    // Validate that both players exist
    const playerInfos = await readPublicKnowledgeBatch("PlayerInformations", getPlayerInformations);

    const playerInfo = playerInfos.find(info => info.Key === PlayerID);
    if (!playerInfo) {
      throw new Error(`Player with ID ${PlayerID} not found.`);
    }

    const targetInfo = playerInfos.find(info => info.Key === TargetID);
    if (!targetInfo) {
      throw new Error(`Target player with ID ${TargetID} not found.`);
    }

    // Call the parent execute with the relationship values
    const result = await super.call(PlayerID, TargetID, Public, Private);

    if (result.Success && result.Result) {
      // Use the target player name from Lua result
      const targetName = result.Result.TargetPlayerName;

      // Store the relationship change in the knowledge database
      const store = this.getStore();
      await store.storeTimedKnowledgeBatch(
        'RelationshipChanges',
        [{
          data: {
            PlayerID,
            TargetID,
            PublicValue: Public,
            PrivateValue: Private,
            Rationale
          },
          turn
        }]
      );

      // Generate action event and replay message for changes
      const changes: string[] = [];

      if (Public !== result.Result.PreviousPublic) {
        changes.push(`Public ${result.Result.PreviousPublic} → ${Public}`);
      }

      if (Private !== result.Result.PreviousPrivate) {
        changes.push(`Private ${result.Result.PreviousPrivate} → ${Private}`);
      }

      if (changes.length > 0) {
        const summary = `${targetName}: ${changes.join("; ")}`;
        await this.pushAction(PlayerID, "relationship", summary, Rationale, "", turn);
      }

      // Clean up the result
      delete result.Result;
    }

    return result;
  }
}

/**
 * Creates a new instance of the set relationship tool
 */
export default function createSetRelationshipTool() {
  return new SetRelationshipTool();
}