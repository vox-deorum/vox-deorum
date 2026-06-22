/**
 * @module telepathist/summarizer
 *
 * General-purpose summarization agent for the telepathist system.
 * Handles all summarization needs: tool result focusing, turn summaries,
 * and phase summaries — driven by a flexible instruction parameter.
 * Replaces the previous TurnSummarizer and PhaseSummarizer agents.
 */

import { createHash } from 'node:crypto';
import { VoxAgent } from '../infra/vox-agent.js';
import { TelepathistParameters } from './telepathist-parameters.js';
import { VoxContext } from '../infra/vox-context.js';
import { createLogger } from '../utils/logger.js';
import { getModelConfig } from '../utils/models/models.js';

/**
 * Shared historian guidelines reused across summarization instructions.
 * Both the Summarizer's system prompt and caller-built instructions
 * reference these to maintain consistent tone and quality.
 */
export const summarizerGuidelines = `- Write in past tense from an archivist's perspective, not the leader's.
- Mention specific civilizations, cities, technologies, and policies by name.
- The history happened in a generated world, and the geography had nothing to do with the real Earth.
- ALWAYS follow the guidelines, including overall and for each heading.
- Carefully distinguish between what is truth (game state) and what is perception of the leader.
  - "Rationale" under the Options heading reflects the leader's perspective and can deviate from the reality.
  - "RelayedMessage" type of events reflects the intelligence gathered by the government and can be incorrect.`.trim();

/**
 * Input for the Summarizer agent.
 * The instruction drives the summarization behavior — from tool result
 * focusing to structured turn summaries to narrative phase summaries.
 */
export interface SummarizerInput {
  /** The raw text data to summarize */
  text: string;
  /** What to focus on and how to format the output */
  instruction: string;
  /** Optional reminder appended after the data to reinforce key instructions over long contexts */
  reminder?: string;
}

/**
 * Builds the instruction for tool result summarization.
 * Focuses the summary on the user's inquiry if provided.
 */
export function buildToolSummaryInstruction(toolName: string, inquiry?: string): string {
  if (inquiry) {
    return `
- Accurately summarize the following ${toolName} data based on available raw information. NEVER make up facts.
- Focus on preserving key details (turn numbers, names, numerical values) and/or exact quotes most relevant to the inquiry, NOT providing analysis yourself.
- Do not presume the inquiry to be factually true. Push back when the raw data does not fit its narrative.

# Inquiry Focus
${inquiry}`;
  }
  return `Summarize the following ${toolName} data, preserving the most important information. Focus on significant events, decisions, and state changes. Keep specifics (turn numbers, names, values) but compress verbose sections.`;
}

/**
 * General-purpose summarization agent.
 * Driven by an instruction parameter that controls output format and focus.
 * No outputSchema — returns text by default; callers parse structured output when needed.
 */
export class Summarizer extends VoxAgent<TelepathistParameters, SummarizerInput, string> {
  readonly name = 'summarizer';
  readonly description = 'General-purpose summarizer for historical data';

  public async getSystem(
    params: TelepathistParameters,
    _input: SummarizerInput,
    _context: VoxContext<TelepathistParameters>
  ): Promise<string> {
    return `You are a senior archivist looking at a Civilization V game played by ${params.leaderName} of ${params.civilizationName}.

# Guidelines
${summarizerGuidelines}`.trim();
  }

  public async getInitialMessages(
    _params: TelepathistParameters,
    input: SummarizerInput,
    _context: VoxContext<TelepathistParameters>
  ) {
    const dataSection = input.text.startsWith('#') ? input.text : `# Data\n${input.text}`;
    const content = input.reminder
      ? `# Task\n${input.instruction}\n\n${dataSection}\n\n# Reminder\n${input.reminder}`
      : `# Task\n${input.instruction}\n\n${dataSection}`;
    return [{
      role: 'user' as const,
      content
    }];
  }
}

const cacheLogger = createLogger('SummarizerCache');

/** Generates a SHA-256 cache key from the summarizer input text and instruction. */
function computeCacheKey(text: string, instruction: string, reminder?: string): string {
  const hash = createHash('sha256')
    .update(text)
    .update(instruction);
  if (reminder) hash.update(reminder);
  return hash.digest('hex');
}

/**
 * Summarizes text using the Summarizer agent, with database-backed caching.
 * Checks the summary_cache table before invoking the LLM. On cache miss,
 * calls the summarizer agent and persists the result.
 */
export async function summarizeWithCache(
  input: SummarizerInput,
  params: TelepathistParameters,
  context: VoxContext<TelepathistParameters>
): Promise<string | undefined> {
  const cacheKey = computeCacheKey(input.text, input.instruction, input.reminder);

  const cached = await params.telepathistDb
    .selectFrom('summary_cache')
    .select('result')
    .where('cacheKey', '=', cacheKey)
    .executeTakeFirst();

  if (cached) {
    cacheLogger.debug('Summary cache hit', { cacheKey: cacheKey.substring(0, 12) });
    return cached.result;
  }

  cacheLogger.debug('Summary cache miss, invoking summarizer', { cacheKey: cacheKey.substring(0, 12) });
  const result = await context.callAgent<string>('summarizer', input);

  if (result) {
    await params.telepathistDb
      .insertInto('summary_cache')
      .values({
        cacheKey,
        result,
        model: getModelConfig('summarizer', undefined, context.modelOverrides).name,
        createdAt: Date.now()
      })
      .onConflict((oc) => oc.column('cacheKey').doNothing())
      .execute();
  }

  return result;
}
