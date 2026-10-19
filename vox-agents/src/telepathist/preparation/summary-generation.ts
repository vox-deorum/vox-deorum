/**
 * @module telepathist/preparation/summary-generation
 *
 * Shared summarizer invocation, markdown parsing, and retry policy for turn and phase summaries.
 */

import type { SummarizerInput } from '../summarizer.js';
import type { VoxContext } from '../../infra/vox-context.js';
import { exponentialRetry } from '../../utils/retry.js';
import { parseSummaryMarkdown } from './instructions.js';
import { z } from 'zod';
import type { TelepathistParameters } from '../telepathist-parameters.js';
import type { Logger } from 'winston';

/**
 * Generate and parse one summary, retrying unusable output up to 10 times. Resolves undefined
 * when the input exceeds the summarizer's context window, which no retry can fix.
 *
 * @param label - Identifies the summary in retry logs and errors, e.g. `turn-12`
 */
export async function generateSummary<T>(
  context: VoxContext<TelepathistParameters>,
  input: SummarizerInput,
  schema: z.ZodType<T>,
  logger: Logger,
  label: string
): Promise<T | undefined> {
  let formatFailures = 0;
  let contextExceeded = false;
  return exponentialRetry(async () => {
    const rawSummary = await context.callAgent<string>('summarizer', input, () => { contextExceeded = true; });
    if (contextExceeded) return undefined;
    const parsed = rawSummary ? parseSummaryMarkdown(rawSummary, schema) : undefined;
    if (!parsed) {
      formatFailures++;
      const error = new Error(`Summarizer returned no usable result for ${label} (format failure ${formatFailures}/10): ${rawSummary}`);
      if (formatFailures >= 10) (error as Error & { isRetryable: boolean }).isRetryable = false;
      throw error;
    }
    return parsed;
  }, logger, { source: label });
}
