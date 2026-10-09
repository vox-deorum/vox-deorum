/**
 * @module infra/vox-execute
 *
 * The agent execution loop. Runs an agent's system prompt, tools, and lifecycle hooks in an
 * iterative loop until the stop condition is met, with per-step tracing, token accounting, and
 * stop checks. VoxContext.execute() delegates here and passes itself as the host.
 *
 * The host is typed as a VoxContext because that is genuinely what this loop needs: every agent
 * lifecycle hook it calls (getSystem, prepareStep, stopCheck, and the rest) is declared to
 * receive one. The import is type-only, so it is erased at emit and no runtime cycle forms.
 * Shared span, token, and label primitives live in vox-telemetry.ts, which works against a much
 * narrower host surface of its own.
 */

import { Output, StepResult, ToolSet, ModelMessage } from "ai";
import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import type { AgentParameters, PreparedAgentState, TriageDecision, VoxAgent } from "./vox-agent.js";
import type { VoxContext } from "./vox-context.js";
import type { Model, StreamingEventCallback } from "../types/index.js";
import { streamTextWithConcurrency, withModelConfig } from "../utils/models/concurrency.js";
import { getModel, buildProviderOptions, continuityThreshold } from "../utils/models/models.js";
import { countRequestTokens } from "../utils/models/token-counter.js";
import { countCacheBreakpoints, hasCacheBreakpoint, markBreakpointOnLast, MAX_CACHE_BREAKPOINTS } from "../utils/models/cache-breakpoint.js";
import { formatModelReference } from '../utils/models/model-reference.js';
import { emitProviderExecutedToolSpans } from "../utils/telemetry/provider-tool-spans.js";
import { hostCapabilityTelemetryAttributes } from "../utils/telemetry/host-capabilities.js";
import { codexResponseTelemetryAttributes } from "../utils/telemetry/codex-response.js";
import { stepTokenUsage } from "../utils/telemetry/model-usage.js";
import { isHostCapabilityProvider } from "../utils/models/providers/host-tools.js";
import { rootPrompts } from "../utils/prompts/prompt-files.js";
import { stripMarkdownConfig, stripToolArtifacts } from "../utils/models/text-cleaning.js";
import { appendReminder } from "../utils/prompts/reminders.js";
import { compactWorkspaceTraffic, compactionReminder, dropOlderReasoning } from "../utils/prompts/message-history.js";
import { buildRemovedToolRejections } from "../utils/tools/tool-availability.js";
import { isContextLengthError } from "../utils/retry.js";
import { agentRegistry } from "./agent-registry.js";
import type { ExecuteTokenOutput, ExecuteOptions } from "./vox-run.js";
import {
  openAgentSpan,
  openStepSpan,
  recordSpanError,
  accrueTokens,
  updateModelLabel,
} from "./vox-telemetry.js";

/**
 * Execute an agent with the given parameters on the host context. Requires an active root run;
 * pushes a nested execution frame for this agent's input, opens the agent span, resolves the
 * model and system prompt, loops {@link executeAgentStep} until a stop check passes, then accrues
 * tokens and converts the final text into the agent's output.
 *
 * @param host - The execution host (the calling VoxContext instance, passed straight through)
 * @param agentName - The name of the agent to execute
 * @param input - The agent input (becomes the new execution frame's input)
 * @param callback - Optional streaming event callback forwarded to each model step
 * @param tokenOutput - Optional mutable object populated with this execution's token counts
 * @param onContextLengthError - Optional hook invoked when the failure is a context-length error
 * @param options - Per-execution controls (e.g. throwOnError)
 * @returns The generated text response (post-processed) from the agent
 * @throws Error if called outside a run, or if the agent is not found
 */
