/**
 * @module telepathist/tools/get-situation
 *
 * Telepathist tool for retrieving world state information.
 * Default mode: reads pre-generated situation from turn_summaries (fast DB read).
 * Detailed mode: executes raw span traversal from telemetry + summarizer.
 */

import { z } from 'zod';
import { TelepathistTool, inquiryField } from '../telepathist-tool.js';
import { TelepathistParameters } from '../telepathist-parameters.js';
import { cleanToolArtifacts } from '../../agents/models/text-cleaning.js';

/** Maps category names to MCP tools and display labels. */
const categoryRegistry = new Map([
  ['players', { toolName: 'get-players', label: 'Players' }],
  ['victory', { toolName: 'get-victory-progress', label: 'Victory Progress' }],
  ['options', { toolName: 'get-options', label: 'Options' }],
  ['military', { toolName: 'get-military-report', label: 'Military' }],
  ['cities', { toolName: 'get-cities', label: 'Cities' }],
  ['events', { toolName: 'get-events', label: 'Events' }],
] as const);

export const situationCategories = [...categoryRegistry.keys()] as const;
type SituationCategory = (typeof situationCategories)[number];

/** Check whether a category supplied to the chat tool is registered. */
function isSituationCategory(category: string): category is SituationCategory {
  return situationCategories.some(key => key === category);
}

const inputSchema = z.object({
  Turns: z.string().describe(
    'Turn(s) to retrieve situation for. Single ("30"), comma-separated ("10,20,30"), or range ("30-34"). No more than 5 turns at a time.'
  ),
  Detailed: z.boolean().optional().describe(
    'If true, executes raw span traversal for full game data instead of reading pre-generated summaries. Use for ground truth verification.'
  ),
  Categories: z.array(z.string()).optional().describe(
    `Optional filter for specific data categories (only in Detailed mode): ${situationCategories.join(', ')}. If omitted, returns all available data.`
  ),
  ...inquiryField
});

type GetSituationInput = z.infer<typeof inputSchema>;

/**
 * Retrieves world state information for specific turns.
 * Default: reads pre-generated situation summaries from the DB.
 * Detailed: reconstructs actual game data from MCP tool output spans.
 */
export class GetSituationTool extends TelepathistTool<GetSituationInput> {
  readonly name = 'get-situation';
  readonly description = 'Get the world state / situation for specific turns. Returns pre-generated summaries by default; use Detailed mode for raw game data.';
  readonly inputSchema = inputSchema;

  /** Select the requested mode and tell the chat wrapper whether to summarize its result. */
  async execute(input: GetSituationInput, params: TelepathistParameters): Promise<string[]> {
    // Dynamically set summarize based on Detailed mode
    this.summarize = !!input.Detailed;

    if (input.Detailed) {
      return this.executeDetailed(input, params);
    }
    return this.executeDefault(input, params);
  }

  /** Default mode: read pre-generated situation from turn_summaries DB, falling back to detailed mode for missing turns */
  private async executeDefault(input: GetSituationInput, params: TelepathistParameters): Promise<string[]> {
    return this.executeDefaultFromSummaries(
      input.Turns, params.availableTurns, params, 'situation',
      (fallbackInput, p) => this.executeDetailed(fallbackInput, p),
      (missing) => ({ Turns: missing.join(','), Detailed: true, Categories: input.Categories, Inquiry: input.Inquiry })
    );
  }

  /** Detailed mode: reconstruct actual game data from MCP tool output spans */
  private async executeDetailed(input: GetSituationInput, params: TelepathistParameters): Promise<string[]> {
    const turns = this.parseTurns(input.Turns, params.availableTurns, 5);
    if (turns.length === 0) {
      return ['No turns found in the requested range.'];
    }

    const requestedCategories = input.Categories && input.Categories.length > 0
      ? input.Categories.filter(isSituationCategory)
      : situationCategories;

    if (requestedCategories.length === 0) {
      return [`Invalid categories. Available: ${situationCategories.join(', ')}`];
    }

    const sections: string[] = [];

    for (const turn of turns) {
      const { text } = await this.readDetailedTurn(turn, params, requestedCategories);
      sections.push(text);
    }
    return sections;
  }

  /** Read one recorded turn for the given categories without going through the summarizer. */
  async readDetailedTurn(
    turn: number,
    params: TelepathistParameters,
    categories: readonly SituationCategory[]
  ): Promise<{ text: string; hasGameState: boolean }> {
    const turnSections = [`# Turn ${turn}`];
    const { turnRoots, agents } = await this.getRootSpans(params.db, [turn]);

    const validTraceIds = new Set<string>();
    const turnRoot = turnRoots.get(turn);
    if (turnRoot) validTraceIds.add(turnRoot.traceId);
    for (const agentSpans of Object.values(agents)) {
      for (const span of agentSpans) {
        validTraceIds.add(span.traceId);
      }
    }

    if (validTraceIds.size === 0) {
      turnSections.push('*No valid agent executions found for this turn.*');
      return { text: turnSections.join('\n'), hasGameState: false };
    }

    for (const category of categories) {
      const { toolName, label } = categoryRegistry.get(category)!;
      const mcpSpanName = `mcp-tool.${toolName}`;

      const toolSpans = await params.db
        .selectFrom('spans')
        .selectAll()
        .where('turn', '=', turn)
        .where('name', '=', mcpSpanName)
        .where('traceId', 'in', [...validTraceIds])
        .orderBy('startTime', 'desc')
        .limit(1)
        .execute();

      if (toolSpans.length > 0) {
        const output = this.getToolOutput(toolSpans[0]);
        if (output) {
          turnSections.push(`## ${label}`);
          turnSections.push(this.formatToolOutput(toolName, output));
        }
      }
    }

    const hasGameState = turnSections.length > 1;
    if (!hasGameState) {
      turnSections.push('*No game state data found for this turn.*');
    }
    return { text: cleanToolArtifacts(turnSections.join('\n')), hasGameState };
  }
}
