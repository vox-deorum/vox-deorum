/**
 * Tests for rescuing JSON tool calls embedded in free-form model text.
 */
import { describe, it, expect } from 'vitest';
import { rescueToolCallsFromText, isStructuredOutputToolName } from '../../../src/utils/models/tool-rescue/extract.js';

const tools = new Set(['get-data', 'set-strategy', 'end-turn']);

describe('isStructuredOutputToolName', () => {
  it('matches the claude-code constrained-decoding carrier (any prefix)', () => {
    expect(isStructuredOutputToolName('claude-code-tool.StructuredOutput')).toBe(true);
    expect(isStructuredOutputToolName('StructuredOutput')).toBe(true);
    expect(isStructuredOutputToolName('mcp__x__StructuredOutput')).toBe(true);
    expect(isStructuredOutputToolName('structuredoutput')).toBe(true); // case-insensitive
  });

  it('does not match game tools or provider built-ins', () => {
    expect(isStructuredOutputToolName('send-message')).toBe(false);
    expect(isStructuredOutputToolName('Read')).toBe(false);
    expect(isStructuredOutputToolName('mcp__game__end-turn')).toBe(false);
  });
});

describe('argument-key case normalization (toolSchemas)', () => {
  const schemas = new Map<string, any>([
    ['send-message', { type: 'object', properties: { Message: { type: 'string' } } }],
  ]);
  const named = new Set(['send-message']);

  it('rewrites a case-mismatched key to the schema casing (message → Message)', () => {
    const text = '{"action":"send-message","arguments":{"message":"hi"}}';
    const result = rescueToolCallsFromText(text, named, true, schemas);
    expect(result.toolCalls).toHaveLength(1);
    expect(JSON.parse(result.toolCalls[0].input)).toEqual({ Message: 'hi' });
  });

  it('rewrites nested keys inside array items (deep, schema-driven)', () => {
    const dealSchemas = new Map<string, any>([
      ['propose-deal', {
        type: 'object',
        properties: {
          Give: { type: 'array', items: { type: 'object', properties: { Term: { type: 'string' }, Amount: { type: 'integer' } } } },
        },
      }],
    ]);
    const text = '{"action":"propose-deal","arguments":{"Give":[{"term":"Gold Per Turn","amount":3}]}}';
    const result = rescueToolCallsFromText(text, new Set(['propose-deal']), true, dealSchemas);
    expect(JSON.parse(result.toolCalls[0].input)).toEqual({ Give: [{ Term: 'Gold Per Turn', Amount: 3 }] });
  });

  it('leaves keys without a case-insensitive schema match untouched', () => {
    const text = '{"action":"send-message","arguments":{"Message":"hi","extra":1}}';
    const result = rescueToolCallsFromText(text, named, true, schemas);
    expect(JSON.parse(result.toolCalls[0].input)).toEqual({ Message: 'hi', extra: 1 });
  });

  it('does not clobber an already-correct key when a variant is also present', () => {
    const text = '{"action":"send-message","arguments":{"Message":"keep","message":"drop"}}';
    const result = rescueToolCallsFromText(text, named, true, schemas);
    // Message is already present, so the lowercase variant is not folded onto it.
    expect(JSON.parse(result.toolCalls[0].input).Message).toBe('keep');
  });

  it('is a no-op without a schema map (keys pass through)', () => {
    const text = '{"action":"send-message","arguments":{"message":"hi"}}';
    const result = rescueToolCallsFromText(text, named);
    expect(JSON.parse(result.toolCalls[0].input)).toEqual({ message: 'hi' });
  });

  it('does not silently drop a value when two variants fold to the same schema key', () => {
    // `message` and `MESSAGE` both case-fold to `Message`; the first claims the canonical key and
    // the second is left as-is rather than overwriting it, so no value vanishes silently.
    const text = '{"action":"send-message","arguments":{"message":"first","MESSAGE":"second"}}';
    const result = rescueToolCallsFromText(text, named, true, schemas);
    const args = JSON.parse(result.toolCalls[0].input);
    expect(args.Message).toBe('first');
    expect(args.MESSAGE).toBe('second');
  });
});