export async function executeAgent<TParameters extends AgentParameters>(
  host: VoxContext<TParameters>,
  agentName: string,
  input: unknown,
  callback?: StreamingEventCallback,
  tokenOutput?: ExecuteTokenOutput,
  onContextLengthError?: () => void,
  options: ExecuteOptions = {}
): Promise<unknown> {
  const root = host.activeRoot;
  if (!root) {
    throw new Error('VoxContext.execute requires an active run; call withRun() or forkRun().');
  }

  const agent = agentRegistry.get<TParameters>(agentName);
  if (!agent) {
    host.logger.error(`Agent not found: ${agentName}`);
    throw new Error(`Agent '${agentName}' not found in registry`);
  }

  // A diplomacy-only agent (e.g. the diplomat) has no counterpart outside a civ↔civ diplomacy
  // conversation, so it must never run as an ordinary observer/telepathist chat. This is the single
  // execution boundary every entry point (the web chat routes, the telepathist CLI, and agent-tool
  // handoffs) funnels through, so enforcing the invariant here makes it unbypassable rather than
  // relying on each caller to re-check it. The EnvoyThread `diplomacy` flag is set only by the
  // diplomacy route; non-envoy inputs (strategists, narrators) are never diplomacyOnly and skip this.
  if (agent.diplomacyOnly && !(input as { diplomacy?: boolean } | null | undefined)?.diplomacy) {
    throw new Error(`Agent '${agentName}' only runs in diplomacy mode; it cannot run as an ordinary observer/telepathist chat.`);
  }

  // The active root's composed parameters are the single source of execution parameters.
  const params = root.parameters;

  // Run in a nested frame so a sub-agent (e.g. an agent-tool such as call-diplomatic-analyst,
  // running on this same VoxContext) sees its own input. The parent input is restored
  // automatically when the frame scope exits, so tools that read currentInput later in the
  // parent's tool loop (e.g. close-conversation) still see the parent's EnvoyThread.
  return host.runInChildFrame(input, async (frame) => {
    const span = openAgentSpan(host, agentName, params.turn, input);
    span.setAttribute('triage.baseline', agent.modelSize);
    // The custom prompt folder behind this run's system text, so analysis can group rows by prompt set.
    span.setAttribute('context.prompts', host.prompts ?? rootPrompts());

    return await context.with(trace.setSpan(context.active(), span), async () => {
      try {
        // An empty system prompt means the agent has nothing to do this time.
        const system = await agent.getSystem(params, input, host);
        if (system === "") {
          span.setStatus({ code: SpanStatusCode.OK, message: 'No system prompt' });
          return undefined;
        }

        const prepared: PreparedAgentState = {
          system,
          messages: await agent.getInitialMessages(params, input, host),
          tools: await agent.getRunTools(params, input, host),
        };
        const decision = await resolveTriage(host, agent, params, input, options, prepared);
        frame.triage = decision;
        if (decision) {
          span.setAttribute('triage.tier', decision.tier);
          if (decision.source) span.setAttribute('triage.source', decision.source);
          if (decision.note !== undefined) span.setAttribute('triage.note', decision.note);
        }

        // Get model config after triage so every execution path uses the selected tier.
        const modelConfig = agent.getModel(params, input, host.modelOverrides, decision?.tier);
        await updateModelLabel(host, agent.name, modelConfig, system, params);

        if (agent.executeEvaluation) {
          host.currentSignal().throwIfAborted();
          const evaluationOutput = await agent.executeEvaluation(params, input, host, prepared, modelConfig, tokenOutput);
          host.currentSignal().throwIfAborted();
          span.setAttribute('model', formatModelReference(modelConfig));
          // Evaluation agents have no step spans, so their returned text is the span's response.
          if (evaluationOutput !== undefined) {
            span.setAttribute('agent.output', typeof evaluationOutput === 'string' ? evaluationOutput : JSON.stringify(evaluationOutput));
          }
          span.setStatus({ code: SpanStatusCode.OK });
          if (evaluationOutput === undefined) return;
          return agent.postprocessOutput(params, input, evaluationOutput);
        }

        let shouldStop = false;
        let messages: ModelMessage[] = [{
          role: "system",
          content: system
        }];

        messages.push(...prepared.messages);
        // Files make multi-step runs likely, so the initial prompt is marked for prompt caching and
        // later steps can re-read it. The marker sits in the history, so it is byte-stable across
        // steps, and providers other than the Anthropic family ignore it.
        if (host.files && !hasCacheBreakpoint(messages[messages.length - 1])
          && countCacheBreakpoints(messages) < MAX_CACHE_BREAKPOINTS) {
          markBreakpointOnLast(messages);
        }
        const initialLength = messages.length;
        const allSteps: StepResult<ToolSet>[] = [];
        let finalText = "";

        // Count tokens
        let inputTokens = 0;
        let cachedInputTokens = 0;
        let hasCachedInputTokens = false;
        let reasoningTokens = 0;
        let outputTokens = 0;
        // Threads the previous Codex step's response id so the next step prefers native thread continuation.
        let codexResponseId: string | undefined;
        // With files on, the run compacts old bash output near this request size. Workspace notes
        // are what make dropping that output safe, so runs without files never compact.
        const threshold = host.files ? continuityThreshold(modelConfig) : undefined;
        // Where the last step's response starts; its bash output survives compaction.
        let lastResponseStart: number | undefined;
        let compactionReminded = false;
        let overflowRetried = false;

        // Execute steps in a loop, one at a time
        for (let stepCount = 0; !shouldStop; stepCount++) {
          host.logger.info(`Executing ${agentName}'s step ${stepCount + 1}`, {
            GameID: params.gameID,
            PlayerID: params.playerID
          });

          // Before each later step, remind once from 75 percent of the threshold, and compact at the
          // threshold only after the reminder had a step to act on, so old output never drops unwarned.
          let compacted: StepCompaction | undefined;
          let compactOnOverflow: ((stepMessages: ModelMessage[]) => ModelMessage[]) | undefined;
          if (threshold !== undefined && lastResponseStart !== undefined) {
            const keepFrom = lastResponseStart;
            const requestTokens = countRequestTokens(messages);
            if (!compactionReminded) {
              if (requestTokens >= threshold * 0.75) {
                messages = appendReminder(messages, compactionReminder);
                compactionReminded = true;
              }
            } else if (requestTokens >= threshold) {
              messages = compactHistory(messages, keepFrom, initialLength);
              compacted = 'threshold';
            }
            // The first context overflow compacts and retries the step once. A step that already
            // compacted would resend the same request, so it fails as before.
            if (!compacted && !overflowRetried) {
              compactOnOverflow = (stepMessages) => compactHistory(stepMessages, keepFrom, initialLength);
            }
          }

          // Execute the step with proper tracing
          const stepResult = await executeAgentStep(
            host,
            agent,
            params,
            input,
            allSteps,
            stepCount,
            messages,
            prepared.tools,
            modelConfig,
            // A compacted history must reach the model in full, not continue Codex's native thread.
            compacted ? undefined : codexResponseId,
            callback,
            compacted,
            compactOnOverflow
          );

          // Update state from step results
          if (stepResult.compacted === 'overflow') overflowRetried = true;
          messages = stepResult.messages;
          shouldStop = stepResult.shouldStop;
          finalText = stepResult.finalText ?? "";
          inputTokens += stepResult.inputTokens;
          if (stepResult.cachedInputTokens !== undefined) {
            cachedInputTokens += stepResult.cachedInputTokens;
            hasCachedInputTokens = true;
          }
          reasoningTokens += stepResult.reasoningTokens;
          outputTokens += stepResult.outputTokens;
          codexResponseId = stepResult.responseId;
          lastResponseStart = stepResult.responseStart;
        }

        host.logger.info(`Agent execution completed: ${agentName} with ${allSteps.length} steps`);

        // Accrue tokens to the active root's sink and the seat-wide totals.
        accrueTokens(host, root, { inputTokens, reasoningTokens, outputTokens }, tokenOutput);
        span.setAttributes({
          'model': formatModelReference(modelConfig),
          'tokens.input': inputTokens,
          'tokens.reasoning': reasoningTokens,
          'tokens.output': outputTokens,
        });
        if (hasCachedInputTokens) span.setAttribute('tokens.input.cached', cachedInputTokens);
        span.setStatus({ code: SpanStatusCode.OK });

        // Convert into the output (now async)
        const output = await agent.getOutput(params, input, finalText, host);
        if (!output) return;
        return agent.postprocessOutput(params, input, output);
      } catch (error) {
        host.logger.error(`Error executing agent ${agentName}!`, error);
        recordSpanError(span, error);
        const contextLengthError = isContextLengthError(error);
        if (onContextLengthError && contextLengthError) {
          onContextLengthError();
        }
        if (options.throwOnError && !contextLengthError) {
          throw error;
        }
        return undefined;
      } finally {
        span.end();
      }
    });
  }, agentName);
}

