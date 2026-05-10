/**
 * @module telepathist/tools/get-decision
 *
 * Telepathist tool for retrieving AI decisions and reasoning.
 * Default mode: reads pre-generated decisions from turn_summaries (fast DB read).
 * Detailed mode: executes raw span traversal from telemetry + summarizer.
 */

import { z } from 'zod';
import { TelepathistTool, inquiryField } from '../telepathist-tool.js';
import { TelepathistParameters } from '../telepathist-parameters.js';
import type { Span } from '../../utils/telemetry/schema.js';
import { jsonToMarkdown } from '../../utils/tools/json-to-markdown.js';
import { cleanToolArtifacts } from '../../utils/models/text-cleaning.js';
import { agentRegistry } from '../../infra/agent-registry.js';

/** Decision tools whose inputs contain the AI's strategic choices */
const decisionTools = [
  'set-strategy',
  'set-research',
  'set-policy',
  'set-flavors',
  'set-persona',
  'set-relationship',
  'keep-status-quo',
  'relay-message',
];

/** Static keys in Options that are identical across turns and should be consolidated */
const consolidatedOptionKeys = ['GrandStrategies', 'Flavors'];

const inputSchema = z.object({
  Turns: z.string().describe(
    'Turn(s) to retrieve decisions for. Single ("30"), comma-separated ("10,20,30"), or range ("30-39"). No more than 10 turns at a time.'
  ),
  Detailed: z.boolean().optional().describe(
    'If true, executes raw span traversal for full decision data instead of reading pre-generated summaries. Use for deep analysis.'
  ),
  ...inquiryField
});

type GetDecisionInput = z.infer<typeof inputSchema>;

/**
 * Retrieves AI decisions and reasoning for specific turns.
 * Default: reads pre-generated decision summaries from the DB.
 * Detailed: extracts full decision data from telemetry spans.
 */
export class GetDecisionTool extends TelepathistTool<GetDecisionInput> {
  readonly name = 'get-decision';
  readonly description = 'Get AI decisions and reasoning for specific turns. Returns pre-generated summaries by default; use Detailed mode for full decision data with agents involved, options available, and reasoning.';
  readonly inputSchema = inputSchema;

  async execute(input: GetDecisionInput, params: TelepathistParameters): Promise<string[]> {
    // Dynamically set summarize based on Detailed mode
    this.summarize = !!input.Detailed;

    if (input.Detailed) {
      return this.executeDetailed(input, params);
    }
    return this.executeDefault(input, params);
  }

  /** Default mode: read pre-generated decisions from turn_summaries DB, falling back to detailed mode for missing turns */
  private async executeDefault(input: GetDecisionInput, params: TelepathistParameters): Promise<string[]> {
    return this.executeDefaultFromSummaries(
      input.Turns, params.availableTurns, params, 'decisions',
      (fallbackInput, p) => this.executeDetailed(fallbackInput, p),
      (missing) => ({ Turns: missing.join(','), Inquiry: input.Inquiry })
    );
  }

