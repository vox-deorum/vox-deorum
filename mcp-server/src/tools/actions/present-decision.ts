/**
 * Tool for presenting a turn's strategic options to the in-game human-control panel.
 *
 * Fire-and-forget outbound half of the decision round-trip. The tool fetches the
 * turn's OptionsReport itself — calling the get-options tool in Flavor mode (the
 * only mode human control supports) — and pushes it into the game via the
 * presentHumanDecision Lua util (LuaEvents.VoxDeorumHumanDecision). Fetching
 * server-side keeps the strongly-typed get-options output intact end to end: the
 * caller doesn't marshal the report back across the MCP wire just to have it
 * re-serialized here. The report is handed to the Lua util as a structured
 * object; the bridge serializes it for transport and the DLL rebuilds it as a
 * Lua table for the panel (no JSON parsing in Lua). The game is paused across a
 * human decision and get-options reads cached knowledge, so this is the same
 * snapshot the strategist's context was built from.
 *
 * It records no game decision — the human's actual submission rides back in on the
 * HumanDecision event and is enacted through the regular action tools.
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { knowledgeManager } from "../../server.js";
import { getTool } from "../index.js";
import { presentHumanDecision } from "../../utils/lua/present-decision.js";

/**
 * Tool that hands the current decision options to the human-control panel.
 */
class PresentDecisionTool extends ToolBase {
  readonly name = "present-decision";

  readonly description = "Present a turn's strategic options to the in-game human-control panel (fetches get-options and fires VoxDeorumHumanDecision into the game).";

  readonly inputSchema = z.object({
    PlayerID: z.number().min(0).max(MaxMajorCivs - 1).describe("ID of the human strategist's player"),
    Turn: z.number().default(-1).describe("Turn the decision is for (-1 = use server's current turn)")
  });

  readonly outputSchema = z.boolean();

  readonly annotations: ToolAnnotations = { readOnlyHint: false };

  readonly metadata = {
    autoComplete: ["PlayerID", "Turn"]
  };

  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const turn = args.Turn !== undefined && args.Turn >= 0 ? args.Turn : knowledgeManager.getTurn();

    // Fetch the option landscape server-side. Human control runs in Flavor mode
    // only, so the panel receives the Flavor-mode OptionsReport — the same call
    // the strategist's context is built from.
    const getOptions = getTool("getOptions");
    if (!getOptions) throw new Error("get-options tool is not registered");
    const report = await getOptions.execute({ PlayerID: args.PlayerID, Mode: "Flavor" });

    // Hand the report off as a structured object. The bridge JSON-serializes it
    // for transport and the DLL converts it to a Lua table for the panel, so the
    // panel reads its fields directly rather than parsing JSON in Lua.
    const response = await presentHumanDecision(args.PlayerID, turn, report);
    return response.success;
  }
}

/**
 * Creates a new instance of the present decision tool
 */
export default function createPresentDecisionTool() {
  return new PresentDecisionTool();
}
