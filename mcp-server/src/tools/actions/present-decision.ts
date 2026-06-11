/**
 * Tool for presenting a turn's strategic options to the in-game human-control panel.
 *
 * Fire-and-forget outbound half of the decision round-trip: it serializes the
 * OptionsReport (get-options output) and pushes it into the game via the
 * presentHumanDecision Lua util (LuaEvents.VoxDeorumHumanDecision). It records
 * no game decision — the human's actual submission rides back in on the
 * HumanDecision event and is enacted through the regular action tools.
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { knowledgeManager } from "../../server.js";
import { presentHumanDecision } from "../../utils/lua/present-decision.js";

/**
 * Tool that hands the current decision options to the human-control panel.
 */
class PresentDecisionTool extends ToolBase {
  readonly name = "present-decision";

  readonly description = "Present a turn's strategic options to the in-game human-control panel (fires VoxDeorumHumanDecision into the game).";

  readonly inputSchema = z.object({
    PlayerID: z.number().min(0).max(MaxMajorCivs - 1).describe("ID of the human strategist's player"),
    Turn: z.number().default(-1).describe("Turn the decision is for (-1 = use server's current turn)"),
    Options: z.record(z.string(), z.any()).describe("The OptionsReport (get-options output) to present to the panel")
  });

  readonly outputSchema = z.boolean();

  readonly annotations: ToolAnnotations = { readOnlyHint: false };

  readonly metadata = {
    autoComplete: ["PlayerID", "Turn"]
  };

  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const turn = args.Turn !== undefined && args.Turn >= 0 ? args.Turn : knowledgeManager.getTurn();

    // Human control runs in Flavor mode only, so the panel receives the
    // OptionsReport verbatim — no mode discriminator to carry.
    const optionsJson = JSON.stringify(args.Options);

    const response = await presentHumanDecision(args.PlayerID, turn, optionsJson);
    return response.success;
  }
}

/**
 * Creates a new instance of the present decision tool
 */
export default function createPresentDecisionTool() {
  return new PresentDecisionTool();
}