  /** Detailed mode: extract full decision data from telemetry spans */
  private async executeDetailed(input: GetDecisionInput, params: TelepathistParameters): Promise<string[]> {
    const turns = this.parseTurns(input.Turns, params.availableTurns);
    if (turns.length === 0) {
      return ['No turns found in the requested range.'];
    }

    const sections: string[] = [];

    const multiTurn = turns.length > 1;
    let hasConsolidated = false;
    if (multiTurn) {
      const refSection = await this.buildReferenceSection(params, turns);
      if (refSection) {
        sections.push(refSection);
        hasConsolidated = true;
      }
    }

    for (const turn of turns) {
      const turnSections: string[] = [];
      turnSections.push(`# Turn ${turn}`);

      const { turnRoots, agents } = await this.getRootSpans(params.db, [turn]);

      if (Object.keys(agents).length === 0) {
        turnSections.push('*No agent executions found for this turn.*');
        sections.push(turnSections.join('\n'));
        continue;
      }

      const turnRoot = turnRoots.get(turn);
      await this.addOptionsSection(params, turn, turnRoot, agents, turnSections, hasConsolidated ? consolidatedOptionKeys : []);

      await this.addAgentsSection(params, agents, turnSections);

      for (const [agentName, agentSpans] of Object.entries(agents)) {
        if (!agentRegistry.has(agentName)) continue;

        const stepSpans = await this.getStepsForAgent(params, agentSpans);
        if (stepSpans.length === 0) continue;

        if (agentName.indexOf("strategist") !== -1 && input.Detailed) {
          const reasoning = this.extractReasoning(stepSpans);
          if (reasoning) {
            turnSections.push(`## ${agentName} Reasoning`);
            turnSections.push(reasoning);
          }
        }

        const decisions = await this.extractDecisions(params, stepSpans);
        if (decisions.length > 0) {
          turnSections.push(`## ${agentName} Decisions`);
          turnSections.push(...decisions);
        }
      }

      sections.push(cleanToolArtifacts(turnSections.join('\n\n')));
    }

    return sections;
  }

  /**
   * Build a reference section with static Options data (GrandStrategies, Flavors)
   * by reading the first available get-options output across requested turns.
   */
  private async buildReferenceSection(
    params: TelepathistParameters,
    turns: number[]
  ): Promise<string | null> {
    for (const turn of turns) {
      const { turnRoots, agents } = await this.getRootSpans(params.db, [turn]);
      const traceIds = this.collectTraceIds(turnRoots.get(turn), agents);
      if (traceIds.size === 0) continue;

      const optionSpans = await params.db
        .selectFrom('spans')
        .selectAll()
        .where('turn', '=', turn)
        .where('name', '=', 'mcp-tool.get-options')
        .where('traceId', 'in', [...traceIds])
        .orderBy('startTime', 'desc')
        .limit(1)
        .execute();

      if (optionSpans.length === 0) continue;

      const output = this.getToolOutput(optionSpans[0]);
      if (!output?.Options) continue;

      const refParts: string[] = ['# Reference Data'];
      for (const key of consolidatedOptionKeys) {
        if (output.Options[key]) {
          refParts.push(`## ${key}`);
          refParts.push(this.formatToolOutput('get-options', { [key]: output.Options[key] }));
        }
      }

      return refParts.length > 1 ? refParts.join('\n\n') : null;
    }

    return null;
  }

  /** Add get-options output to the turn sections, optionally stripping consolidated keys */
  private async addOptionsSection(
    params: TelepathistParameters,
    turn: number,
    turnRoot: Span | undefined,
    agents: Record<string, Span[]>,
    turnSections: string[],
    stripKeys: string[]
  ): Promise<void> {
    const traceIds = this.collectTraceIds(turnRoot, agents);
    if (traceIds.size === 0) return;

    const optionSpans = await params.db
      .selectFrom('spans')
      .selectAll()
      .where('turn', '=', turn)
      .where('name', '=', 'mcp-tool.get-options')
      .where('traceId', 'in', [...traceIds])
      .orderBy('startTime', 'desc')
      .limit(1)
      .execute();

    if (optionSpans.length > 0) {
      const output = this.getToolOutput(optionSpans[0]);
      if (output) {
        if (stripKeys.length > 0 && output.Options) {
          for (const key of stripKeys) {
            delete output.Options[key];
          }
        }
        turnSections.push(this.formatToolOutput('get-options', output));
      }
    }
  }

  /** Collect valid traceIds from turn root and agent spans */
  private collectTraceIds(turnRoot: Span | undefined, agents: Record<string, Span[]>): Set<string> {
    const traceIds = new Set<string>();
    if (turnRoot) traceIds.add(turnRoot.traceId);
    for (const spans of Object.values(agents)) {
      for (const span of spans) {
        traceIds.add(span.traceId);
      }
    }
    return traceIds;
  }

