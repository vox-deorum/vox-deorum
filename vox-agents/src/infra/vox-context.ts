/**
 * @module infra/vox-context
 *
 * Runtime context for executing Vox Agents.
 * Manages agent registration, tool availability, and agent execution with observability.
 * Implements the agentic loop with tool calling, step preparation, and stop conditions.
 */

import { Output, Tool, StepResult, ToolSet, ModelMessage } from "ai";
import { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { AgentParameters, VoxAgent } from "./vox-agent.js";
import { createLogger } from "../utils/logger.js";
import { mcpClient } from "../utils/models/mcp-client.js";
import { getModel, buildProviderOptions } from "../utils/models/models.js";
import { Model, StreamingEventCallback } from "../types/index.js";
import { streamTextWithConcurrency, withModelConfig } from "../utils/models/concurrency.js";
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import { spanProcessor } from '../instrumentation.js';
import { VoxSpanExporter } from '../utils/telemetry/vox-exporter.js';
import { countMessagesTokens } from "../utils/models/token-counter.js";
import { cleanToolArtifacts } from "../utils/models/text-cleaning.js";
import { isContextLengthError } from "../utils/retry.js";
import { agentRegistry } from "./agent-registry.js";
import { contextRegistry } from "./context-registry.js";
import { createAgentTool } from "../utils/tools/agent-tools.js";
import { wrapMCPTools } from "../utils/tools/mcp-tools.js";
import winston from "winston";

/** Mutable object populated by execute() with per-execution token counts */
export interface ExecuteTokenOutput {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
}

/**
 * Runtime context for executing Vox Agents.
 * Manages agent registration, tool availability, and execution flow.
 *
 * @template TParameters - The type of parameters that agents will receive
 */
export class VoxContext<TParameters extends AgentParameters> {
  public logger: winston.Logger;
  private tracer = trace.getTracer('vox-agents');

  /**
   * Unique identifier for this context instance
   */
  public readonly id: string;

  /**
   * Registry of available tools indexed by name
   */
  public tools: Record<string, Tool> = {};

  /**
   * Map of raw MCP tool definitions indexed by name, used for annotation lookups
   */
  public mcpToolMap: Map<string, MCPTool> = new Map();

  /**
   * Model configuration overrides (replaces config.json definitions)
   */
  public modelOverrides: Record<string, Model | string>;

  /**
   * AbortController for managing generation cancellation
   */
  private abortController: AbortController;
  /**
   * A callback for refreshing LLM timeouts
   */
  public timeoutRefresh: () => void = () => {};

  /**
   * Total input tokens
   */
  public inputTokens: number = 0;
  /**
   * Total reasoning tokens
   */
  public reasoningTokens: number = 0;
  /**
   * Total output tokens
   */
  public outputTokens: number = 0;

  /**
   * The last executed parameter
   */
  public lastParameter?: TParameters;

  /**
   * Tracks the last model short name sent via set-metadata, to avoid duplicate updates
   */
  private lastModelName?: string;

  /**
   * Optional callback for streaming non-LLM progress updates (e.g., during initialization).
   * Set by the web route before calling execute(). Reusable for any agent that needs
   * to send progress messages to the client.
   */
  public streamProgress?: (message: string) => void;

  /**
   * Resets the cached model identity so it will be re-sent on the next strategist execution.
   * Call this after crash recovery when the game has lost its Lua state.
   */
  public resetModelIdentity(): void {
    this.lastModelName = undefined;
  }

  /**
   * Constructor for VoxContext
   * @param modelOverrides - Model configuration overrides to replace config.json definitions
   * @param id - Optional context ID, generates a UUID if not provided
   */
  constructor(modelOverrides: Record<string, Model | string> = {}, id?: string) {
    this.id = id || uuidv4();
    this.modelOverrides = modelOverrides;
    this.abortController = new AbortController();
    this.logger = createLogger(`VoxContext-${this.id}`);
    this.logger.info(`VoxContext initialized with ID: ${this.id}`);

    // Automatically register this context in the registry
    contextRegistry.register(this);
  }

  /** Path to the MCP tool metadata cache file */
  private static readonly toolCachePath = path.join('cache', 'mcp-tools.json');

  /**
   * Register all tools.
   * Fetches available tools from the MCP server and wraps them for use with AI SDK.
   * Also registers agent tools and extra tools. Persists MCP tool metadata to disk for offline use.
   */
  public async registerTools() {
    // MCP tools
    const rawMcpTools = await mcpClient.getTools();
    this.mcpToolMap = new Map(rawMcpTools.map(t => [t.name, t]));
    var mcpTools = wrapMCPTools(rawMcpTools, this);

    for (var tool of Object.keys(mcpTools)) {
      this.tools[tool] = mcpTools[tool];
    }

    // Agent + extra tools
    this.registerAgentTools();

    // Persist MCP tool metadata for offline use
    this.saveToolCache(rawMcpTools);
  }

  /**
   * Register agent tools and agent-provided extra tools without connecting to MCP.
   * Use this together with loadToolCache() for workflows that don't need live MCP tools
   * (e.g. telepathist post-game analysis).
   */
  public registerAgentTools(): void {
    const allAgents = agentRegistry.getAllAsRecord();
    for (const [agentName, agent] of Object.entries(allAgents)) {
      // Agent as a tool
      this.tools[`call-${agentName}`] = createAgentTool(
        agent as VoxAgent<TParameters>,
        this,
        () => this.lastParameter!
      );

      // Register any extra tools provided by the agent
      const extraTools = (agent as VoxAgent<TParameters>).getExtraTools(this);
      for (const [toolName, tool] of Object.entries(extraTools)) {
        this.tools[toolName] = tool;
      }
    }
  }

  /**
   * Save MCP tool definitions to a JSON cache file.
   * The full schema is needed by offline Oracle replay; metadata-only readers below
   * remain tolerant of older cache files.
   */
  private saveToolCache(tools: MCPTool[]): void {
    try {
      const cacheDir = path.dirname(VoxContext.toolCachePath);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      const cacheData = tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        _meta: t._meta
      }));
      fs.writeFileSync(VoxContext.toolCachePath, JSON.stringify(cacheData, null, 2));
      this.logger.debug(`Saved MCP tool cache (${tools.length} tools)`);
    } catch (error) {
      this.logger.warn('Failed to save MCP tool cache', { error });
    }
  }

  /**
   * Load MCP tool metadata from cache. Used when MCP server is offline (e.g. -p mode).
   * Populates mcpToolMap so formatToolOutput can find markdownConfig.
   */
  public loadToolCache(): void {
    try {
      if (!fs.existsSync(VoxContext.toolCachePath)) {
        this.logger.warn('No MCP tool cache found — formatToolOutput will use default formatting');
        return;
      }
      const raw = fs.readFileSync(VoxContext.toolCachePath, 'utf-8');
      const tools: Pick<MCPTool, 'name' | '_meta'>[] = JSON.parse(raw);
      this.mcpToolMap = new Map(tools.map(t => [t.name, t as MCPTool]));
      this.logger.info(`Loaded MCP tool cache (${tools.length} tools)`);
    } catch (error) {
      this.logger.warn('Failed to load MCP tool cache', { error });
    }
  }

  /**
   * Abort the current generation if one is in progress.
   * Creates a new AbortController after aborting for future operations.
   *
   * @param successful - Whether the abort is due to successful completion
   */
  public abort(successful: boolean = false): void {
    this.logger.info(`Aborting current generation (successful: ${successful})`);
    this.abortController.abort();
    // Create a new AbortController for future executions
    this.abortController = new AbortController();
  }

  /**
   * Call a tool by name with the given arguments.
   * Allows manual tool invocation outside of agent execution loop.
   *
   * @param name - The name of the tool to call
   * @param args - The arguments to pass to the tool
   * @param parameters - Agent parameters to pass as experimental_context
   * @returns The result of the tool execution, or undefined if tool not found or execution fails
   */
  public async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    parameters: TParameters): Promise<T | undefined> {
    const tool = this.tools[name];
    if (!tool) {
      this.logger.error(`Tool not found: ${name}`);
      return undefined;
    }

    try {
      const result = await tool.execute?.(args, {
        toolCallId: "manual",
        messages: [],
        experimental_context: parameters
      });
      return result;
    } catch (error) {
      this.logger.error(`Error calling tool ${name}:`, error);
      return undefined;
    }
  }

  /**
   * Call an agent by name with the given input.
   * Allows manual agent invocation outside of the main execution loop.
   * This is useful for orchestrating multiple agents or calling agents programmatically.
   *
   * @param name - The name of the agent to call
   * @param input - The input to pass to the agent
   * @param parameters - The parameters to pass to the agent
   * @returns The result of the agent execution, or undefined if agent not found or execution fails
   */
  public async callAgent<T = unknown>(
    name: string,
    input: unknown,
    parameters: TParameters,
    onContextLengthError?: () => void): Promise<T | undefined> {
    const agent = agentRegistry.get<TParameters>(name);
    if (!agent) {
      this.logger.error(`Agent not found: ${name}`);
      return undefined;
    }

    try {
      return await this.execute(name, parameters, input, undefined, undefined, onContextLengthError) as T;
    } catch (error) {
      this.logger.error(`Error calling agent ${name}:`, error);
      return undefined;
    }
  }

  /**
   * Execute an agent with the given parameters.
   * Runs the agent's system prompt, tools, and lifecycle hooks in an iterative loop
   * until the stop condition is met. Tracks token usage and provides observability.
   *
   * @param agentName - The name of the agent to execute
   * @param parameters - The parameters to pass to the agent
   * @param outputSchema - Optional output schema for structured generation
   * @returns The generated text response from the agent
   * @throws Error if the agent is not found
   */
  public async execute(
    agentName: string,
    parameters: TParameters,
    input: unknown,
    callback?: StreamingEventCallback,
    tokenOutput?: ExecuteTokenOutput,
    onContextLengthError?: () => void
  ): Promise<unknown> {
    const agent = agentRegistry.get<TParameters>(agentName);
    if (!agent) {
      this.logger.error(`Agent not found: ${agentName}`);
      throw new Error(`Agent '${agentName}' not found in registry`);
    }

    this.lastParameter = parameters;

    const span = this.tracer.startSpan(`agent.${agentName}`, {
      attributes: {
        'vox.context.id': this.id,
        'game.turn': String(parameters.turn),
        'agent.name': agentName,
        'agent.input': input ? JSON.stringify(input) : undefined
      }
    });

    return await context.with(trace.setSpan(context.active(), span), async () => {
      try {
        // Execute the agent using generateText
        // Get model config - agent's model or default, with overrides applied
        const modelConfig = agent.getModel(parameters, input, this.modelOverrides);
        var system = await agent.getSystem(parameters, input, this);

        // Auto-send model name via set-metadata when the strategist's model changes
        if (agent.name.includes("-strategist")) {
          // "VPAI" when no system prompt (in-game AI only), otherwise the LLM short name
          const shortName = system !== ""
            ? (modelConfig.name.split("/").pop() || modelConfig.name)
            : "VPAI";
          if (shortName !== this.lastModelName) {
            this.lastModelName = shortName;
            await this.callTool("set-metadata", {
              Key: `model-${parameters.playerID}`, Value: shortName
            }, parameters);
          }
        }

        if (system != "") {
          var shouldStop = false;
          var messages: ModelMessage[] = [{
            role: "system",
            content: system
          }];
          
          const initialMessages = await agent.getInitialMessages(parameters, input, this);
          messages.push(...initialMessages);
          var allSteps: StepResult<ToolSet>[] = [];
          var finalText = "";
          
          // Count tokens
          var inputTokens = 0;
          var reasoningTokens = 0;
          var outputTokens = 0;

          // Execute steps in a loop, one at a time
          for (let stepCount = 0; !shouldStop; stepCount++) {
            this.logger.info(`Executing ${agentName}'s step ${stepCount + 1}`, {
              GameID: parameters.gameID,
              PlayerID: parameters.playerID
            });

            // Execute the step with proper tracing
            const stepResult = await this.executeAgentStep(
              agent,
              parameters,
              input,
              allSteps,
              stepCount,
              messages,
              modelConfig,
              callback
            );

            // Update state from step results
            messages = stepResult.messages;
            shouldStop = stepResult.shouldStop;
            finalText = stepResult.finalText ?? "";
            inputTokens += stepResult.inputTokens;
            reasoningTokens += stepResult.reasoningTokens;
            outputTokens += stepResult.outputTokens;
          }

          this.logger.info(`Agent execution completed: ${agentName} with ${allSteps.length} steps`);

          // Log the conclusion
          this.inputTokens += inputTokens;
          this.reasoningTokens += reasoningTokens;
          this.outputTokens += outputTokens;
          span.setAttributes({
            'model': `${modelConfig.provider}/${modelConfig.name}@${modelConfig.options?.["reasoningEffort"] ?? ""}`,
            'tokens.input': inputTokens,
            'tokens.reasoning': reasoningTokens,
            'tokens.output': outputTokens,
          });
          span.setStatus({ code: SpanStatusCode.OK });

          // Populate optional token output for callers that need per-execution counts
          if (tokenOutput) {
            tokenOutput.inputTokens = inputTokens;
            tokenOutput.reasoningTokens = reasoningTokens;
            tokenOutput.outputTokens = outputTokens;
          }

          // Convert into the output (now async)
          const output = await agent.getOutput(parameters, input, finalText, this);
          if (!output) return;
          return agent.postprocessOutput(parameters, input, output);
        } else {
          span.setStatus({ code: SpanStatusCode.OK, message: 'No system prompt' });
          return undefined;
        }
      } catch (error) {
        this.logger.error(`Error executing agent ${agentName}!`, error);
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error)
        });
        if (onContextLengthError && isContextLengthError(error)) {
          onContextLengthError();
        }
        return undefined;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Execute a single agent step with proper tracing and error handling.
   * This method encapsulates the logic for preparing, executing, and processing
   * a single step in an agent's execution flow.
   *
   * @private
   * @param stepSpan - The OpenTelemetry span for this step
   * @param agent - The agent being executed
   * @param agentName - The name of the agent
   * @param parameters - The parameters for the agent
   * @param allSteps - All steps executed so far
   * @param messages - The current message history
   * @param model - The model identifier
   * @param system - The system prompt
   * @param allTools - All available tools including agent handoff tools
   * @param stepCount - The current step number
   * @returns Updated messages, stop condition, and optional final text
   */
  private async executeAgentStep(
    agent: VoxAgent<TParameters>,
    parameters: TParameters,
    input: unknown,
    allSteps: StepResult<ToolSet>[],
    stepCount: number,
    messages: ModelMessage[],
    model: Model,
    callback?: StreamingEventCallback
  ): Promise<{ messages: ModelMessage[], shouldStop: boolean, finalText?: string, inputTokens: number, reasoningTokens: number, outputTokens: number }> {
    const stepSpan = this.tracer.startSpan(`agent.${agent.name}.step.${stepCount + 1}`, {
      attributes: {
        'vox.context.id': this.id,
        'game.turn': String(parameters.turn),
        'agent.name': agent.name,
        'step.number': stepCount + 1
      }
    });

    return await context.with(trace.setSpan(context.active(), stepSpan), async () => {
      try {
        // Prepare configuration for this step
        const stepConfig = await agent.prepareStep(parameters, input,
          allSteps.length === 0 ? null : allSteps[allSteps.length - 1], allSteps, messages, this);

        // Apply prepared configuration
        messages = stepConfig.messages || messages;
        const stepModel = stepConfig.model || model;
        const stepProviderOptions = buildProviderOptions(stepConfig.model || model);
        const stepActiveTools = stepConfig.activeTools || agent.getActiveTools(parameters);
        const stepToolChoice = stepConfig.toolChoice || (stepActiveTools && stepActiveTools.length > 0 ? agent.toolChoice : "auto");
        const stepOutputSchema = stepConfig.outputSchema;

        // Prepare tool-result messages by converting nested objects to markdown
        messages.forEach((message) => {
          if (!Array.isArray(message.content)) return;
          // Process each tool result
          message.content.forEach(toolResult => {
            if (toolResult.type === 'tool-result' && 'value' in toolResult.output && typeof(toolResult.output.value) === "object") {
              delete (toolResult.output.value as any)._markdownConfig;
            }
          });
        });

        // Record step configuration in span
        stepSpan.setAttributes({
          'step.tools': JSON.stringify(stepActiveTools),
          'step.tools.choice': stepToolChoice,
          'step.messages': JSON.stringify(messages)
        });

        // Execute a single step with concurrency limiting and retry
        // The steps are already awaited within the retry mechanism to properly catch streaming errors
        const result = await streamTextWithConcurrency(
          withModelConfig({
            // Model settings
            model: getModel(stepModel),
            providerOptions: stepProviderOptions,
            // Disable Vercel AI SDK's internal retry to let our wrapper handle it
            maxRetries: 0,
            // Abort signal for cancellation
            abortSignal: this.abortController.signal,
            // Current messages
            messages: messages,
            // Tools
            tools: this.tools,
            activeTools: stepActiveTools,
            toolChoice: stepModel.provider === "anthropic" && stepToolChoice === "required" ? "auto" : stepToolChoice as any,
            experimental_context: parameters,
            // Output schema for tool as agent
            experimental_output: stepOutputSchema ? Output.object({ schema: stepOutputSchema }) : undefined,
            // Stop after one step
            stopWhen: () => true,
            // Events
            onChunk: (args: any) => {
              callback?.OnChunk(args);
            }
          }, stepModel),
          this
        );

        if (!result || this.abortController.signal.aborted) throw new Error("Operation aborted.");
        // Steps are already resolved by streamTextWithConcurrency
        const stepResults = result.steps;
        const stepResponse = stepResults[stepResults.length - 1];

        // Update token usage
        const inputTokens = Math.max(countMessagesTokens(messages, false), stepResponse.usage.inputTokens ?? 0);
        let reasoningTokens = stepResponse.usage.reasoningTokens ?? 0;
        const outputTokens = countMessagesTokens(stepResponse.response.messages, false);
        
        // Alternatively: estimate reasoning tokens
        if (reasoningTokens === 0) {
          reasoningTokens = countMessagesTokens(stepResponse.response.messages, true);
          if (reasoningTokens > 0) {
            reasoningTokens = Math.max(reasoningTokens, stepResponse.usage.outputTokens ?? 0 - outputTokens);
          }
        }

        // Record step results in span
        const responses = stepResponse.response.messages;
        responses.forEach((response: any) => delete response.providerOptions);

        // Add the step to our collection
        let shouldStop = false;
        let finalText: string | undefined;

        if (stepResults.length > 0) {
          allSteps.push(...stepResults);
          finalText = stepResponse.text;

          // Clean tool rescue artifacts from response messages
          for (const msg of stepResponse.response.messages) {
            if (Array.isArray(msg.content)) {
              msg.content = msg.content.filter((part: any) => {
                if (part.type === 'text') {
                  part.text = cleanToolArtifacts(part.text);
                  return part.text.length > 0;
                }
                return true;
              });
            } else if (typeof msg.content === 'string') {
              msg.content = cleanToolArtifacts(msg.content);
            }
          }

          // Update messages with the response
          messages = messages.concat(stepResponse.response.messages);

          // Check stop condition
          shouldStop = this.abortController.signal.aborted ||
            agent.stopCheck(parameters, input, stepResponse, allSteps, this);

          this.logger.debug(`Stop check for ${agent.name}: ${shouldStop}`, {
            stepNumber: stepCount + 1,
            totalSteps: allSteps.length
          });
        } else {
          this.logger.warn(`Agent execution produced no steps: ${agent.name} at step ${stepCount + 1}.`);
          shouldStop = this.abortController.signal.aborted;
        }
        
        stepSpan.setAttributes({
          'model': `${stepModel.provider}/${stepModel.name}@${stepModel.options?.["reasoningEffort"] ?? ""}`,
          'tokens.input': inputTokens,
          'tokens.reasoning': reasoningTokens,
          'tokens.output': outputTokens,
          'step.responses': JSON.stringify(stepResponse.response.messages)
        });

        stepSpan.setAttribute('step.should_stop', shouldStop);
        stepSpan.setStatus({ code: SpanStatusCode.OK });

        return { messages, shouldStop, finalText, inputTokens, reasoningTokens, outputTokens };
      } catch (error) {
        stepSpan.recordException(error as Error);
        stepSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error; // Re-throw to be handled by outer try-catch
      } finally {
        stepSpan.end();
      }
    });
  }

  /**
   * Gracefully shutdown the VoxContext.
   * Flushes telemetry data, closes SQLite databases, and unregisters from the registry.
   */
  public async shutdown(): Promise<void> {
    this.logger.info(`Shutting down VoxContext ${this.id}`);

    try {
      // Abort any ongoing generation
      this.abort(true);

      // Force flush telemetry data to ensure all spans are written
      await spanProcessor.forceFlush();

      // Close the SQLite database for this specific context
      await VoxSpanExporter.getInstance().closeContext(this.id);

      // Close parameter resources (database connections, etc.) if applicable
      await this.lastParameter?.close?.();

      // Automatically unregister this context from the registry
      contextRegistry.unregister(this.id);

      this.logger.info(`VoxContext ${this.id} shutdown complete`);
    } catch (error) {
      this.logger.error(`Error during VoxContext shutdown for ${this.id}:`, error);
      throw error;
    }
  }
}
