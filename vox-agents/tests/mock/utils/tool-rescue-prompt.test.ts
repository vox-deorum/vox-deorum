/**
 * Mock-tier unit tests for the tool-rescue prompt shaping (`prompt.ts`).
 *
 * `createToolPrompts`: the instruction branches (auto, unwrapped required, tool,
 * and wrapped required) under both default `'tool'` and claude-code `'action'`
 * framing, plus the `'none'` short-circuit. Assertions check offered names and
 * the JSON protocol fields independently of surrounding prompt prose.
 *
 * `convertPromptToolMessagesToText`: prompt-emulated (client) tool parts get
 * reframed to text, while provider-executed built-in tool parts (e.g. claude-code's
 * `Read`) are left native so they are not misattributed to the game.
 */

import { describe, expect, it } from 'vitest';
import {
  createToolPrompts,
  convertPromptToolMessagesToText,
  reframeToolWording,
  buildToolCallArraySchema,
} from '../../../src/utils/models/tool-rescue/prompt.js';

const tools = [
  {
    type: 'function' as const,
    name: 'send_message',
    description: 'Send a message',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

describe('buildToolCallArraySchema', () => {
  it("wraps the array under 'tools' and enumerates the names under default framing", () => {
    const schema: any = buildToolCallArraySchema(tools);
    // Root must be an object: a forced tool call's input_schema.type must be 'object'.
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['tools']);
    expect(schema.properties.tools.type).toBe('array');
    const item = schema.properties.tools.items;
    expect(item.type).toBe('object');
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(['tool', 'arguments']);
    expect(item.properties.tool.enum).toEqual(['send_message']);
    // Shape-only: the action name is constrained but arguments stays an open object.
    expect(item.properties.arguments).toEqual({ type: 'object' });
  });

  it("wraps under 'actions' and uses the 'action' key under action framing", () => {
    const schema: any = buildToolCallArraySchema(tools, 'action');
    expect(schema.required).toEqual(['actions']);
    const item = schema.properties.actions.items;
    expect(item.required).toEqual(['action', 'arguments']);
    expect(item.properties.action.enum).toEqual(['send_message']);
    expect(item.properties.tool).toBeUndefined();
  });

  it('excludes provider tools from the enum (mirrors createToolPrompt)', () => {
    const withProvider = [
      ...tools,
      { type: 'provider' as const, id: 'anthropic.web_search', name: 'web_search', args: {} },
    ];
    const schema: any = buildToolCallArraySchema(withProvider as any);
    expect(schema.properties.tools.items.properties.tool.enum).toEqual(['send_message']);
  });
});

describe('createToolPrompts', () => {
  describe("default ('tool') framing", () => {
    it('exposes the offered tool name and JSON call fields for the auto branch', () => {
      const out = createToolPrompts(tools, { type: 'auto' })!;
      expect(out).toContain('send_message');
      expect(out).toMatch(/\[\s*\{\s*"tool"\s*:/);
      expect(out).toMatch(/"arguments"\s*:/);
    });

    it('describes the unwrapped required branch as a bare list of calls', () => {
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
      const schemaBlock = out.match(/- Arguments: \n```([\s\S]*?)```/)?.[1];
      expect(JSON.parse(schemaBlock!)).toEqual({
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

    it('describes the unwrapped required branch with action calls', () => {
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

  describe('wrapped (constrained-decoding) required branch', () => {
    it('describes the wrapper object under the schema keys for action framing', () => {
      const out = createToolPrompts(tools, { type: 'required' }, 'action', true)!;
      expect(out).toMatch(/\{\s*"actions"\s*:\s*\[/);
      expect(out).toContain('send_message');
      expect(out).toMatch(/"action"\s*:/);
      expect(out).toMatch(/"arguments"\s*:/);
    });

    it("uses the framing's listKey wrapper under tool framing", () => {
      const out = createToolPrompts(tools, { type: 'required' }, 'tool', true)!;
      expect(out).toMatch(/\{\s*"tools"\s*:\s*\[/);
      expect(out).toContain('send_message');
      expect(out).toMatch(/"tool"\s*:/);
      expect(out).toMatch(/"arguments"\s*:/);
    });

    it('keeps the auto branch as an array when wrapped mode is requested', () => {
      const out = createToolPrompts(tools, { type: 'auto' }, 'action', true)!;
      expect(out).not.toMatch(/"actions":\s*\[/);
      expect(out).toMatch(/\[\s*\{\s*"action"\s*:/);
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

  const wrapped = (text: string) => JSON.parse(text.match(/```json\n([\s\S]*)\n```/)![1]);

  it('wraps a single emulated call under the actions key when wrapped', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'send_message', input: { text: 'hi' } },
      ] },
    ] as any, 'action', true);
    const parts = out[0].content;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('text');
    expect(wrapped(parts[0].text)).toEqual({ actions: [{ action: 'send_message', arguments: { text: 'hi' } }] });
  });

  it('groups multiple emulated calls into one wrapper text part, preserving order', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'found_city', input: { name: 'Rome' } },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'send_message', input: { text: 'hi' } },
      ] },
    ] as any, 'action', true);
    const parts = out[0].content;
    expect(parts).toHaveLength(1);
    expect(wrapped(parts[0].text).actions).toEqual([
      { action: 'found_city', arguments: { name: 'Rome' } },
      { action: 'send_message', arguments: { text: 'hi' } },
    ]);
  });

  it('emits a bare array with no wrapper key when not wrapped (default)', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'send_message', input: { text: 'hi' } },
      ] },
    ] as any, 'action');
    const parsed = wrapped(out[0].content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual([{ action: 'send_message', arguments: { text: 'hi' } }]);
    expect(JSON.stringify(out)).not.toContain('"actions"');
  });

  it('uses tools/tool under tool framing and actions/action under action framing when wrapped', () => {
    const toolFramed: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'send_message', input: {} }] },
    ] as any, 'tool', true);
    const toolParsed = wrapped(toolFramed[0].content[0].text);
    expect(toolParsed.tools[0]).toHaveProperty('tool', 'send_message');

    const actionFramed: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'send_message', input: {} }] },
    ] as any, 'action', true);
    const actionParsed = wrapped(actionFramed[0].content[0].text);
    expect(actionParsed.actions[0]).toHaveProperty('action', 'send_message');
  });

  it('leaves a provider-executed tool-call native and wraps only the emulated call', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'r1', toolName: 'Read', input: { file: 'x' }, providerExecuted: true },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'send_message', input: { text: 'hi' } },
      ] },
    ] as any, 'action', true);
    const parts = out[0].content;
    const readPart = parts.find((p: any) => p.type === 'tool-call');
    expect(readPart.toolName).toBe('Read');
    expect(readPart.providerExecuted).toBe(true);
    const textPart = parts.find((p: any) => p.type === 'text');
    expect(wrapped(textPart.text)).toEqual({ actions: [{ action: 'send_message', arguments: { text: 'hi' } }] });
    expect(JSON.stringify(out)).not.toContain('"action": "Read"');
  });

  it('flushes a wrapper before interleaved prose, yielding separate wrapper parts', () => {
    const out: any = convertPromptToolMessagesToText([
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'found_city', input: { name: 'Rome' } },
        { type: 'text', text: 'thinking...' },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'send_message', input: { text: 'hi' } },
      ] },
    ] as any, 'action', true);
    const parts = out[0].content;
    expect(parts).toHaveLength(3);
    expect(parts[1]).toEqual({ type: 'text', text: 'thinking...' });
    expect(wrapped(parts[0].text).actions).toEqual([{ action: 'found_city', arguments: { name: 'Rome' } }]);
    expect(wrapped(parts[2].text).actions).toEqual([{ action: 'send_message', arguments: { text: 'hi' } }]);
  });
});
