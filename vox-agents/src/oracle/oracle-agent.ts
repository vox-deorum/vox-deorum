/**
 * @module oracle/oracle-agent
 *
 * OracleAgent -- a VoxAgent subclass that replays a past agent turn with a (possibly modified) prompt.
 * The LLM sees the original conversation and tools but nothing executes against MCP.
 * Used for counterfactual analysis: "what would the LLM have decided with a different prompt?"
 */

import { Tool, StepResult, ModelMessage } from 'ai';
import { VoxAgent } from '../infra/vox-agent.js';
import type { VoxContext } from '../infra/vox-context.js';
import type { Model } from '../types/index.js';
import type { OracleParameters, OracleInput, ReplayResult, ReplayDecision } from './types.js';

/**
 * Oracle agent that replays prompts through an LLM for counterfactual analysis.
 * Stop behavior adapts to the agent type being replayed.
 */
export class OracleAgent extends VoxAgent<OracleParameters, OracleInput, ReplayResult> {
  readonly name = 'oracle';
  readonly description = 'Replays past agent turns with modified prompts for counterfactual analysis.';

  /** Let the LLM decide whether to call tools */
  public override toolChoice = 'auto';
  public override requiredTools = ['set-strategy', 'set-flavors', 'keep-status-quo'];
  public override maxSteps = 5;

  /**
   * Disable the requiredTools-derived nudge: Oracle replays the originally recorded prompt
   * verbatim, so injecting an unrecorded reminder on a continuation step would diverge the
   * replayed conversation from what the original agent saw and bias the counterfactual.
   */
  public override continuationNudge(): undefined {
    return undefined;
  }

  /** Return the pre-resolved model from parameters */
  public override getModel(parameters: OracleParameters, _input: OracleInput, _overrides: Record<string, Model | string>): Model {
    return parameters.resolvedModel;
  }

  /** Return the (possibly modified) system prompt from the input, joining array parts */
  public async getSystem(parameters: OracleParameters, input: OracleInput, _context: VoxContext<OracleParameters>): Promise<string> {
    return input.system.join('\n');
  }

  /** Return the non-system messages from the original conversation (possibly modified) */
  public override async getInitialMessages(
    _parameters: OracleParameters,
    input: OracleInput,
    _context: VoxContext<OracleParameters>
  ): Promise<ModelMessage[]> {
    return input.messages;
  }

  /** Return the active tool set from the original span */
  public override getActiveTools(parameters: OracleParameters): string[] | undefined {
    return parameters.activeTools.length > 0 ? parameters.activeTools : undefined;
  }

  /**
   * Stop check that adapts to the agent type being replayed.
   * - Strategist: stop when a decision tool call is found (multi-step, up to 5 steps)
   * - Other: stop after one step
   */
  public override stopCheck(
    parameters: OracleParameters,
    _input: OracleInput,
    lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    _context: VoxContext<OracleParameters>
  ): boolean {
    parameters.capturedSteps.push(lastStep);

    if (!parameters.agentType || parameters.agentType?.includes('strategist')) {
      return super.stopCheck(parameters, _input, lastStep, allSteps, _context);
    }

    // Default: stop after one step
    return true;
  }

  /** Build the ReplayResult from captured steps */
  public override async getOutput(
    parameters: OracleParameters,
    input: OracleInput,
    _finalText: string,
    _context: VoxContext<OracleParameters>
  ): Promise<ReplayResult | undefined> {
    // Collect all tool calls as ReplayDecisions
    const decisions: ReplayDecision[] = [];
    for (const step of parameters.capturedSteps) {
      for (const tc of step.toolCalls) {
        const decision: ReplayDecision = {
          toolName: tc.toolName,
          args: { ...(tc as any).input },
        };

        // Extract Rationale from strategist decision tool args
        if (this.requiredTools!.includes(tc.toolName) && decision.args.Rationale) {
          decision.rationale = decision.args.Rationale as string;
          delete decision.args.Rationale;
        }

        decisions.push(decision);
      }
    }

    // Collect raw response messages from all steps
    const messages: ModelMessage[] = [];
    for (const step of parameters.capturedSteps) {
      messages.push(...step.response.messages);
    }

    return {
      row: input.row,
      model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
      decisions,
      // Placeholder — replayRow() overrides with VoxContext's nuanced token counts
      tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
      messages,
      metadata: input.metadata,
    };
  }
}
