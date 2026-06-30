/**
 * Unit tests for the `send-message` streamer (interactive-diplomacy refactor 05.1).
 *
 * Two units, both pure: `decodeJsonStringField` (the partial-JSON string decode, including escapes,
 * unicode, and back-off at a buffer boundary) and `createSendMessageStreamer` (incremental deltas,
 * whole-argument tool-call, independent tracking of concurrent calls, swallowing of the tool's own
 * chunks, and passthrough of everything else). No SDK, no model, no I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  decodeJsonStringField,
  createSendMessageStreamer,
  type StreamChunk,
} from '../../../src/utils/models/send-message-stream.js';

/** Collect the (text, id) pairs a streamer emits so a test can assert order and grouping. */
function makeSink() {
  const emitted: Array<{ text: string; id: string }> = [];
  const streamer = createSendMessageStreamer((text, id) => emitted.push({ text, id }));
  return { emitted, streamer };
}

describe('decodeJsonStringField', () => {
  it('decodes a complete string value', () => {
    expect(decodeJsonStringField('{"Message":"Hello, world"}', 'Message')).toBe('Hello, world');
  });

  it('decodes a partial value up to the buffer end', () => {
    expect(decodeJsonStringField('{"Message":"Hello, wor', 'Message')).toBe('Hello, wor');
  });

  it('returns "" before the opening quote has streamed', () => {
    expect(decodeJsonStringField('{"Mess', 'Message')).toBe('');
    expect(decodeJsonStringField('{"Message"', 'Message')).toBe(''); // colon not yet there
    expect(decodeJsonStringField('{"Message":', 'Message')).toBe(''); // opening quote not yet there
    expect(decodeJsonStringField('{"Message": ', 'Message')).toBe(''); // whitespace, still no quote
  });

  it('tolerates whitespace around the colon', () => {
    expect(decodeJsonStringField('{ "Message" : "hi" }', 'Message')).toBe('hi');
  });

  it('honors the standard JSON escapes', () => {
    expect(decodeJsonStringField('{"Message":"a\\"b\\\\c\\/d\\n\\t\\r\\b\\fe"}', 'Message')).toBe(
      'a"b\\c/d\n\t\r\b\fe'
    );
  });

  it('decodes \\uXXXX unicode escapes', () => {
    expect(decodeJsonStringField('{"Message":"snow \\u2603 man"}', 'Message')).toBe('snow ☃ man');
  });

  it('backs off at an incomplete trailing backslash', () => {
    // The lone backslash is an incomplete escape at the boundary: return only what is safe.
    expect(decodeJsonStringField('{"Message":"line one\\', 'Message')).toBe('line one');
  });

  it('backs off at a partial \\u escape', () => {
    expect(decodeJsonStringField('{"Message":"snow \\u26', 'Message')).toBe('snow ');
  });

  it('is monotonic: appending the rest of an escape extends the prior prefix', () => {
    const before = decodeJsonStringField('{"Message":"Hi\\', 'Message');
    const after = decodeJsonStringField('{"Message":"Hi\\n there', 'Message');
    expect(before).toBe('Hi');
    expect(after).toBe('Hi\n there');
    expect(after.startsWith(before)).toBe(true);
  });

  it('treats the first "Message" as the key, decoding a value that mentions the word', () => {
    expect(decodeJsonStringField('{"Message":"say \\"Message\\" again"}', 'Message')).toBe(
      'say "Message" again'
    );
  });

  it('returns "" when the field is absent', () => {
    expect(decodeJsonStringField('{"Other":"x"}', 'Message')).toBe('');
  });
});

