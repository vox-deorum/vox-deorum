/**
 * @module utils/models/tool-rescue/tool-input-stream
 *
 * Forwards a whitelisted tool's arguments while the model is still writing them.
 *
 * A prompt-mode model has no native tool calling, so it writes its call as JSON TEXT and the rescue
 * cannot commit that call until the JSON closes. For most tools that is fine — the arguments are
 * machine input and nobody is waiting on them. For a tool whose argument IS the user-visible output,
 * it means the whole reply appears at once, at the end. This module closes that gap by minting the
 * `tool-input-start` / `tool-input-delta` / `tool-input-end` parts a native provider would have sent,
 * out of the still-growing text buffer.
 *
 * Two properties make it safe:
 *
 * **Nothing is spoken that was not resolved.** {@link findStreamableToolCallStart} only reports a
 * call once an actual KEY in an actual object frame names a whitelisted, available tool — never a
 * substring — and only for the contours the full rescue will really commit.
 *
 * **One id spans both halves.** The id is allocated when the stream opens and then forced onto the
 * rescued call, because downstream matches a terminal `tool-call` back to its open delta stream by
 * that id and, on a miss, re-speaks the entire message as a second bubble.
 */

import type { LanguageModelV4StreamPart, LanguageModelV4ToolCall } from '@ai-sdk/provider';
import { createLogger } from '../../logger.js';
import { findStreamableToolCallStart } from './extract.js';
import { sendMessageToolName } from '../../diplomacy/constants.js';

const logger = createLogger("tool-rescue");

/**
 * Tools whose in-flight JSON arguments may be forwarded live.
 *
 * Deliberately a closed allowlist. Streaming a partially-written argument only pays off for a tool
 * whose argument is rendered as it arrives — today just `send-message`, whose `Message` the streamer
 * in `utils/models/send-message-stream.ts` decodes incrementally into a text bubble. Every extra
 * name widens the blast radius of a mis-scan (text spoken that never becomes a durable row) while
 * buying nothing, so a tool joins this set only alongside a consumer that can render partial input.
 */
export const streamableToolNames: ReadonlySet<string> = new Set([sendMessageToolName]);

/** One text block's in-flight synthetic tool-input stream. */
interface StreamedToolInput {
  /** Pre-allocated call id, forced onto the rescued call so both halves share one id. */
  id: string;
  /** The canonical tool name the partial-buffer scan resolved. */
  toolName: string;
  /**
   * How many same-named calls the rescue commits ahead of this one, as counted in the buffer this
   * stream opened against. Decremented when an emission site consumes some of them out of that
   * buffer, so it always describes the text the NEXT emission site will rescue.
   */
  ordinal: number;
  /** Offset of the arguments object in the block's buffer; -1 once that buffer was rewritten. */
  argsStart: number;
  /** Characters of the arguments slice already sent; doubles as the balance-scan cursor. */
  emitted: number;
  /** Incremental brace-balance state, so the arguments object's close is found exactly. */
  depth: number;
  inString: boolean;
  escaped: boolean;
  /** Whether `tool-input-end` has been emitted for this stream. */
  ended: boolean;
}

type Controller = TransformStreamDefaultController<LanguageModelV4StreamPart>;

/** Per-response streaming of whitelisted tool arguments, one independent stream per text block. */
export interface ToolInputStreamer {
  /** Open (once resolvable) and advance the stream for one text block's growing buffer. */
  pump(blockId: string, buffer: string, controller: Controller): void;
  /**
   * Bind a rescued call to the id its arguments streamed under, close the stream, and forget it.
   * Returns whether a call was bound. `keepIfUnbound` leaves an unmatched stream open for a later
   * emission site, which is what a mid-stream rescue needs: committing some OTHER tool's call says
   * nothing about the one still being streamed.
   */
  finalize(blockId: string, toolCalls: LanguageModelV4ToolCall[], controller: Controller, keepIfUnbound?: boolean): boolean;
  /**
   * Keep an opened stream bindable after its block's buffer was rewritten, without streaming any
   * more of it. Forgetting it instead would let the next delta re-scan the rewritten buffer, open a
   * SECOND stream under a new id, and re-speak the same partial message.
   */
  stale(blockId: string): void;
  /** Close every stream still open, so none outlives the response that opened it. */
  closeAll(controller: Controller): void;
}