/**
 * Resolve one execution's supplied or agent-provided triage decision. A failed hook keeps the
 * agent's own tier and notes the failure on the decision, so the span tells an outage apart from
 * an evaluator's choice. Cancellation rethrows.
 */
async function resolveTriage<TParameters extends AgentParameters>(
  host: VoxContext<TParameters>,
  agent: VoxAgent<TParameters>,
  parameters: TParameters,
  input: unknown,
  options: ExecuteOptions,
  prepared: PreparedAgentState,
): Promise<TriageDecision | undefined> {
  if (options.triage) return { ...options.triage, source: 'caller' };
  if (!agent.triage) return undefined;

  const signal = host.currentSignal();
  signal.throwIfAborted();
  try {
    const decision = await agent.triage(parameters, input, host, prepared);
    signal.throwIfAborted();
    return decision;
  } catch (error) {
    if (signal.aborted) throw error;
    host.logger.warn(`Triage failed for agent ${agent.name}; keeping its ${agent.modelSize} tier.`, error);
    return { tier: agent.modelSize, source: 'failed', note: 'triage failed' };
  }
}

/** Why a step's history was compacted before it ran. */
type StepCompaction = 'threshold' | 'overflow';

/**
 * Drops old bash output before `keepFrom` and reasoning from older assistant messages, both only
 * after the run's initial messages, so the initial prompt stays byte-identical for prompt caching.
 */