  /**
   * Build hierarchical agents-involved section by examining each agent's subspans
   * for agent-tool calls (subagent invocations).
   */
  private async addAgentsSection(
    params: TelepathistParameters,
    agents: Record<string, Span[]>,
    turnSections: string[]
  ): Promise<void> {
    turnSections.push('## Agents Involved');

    for (const [agentName, agentSpans] of Object.entries(agents)) {
      const agent = agentRegistry.get(agentName);
      if (!agent) continue;
      turnSections.push(`- **${agentName}**: ${agent.description}`);

      const stepSpans = await this.getStepsForAgent(params, agentSpans);
      if (stepSpans.length === 0) continue;

      const stepIds = stepSpans.map(s => s.spanId);
      const agentToolSpans = await params.db
        .selectFrom('spans')
        .selectAll()
        .where('parentSpanId', 'in', stepIds)
        .where('name', 'like', 'agent.%')
        .orderBy('startTime', 'asc')
        .execute();

      for (const toolSpan of agentToolSpans) {
        const subagentName = toolSpan.name.replace('agent.', '');
        if (!agentRegistry.has(subagentName)) continue;
        const toolInput = this.getToolInput(toolSpan);
        const mode = toolInput?.mode || toolInput?.Mode || '';
        const label = mode ? `**${subagentName}** (${mode})` : `**${subagentName}**`;
        turnSections.push(`  - Called ${label}`);
      }
    }
  }

  /** Get step spans that are children of the given agent spans */
  private async getStepsForAgent(
    params: TelepathistParameters,
    agentSpans: Span[]
  ): Promise<Span[]> {
    const parentIds = agentSpans.map(s => s.spanId);
    return params.db
      .selectFrom('spans')
      .selectAll()
      .where('parentSpanId', 'in', parentIds)
      .orderBy('startTime', 'asc')
      .execute();
  }

  /** Extract reasoning text from step span responses */
  private extractReasoning(stepSpans: Span[]): string | undefined {
    const reasoningParts: string[] = [];

    for (const step of stepSpans) {
      const attrs = this.parseAttributes(step);
      const responses = attrs['step.responses'];
      if (!responses) continue;

      try {
        const parsed = JSON.parse(responses);
        if (!Array.isArray(parsed)) return undefined;
        for (const msg of parsed) {
          if (msg.role !== 'assistant') continue;
          if (typeof msg.content === 'string' && msg.content.trim()) {
            reasoningParts.push(msg.content.trim());
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === 'text' && part.text?.trim()) {
                reasoningParts.push(part.text.trim());
              } else if (part.type === 'reasoning' && part.text?.trim()) {
                reasoningParts.push(`*[Reasoning]: ${part.text.trim()}*`);
              }
            }
          }
        }
      } catch {
        // Skip unparseable responses
      }
    }

    return reasoningParts.length > 0 ? reasoningParts.join('\n\n') : undefined;
  }

  /** Extract decision tool calls from step spans */
  private async extractDecisions(
    params: TelepathistParameters,
    stepSpans: Span[]
  ): Promise<string[]> {
    const parentIds = stepSpans.map(s => s.spanId);

    const toolCalls = await params.db
      .selectFrom('spans')
      .selectAll()
      .where('parentSpanId', 'in', parentIds)
      .orderBy('startTime', 'asc')
      .execute();

    const decisions: string[] = [];

    for (const span of toolCalls) {
      const toolName = span.name.replace(/^(mcp-tool\.|simple-tool\.)/, '');

      if (decisionTools.includes(toolName)) {
        // Skip decisions that errored (no impact on game)
        if (span.statusCode === 2) continue;

        const input = this.getToolInput(span);
        if (input) {
          const details = { ...input };
          delete details.Rationale;
          delete details.PlayerID;

          const parts: string[] = [`### ${toolName}`];
          if (input.Rationale) parts.push(`**Rationale**: ${input.Rationale.replaceAll("in-game AI", "staff member")}`);

          if (Object.keys(details).length > 0)
            parts.push(jsonToMarkdown(details, { startingLevel: 4 }));

          decisions.push(parts.join('\n'));
        }
      }
    }

    return decisions;
  }
}
