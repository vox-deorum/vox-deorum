/**
 * @module oracle/utils/schema-tools
 *
 * Schema-only tool wrappers for oracle replay mode.
 * LLMs can generate tool call intents but nothing executes against MCP.
 */

import { dynamicTool, jsonSchema } from 'ai';
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import type { VoxContext } from '../../infra/vox-context.js';
import type { OracleParameters } from '../types.js';
import { createLogger } from '../../utils/logger.js';
import { filterAutoCompleteSchema } from '../../utils/tools/mcp-schema.js';

const logger = createLogger('OracleSchemaTools');

/**
 * Compute the final description and inputSchema for a tool after
 * autoComplete filtering and optional rewriting.
 */
function computeFinalSchema(
  name: string,
  mcpTool: Pick<MCPTool, 'description' | 'inputSchema' | '_meta'>,
  rewriter?: (json: string) => string
): { description: string; inputSchema: any } {
  let description = mcpTool.description ?? `Tool: ${name}`;
  let schema = filterAutoCompleteSchema(
    mcpTool.inputSchema as Record<string, any>,
    (mcpTool._meta as any)?.autoComplete as string[] | undefined
  );

  if (rewriter) {
    const rewritten = JSON.parse(rewriter(JSON.stringify({ description, inputSchema: schema })));
    description = rewritten.description;
    schema = rewritten.inputSchema;
  }

  return { description, inputSchema: schema };
}

/**
 * Replace all tools in the VoxContext with schema-only versions.
 * The LLM can still generate tool call intents, but nothing executes.
 *
 * @param voxContext - The VoxContext to modify in place
 * @param rewriter - Optional function applied to each tool's JSON schema
 */
export function replaceToolsWithSchemaOnly(
  voxContext: VoxContext<OracleParameters>,
  rewriter?: (json: string) => string
): void {
  const schemaTools: Record<string, any> = {};
  const convertedSchemas: Record<string, { description: string; inputSchema: any }> = {};

  for (const [name, mcpTool] of voxContext.mcpToolMap) {
    const finalSchema = computeFinalSchema(name, mcpTool, rewriter);
    convertedSchemas[name] = finalSchema;
    schemaTools[name] = dynamicTool({
      description: finalSchema.description,
      inputSchema: jsonSchema(finalSchema.inputSchema as any),
      execute: async () => ({ message: `Successfully executed.` }),
    });
  }

  voxContext.tools = schemaTools;
  logger.info('Converted tool schemas:\n' + JSON.stringify(convertedSchemas, null, 2));
}
