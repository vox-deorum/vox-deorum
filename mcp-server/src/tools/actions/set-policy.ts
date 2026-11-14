/**
 * Tool for setting a player's next policy selection in Civilization V
 */

import { ActionTool, sourceTurnField } from "../abstract/action.js";
import * as z from "zod";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { retrieveEnumValue, retrieveEnumName } from "../../knowledge/helpers/enum.js";

/**
 * Schema for the result returned by the Lua script
 */
const SetPolicyResultSchema = z.object({
  PreviousPolicy: z.number().optional(),
  PreviousBranch: z.number().optional(),
  Next: z.number().optional(), // Used for validation failures
  // These properties are added by the execute method
  Previous: z.string().optional(),
  IsBranch: z.boolean().optional()
});

type SetPolicyResultType = z.infer<typeof SetPolicyResultSchema>;

/**
 * Tool that sets a player's next policy selection using a Lua function
 * Can accept either a PolicyBranchType or PolicyID
 */
class SetPolicyTool extends ActionTool<SetPolicyResultType> {
  /**
   * Unique identifier for the set-policy tool
   */
  readonly name = "set-policy";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Set a player's next policy selection by name. The in-game AI will be forced to select this policy or policy branch when making its next policy choice.";

  /**
   * Input schema for the set-policy tool
   */
  inputSchema = z.object({
    PlayerID: z.number().min(0).max(MaxMajorCivs - 1).describe("ID of the player"),
    Policy: z.string().describe("Policy name or branch name to adopt next (None to clear)"),
    Rationale: z.string().describe("Briefly explain your rationale for selecting this policy")
  }).extend(sourceTurnField);

  /**
   * Result schema - returns the previous policy selection
   */
  protected resultSchema = SetPolicyResultSchema;

  /**
   * The Lua function arguments
   */
  protected arguments = ["playerID", "policyID", "branchID"];

  /**
   * The Lua script to execute
   */
  protected script = `
    local activePlayer = Players[playerID]

    -- Validate that the policy/branch is available if not clearing
    if not (policyID == -1 and branchID == -1) then
      -- Check if already adopted
      if policyID ~= -1 then
        if activePlayer:HasPolicy(policyID) then return { Next = -2 } end
      end
      if branchID ~= -1 then
        if activePlayer:IsPolicyBranchUnlocked(branchID) then return { Next = -2 } end
      end

      local possiblePolicies, possibleBranches = activePlayer:GetPossiblePolicies(true)
      local isValid = false

      -- Check if it's a valid policy
      if policyID ~= -1 then
        for _, id in ipairs(possiblePolicies) do
          if id == policyID then isValid = true break end
        end
      end

      -- Check if it's a valid branch
      if branchID ~= -1 then
        for _, id in ipairs(possibleBranches) do
          if id == branchID then isValid = true break end
        end
      end

      if not isValid then return { Next = -1 } end
    end

    -- Get the previous forced policy (if any)
    -- GetNextPolicy returns (policyID, branchID)
    local prevPolicy, prevBranch = activePlayer:GetNextPolicy()

    -- Set the new policy selection
    -- SetNextPolicy takes (policyID, branchID)
    activePlayer:SetNextPolicy(policyID, branchID)

    -- Return the previous selections
    return {
      PreviousPolicy = prevPolicy,
      PreviousBranch = prevBranch
    }
  `;

  /**
   * Execute the set-policy command
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    // Extract the arguments and trim rationale
    const { PlayerID, Rationale: rawRationale, Turn: _sourceTurn } = args;
    let Policy = args.Policy;
    const Rationale = this.trimRationale(rawRationale);
    const turn = this.resolveSourceTurn(args);

    // Remove parenthetical content for better matching (e.g., "Authority (New Branch)" -> "Authority")
    Policy = Policy.replace(/\s*\([^)]*\)/g, '').trim();

    // Convert policy name to ID - first try as a branch, then as a policy
    let policyID = -1;
    let branchID = -1;
    let isBranch = false;

    if (Policy.toLowerCase() === "none") {
      // Clear both
      policyID = -1;
      branchID = -1;
    } else {
      // Try as a branch first
      branchID = retrieveEnumValue("BranchType", Policy);
      if (branchID !== -1) {
        isBranch = true;
      } else {
        // Try as an individual policy
        policyID = retrieveEnumValue("PolicyID", Policy);
        if (policyID === -1)
          throw new Error(`Policy or branch "${Policy}" not found.`);
      }
    }

    // Call the parent execute with policyID and branchID
    const result = await super.call(PlayerID, policyID, branchID);

    if (result.Success) {
      // Check for validation failures
      if (result.Result?.Next === -1)
        throw new Error(`The policy "${Policy}" is not currently available for this player. Please check available options using get-options.`);
      if (result.Result?.Next === -2)
        throw new Error(`Policy "${Policy}" has already been adopted. Please check your availability list.`);

      // Convert the previous policy/branch IDs back to names
      if (result.Result) {
        if (result.Result.PreviousPolicy !== -1) {
          const policyName = retrieveEnumName("PolicyID", result.Result.PreviousPolicy);
          result.Result.Previous = policyName || "None";
          result.Result.IsBranch = false;
        } else if (result.Result.PreviousBranch !== -1) {
          const branchName = retrieveEnumName("BranchType", result.Result.PreviousBranch);
          result.Result.Previous = branchName || "None";
          result.Result.IsBranch = true;
        } else {
          result.Result.Previous = "None";
          result.Result.IsBranch = false;
        }
        delete result.Result.PreviousPolicy;
        delete result.Result.PreviousBranch;
      }

      // Store the policy decision in the knowledge database
      const store = this.getStore();
      await store.storeMutableKnowledge(
        'PolicyChanges',
        PlayerID,
        {
          Policy: Policy,
          IsBranch: isBranch ? 1 : 0,
          Rationale: Rationale
        },
        undefined,
        undefined,
        turn
      );

      // Send action event and replay message if the policy actually changed
      const previousPolicy = result.Result?.Previous;
      if (Policy !== previousPolicy && !(Policy === "None" && previousPolicy === "Unknown")) {
        const summary = `${previousPolicy || "None"} → ${Policy}`;
        const typeDesc = isBranch ? "policy branch" : "policy";
        await this.pushAction(PlayerID, "policy", summary, Rationale, `Changed next ${typeDesc}`, turn);
      }
    }

    delete result.Result;
    return result;
  }
}

/**
 * Creates a new instance of the set policy tool
 */
export default function createSetPolicyTool() {
  return new SetPolicyTool();
}