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
      // Unwrapped by default: teaches a bare array, never the wrapper object.
      expect(out).toMatch(/Respond ONLY with a JSON array/);
      expect(out).not.toMatch(/"tools":\s*\[/);
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

  describe('wrapped (constrained-decoding) required branch', () => {
    it('teaches the wrapper object matching the responseFormat schema under action framing', () => {
      const out = createToolPrompts(tools, { type: 'required' }, 'action', true)!;
      expect(out).toContain('## Action Calling');
      expect(out).toMatch(/Respond ONLY with a JSON object/);
      expect(out).toMatch(/"actions":\s*\[/);
      expect(out).toContain('{ "action": "<action_name>", "arguments": { <parameters> } }');
      // Must NOT reuse the bare-array phrasing that would contradict the enforced grammar.
      expect(out).not.toMatch(/Respond ONLY with a JSON array/);
    });

    it("uses the framing's listKey wrapper under tool framing", () => {
      const out = createToolPrompts(tools, { type: 'required' }, 'tool', true)!;
      expect(out).toContain('## Tool Calling');
      expect(out).toMatch(/"tools":\s*\[/);
      expect(out).toContain('{ "tool": "<tool_name>", "arguments": { <parameters> } }');
    });

    it('only affects the required branch — auto stays bare even when wrapped is true', () => {
      const out = createToolPrompts(tools, { type: 'auto' }, 'action', true)!;
      expect(out).toMatch(/You have access to actions/);
      expect(out).not.toMatch(/"actions":\s*\[/);
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
});
