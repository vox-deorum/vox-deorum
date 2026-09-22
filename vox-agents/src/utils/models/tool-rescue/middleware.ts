/**
 * @module utils/models/tool-rescue/middleware
 *
 * AI SDK middleware that wires the prompt-shaping and text-extraction halves together. In `prompt`
 * mode it injects a JSON-format instruction before the model runs; on the way out it inspects text
 * content and rescues any JSON tool calls the model emitted instead of using native tool-calling.
 *
 * Under `structuredToolCalls` (the claude-code constrained-decoding path) the CLI strictly validates
 * each forced-tool attempt and retries a rejected one within the same response, so separate text
 * blocks are competing ATTEMPTS at one output rather than independent calls. In that mode the rescue
 * is last-attempt-wins: only the final call-yielding attempt is committed. Free-text prompt mode
 * keeps its original semantics, where every text-authored call survives (repeats included).
 *
 * This module is only the assembly. Each hook's work lives beside it:
 *
 * - `./transform-params.ts` — teach the contour, take the native tools away
 * - `./generate.ts` — rescue from a finished response
 * - `./stream.ts` — rescue from a response still arriving
 * - `./recovery.ts` — the rules the two outbound halves must agree on
 * - `./tool-input-stream.ts` — forward a whitelisted tool's arguments live
 */

import { type LanguageModelMiddleware } from 'ai';
import { createLogger } from '../../logger.js';
import type { ToolRescueOptions } from './types.js';
import { transformRescueParams } from './transform-params.js';
import { rescueGenerateResult } from './generate.js';
import { createRescueTransform } from './stream.js';
import { preserveModelError } from '../preserved-model-error.js';

const logger = createLogger("tool-rescue");

/**
 * Creates a tool rescue middleware for language models.
 * This middleware intercepts generate operations to detect and transform
 * JSON tool calls embedded in text responses into proper tool-call format.
 *
 * @param options Configuration options
 * @returns A LanguageModelMiddleware that handles tool rescue
 */
export function toolRescueMiddleware(options?: ToolRescueOptions): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4' as const,

    transformParams: async ({ params }) => transformRescueParams(params, options),

    wrapGenerate: async ({ doGenerate, params }) => {
      try {
        // Execute the generation (params were already transformed if needed)
        return rescueGenerateResult(await doGenerate(), params);
      } catch (error) {
        // Re-throw the error to let the retry mechanism handle it
        logger.error("Error in wrapGenerate middleware, passing down");
        // Preserve context length errors so they survive the AI SDK's error wrapping
        preserveModelError(params, error);
        throw error;
      }
    },

    wrapStream: async ({ doStream, params }) => {
      try {
        const { stream, ...rest } = await doStream();
        params.tools = params.tools ?? (params as any).originalTools;

        // If we don't have tools, just pass through the stream
        if (!params.tools || params.tools.length === 0) {
          return { stream, ...rest };
        }

        return {
          stream: stream.pipeThrough(createRescueTransform(params, options)),
          ...rest,
        };
      } catch (error) {
        // Re-throw the error to let the retry mechanism handle it
        logger.error("Error in wrapStream middleware, passing down");
        // Preserve context length errors so they survive the AI SDK's error wrapping
        preserveModelError(params, error);
        throw error;
      }
    }
  };
}
