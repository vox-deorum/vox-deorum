/**
 * @module utils/tools/mcp-tools
 *
 * MCP tool wrapper utilities for integrating Model Context Protocol tools with Vercel AI SDK.
 * Provides functions to wrap MCP tools as AI SDK CoreTools,
 * handling schema filtering, parameter injection, and markdown conversion.
 */

import { Tool as VercelTool, dynamicTool, ToolSet, jsonSchema } from 'ai';
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { mcpClient } from "../models/mcp-client.js";
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { camelCase } from "change-case";
import { createLogger } from "../logger.js";
import { VoxContext } from "../../infra/vox-context.js";
import { AgentParameters } from "../../infra/vox-agent.js";
import { HeadingConfig } from './json-to-markdown.js';

const tracer = trace.getTracer('vox-tools');

/**
 * Return true when the value is a plain object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert MCP CallToolResult wrappers back into the primitive or structured
 * value callers expect. The MCP server wraps primitive booleans/strings as a
 * single text content item, while object and array results ride in
 * structuredContent.
 */
export function unwrapMCPResult(rawResult: unknown): unknown {
  if (!isRecord(rawResult)) return rawResult;
  if (rawResult.isError === true) return rawResult;

  if (rawResult.structuredContent !== undefined) {
    return rawResult.structuredContent;
  }

  const content = rawResult.content;
  if (!Array.isArray(content) || content.length !== 1) return rawResult;

  const item = content[0];
  if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
    return rawResult;
  }

  if (item.text === "true") return true;
  if (item.text === "false") return false;
  return item.text;
}

/**
 * Normalize an MCP tool response all the way to the value returned to
 * VoxContext.callTool and AI SDK tool callers.
 */
export function normalizeMCPToolResult(rawResult: unknown): unknown {
  const unwrapped = unwrapMCPResult(rawResult);
  if (isRecord(unwrapped)) {
    return unwrapped.Result ?? unwrapped;
  }
  return unwrapped;
}

/**
 * Wrap a MCP tool for Vercel AI SDK.
 * Handles schema filtering and parameter injection,
 * and markdown conversion of results.
 *
 * @param tool - MCP tool definition
 * @param context - VoxContext for tracing and parameter injection
 * @returns Vercel AI SDK CoreTool
 *
 * @example
 * ```typescript
 * const tools = await mcpClient.getTools();
 * const wrapped = wrapMCPTool(tools[0], context);
 * ```
 */
export function wrapMCPTool(tool: Tool, context: VoxContext<AgentParameters>): VercelTool {
  const logger = createLogger(`tool-${tool.name}`);

  // Remove autoComplete fields from input schema
  const filteredSchema = { ...tool.inputSchema };
  if (filteredSchema.properties && (tool._meta as any)?.autoComplete) {
    const autoCompleteFields = (tool._meta as any).autoComplete as string[];
    const filteredProperties = { ...filteredSchema.properties };

    // Remove autoComplete fields from properties
    autoCompleteFields.forEach(field => {
      delete filteredProperties[field];
    });

    // Remove autoComplete fields from required array if present
    if (filteredSchema.required) {
      filteredSchema.required = filteredSchema.required.filter(
        (field: string) => !autoCompleteFields.includes(field)
      );
    }

    filteredSchema.properties = filteredProperties;
  }

  return dynamicTool({
    description: tool.description || `MCP tool: ${tool.name}`,
    inputSchema: jsonSchema(filteredSchema),
    execute: async (args: any, options) => {
      context.timeoutRefresh?.();
      
      const span = tracer.startSpan(`mcp-tool.${tool.name}`, {
        kind: SpanKind.CLIENT,
        attributes: {
          'tool.name': tool.name,
          'tool.type': 'mcp',
          'vox.context.id': context.id,
          'game.turn': context.currentParameters?.turn ?? -1
        }
      });

      try {
        // Autocomplete support - add the fields back for execution
        if ((tool._meta as any)?.autoComplete) {
          ((tool._meta as any)?.autoComplete as string[]).forEach(
            key => {
              var camelKey = camelCase(key);
              if (camelKey.endsWith("Id")) camelKey = camelKey.substring(0, camelKey.length - 2) + "ID";
              // Only auto-fill when the context actually has a value; never clobber
              // an explicitly-passed arg (e.g. get-events `Original: true`) with undefined.
              const value = (options.experimental_context as any)[camelKey];
              if (value !== undefined) args[key] = value;
              // console.log(`${key} => ${camelKey} => ${(options.experimental_context as any)[camelKey]}`)
            }
          )
          // console.log(options.experimental_context);
        }

        // Log inputs
        span.setAttributes({
          'tool.input': JSON.stringify(args)
        });
        logger.info(`Calling tool ${tool.name}...`, args);

        // Call the tool
        const rawResult = await mcpClient.callTool(tool.name, args);
        const result = normalizeMCPToolResult(rawResult);
        logger.debug(`Tool call completed: ${tool.name}`);

        span.setAttributes({
          'tool.output': JSON.stringify(result)
        });
        span.setStatus({ code: SpanStatusCode.OK });

        // Return results
        if (isRecord(result)) {
          const config = (tool._meta as Record<string, unknown>)?.markdownConfig;
          if (Array.isArray(config)) {
            result._markdownConfig = {
              configs: config.map(level => {
                return { format: level } as HeadingConfig;
              })
            }
          }
        } return result;
      } catch (error) {
        logger.error(`Error calling MCP tool ${tool.name}:`, error);
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        span.end();
      }
    }
  });
}

/**
 * Wrap multiple MCP tools for Vercel AI SDK.
 * Convenience function to batch-wrap an array of MCP tools.
 *
 * @param tools - Array of MCP tool definitions
 * @param context - VoxContext for tracing and parameter injection
 * @returns ToolSet object mapping tool names to wrapped tools
 *
 * @example
 * ```typescript
 * const tools = await mcpClient.getTools();
 * const toolSet = wrapMCPTools(tools, context);
 * ```
 */
export function wrapMCPTools(tools: Tool[], context: VoxContext<AgentParameters>): ToolSet {
  var results: Record<string, VercelTool> = {};
  tools.forEach(tool => results[tool.name] = wrapMCPTool(tool, context));
  return results;
}
