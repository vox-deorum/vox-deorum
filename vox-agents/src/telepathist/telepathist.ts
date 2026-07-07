/**
 * @module telepathist/telepathist
 *
 * Base Telepathist agent that reads from telemetry databases.
 * Extends Envoy<TelepathistParameters> to reuse chat infrastructure.
 * Delegates session initialization (batch summarization) to the preparation module
 * and provides database-backed context instead of live game state.
 */

import { ModelMessage, StepResult, Tool } from 'ai';
import { Envoy } from '../envoy/envoy.js';
import { TelepathistParameters } from './telepathist-parameters.js';
import { TelepathistTool } from './telepathist-tool.js';
import { GetSituationTool } from './tools/get-situation.js';
import { GetDecisionTool } from './tools/get-decision.js';
import { GetConversationLogTool } from './tools/get-conversation-log.js';
import { runPreparation } from './preparation/index.js';
import { EnvoyThread } from '../types/index.js';
import { VoxContext } from '../infra/vox-context.js';
import { createLogger } from '../utils/logger.js';
import { getValidCalls, hasOnlyTerminalCalls } from '../utils/tools/terminal-tools.js';

const logger = createLogger('Telepathist');

/**
 * All available telepathist tool instances
 */
const toolInstances: TelepathistTool[] = [
  new GetSituationTool(),
  new GetDecisionTool(),
  new GetConversationLogTool(),
];

/**
 * Base Telepathist agent for database-backed conversations.
 * Subclasses specialize the persona and behavior.
 *
 * @abstract
 */
export abstract class Telepathist extends Envoy<TelepathistParameters> {
  /** Allow the LLM to decide when to call tools */
  public override toolChoice: string = 'auto';

  /** Telepathist doesn't use turn markers in conversation history */
  protected override includeTurnPrefix: boolean = false;

  /**
   * Provides the telepathist tools to the context.
   */
  public override getExtraTools(context: VoxContext<TelepathistParameters>): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    for (const instance of toolInstances) {
      tools[instance.name] = instance.createTool(context);
    }
    return tools;
  }

  /**
   * Returns tool names available to this agent
   */
  public override getActiveTools(_parameters: TelepathistParameters): string[] | undefined {
    return toolInstances.map(t => t.name);
  }

  /**
   * Orchestrates initial messages with special message support. The always-present hint
   * anchors identity and data span in both modes; an add-on follows it — the special
   * message's prompt in special mode, or the agent's default nudge in normal mode.
   * The {{{Initialize}}} token additionally runs batch summarization before assembling context.
   */
  public async getInitialMessages(
    parameters: TelepathistParameters,
    input: EnvoyThread,
    context: VoxContext<TelepathistParameters>
  ): Promise<ModelMessage[]> {
    const specialConfig = this.findLastSpecialMessage(input);
    let messages = await this.getContextMessages(parameters, input);

    if (specialConfig && this.isInitializeMessage(input)) {
      await runPreparation(parameters, context);
      // Re-fetch context messages since we may have generated summaries
      messages = await this.getContextMessages(parameters, input);
    }

    const addon = specialConfig ?? this.getDefaultAddon(parameters, input);
    if (!specialConfig) {
      // Normal mode: include conversation history before the hint
      messages.push(...this.convertToModelMessages(
        this.filterSpecialMessages(input.messages)
      ));
    }
    messages.push({
      role: 'user',
      content: `${this.getHint(parameters, input)} ${addon}`.trim()
    });

    return messages;
  }

  /**
   * Determines whether the agent should stop execution.
   * Called after each step to check if the generation should continue.
   *
   * @param parameters - The execution parameters
   * @param lastStep - The most recent step result
   * @param allSteps - All steps executed so far
   * @param context - The VoxContext for looking up tool metadata
   * @returns True if the agent should stop, false to continue
   */
  public stopCheck(
    parameters: TelepathistParameters,
    input: EnvoyThread,
    lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    context: VoxContext<TelepathistParameters>
  ): boolean {
    // Add response messages to thread via Envoy.stopCheck (result ignored — custom logic below)
    super.stopCheck(parameters, input, lastStep, allSteps, context);

    // Telepathist-specific stop conditions (50-step limit vs default 3)
    if (getValidCalls(lastStep).length === 0 && !lastStep.text?.trim()) {
      return allSteps.length >= 50;
    }
    if (hasOnlyTerminalCalls(lastStep, context.mcpToolMap)) {
      return true;
    }
    return allSteps.length >= 50;
  }

  /** Telepathist runs at the high reasoning tier. */
  protected modelTier = "high" as const;

  /**
   * Disables tools when in special message mode.
   */
  public override async prepareStep(
    parameters: TelepathistParameters,
    input: EnvoyThread,
    lastStep: StepResult<Record<string, Tool>> | null,
    allSteps: StepResult<Record<string, Tool>>[],
    messages: ModelMessage[],
    context: VoxContext<TelepathistParameters>
  ) {
    const config = await super.prepareStep(parameters, input, lastStep, allSteps, messages, context);
    if (this.isSpecialMode(input)) {
      config.activeTools = [];
    }
    return config;
  }

  // --- Special message handling ---

  /** Checks if the last message is the {{{Initialize}}} message */
  private isInitializeMessage(input: EnvoyThread): boolean {
    if (input.messages.length === 0) return false;
    const last = input.messages[input.messages.length - 1];
    return typeof last.message.content === 'string' && last.message.content === '{{{Initialize}}}';
  }

  // --- Database context assembly ---

  /**
   * Returns context messages: player identity + phase narrative summaries.
   * Always available to the LLM as system context.
   */
  protected async getContextMessages(
    parameters: TelepathistParameters,
    input: EnvoyThread
  ): Promise<ModelMessage[]> {
    // Build phase summaries section using narrative field only
    const phaseSummaries = await parameters.telepathistDb
      .selectFrom('phase_summaries')
      .selectAll()
      .orderBy('fromTurn', 'asc')
      .execute();

    let phaseSummaryText = '';
    if (phaseSummaries.length > 0) {
      const parts = phaseSummaries.map(
        ps => `### Turns ${ps.fromTurn}-${ps.toTurn}\n${ps.narrative}`
      );
      phaseSummaryText = `\n\n# Game Summary\n${parts.join('\n\n')}`;
    }

    const turnRange = parameters.availableTurns.length > 0
      ? `Turns ${parameters.availableTurns[0]} to ${parameters.availableTurns[parameters.availableTurns.length - 1]}`
      : 'No turns available';

    const { name, leader } = this.getSelfIdentity(input);
    return [{
      role: 'system',
      content: `# Player Identity
- **Civilization**: ${name}
- **Leader**: ${leader}
- **Available Data**: ${turnRange} (${parameters.availableTurns.length} turns)${phaseSummaryText}`.trim()
    }];
  }

  // --- Abstract methods ---

  /**
   * Returns a contextual hint anchoring the LLM on its role and audience.
   */
  protected abstract getHint(parameters: TelepathistParameters, input: EnvoyThread): string;
}
