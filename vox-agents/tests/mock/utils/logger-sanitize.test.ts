/**
 * Tests for `sanitizeAIError` (src/utils/logger.ts): what a logger format does with an
 * APICallError-shaped object before it reaches a transport, so a failed evaluation call logs
 * neither the game state it sent nor the question set, while keeping the small identifying fields.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeAIError } from '../../../src/utils/logger.js';

/** Marker planted inside a large payload; it must never survive sanitizing. */
const marker = 'SECRET-STATE-MARKER';

/** An APICallError-shaped object from a failed evaluation call: model, a 100k-character state,
 * and a 77-entry question set. */
function evaluationCallError() {
  return {
    name: 'AI_APICallError',
    message: 'Stream disconnected',
    statusCode: 500,
    requestBodyValues: {
      model: 'jev-latest',
      state: marker + 'x'.repeat(100_000),
      questions: Object.fromEntries(
        Array.from({ length: 77 }, (_, index) => [`question_${index}`, { type: 'score', instructions: marker }]),
      ),
    },
  };
}

describe('sanitizeAIError', () => {
  it('should redact the evaluation state and questions while keeping the small fields', () => {
    const sanitized = sanitizeAIError(evaluationCallError());

    const json = JSON.stringify(sanitized);
    expect(json).not.toContain(marker);
    expect(json.length).toBeLessThan(1_000);
    expect(sanitized.requestBodyValues.model).toBe('jev-latest');
    expect(sanitized.name).toBe('AI_APICallError');
    // Both payloads are replaced by short placeholders that keep a size or count.
    expect(typeof sanitized.requestBodyValues.state).toBe('string');
    expect(String(sanitized.requestBodyValues.state).length).toBeLessThan(100);
    expect(String(sanitized.requestBodyValues.questions)).toContain('77');
  });

  it('should redact an object-shaped state without serializing it', () => {
    const sanitized = sanitizeAIError({
      name: 'AI_APICallError',
      requestBodyValues: {
        model: 'jev-latest',
        state: { [marker]: 'y'.repeat(100_000) },
      },
    });

    const json = JSON.stringify(sanitized);
    expect(json).not.toContain(marker);
    expect(sanitized.requestBodyValues.state).toBeTypeOf('string');
  });

  it('should compact a rate-limited chat call to its settings, retry headers, and short body', () => {
    const level = Symbol.for('level');
    const sanitized = sanitizeAIError({
      [level]: 'warn',
      name: 'AI_APICallError',
      message: 'Rate limited',
      statusCode: 429,
      url: 'https://example.test/v1/chat/completions',
      stack: `AI_APICallError: Rate limited\n    at ${marker}`,
      requestBodyValues: {
        model: 'deepseek',
        stream: true,
        tool_choice: 'required',
        messages: [{ role: 'user', content: marker }],
        tools: Array.from({ length: 12 }, () => ({ name: 'tool', description: marker })),
      },
      responseHeaders: { 'retry-after': '30', server: marker, via: marker },
      responseBody: `{"error":"${marker}${'z'.repeat(5_000)}"}`,
      data: { error: marker },
    });

    const json = JSON.stringify(sanitized);
    expect(json.length).toBeLessThan(1_000);
    expect(sanitized[level]).toBe('warn');
    expect(sanitized.statusCode).toBe(429);
    expect(sanitized.requestBodyValues).toMatchObject({ model: 'deepseek', stream: true, tool_choice: 'required' });
    expect(String(sanitized.requestBodyValues.tools)).toContain('12');
    expect(String(sanitized.requestBodyValues.messages)).not.toContain(marker);
    expect(sanitized.responseHeaders).toEqual({ 'retry-after': '30' });
    expect(sanitized.stack).toBeUndefined();
    expect(sanitized.data).toBeUndefined();
  });
});