describe('createSendMessageStreamer', () => {
  it('streams incremental deltas as cumulative suffixes under one stable id', () => {
    const { emitted, streamer } = makeSink();

    expect(streamer.handleChunk({ type: 'tool-input-start', id: 'c1', toolName: 'send-message' })).toBe(true);
    expect(streamer.handleChunk({ type: 'tool-input-delta', id: 'c1', delta: '{"Message":"Hel' })).toBe(true);
    expect(streamer.handleChunk({ type: 'tool-input-delta', id: 'c1', delta: 'lo, wor' })).toBe(true);
    expect(streamer.handleChunk({ type: 'tool-input-delta', id: 'c1', delta: 'ld"}' })).toBe(true);

    expect(emitted).toEqual([
      { text: 'Hel', id: 'c1' },
      { text: 'lo, wor', id: 'c1' },
      { text: 'ld', id: 'c1' },
    ]);
  });

  it('emits only the remaining suffix on the closing tool-call after deltas (same id)', () => {
    const { emitted, streamer } = makeSink();

    streamer.handleChunk({ type: 'tool-input-start', id: 'c2', toolName: 'send-message' });
    streamer.handleChunk({ type: 'tool-input-delta', id: 'c2', delta: '{"Message":"Hello' });
    // The authoritative full input arrives; only the missing tail is emitted, under the same id.
    expect(
      streamer.handleChunk({ type: 'tool-call', toolCallId: 'c2', toolName: 'send-message', input: { Message: 'Hello there' } })
    ).toBe(true);

    expect(emitted).toEqual([
      { text: 'Hello', id: 'c2' },
      { text: ' there', id: 'c2' },
    ]);
  });

  it("matches a tool-call's unprefixed toolCallId to its concurrency-prefixed delta stream id", () => {
    const { emitted, streamer } = makeSink();

    // concurrency.ts prefixes the streaming `id` (`<callId>-<toolCallId>`) but leaves the tool-call's
    // `toolCallId` bare; the closing call must still resolve to the same bubble.
    streamer.handleChunk({ type: 'tool-input-start', id: '7-abc', toolName: 'send-message' });
    streamer.handleChunk({ type: 'tool-input-delta', id: '7-abc', delta: '{"Message":"Greet' });
    streamer.handleChunk({ type: 'tool-call', toolCallId: 'abc', toolName: 'send-message', input: { Message: 'Greetings' } });

    expect(emitted).toEqual([
      { text: 'Greet', id: '7-abc' },
      { text: 'ings', id: '7-abc' },
    ]);
  });

  it('tracks two concurrent send-message calls independently (no cross-assignment)', () => {
    const { emitted, streamer } = makeSink();

    // Both calls open, then their deltas interleave. The single-buffer design would corrupt this;
    // per-id tracking keeps each suffix on its own bubble.
    streamer.handleChunk({ type: 'tool-input-start', id: 'a', toolName: 'send-message' });
    streamer.handleChunk({ type: 'tool-input-start', id: 'b', toolName: 'send-message' });
    streamer.handleChunk({ type: 'tool-input-delta', id: 'a', delta: '{"Message":"Aaa' });
    streamer.handleChunk({ type: 'tool-input-delta', id: 'b', delta: '{"Message":"Bbb' });
    streamer.handleChunk({ type: 'tool-input-delta', id: 'a', delta: 'a"}' });
    streamer.handleChunk({ type: 'tool-input-delta', id: 'b', delta: 'b"}' });
    streamer.handleChunk({ type: 'tool-call', toolCallId: 'a', toolName: 'send-message', input: { Message: 'Aaaa' } });
    streamer.handleChunk({ type: 'tool-call', toolCallId: 'b', toolName: 'send-message', input: { Message: 'Bbbb' } });

    expect(emitted).toEqual([
      { text: 'Aaa', id: 'a' },
      { text: 'Bbb', id: 'b' },
      { text: 'a', id: 'a' },
      { text: 'b', id: 'b' },
    ]);
  });

  it('emits the whole message from a tool-call with no preceding deltas (whole-arg providers)', () => {
    const { emitted, streamer } = makeSink();

    expect(
      streamer.handleChunk({ type: 'tool-call', toolCallId: 'tc3', toolName: 'send-message', input: { Message: 'All at once.' } })
    ).toBe(true);

    expect(emitted).toEqual([{ text: 'All at once.', id: 'tc3' }]);
  });

  it('swallows the send-message tool-result confirmation', () => {
    const { emitted, streamer } = makeSink();
    expect(
      streamer.handleChunk({ type: 'tool-result', toolCallId: 'tc4', toolName: 'send-message', input: {} })
    ).toBe(true);
    expect(emitted).toEqual([]);
  });

  it('passes through native text-delta chunks (greetings / Anthropic fallback)', () => {
    const { emitted, streamer } = makeSink();
    expect(streamer.handleChunk({ type: 'text-delta', id: 't', delta: 'free text' } as StreamChunk)).toBe(false);
    expect(emitted).toEqual([]);
  });

  it("passes through other tools' chunks unchanged", () => {
    const { emitted, streamer } = makeSink();
    expect(streamer.handleChunk({ type: 'tool-input-start', id: 'b1', toolName: 'get-briefing' })).toBe(false);
    expect(streamer.handleChunk({ type: 'tool-input-delta', id: 'b1', delta: '{"Categories":["Mil' })).toBe(false);
    expect(
      streamer.handleChunk({ type: 'tool-call', toolCallId: 'tb1', toolName: 'get-briefing', input: { Categories: ['Military'] } })
    ).toBe(false);
    expect(
      streamer.handleChunk({ type: 'tool-result', toolCallId: 'tb1', toolName: 'get-briefing', input: {} })
    ).toBe(false);
    expect(emitted).toEqual([]);
  });

  it('does not consume a send-message delta whose id does not match any open stream', () => {
    const { emitted, streamer } = makeSink();
    streamer.handleChunk({ type: 'tool-input-start', id: 'c5', toolName: 'send-message' });
    // A stray delta for a different id is not part of any tracked stream: pass it through.
    expect(streamer.handleChunk({ type: 'tool-input-delta', id: 'other', delta: '{"Message":"x"}' })).toBe(false);
    expect(emitted).toEqual([]);
  });
});