function compactHistory(messages: ModelMessage[], keepFrom: number, initialLength: number): ModelMessage[] {
  return dropOlderReasoning(compactWorkspaceTraffic(messages, keepFrom, initialLength), initialLength);
}

/**
 * Execute a single agent step with proper tracing and error handling. This function encapsulates
 * the logic for preparing, executing, and processing a single step in an agent's execution flow.
 *
 * @param host - The execution host (tracer, tools, signal, logger, and the passthrough identity)
 * @param agent - The agent being executed
 * @param parameters - The parameters for the agent
 * @param input - The agent input for this execution frame
 * @param allSteps - All steps executed so far
 * @param stepCount - The current step number
 * @param messages - The current message history
 * @param declaredTools - The run's declared tools (undefined for all registered tools)
 * @param model - The model identifier
 * @param previousResponseId - The prior Codex step's response id, forwarded so the proxy continues the same thread
 * @param callback - Optional streaming event callback for this step
 * @param compacted - Why the history was compacted before this step, recorded as step.compacted
 * @param compactOnOverflow - When set, the first context-length error compacts the prepared request
 *   with it and retries once inside this step, so the rejected request is not another logical step
 * @returns Updated messages, where this step's response starts in them, stop condition, optional
 *   final text, the response id that continues the thread, and why the step's history was compacted
 */
