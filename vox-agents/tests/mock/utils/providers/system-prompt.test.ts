/** Tests for the shared system-prompt middleware helper. */

import { describe, expect, it } from 'vitest';
import { appendSystemInstruction } from '../../../../src/utils/models/providers/system-prompt.js';

const instruction = 'Use the assigned capabilities as support.';

describe('appendSystemInstruction', () => {
  it('appends to the leading system message without changing the caller prompt', () => {
    const prompt: any = [{ role: 'system', content: 'Follow the game state.' }, { role: 'user', content: [] }];
    const result = appendSystemInstruction(prompt, instruction);

    expect(prompt[0].content).toBe('Follow the game state.');
    expect(result[0].content).toBe(`Follow the game state.\n\n${instruction}`);
    expect(result[1]).toBe(prompt[1]);
  });

  it('creates a system message without changing a prompt that has none', () => {
    const prompt: any = [{ role: 'user', content: [{ type: 'text', text: 'Take the turn.' }] }];
    const result = appendSystemInstruction(prompt, instruction);

    expect(result[0]).toEqual({ role: 'system', content: instruction });
    expect(result[1]).toBe(prompt[0]);
    expect(prompt).toHaveLength(1);
  });
});