describe('rescueToolCallsFromText', () => {
  describe('delimiter format', () => {
    it('should rescue a delimiter-based tool call', () => {
      const text = '<|tool_call_begin|>functions.get_data:0<|tool_call_argument_begin|>{"playerId": 3}<|tool_call_end|>';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('get-data');
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ playerId: 3 });
      expect(result.remainingText).toBeUndefined();
    });

    it('should rescue multiple delimiter tool calls and keep surrounding text', () => {
      const text = 'Let me check.\n' +
        '<|tool_call_begin|>get_data:0<|tool_call_argument_begin|>{"a":1}<|tool_call_end|>' +
        '<|tool_call_begin|>end_turn:1<|tool_call_argument_begin|>{}<|tool_call_end|>';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls.map(tc => tc.toolName)).toEqual(['get-data', 'end-turn']);
      expect(result.remainingText).toBe('Let me check.');
    });

    it('should skip delimiter calls referencing unavailable tools', () => {
      const text = '<|tool_call_begin|>functions.unknown_tool:0<|tool_call_argument_begin|>{"a":1}<|tool_call_end|>';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toEqual([]);
    });
  });

  describe('object-wrapped array (constrained-output shape)', () => {
    it('unwraps a single array property so { actions: [...] } parses like a bare array', () => {
      const text = '{"actions": [{"action": "get-data", "arguments": {"x": 1}}, {"action": "end-turn", "arguments": {}}]}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls.map(tc => tc.toolName)).toEqual(['get-data', 'end-turn']);
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ x: 1 });
    });

    it('still parses a bare single tool-call object (no wrapper) unchanged', () => {
      const text = '{"action": "get-data", "arguments": {"x": 2}}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('get-data');
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ x: 2 });
    });

    it('descends into the known wrapper key even beside an unrelated array sibling', () => {
      // A `metadata` array must not be mistaken for the tool-call list; the named `actions` wins.
      const text = '{"metadata": ["v1"], "actions": [{"action": "get-data", "arguments": {"x": 1}}]}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls.map(tc => tc.toolName)).toEqual(['get-data']);
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ x: 1 });
    });

    it('strips a bare wrapper remnant instead of leaving it as free text', () => {
      // `{"actions":}` is the leftover shell of the constrained-decoding envelope after the
      // real calls were extracted natively. It carries no tool call, must not warn, and must
      // be consumed rather than leaked downstream as free text.
      const text = '{"actions":}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toEqual([]);
      expect(result.remainingText).toBeUndefined();
    });

    it('strips an empty-array wrapper remnant while keeping surrounding prose', () => {
      const text = 'Sure. {"actions": []}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toEqual([]);
      expect(result.remainingText).toBe('Sure.');
    });

    it('keeps a wrapper block that held a real-but-unavailable call (genuine failure, not a husk)', () => {
      const text = '{"actions": [{"action": "nonexistent-tool", "arguments": {}}]}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toEqual([]);
      expect(result.remainingText).toBe(text);
    });

    it('preserves prose held under a wrapper key instead of stripping it as a husk', () => {
      // A wrapper key can carry genuine model prose (`{"actions": "<text>"}`) rather than an
      // emptied array/null. That is NOT the husk — stripping it would silently discard the
      // model's turn. It is kept as free text; only truly empty wrapper values are consumed.
      const text = '{"actions": "I recommend building a settler to expand our empire."}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toEqual([]);
      expect(result.remainingText).toBe(text);
    });
  });

  describe('markdown code blocks', () => {
    it('should rescue a tool call from a ```json block', () => {
      const text = 'I will call a tool.\n```json\n{"name": "get-data", "parameters": {"x": 1}}\n```\nDone.';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('get-data');
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ x: 1 });
      expect(result.remainingText).toBe('I will call a tool. Done.');
    });

    it('should rescue an array of tool calls from a code block', () => {
      const text = '```json\n[{"name": "get-data", "parameters": {"a": 1}}, {"name": "end-turn", "parameters": {"b": 2}}]\n```';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls.map(tc => tc.toolName)).toEqual(['get-data', 'end-turn']);
      expect(result.remainingText).toBeUndefined();
    });

    it('should rescue an array of action-key objects (claude-code framing)', () => {
      // The exact shape the 'action' framing prompt instructs the model to emit.
      const text = '```json\n[\n  { "action": "get-data", "arguments": { "a": 1 } },\n  { "action": "end-turn", "arguments": {} }\n]\n```';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls.map(tc => tc.toolName)).toEqual(['get-data', 'end-turn']);
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ a: 1 });
    });
  });

  describe('raw JSON blocks', () => {
    it('should rescue from a bare JSON object using name/parameters', () => {
      const text = '{"name": "set-strategy", "parameters": {"strategy": "war"}}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('set-strategy');
    });

    it('should support the toolName/input field pattern', () => {
      const text = '{"toolName": "get-data", "input": {"k": "v"}}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toHaveLength(1);
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ k: 'v' });
    });

    it('should support the tool/arguments field pattern', () => {
      const text = '{"tool": "end-turn", "arguments": {"confirm": true}}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('end-turn');
    });

    it('should support the action/arguments field pattern (claude-code framing)', () => {
      const text = '{"action": "end-turn", "arguments": {"confirm": true}}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('end-turn');
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ confirm: true });
    });

    it('should normalize underscores in tool names to hyphens', () => {
      const text = '{"name": "set_strategy", "parameters": {"strategy": "peace"}}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls[0].toolName).toBe('set-strategy');
    });

    it('preserves an underscore tool name when that is the real tool (exact match wins)', () => {
      // If the available tool genuinely has underscores, an exact match must round-trip rather
      // than being hyphenated into a name that no longer exists.
      const underscored = new Set(['set_strategy']);
      const text = '{"name": "set_strategy", "parameters": {"strategy": "peace"}}';
      const result = rescueToolCallsFromText(text, underscored);
      expect(result.toolCalls[0].toolName).toBe('set_strategy');
    });

    it('should extract the JSON embedded in surrounding prose', () => {
      const text = 'Thinking... {"name": "get-data", "parameters": {"a": 1}} hope that works';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.remainingText).toBe('Thinking... hope that works');
    });

    it('should handle nested braces and strings containing brackets', () => {
      const text = '{"name": "get-data", "parameters": {"query": "a {weird} [string]", "nested": {"deep": [1, 2]}}}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toHaveLength(1);
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({
        query: 'a {weird} [string]',
        nested: { deep: [1, 2] },
      });
    });
  });

  describe('flattened tool calls (name field with sibling arguments)', () => {
    const ksqTools = new Set(['keep-status-quo']);
    const ksqSchemas = new Map<string, any>([
      ['keep-status-quo', { type: 'object', properties: { PlayerID: { type: 'number' }, Rationale: { type: 'string' } } }],
    ]);

    it('rescues the claude-code payload: array item with action + flattened Rationale', () => {
      const text = '[\n  {\n    "action": "keep-status-quo",\n    "Rationale": "Current strategy is on track."\n  }\n]';
      const result = rescueToolCallsFromText(text, ksqTools, true, ksqSchemas);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('keep-status-quo');
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ Rationale: 'Current strategy is on track.' });
      expect(result.remainingText).toBeUndefined();
    });

    it('normalizes flattened argument-key casing via the schema (rationale → Rationale)', () => {
      const text = '{"action": "keep-status-quo", "rationale": "hold"}';
      const result = rescueToolCallsFromText(text, ksqTools, true, ksqSchemas);
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ Rationale: 'hold' });
    });

    it('rescues a flattened single object (not array)', () => {
      const text = '{"action": "get-data", "x": 1}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls[0].toolName).toBe('get-data');
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ x: 1 });
    });

    it('rescues a bare no-argument call', () => {
      const result = rescueToolCallsFromText('{"action": "end-turn"}', tools);
      expect(result.toolCalls[0].toolName).toBe('end-turn');
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({});
    });

    it('drops a nullish nested params key instead of treating it as an argument', () => {
      const result = rescueToolCallsFromText('{"action": "end-turn", "arguments": null}', tools);
      expect(result.toolCalls[0].toolName).toBe('end-turn');
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({});
    });

    it('descends into the actions wrapper and rescues a flattened item inside it', () => {
      const text = '{"actions": [{"action": "get-data", "x": 2}]}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls.map(tc => tc.toolName)).toEqual(['get-data']);
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ x: 2 });
    });

    it('nested pattern wins over the flattened interpretation when both are possible', () => {
      const text = '{"action": "get-data", "arguments": {"x": 1}, "note": "ignored"}';
      const result = rescueToolCallsFromText(text, tools);
      expect(JSON.parse(result.toolCalls[0].input)).toEqual({ x: 1 });
    });

    it('keeps a flattened unknown tool unrescuable (text preserved)', () => {
      const text = '{"action": "bogus", "x": 1}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toEqual([]);
      expect(result.remainingText).toBe(text);
    });

    it('refuses an ambiguous object with two name fields', () => {
      const text = '{"tool": "get-data", "action": "end-turn"}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toEqual([]);
      expect(result.remainingText).toBe(text);
    });
  });

  describe('failure cases', () => {
    it('should return plain text untouched with no tool calls', () => {
      const text = 'Just a normal sentence without any JSON.';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toEqual([]);
      expect(result.remainingText).toBe(text);
    });

    it('should reject tool calls for unavailable tools', () => {
      const text = '{"name": "rm-rf", "parameters": {"path": "/"}}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toEqual([]);
      expect(result.remainingText).toBe(text);
    });

    it('should reject JSON without a recognized field pattern', () => {
      const text = '{"foo": "bar", "baz": 42}';
      const result = rescueToolCallsFromText(text, tools);
      expect(result.toolCalls).toEqual([]);
      expect(result.remainingText).toBe(text);
    });
  });

  describe('strict mode (useJaison = false)', () => {
    it('should skip rescue when a ```json block is present', () => {
      const text = 'Partial output ```json\n{"name": "get-data"';
      const result = rescueToolCallsFromText(text, tools, false);
      expect(result.toolCalls).toEqual([]);
      expect(result.remainingText).toBe(text);
    });

    it('should still parse strictly valid JSON', () => {
      const text = '{"name": "get-data", "parameters": {"a": 1}}';
      const result = rescueToolCallsFromText(text, tools, false);
      expect(result.toolCalls).toHaveLength(1);
    });

    it('should reject lenient-only JSON in strict mode but rescue it in lenient mode', () => {
      // Trailing comma: invalid for JSON.parse, repairable by jaison
      const text = '{"name": "get-data", "parameters": {"a": 1,}}';
      const strict = rescueToolCallsFromText(text, tools, false);
      expect(strict.toolCalls).toEqual([]);
      expect(strict.remainingText).toBe(text);

      const lenient = rescueToolCallsFromText(text, tools, true);
      expect(lenient.toolCalls).toHaveLength(1);
      expect(JSON.parse(lenient.toolCalls[0].input)).toEqual({ a: 1 });
    });
  });

  it('should assign unique tool call IDs', () => {
    const text = '```json\n[{"name": "get-data", "parameters": {"a": 1}}, {"name": "get-data", "parameters": {"a": 2}}]\n```';
    const result = rescueToolCallsFromText(text, tools);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].toolCallId).not.toBe(result.toolCalls[1].toolCallId);
  });
});
