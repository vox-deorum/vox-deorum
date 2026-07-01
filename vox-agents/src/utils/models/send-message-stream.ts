/**
 * @module utils/models/send-message-stream
 *
 * Per-request streamer that turns the live envoy's `send-message` tool call back into streamed
 * text (interactive-diplomacy refactor 05.1). Because `toolChoice: "required"` is honored on the
 * deployed model, *every* normal reply now flows through `send-message`, so streaming its `Message`
 * argument back as text is what preserves the token-by-token bubble for all replies. The tool's
 * own `tool-call` / `tool-result` chunks are swallowed so the UI renders a text bubble, never a
 * tool-call card; every other chunk (native `text-delta` greetings/fallback, other tools' chunks)
 * passes through unchanged, UNLESS `suppressFreeText` is set (a live envoy, which speaks only via
 * `send-message`), in which case native model text chunks are swallowed too: such free text is the
 * Anthropic tool-force fallback, possibly malformed tool-call junk, never a real spoken reply. The
 * web route owns the SSE wiring; this module only maps stream chunks to `(text, id)` emissions, so
 * it is a pure model-stream transform (like its neighbor `concurrency.ts`).
 *
 * The AI SDK delivers `tool-input-start` / `tool-input-delta` / `tool-call` / `tool-result` chunks
 * to `streamText`'s `onChunk`. A `tool-input-delta` carries only a raw JSON-text fragment (the
 * `delta` field on the `TextStreamPart` union onChunk receives), so reconstructing the `Message`
 * string needs a small partial-JSON decode. That decode is synchronous on purpose: `concurrency.ts`
 * does **not** await `onChunk`, so async work here would race chunk ordering. The schema's single
 * `Message` string field makes the field unambiguous and first.
 */

import { sendMessageToolName } from "../diplomacy/send-message-tool-name.js";

/**
 * The subset of an AI SDK streaming chunk the streamer reads. The `onChunk` callback receives a
 * `TextStreamPart` union; this structural shape captures the fields we branch on so test fixtures
 * stay light and the real union assigns cleanly. `id` is present on `tool-input-start` /
 * `tool-input-delta` (and is prefixed per-call by `concurrency.ts`); `toolCallId` on `tool-call` /
 * `tool-result` (unprefixed, since those chunks carry no `id`); `delta` is the raw JSON fragment on
 * `tool-input-delta`; `input` is the parsed arguments on `tool-call`.
 */
export interface StreamChunk {
  type: string;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  delta?: string;
  input?: unknown;
}

/** A streamer routes every stream chunk; `handleChunk` returns true when the chunk was swallowed. */
export interface SendMessageStreamer {
  /** Process one chunk. Returns true when it was consumed (the caller must NOT forward it). */
  handleChunk(chunk: StreamChunk): boolean;
}

/** Options for {@link createSendMessageStreamer}. */
export interface SendMessageStreamerOptions {
  /**
   * When true (a live envoy, which speaks ONLY through `send-message`), swallow native model text
   * chunks too. Such free text is the Anthropic tool-force fallback (possibly malformed tool-call
   * text the rescue middleware left behind), never a real spoken reply, so it must not render.
   */
  suppressFreeText?: boolean;
}

/** Native model text chunk types (vs. the `send-message` tool-input chunks the streamer converts). */
const NATIVE_TEXT_CHUNK_TYPES = new Set(["text", "text-start", "text-delta", "text-end"]);

/** In-flight decode state for one `send-message` tool-input stream. */
interface OpenStream {
  /** Accumulated raw JSON argument text for this call. */
  rawJson: string;
  /** Length of the decoded `Message` already emitted, so the next emit is a pure suffix. */
  emitted: number;
}

/**
 * Decode the value of a JSON string field from a raw (possibly incomplete) JSON object text.
 *
 * Locates `"<field>"`, then its `:` and the value's opening quote, then decodes the string body
 * honoring JSON escapes. When the buffer ends mid-token it **backs off**, returning only the
 * safely-decoded prefix: a trailing lone `\` or a partial `\uXXXX` are left undecoded until the
 * rest streams in. Because only fully-resolved characters are ever returned, the output grows
 * monotonically as `raw` grows, so a caller emitting the new suffix never has to revise a character
 * it already emitted. Returns "" until the field's opening quote is present.
 */
