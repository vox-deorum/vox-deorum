/**
 * Tool for retrieving Civ V's pregame random seed metadata.
 */

import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { ToolBase } from "../base.js";
import { getRandomSeeds, RandomSeedsSchema } from "../../knowledge/getters/random-seeds.js";

class GetRandomSeedsTool extends ToolBase {
  readonly name = "get-random-seeds";

  readonly description = "Retrieves Civ V's authoritative pregame SyncRandSeed and MapRandSeed values";

  readonly inputSchema = z.object({});

  readonly outputSchema = RandomSeedsSchema;

  readonly annotations: ToolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false
  };

  async execute(_args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const seeds = await getRandomSeeds();
    if (!seeds) {
      throw new Error('Unable to retrieve Civ random seeds');
    }
    return seeds;
  }
}

export default function createGetRandomSeedsTool() {
  return new GetRandomSeedsTool();
}
