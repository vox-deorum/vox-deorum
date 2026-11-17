/**
 * Tool for reading metadata key-value pairs from the knowledge store
 */

import { ToolBase } from "../base.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { knowledgeManager } from "../../server.js";
import { mapGeometryMetadataSchema } from "./get-game-settings.js";

/**
 * Tool that reads a metadata value by key from the GameMetadata table
 */
class GetMetadataTool extends ToolBase {
  /**
   * Unique identifier for the tool
   */
  readonly name = "get-metadata";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Get a metadata value by key from the knowledge store";

  /**
   * Input schema for the tool
   */
  readonly inputSchema = z.object({
    Key: z.string().describe("The metadata key to retrieve")
  });

  /**
   * Output schema for the tool
   */
  readonly outputSchema = z.string();

  /**
   * Optional annotations for the tool
   */
  readonly annotations: ToolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false
  };

  /**
   * Execute the tool to retrieve a metadata value
   */
  async execute(args: z.infer<typeof this.inputSchema>) {
    if (Object.hasOwn(mapGeometryMetadataSchema.shape, args.Key)) return "";
    const store = knowledgeManager.getStore();
    const value = await store.getMetadata(args.Key);
    return value ?? "";
  }
}

/**
 * Creates a new instance of the get metadata tool
 */
export default function createGetMetadataTool() {
  return new GetMetadataTool();
}