/**
 * Build the per-response streamer.
 *
 * @param enabled Whether synthetic streaming applies at all to this call. Two conditions gate it,
 *   and both matter. Prompt mode, because this middleware wraps every model and its text-rescue
 *   path runs whenever tools exist — for a NATIVE tool-caller this would open a second, synthetic
 *   stream for a call whose real `tool-input-delta`s the provider is already sending. And NOT
 *   constrained decoding, where each text block is a competing attempt the CLI may reject and
 *   retry: speaking one would commit text that last-attempt-wins then supersedes.
 * @param availableTools The tool names this request actually offers
 */
export function createToolInputStreamer(enabled: boolean, availableTools: Set<string>): ToolInputStreamer {
  const streams: Record<string, StreamedToolInput> = {};
  let sequence = 0;

  const end = (state: StreamedToolInput, controller: Controller): void => {
    if (state.ended) return;
    controller.enqueue({ type: 'tool-input-end', id: state.id } as any);
    state.ended = true;
  };

  return {
    pump(blockId, buffer, controller) {
      if (!enabled) return;
      let state = streams[blockId];
      if (!state) {
        const found = findStreamableToolCallStart(buffer, availableTools, streamableToolNames);
        if (!found) return;
        state = {
          // Suffix-matchable: the concurrency wrapper prefixes a chunk `id` but leaves a tool-call's
          // `toolCallId` bare, and the downstream streamer re-pairs them by that suffix.
          id: `${blockId}-stream-${sequence++}`,
          toolName: found.toolName,
          ordinal: found.ordinal,
          argsStart: found.argsStart,
          emitted: 0,
          depth: 0,
          inString: false,
          escaped: false,
          ended: false,
        };
        streams[blockId] = state;
        controller.enqueue({ type: 'tool-input-start', id: state.id, toolName: state.toolName } as any);
      }
      if (state.ended || state.argsStart < 0) return;

      // Deltas carry the arguments text verbatim, so a decoder downstream walks exactly what the
      // model wrote. Emission stops at the arguments object's closing brace, which keeps the
      // concatenated deltas a genuine prefix of the tool's input rather than trailing off into
      // whatever the model writes after the call.
      const args = buffer.slice(state.argsStart);
      let cursor = state.emitted;
      let closed = false;
      while (cursor < args.length) {
        const char = args[cursor];
        cursor++;
        if (state.escaped) { state.escaped = false; continue; }
        if (state.inString) {
          if (char === '\\') state.escaped = true;
          else if (char === '"') state.inString = false;
          continue;
        }
        if (char === '"') { state.inString = true; continue; }
        if (char === '{') { state.depth++; continue; }
        if (char === '}') {
          state.depth--;
          if (state.depth === 0) { closed = true; break; }
        }
      }
      if (cursor > state.emitted) {
        controller.enqueue({ type: 'tool-input-delta', id: state.id, delta: args.slice(state.emitted, cursor) } as any);
        state.emitted = cursor;
      }
      if (closed) end(state, controller);
    },

    finalize(blockId, toolCalls, controller, keepIfUnbound = false) {
      const state = streams[blockId];
      if (!state) return false;
      // By NAME and SOURCE ORDINAL, not by id or input: the rescue mints a fresh id after parsing,
      // and key normalization or a lenient repair can change the input between what streamed and
      // what was rescued. Name alone is not enough, because the scan reports the first STREAMABLE
      // call while the rescue also commits flattened ones it passed over — so a flattened
      // send-message ahead of the streamed one would otherwise steal its id and speak the wrong
      // text. Both sides order by source position, so the ordinal indexes the same call.
      const sameName = toolCalls.filter((call) => call.toolName === state.toolName);
      const match = sameName[state.ordinal];
      if (!match && keepIfUnbound) {
        // These calls are about to be spliced out of the block's buffer, so they no longer precede
        // the streamed call in the text the next emission site will rescue. (Unmatched implies
        // `sameName.length <= state.ordinal`, so this can never go negative.)
        state.ordinal -= sameName.length;
        return false;
      }
      if (match) match.toolCallId = state.id;
      end(state, controller);
      if (!match) {
        // The model opened a call we spoke from and then abandoned or mangled it. Nothing can be
        // unsaid, and synthesizing a tool-call to close the bubble would EXECUTE the tool, so the
        // partial text simply never becomes a durable row. Name it rather than leave a silent gap.
        logger.log("warn", `streamed ${state.toolName} arguments were never rescued into a tool call`);
      }
      delete streams[blockId];
      return match !== undefined;
    },

    stale(blockId) {
      const state = streams[blockId];
      if (state) state.argsStart = -1;
    },

    closeAll(controller) {
      for (const blockId of Object.keys(streams)) this.finalize(blockId, [], controller);
    },
  };
}
