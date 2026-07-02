/**
 * Mock-tier unit tests for the tool-rescue prompt shaping (`prompt.ts`).
 *
 * `createToolPrompts`: the three instruction branches (required / tool / auto)
 * under both the default `'tool'` framing and the claude-code `'action'` framing,
 * plus the `'none'` short-circuit. The default-framing assertions pin the wording
 * the ~15 prompt-mode models depend on; the action-framing assertions pin the
 * reframed terminology and JSON key.
 *
 * `convertPromptToolMessagesToText`: prompt-emulated (client) tool parts get
 * reframed to text, while provider-executed built-in tool parts (e.g. claude-code's
 * `Read`) are left native so they are not misattributed to the game.
 */

import { describe, expect, it } from 'vitest';
import {
  createToolPrompts,
  convertPromptToolMessagesToText,
} from '../../../src/utils/models/tool-rescue/prompt.js';

const tools = [
  {
    type: 'function' as const,
    name: 'send_message',
    description: 'Send a message',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

describe('createToolPrompts', () => {
  describe("default ('tool') framing", () => {
    it('uses Tool headings and the "tool" JSON key for the auto branch', () => {
      const out = createToolPrompts(tools, { type: 'auto' })!;
      expect(out).toContain('## Tool Calling');
      expect(out).toContain('## Available Tools');
      expect(out).toContain('{ "tool": "<tool_name>", "arguments": { <parameters> } }');
      expect(out).not.toContain('Action');
      // The per-tool schema block is always appended.
      expect(out).toContain('### send_message');
    });

    it('mandates one-or-more for the required branch', () => {
      const out = createToolPrompts(tools, { type: 'required' })!;
      expect(out).toContain('## Tool Calling');
      expect(out).toMatch(/You must use one or more tools/);
    });

    it('mandates the single tool for the tool branch', () => {
      const out = createToolPrompts(tools, { type: 'tool', toolName: 'send_message' })!;
      expect(out).toContain('## Tool Calling');
      expect(out).toMatch(/You must use the tool defined below/);
    });
  });

  describe("'action' framing", () => {
    it('uses Action headings and the "action" JSON key for the auto branch', () => {
      const out = createToolPrompts(tools, { type: 'auto' }, 'action')!;
      expect(out).toContain('## Action Calling');
      expect(out).toContain('## Available Actions');
      expect(out).toContain('{ "action": "<action_name>", "arguments": { <parameters> } }');
      expect(out).not.toContain('## Tool Calling');
      expect(out).not.toContain('## Available Tools');
      expect(out).toMatch(/You have access to actions/);
    });

    it('uses Action wording for the required branch', () => {
      const out = createToolPrompts(tools, { type: 'required' }, 'action')!;
      expect(out).toContain('## Action Calling');
      expect(out).toContain('## Available Actions');
      expect(out).toMatch(/You must use one or more actions/);
      expect(out).toContain('{ "action": "<action_name>", "arguments": { <parameters> } }');
    });

    it('uses Action wording for the tool branch', () => {
      const out = createToolPrompts(tools, { type: 'tool', toolName: 'send_message' }, 'action')!;
      expect(out).toContain('## Action Calling');
      expect(out).toMatch(/You must use the action defined below/);
      expect(out).toContain('{ "action": "<action_name>", "arguments": { <parameters> } }');
    });
  });

  it("returns undefined for the 'none' choice regardless of framing", () => {
    expect(createToolPrompts(tools, { type: 'none' })).toBeUndefined();
    expect(createToolPrompts(tools, { type: 'none' }, 'action')).toBeUndefined();
  });
});

describe('convertPromptToolMessagesToText', () => {
  it('reframes a prompt-emulated (client) tool-call to text under action framing', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'send_message', input: { text: 'hi' } },
      ] },
    ] as any, 'action');
    const parts = out[0].content;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('"action": "send_message"');
  });

  it('leaves a provider-executed built-in tool-call native (not reframed as an action)', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'r1', toolName: 'Read', input: { file: 'x' }, providerExecuted: true },
      ] },
    ] as any, 'action');
    const part = out[0].content[0];
    expect(part.type).toBe('tool-call');
    expect(part.toolName).toBe('Read');
    expect(part.providerExecuted).toBe(true);
    expect(JSON.stringify(out)).not.toContain('"action": "Read"');
  });

  it('leaves an assistant-content tool-result native (provider-executed by construction)', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-result', toolCallId: 'r1', toolName: 'Read', output: { type: 'text', value: 'file body' } },
      ] },
    ] as any, 'action');
    const part = out[0].content[0];
    expect(part.type).toBe('tool-result');
    expect(JSON.stringify(out)).not.toContain('# Action Read Result');
  });

  it('still reframes a client tool-result delivered as a tool-role message', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'tool', content: [
        { type: 'tool-result', toolCallId: 'c1', toolName: 'send_message', output: { type: 'text', value: 'delivered' } },
      ] },
    ] as any, 'action');
    expect(JSON.stringify(out)).toContain('# Action send_message Result');
  });
});
