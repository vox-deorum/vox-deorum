/**
 * @module utils/tools/agent-tools
 *
 * Agent tool wrapper utilities for integrating VoxAgents with Vercel AI SDK.
 * Provides functions to wrap VoxAgents as AI SDK CoreTools,
 * handling schema transformation, parameter injection, and observability.
 */

import { z } from "zod";
import { AgentParameters, VoxAgent } from "../../infra/vox-agent.js";
import { VoxContext } from "../../infra/vox-context.js";
import type { ModelSize } from "../models/models.js";
import { modelTiers } from '../../types/config.js';
import { createLogger } from "../logger.js";
import { Tool as VercelTool, dynamicTool, jsonSchema, zodSchema } from 'ai';
import { trace, SpanStatusCode, ROOT_CONTEXT, context as otelContext } from '@opentelemetry/api';

const tracer = trace.getTracer('vox-tools');

const toolTierSchema = z.enum(modelTiers);

/**
 * Creates a dynamic tool wrapper for an agent using Vercel AI SDK's dynamicTool.
 * Allows agents to call other agents as tools, enabling hierarchical agent architectures.
 *
 * @param agent - The agent to wrap as a tool
 * @param context - The VoxContext for executing the agent (the agent runs as a nested execution
 *   in the caller's active root, or a forked root for fire-and-forget; parameters come from there)
 * @returns A CoreTool that can be used with AI SDK
 *
 * @example
 * ```typescript
 * const strategistAgent = new SimpleStrategist();
 * const tool = createAgentTool(strategistAgent, context);
 * ```
 */
export function createAgentTool<TParameters extends AgentParameters, TInput = unknown, TOutput = unknown>(
  agent: VoxAgent<TParameters, TInput, TOutput>,
  context: VoxContext<TParameters>
): VercelTool {
  const logger = createLogger(`AgentTool-${agent.name}`);

  // Use a simpler approach to avoid deep type instantiation issues
  const description = agent.toolDescription || `Execute the ${agent.name} agent to handle specialized tasks`;
  // Prefer the caller-facing handoff schema (mapped into the agent's input by
  // resolveHandoffInput); fall back to the agent's own input schema, then a generic prompt.
  const baseInputSchema = agent.handoffSchema || agent.inputSchema || z.object({
    Prompt: z.string().describe("The prompt or task to give to the agent")
  });
  const tierShape = {
    Tier: toolTierSchema.optional().describe('Model tier for this call: small for simple work, default for typical work, large for complex work.')
  };
  const tierEnvelope = z.object(tierShape).passthrough();
  // Expose all caller fields, but validate the original schema once with Tier removed.
  const inputSchema = jsonSchema(zodSchema(baseInputSchema.safeExtend(tierShape)).jsonSchema, {
    /** Validate wrapper metadata separately from the agent's refinements and transforms. */
    validate: async (value) => {
      const envelope = tierEnvelope.safeParse(value);
      if (!envelope.success) return { success: false, error: envelope.error };
      const { Tier, ...callerInput } = envelope.data;
      const parsed = await baseInputSchema.safeParseAsync(callerInput);
      return parsed.success
        ? { success: true, value: { ...parsed.data, ...(Tier === undefined ? {} : { Tier }) } }
        : { success: false, error: parsed.error };
    },
  });

  return dynamicTool({
    description,
    inputSchema: inputSchema as any,
    execute: async (input) => {
      const span = tracer.startSpan(`agent-tool.${agent.name}`, {
        attributes: {
          'vox.context.id': context.id,
          'tool.name': agent.name,
          'tool.type': 'agent',
        }
      });

      try {
        logger.debug(`Executing agent-tool: ${agent.name}`);
        span.setAttributes({
          'tool.input': JSON.stringify(input)
        });

        // Map the caller's arguments into the agent's input, enriching with ambient context
        // (e.g. the caller's currentInput), still the caller's input at this point, since the
        // agent-tool runs inside the caller's step before context.execute swaps it.
        const { Tier, ...callerInput } = input as Record<string, unknown> & { Tier?: ModelSize };
        const agentInput = agent.resolveHandoffInput(callerInput, context);
        // Resolve which concrete agent to run: defaults to this agent, but may dispatch to a
        // context-resolved variant (e.g. a per-seat custom negotiator) sharing the same input.
        const targetName = agent.resolveHandoffTarget(context);

        // Fire-and-forget: detach from current trace and return immediately. Run on a forked
        // root, NOT a nested execute() on the caller's root: a nested execute() pushes a child
        // frame onto the parent root, so when the caller's run settles and is removed from
        // activeRuns, this still-running work would be orphaned and unreachable by abort()/shutdown().
        // forkRun() registers its own detached root that outlives the parent and is reachable by
        // context-wide abort. It snapshots the parent's parameters and logs failures internally.
        if (agent.fireAndForget) {
          otelContext.with(ROOT_CONTEXT, () => {
            context.forkRun(() => Tier
              ? context.execute(targetName, agentInput, undefined, undefined, undefined, { triage: { tier: Tier } })
              : context.execute(targetName, agentInput));
          });
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return { result: "Submitted for asynchronous processing." };
        }

        // Execute the agent through the context
        const result = await (Tier
          ? context.execute(targetName, agentInput, undefined, undefined, undefined, { triage: { tier: Tier } })
          : context.execute(targetName, agentInput));
        logger.debug(`Agent-tool execution completed: ${agent.name}`);

        span.setAttributes({
          'tool.output': JSON.stringify(result)
        });
        span.setStatus({ code: SpanStatusCode.OK });

        // Apply output schema if defined
        if (agent.outputSchema) {
          return agent.outputSchema.parse(result);
        }

        return { result };
      } catch (error) {
        logger.error(`Error in agent-tool ${agent.name}:`, error);
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
