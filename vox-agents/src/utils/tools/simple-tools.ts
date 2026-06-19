/**
 * @module utils/tools/simple-tools
 *
 * Simple tool wrapper utilities for creating tools from regular functions.
 * Provides a lightweight way to wrap functions as AI SDK CoreTools
 * with access to agent parameters and observability.
 */

import { z, ZodType } from "zod";
import { AgentParameters } from "../../infra/vox-agent.js";
import { createLogger } from "../logger.js";
import { Tool as VercelTool, dynamicTool } from 'ai';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { VoxContext } from "../../infra/vox-context.js";

const tracer = trace.getTracer('vox-tools');

/** AI SDK execution metadata exposed to simple-tool implementations when they need it. */
export interface SimpleToolExecutionOptions {
  /** Unique ID of this tool call. */
  toolCallId: string;
  /** Shared prompt-message array for every tool call emitted in the same model step. */
  messages: unknown[];
}

/**
 * Function signature for simple tools.
 * Simple tools are regular functions that receive input and agent parameters.
 */
export type SimpleToolFunction<TParameters extends AgentParameters, TInput = any, TOutput = any> = (
  input: TInput,
  parameters: TParameters,
  options: SimpleToolExecutionOptions
) => Promise<TOutput> | TOutput;

/**
 * Configuration for creating a simple tool.
 */
export interface SimpleToolConfig<TParameters extends AgentParameters, TInput = any, TOutput = any> {
  /** Name of the tool */
  name: string;
  /** Description of what the tool does */
  description: string;
  /** Input schema for the tool */
  inputSchema: ZodType<TInput>;
  /** Optional output schema for validation */
  outputSchema?: ZodType<TOutput>;
  /** The function to execute */
  execute: SimpleToolFunction<TParameters, TInput, TOutput>;
}

/**
 * Creates a simple tool wrapper for a regular function.
 * Provides a lightweight way to create tools without full agent complexity.
 *
 * @param config - Configuration for the simple tool
 * @param parameters - Agent parameters to pass to the function
 * @returns A CoreTool that can be used with AI SDK
 *
 * @example
 * ```typescript
 * const calculateTool = createSimpleTool({
 *   name: "calculate_score",
 *   description: "Calculate the score for a given action",
 *   inputSchema: z.object({
 *     action: z.string(),
 *     multiplier: z.number()
 *   }),
 *   execute: async (input, params) => {
 *     // Access both input and agent parameters
 *     const baseScore = params.playerID * 100;
 *     return baseScore * input.multiplier;
 *   }
 * }, { playerID: 0, turn: 1 });
 * ```
 */
export function createSimpleTool<TParameters extends AgentParameters, TInput = any, TOutput = any>(
  config: SimpleToolConfig<TParameters, TInput, TOutput>,
  context: VoxContext<TParameters>
): VercelTool {
  const logger = createLogger(`SimpleTool-${config.name}`);

  return dynamicTool({
    description: config.description,
    inputSchema: config.inputSchema as any,
    execute: async (input, options) => {
      const span = tracer.startSpan(`simple-tool.${config.name}`, {
        attributes: {
          'tool.name': config.name,
          'tool.type': 'simple',
          'vox.context.id': context.id,
          'game.turn': context.lastParameter?.turn ?? -1
        }
      });

      try {
        logger.debug(`Executing simple tool: ${config.name}`);
        span.setAttributes({
          'tool.input': JSON.stringify(input)
        });

        // Execute the function with input and parameters
        const result = await config.execute(
          input as TInput,
          context.lastParameter!,
          options as SimpleToolExecutionOptions
        );

        logger.debug(`Simple tool execution completed: ${config.name}`);
        span.setAttributes({
          'tool.output': JSON.stringify(result)
        });
        span.setStatus({ code: SpanStatusCode.OK });

        // Apply output schema if defined
        if (config.outputSchema) {
          return config.outputSchema.parse(result);
        }

        return result;
      } catch (error) {
        logger.error(`Error in simple tool ${config.name}:`, error);
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