async function executeAgentStep<TParameters extends AgentParameters>(
  host: VoxContext<TParameters>,
  agent: VoxAgent<TParameters>,
  parameters: TParameters,
  input: unknown,
  allSteps: StepResult<ToolSet>[],
  stepCount: number,
  messages: ModelMessage[],
  declaredTools: string[] | undefined,
  model: Model,
  previousResponseId?: string,
  callback?: StreamingEventCallback,
  compacted?: StepCompaction,
  compactOnOverflow?: (messages: ModelMessage[]) => ModelMessage[]
): Promise<{ messages: ModelMessage[], responseStart: number, shouldStop: boolean, finalText?: string, inputTokens: number, cachedInputTokens?: number, reasoningTokens: number, outputTokens: number, responseId?: string, compacted?: StepCompaction }> {
  const stepSpan = openStepSpan(host, agent.name, parameters.turn, stepCount + 1);

  return await context.with(trace.setSpan(context.active(), stepSpan), async () => {
    try {
      // Prepare configuration for this step
      const stepConfig = await agent.prepareStep(parameters, input,
        allSteps.length === 0 ? null : allSteps[allSteps.length - 1], allSteps, messages, host);

      // Apply prepared configuration
      messages = stepConfig.messages || messages;
      const stepModel = stepConfig.model || model;
      // The run's tools stay declared on every step (undefined means "all registered tools", the AI
      // SDK's activeTools contract), so narrowing never changes the cached prompt prefix. Tools that
      // prepareStep removes after a step are enforced once the model replies: each gets a rejection
      // hook, and the closing reminder below names what may run. prepareStep can only remove tools, so
      // a name it returns outside the run's tools is dropped.
      const declaredNames = declaredTools ?? Object.keys(host.tools);
      const executableTools = stepConfig.activeTools?.filter((name) => declaredNames.includes(name)) ?? declaredTools;
      const executableNames = executableTools ?? declaredNames;
      const rejections = buildRemovedToolRejections(declaredNames, executableNames);
      const narrowed = rejections !== undefined;
      // Derived from the executable list, so a step that may run nothing is never forced to call.
      const stepToolChoice = executableTools && executableTools.length > 0 ? agent.toolChoice : "auto";
      const stepOutputSchema = stepConfig.outputSchema;

      // Append the closing reminder (the requirement when the choice is required, tool policy when
      // narrowed, finalize nudge after the first step). Provider middleware keeps its system text the
      // same for auto and required, so only this end of the prompt changes with the choice. Any
      // rescue prompt prepareStep appended is already in `messages` and stays ahead of it: the model
      // reads "your last response was empty, retry" and then what it may call and finish with.
      messages = appendReminder(
        messages,
        agent.continuationNudge(parameters, {
          executable: executableNames,
          narrowed,
          step: allSteps.length,
          required: stepToolChoice === 'required',
          // With files on, workspace work and the final decision share one step budget.
          stepsLeft: host.files ? agent.stepLimit(host) - allSteps.length : undefined,
        }),
      );

      // The markdown rendering hint on tool results is for humans, not the model.
      stripMarkdownConfig(messages);

      // Record step configuration in span. step.tools is what may run on this step; since tools are
      // only removed after a step ran, the first step's list is the run's declared list (Oracle
      // rebuilds replay declarations from it and per-step removals from the later steps).
      stepSpan.setAttributes({
        'step.tools': JSON.stringify(executableTools),
        'step.tools.choice': stepToolChoice,
        'step.messages': JSON.stringify(messages),
      });
      if (compacted) stepSpan.setAttribute('step.compacted', compacted);
      // Recorded separately: host-tool validation may throw, and the step
      // configuration above should already be on the span when it does.
      stepSpan.setAttributes(hostCapabilityTelemetryAttributes(stepModel, host.files));

      // Framing is recorded as an explicit fact, separate from prompt content:
      // step.tool_framing carries the resolved framing for the step. A callback rather
      // than trace.getActiveSpan() because the model call runs through pLimit and can
      // resume in a sibling step's async context; this closure and the stepSpan
      // reference below are immune to that.
      let stepToolFraming: string | undefined;

      // Execute a single step with concurrency limiting and retry
      // The steps are already awaited within the retry mechanism to properly catch streaming errors
      const request = (requestMessages: ModelMessage[], responseId: string | undefined) => streamTextWithConcurrency(
        withModelConfig({
          // Model settings
          model: getModel(stepModel, {
            // Describes the workspace when the step declares bash.
            files: host.files,
            onToolFraming: ({ framing }) => { stepToolFraming = framing; },
            // Provider guidance names these as what ends the turn. Passed unfiltered: each
            // middleware intersects them with the run's declared tools, so its text stays stable on
            // narrowed steps; the closing reminder names what may actually run.
            completionTools: agent.completionTools,
          }),
          providerOptions: buildProviderOptions(stepModel, responseId),
          // Disable Vercel AI SDK's internal retry to let our wrapper handle it
          maxRetries: 0,
          // Abort signal for cancellation: the active root's signal, so aborting one root
          // never stops a sibling root's step.
          abortSignal: host.currentSignal(),
          // Current messages
          messages: requestMessages,
          // Tools
          tools: host.tools,
          activeTools: declaredTools,
          // Only removed tools have an entry; their calls come back invalid with an error result.
          experimental_refineToolInput: rejections as any,
          // Providers that reject a wire-level required tool choice (Anthropic, Codex) map it to auto
          // in provider middleware installed by getModel, which names the agent's completionTools as
          // the calls that end the turn; the closing reminder above carries the requirement.
          toolChoice: stepToolChoice as any,
          runtimeContext: parameters as any,
          toolsContext: Object.fromEntries(
            Object.keys(host.tools).map(toolName => [toolName, parameters]),
          ) as any,
          // Output schema for tool as agent
          output: stepOutputSchema ? Output.object({ schema: stepOutputSchema }) : undefined,
          // Stop after one step
          stopWhen: () => true,
          // Events
          onChunk: (args: any) => {
            callback?.OnChunk(args);
          }
        }, stepModel),
        host
      );
      let result: Awaited<ReturnType<typeof request>>;
      try {
        result = await request(messages, previousResponseId);
      } catch (error) {
        if (!compactOnOverflow || host.currentSignal().aborted || !isContextLengthError(error)) throw error;
        // Same prepared configuration, compacted history, and a fresh Codex thread; the span's
        // snapshot becomes the request that was actually retried.
        host.logger.warn(`Context length exceeded for ${agent.name} at step ${stepCount + 1}; compacting and retrying once.`);
        messages = compactOnOverflow(messages);
        compacted = 'overflow';
        stepSpan.setAttributes({ 'step.messages': JSON.stringify(messages), 'step.compacted': compacted });
        result = await request(messages, undefined);
      }

      if (!result || host.currentSignal().aborted) throw new Error("Operation aborted.");
      // Steps are already resolved by streamTextWithConcurrency
      const stepResults = result.steps;
      const stepResponse = stepResults[stepResults.length - 1];

      // The proxy's response id doubles as the next step's Codex continuation selector.
      const responseId = stepModel.provider === 'codex' && typeof stepResponse.response?.id === 'string'
        ? stepResponse.response.id
        : undefined;

      // Record framing (an explicit fact) next to step.messages/step.tools. Set only when
      // the tool-rescue middleware actually ran for this step, meaning a prompt-mode model
      // with tools whose call reached this point. Native/no-tool steps, batch replays
      // (which bypass the middleware), and pre-completion failures leave it unset.
      if (stepToolFraming !== undefined) {
        stepSpan.setAttribute('step.tool_framing', stepToolFraming);
      }

      // Surface provider-executed host calls as retrospective per-tool spans.
      if (isHostCapabilityProvider(stepModel.provider)) {
        const builtinToolSpans = emitProviderExecutedToolSpans(stepModel.provider, stepResponse.content, host.tracer, {
          contextId: host.id,
          turn: parameters.turn,
        });
        if (builtinToolSpans > 0) {
          host.logger.debug(`Emitted ${builtinToolSpans} ${stepModel.provider} built-in tool span(s) for ${agent.name} step ${stepCount + 1}`);
        }
      }

      // Update token usage
      const { inputTokens, cachedInputTokens, reasoningTokens, outputTokens } =
        stepTokenUsage(messages, stepResponse.usage, stepResponse.response.messages);

      // Provider options are request-side detail and only bloat the recorded response.
      stepResponse.response.messages.forEach((response: any) => delete response.providerOptions);

      // Add the step to our collection
      let shouldStop = false;
      let finalText: string | undefined;
      const responseStart = messages.length;

      if (stepResults.length > 0) {
        allSteps.push(...stepResults);
        finalText = stepResponse.text;

        // Clean tool rescue artifacts from response messages
        stripToolArtifacts(stepResponse.response.messages);

        // Update messages with the response
        messages = messages.concat(stepResponse.response.messages);

        // Check stop condition
        shouldStop = host.currentSignal().aborted ||
          agent.stopCheck(parameters, input, stepResponse, allSteps, host);

        host.logger.debug(`Stop check for ${agent.name}: ${shouldStop}`, {
          stepNumber: stepCount + 1,
          totalSteps: allSteps.length
        });
      } else {
        host.logger.warn(`Agent execution produced no steps: ${agent.name} at step ${stepCount + 1}.`);
        shouldStop = host.currentSignal().aborted;
      }

      stepSpan.setAttributes({
        'model': formatModelReference(stepModel),
        'tokens.input': inputTokens,
        'tokens.reasoning': reasoningTokens,
        'tokens.output': outputTokens,
        'step.responses': JSON.stringify(stepResponse.response.messages)
      });
      if (cachedInputTokens !== undefined) stepSpan.setAttribute('tokens.input.cached', cachedInputTokens);
      stepSpan.setAttributes(codexResponseTelemetryAttributes(stepResponse.providerMetadata));

      stepSpan.setAttribute('step.should_stop', shouldStop);
      stepSpan.setStatus({ code: SpanStatusCode.OK });

      return { messages, responseStart, shouldStop, finalText, inputTokens, cachedInputTokens, reasoningTokens, outputTokens, responseId, compacted };
    } catch (error) {
      recordSpanError(stepSpan, error);
      throw error; // Re-throw to be handled by outer try-catch
    } finally {
      stepSpan.end();
    }
  });
}
