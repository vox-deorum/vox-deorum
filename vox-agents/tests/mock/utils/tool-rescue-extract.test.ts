/**
 * Tests for rescuing JSON tool calls embedded in free-form model text.
 */
import { describe, it, expect } from 'vitest';
import { rescueToolCallsFromText } from '../../../src/utils/models/tool-rescue/extract.js';

const tools = new Set(['get-data', 'set-strategy', 'end-turn']);

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