export function decodeJsonStringField(raw: string, field: string): string {
  const keyToken = `"${field}"`;
  const keyIdx = raw.indexOf(keyToken);
  if (keyIdx < 0) return "";

  // Advance past the key to its colon, tolerating whitespace around it.
  let i = keyIdx + keyToken.length;
  while (i < raw.length && raw[i] !== ":") i++;
  if (i >= raw.length) return ""; // colon not streamed yet
  i++; // past the colon
  while (i < raw.length && isJsonWhitespace(raw[i])) i++;
  if (i >= raw.length || raw[i] !== '"') return ""; // opening quote not streamed yet
  i++; // past the opening quote

  let out = "";
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') return out; // unescaped closing quote: value complete
    if (c !== "\\") {
      out += c;
      i++;
      continue;
    }
    // Escape sequence. Back off if the escape is not yet fully buffered.
    if (i + 1 >= raw.length) return out;
    const esc = raw[i + 1];
    switch (esc) {
      case '"': out += '"'; i += 2; break;
      case "\\": out += "\\"; i += 2; break;
      case "/": out += "/"; i += 2; break;
      case "b": out += "\b"; i += 2; break;
      case "f": out += "\f"; i += 2; break;
      case "n": out += "\n"; i += 2; break;
      case "r": out += "\r"; i += 2; break;
      case "t": out += "\t"; i += 2; break;
      case "u": {
        if (i + 6 > raw.length) return out; // partial \uXXXX at the boundary
        const hex = raw.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out; // malformed: back off defensively
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        break;
      }
      default:
        // Not a valid JSON escape; emit the escaped char literally and move on.
        out += esc;
        i += 2;
        break;
    }
  }
  return out; // reached the buffer end without a closing quote
}

/** JSON insignificant whitespace (space, tab, newline, carriage return). */
function isJsonWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

/**
 * Build a per-request `send-message` streamer. `emitTextDelta(text, id)` is called with each new
 * suffix of the spoken message and the stable id under which the client groups the text bubble.
 *
 * Each in-flight `send-message` tool-input stream is tracked independently by its chunk `id`, so a
 * step that emits more than one `send-message` call (the model can; terminal handling runs only
 * after the step) never lets two calls share a buffer and cross-assign suffixes. A `tool-call`
 * carries the unprefixed `toolCallId`, which `concurrency.ts` does not prefix; it is matched back to
 * its delta stream by the prefix-tolerant `findStreamId`, or, when a provider streamed the whole
 * argument with no deltas, emitted as a fresh bubble keyed on the `toolCallId`.
 */
export function createSendMessageStreamer(
  emitTextDelta: (text: string, id: string) => void,
  options?: SendMessageStreamerOptions
): SendMessageStreamer {
  const suppressFreeText = options?.suppressFreeText ?? false;
  const streams = new Map<string, OpenStream>();

  /** Emit the portion of `fullMessage` beyond what has already been streamed under `id`. */
  function emitSuffix(stream: OpenStream, fullMessage: string, id: string): void {
    if (fullMessage.length > stream.emitted) {
      emitTextDelta(fullMessage.slice(stream.emitted), id);
      stream.emitted = fullMessage.length;
    }
  }

  /**
   * The open-stream key a `tool-call`'s `toolCallId` refers to. The delta stream's `id` is the same
   * tool-call id prefixed by `concurrency.ts` (`<callId>-<toolCallId>`), so an exact hit is tried
   * first and a `-<toolCallId>` suffix match second. The `-` boundary keeps one id from matching
   * another whose tail merely overlaps.
   */
  function findStreamId(toolCallId: string): string | undefined {
    if (streams.has(toolCallId)) return toolCallId;
    for (const id of streams.keys()) {
      if (id.endsWith(`-${toolCallId}`)) return id;
    }
    return undefined;
  }

  return {
    handleChunk(chunk: StreamChunk): boolean {
      switch (chunk.type) {
        case "tool-input-start":
          if (chunk.toolName === sendMessageToolName && chunk.id != null) {
            streams.set(chunk.id, { rawJson: "", emitted: 0 });
            return true;
          }
          return false;

        case "tool-input-delta": {
          const stream = chunk.id != null ? streams.get(chunk.id) : undefined;
          if (stream) {
            stream.rawJson += chunk.delta ?? "";
            emitSuffix(stream, decodeJsonStringField(stream.rawJson, "Message"), chunk.id!);
            return true;
          }
          return false;
        }

        case "tool-call": {
          if (chunk.toolName !== sendMessageToolName) return false;
          const message = (chunk.input as { Message?: unknown } | undefined)?.Message;
          const toolCallId = chunk.toolCallId;
          const streamId = toolCallId != null ? findStreamId(toolCallId) : undefined;
          if (streamId !== undefined) {
            // Delta-streamed: deltas already emitted the message; flush any trailing remainder
            // against the authoritative full input under the same id (one bubble), then close it.
            const stream = streams.get(streamId)!;
            if (typeof message === "string") emitSuffix(stream, message, streamId);
            streams.delete(streamId);
          } else if (typeof message === "string") {
            // Whole-argument provider: no deltas streamed, so emit the full message at once, keyed
            // on the tool-call id as its own bubble.
            emitTextDelta(message, toolCallId ?? sendMessageToolName);
          }
          return true;
        }

        case "tool-result":
          // Swallow the "Message delivered." confirmation so it never renders.
          return chunk.toolName === sendMessageToolName;

        default:
          // For a live envoy, swallow native model text (the Anthropic tool-force fallback / malformed
          // tool-call junk) so it never renders; the real spoken reply always arrives via send-message.
          if (suppressFreeText && NATIVE_TEXT_CHUNK_TYPES.has(chunk.type)) return true;
          // Otherwise native text-delta and every other tool's chunks pass through unchanged.
          return false;
      }
    },
  };
}
