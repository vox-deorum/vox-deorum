/**
 * Mock-tier unit tests for the tool-rescue prompt shaping (`prompt.ts`).
 *
 * `createToolPrompts`: the instruction branches (auto, required, and tool)
 * under both default `'tool'` and `'action'` framing, plus the `'none'`
 * short-circuit. Assertions check offered names and the JSON protocol fields
 * independently of surrounding prompt prose.
 *
 * `convertPromptToolMessagesToText`: prompt-emulated (client) tool parts get
 * reframed to text, while provider-executed built-in tool parts are left native
 * so they are not misattributed to the game.
 */

import { describe, expect, it } from 'vitest';
import {
  createToolPrompts,
  convertPromptToolMessagesToText,
  reframeToolWording,
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
    it('exposes the offered tool name and JSON call fields for the auto branch', () => {
      const out = createToolPrompts(tools, { type: 'auto' })!;
      expect(out).toContain('send_message');
      expect(out).toMatch(/\[\s*\{\s*"tool"\s*:/);
      expect(out).toMatch(/"arguments"\s*:/);
    });

    it('describes the required branch as a bare list of calls', () => {
      const out = createToolPrompts(tools, { type: 'required' })!;
      expect(out).toContain('send_message');
      expect(out).toMatch(/\[\s*\{\s*"tool"\s*:/);
      expect(out).not.toMatch(/"tools"\s*:/);
    });

    it('preserves the selected tool schema for the tool branch', () => {
      const selected = {
        ...tools[0],
        inputSchema: { type: 'object', properties: { recipient: { type: 'string' } } },
      };
      const out = createToolPrompts([selected], { type: 'tool', toolName: 'send_message' })!;
      expect(out).toContain('send_message');
      expect(out).toMatch(/\{\s*"tool"\s*:/);
      expect(out).toMatch(/"arguments"\s*:/);
      // Any fenced JSON block may carry the schema; only its content is part of the contract.
      const fencedJson = [...out.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].flatMap(([, block]) => {
        try { return [JSON.parse(block)]; } catch { return []; }
      });
      expect(fencedJson).toContainEqual({
        type: 'object', properties: { recipient: { type: 'string' } },
      });
    });
  });

  describe("'action' framing", () => {
    it('exposes the offered action name and JSON call fields for the auto branch', () => {
      const out = createToolPrompts(tools, { type: 'auto' }, 'action')!;
      expect(out).toContain('send_message');
      expect(out).toMatch(/\[\s*\{\s*"action"\s*:/);
      expect(out).toMatch(/"arguments"\s*:/);
    });

    it('describes the required branch with action calls', () => {
      const out = createToolPrompts(tools, { type: 'required' }, 'action')!;
      expect(out).toContain('send_message');
      expect(out).toMatch(/\[\s*\{\s*"action"\s*:/);
      expect(out).not.toMatch(/"actions"\s*:/);
    });

    it('identifies the selected action for the tool branch', () => {
      const out = createToolPrompts(tools, { type: 'tool', toolName: 'send_message' }, 'action')!;
      expect(out).toContain('send_message');
      expect(out).toMatch(/\{\s*"action"\s*:/);
      expect(out).toMatch(/"arguments"\s*:/);
    });
  });

  it("returns undefined for the 'none' choice regardless of framing", () => {
    expect(createToolPrompts(tools, { type: 'none' })).toBeUndefined();
    expect(createToolPrompts(tools, { type: 'none' }, 'action')).toBeUndefined();
  });
});

describe('reframeToolWording', () => {
  it('rewrites whole-word tool wording to action, preserving case and plurality', () => {
    expect(reframeToolWording('Use the `send-message` tool; see the Available Tools list.'))
      .toBe('Use the `send-message` action; see the Available Actions list.');
    expect(reframeToolWording('call as many tools as you need')).toBe('call as many actions as you need');
    expect(reframeToolWording('Tool Calling and TOOLS')).toBe('Action Calling and ACTIONS');
  });

  it('leaves non-word and embedded occurrences untouched', () => {
    // No whole-word "tool" boundary: toolkit, stool, and hyphenless compounds are safe.
    expect(reframeToolWording('a toolkit on a stool')).toBe('a toolkit on a stool');
    expect(reframeToolWording('protocol')).toBe('protocol');
  });

  it('is idempotent on already-action text', () => {
    const once = reframeToolWording('the tool');
    expect(reframeToolWording(once)).toBe(once);
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

  const fencedJson = (text: string) => JSON.parse(text.match(/```json\n([\s\S]*)\n```/)![1]);

  it('emits a bare array of calls', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'send_message', input: { text: 'hi' } },
      ] },
    ] as any, 'action');
    const parsed = fencedJson(out[0].content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual([{ action: 'send_message', arguments: { text: 'hi' } }]);
    expect(JSON.stringify(out)).not.toContain('"actions"');
  });

  it('leaves a provider-executed tool-call native while reframing the emulated call', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'r1', toolName: 'Read', input: { file: 'x' }, providerExecuted: true },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'send_message', input: { text: 'hi' } },
      ] },
    ] as any, 'action');
    const parts = out[0].content;
    const readPart = parts.find((p: any) => p.type === 'tool-call');
    expect(readPart.toolName).toBe('Read');
    expect(readPart.providerExecuted).toBe(true);
    const textPart = parts.find((p: any) => p.type === 'text');
    expect(fencedJson(textPart.text)).toEqual([{ action: 'send_message', arguments: { text: 'hi' } }]);
    expect(JSON.stringify(out)).not.toContain('"action": "Read"');
  });

  it('keeps interleaved prose between separate call texts', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'found_city', input: { name: 'Rome' } },
        { type: 'text', text: 'thinking...' },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'send_message', input: { text: 'hi' } },
      ] },
    ] as any, 'action');
    const parts = out[0].content;
    expect(parts).toHaveLength(3);
    expect(parts[1]).toEqual({ type: 'text', text: 'thinking...' });
    expect(fencedJson(parts[0].text)).toEqual([{ action: 'found_city', arguments: { name: 'Rome' } }]);
    expect(fencedJson(parts[2].text)).toEqual([{ action: 'send_message', arguments: { text: 'hi' } }]);
  });
});
