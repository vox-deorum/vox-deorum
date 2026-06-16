/**
 * Mock-tier unit tests for `src/utils/models/text-cleaning.ts`.
 *
 * Covers turn-marker stripping, tool-call artifact cleanup, tool call/result
 * text formatting branches, truncation/error placeholders, and the
 * toolChoice-driven rescue prompt branch. JSON extraction is tested elsewhere,
 * so it is intentionally NOT covered here.
 *
 * Assertions target removed markers/artifacts, parsed payloads, and branch
 * behavior via substring/regex/JSON checks — never whole-string equality.
 */

import { describe, expect, it } from 'vitest';
import {
  stripTurnMarker,
  cleanToolArtifacts,
  formatToolCallText,
  formatToolResultText,
  formatToolResultOutput,
  buildRescuePrompt,
} from '../../../src/utils/models/text-cleaning.js';

describe('text-cleaning', () => {
  describe('stripTurnMarker', () => {
    it('removes a leading [Turn N] marker and surrounding whitespace', () => {
      const out = stripTurnMarker('[Turn 12]   hello world');
      expect(out).toBe('hello world');
    });

    it('leaves text without a leading turn marker unchanged', () => {
      expect(stripTurnMarker('no marker here')).toBe('no marker here');
    });

    it('only strips a leading marker, not one mid-string', () => {
      const out = stripTurnMarker('intro [Turn 3] trailing');
      expect(out).toContain('[Turn 3]');
    });
  });

  describe('cleanToolArtifacts', () => {
    it('removes a complete delimiter-based tool calls section', () => {
      const input =
        'before <|tool_calls_section_begin|>junk<|tool_calls_section_end|> after';
      const out = cleanToolArtifacts(input);
      expect(out).not.toContain('tool_calls_section');
      expect(out).toContain('before');
      expect(out).toContain('after');
    });

    it('truncates an incomplete tool calls section (begin without end)', () => {
      const input = 'keep me <|tool_calls_section_begin|>dangling tail';
      const out = cleanToolArtifacts(input);
      expect(out).toContain('keep me');
      expect(out).not.toContain('dangling tail');
      expect(out).not.toContain('tool_calls_section');
    });

    it('removes complete and truncates incomplete single tool_call blocks', () => {
      const complete = cleanToolArtifacts('x<|tool_call_begin|>a<|tool_call_end|>y');
      expect(complete).not.toContain('tool_call');
      expect(complete).toContain('x');
      expect(complete).toContain('y');

      const incomplete = cleanToolArtifacts('head <|tool_call_begin|>tail');
      expect(incomplete).toContain('head');
      expect(incomplete).not.toContain('tail');
    });

    it('removes complete and truncates incomplete bracket-based TOOL_CALL blocks', () => {
      const complete = cleanToolArtifacts('a[TOOL_CALL]payload[/TOOL_CALL]b');
      expect(complete).not.toContain('TOOL_CALL');
      expect(complete).not.toContain('payload');
      expect(complete).toContain('a');
      expect(complete).toContain('b');

      const incomplete = cleanToolArtifacts('start [TOOL_CALL]unterminated');
      expect(incomplete).toContain('start');
      expect(incomplete).not.toContain('unterminated');
    });

    it('removes leftover individual and standalone markers', () => {
      const input =
        'a<|tool_call_argument_begin|>b<|tool_call_argument_end|>c[/TOOL_CALL]d';
      const out = cleanToolArtifacts(input);
      expect(out).not.toMatch(/tool_call/);
      expect(out).not.toContain('TOOL_CALL');
      expect(out).toContain('a');
      expect(out).toContain('d');
    });

    it('removes empty/comma-only JSON arrays', () => {
      expect(cleanToolArtifacts('result []')).not.toContain('[]');
      expect(cleanToolArtifacts('result [ , , ]')).not.toMatch(/\[\s*,/);
    });

    it('removes empty markdown code blocks and standalone fences', () => {
      const out = cleanToolArtifacts('text\n```json\n\n```\nmore');
      expect(out).toContain('text');
      expect(out).toContain('more');
      expect(out).not.toContain('```');
    });

    it('removes minimax:tool_call artifact lines', () => {
      const out = cleanToolArtifacts('summary\nminimax:tool_call');
      expect(out).not.toContain('minimax:tool_call');
      expect(out).toContain('summary');
    });

    it('trims the final result', () => {
      const out = cleanToolArtifacts('   padded   ');
      expect(out).toBe('padded');
    });
  });

  describe('formatToolCallText', () => {
    it('parses a JSON string argument into structured args', () => {
      const out = formatToolCallText('myTool', '{"a":1,"b":"two"}');
      const fenced = out.match(/```json\n([\s\S]*)\n```/);
      expect(fenced).not.toBeNull();
      const parsed = JSON.parse(fenced![1]);
      expect(parsed).toEqual([{ tool: 'myTool', arguments: { a: 1, b: 'two' } }]);
    });

    it('keeps an object argument as-is', () => {
      const out = formatToolCallText('toolX', { foo: 'bar' });
      const fenced = out.match(/```json\n([\s\S]*)\n```/);
      const parsed = JSON.parse(fenced![1]);
      expect(parsed[0]).toEqual({ tool: 'toolX', arguments: { foo: 'bar' } });
    });

    it('keeps an unparseable string argument as a raw string', () => {
      const out = formatToolCallText('toolY', 'not json');
      const fenced = out.match(/```json\n([\s\S]*)\n```/);
      const parsed = JSON.parse(fenced![1]);
      expect(parsed[0]).toEqual({ tool: 'toolY', arguments: 'not json' });
    });
  });

  describe('formatToolResultText', () => {
    it('includes the tool name in a result heading and the result body', () => {
      const out = formatToolResultText('searchDB', 'the body');
      expect(out).toMatch(/#\s*Tool\s+searchDB\s+Result/);
      expect(out).toContain('the body');
    });
  });

  describe('formatToolResultOutput', () => {
    it('serializes text output', () => {
      const out = formatToolResultOutput({
        toolName: 'echo',
        output: { type: 'text', value: 'plain text' },
      });
      expect(out).toContain('echo');
      expect(out).toContain('plain text');
    });

    it('passes a json string value through directly', () => {
      const out = formatToolResultOutput({
        toolName: 'j',
        output: { type: 'json', value: 'already a string' },
      });
      expect(out).toContain('already a string');
    });

    it('renders a json object value via markdown (not raw JSON)', () => {
      const out = formatToolResultOutput({
        toolName: 'j',
        output: { type: 'json', value: { Alpha: 1 } },
      });
      expect(out).toContain('Alpha');
      expect(out).not.toContain('{"Alpha"');
    });

    it('formats error-text with an Error prefix when not truncating', () => {
      const out = formatToolResultOutput({
        toolName: 'fail',
        output: { type: 'error-text', value: 'boom' },
      });
      expect(out).toContain('Error: boom');
    });

    it('collapses error-text to [Error] placeholder when maxLength is set', () => {
      const out = formatToolResultOutput(
        { toolName: 'fail', output: { type: 'error-text', value: 'boom' } },
        1000
      );
      expect(out).toContain('[Error]');
      expect(out).not.toContain('boom');
    });

    it('formats error-json and collapses to [Error] when maxLength is set', () => {
      const verbose = formatToolResultOutput({
        toolName: 'fail',
        output: { type: 'error-json', value: { code: 42 } },
      });
      expect(verbose).toContain('Error:');
      expect(verbose).toContain('code');

      const truncated = formatToolResultOutput(
        { toolName: 'fail', output: { type: 'error-json', value: { code: 42 } } },
        1000
      );
      expect(truncated).toContain('[Error]');
      expect(truncated).not.toContain('code');
    });

    it('returns undefined for content output', () => {
      const out = formatToolResultOutput({
        toolName: 'c',
        output: { type: 'content', value: [{ type: 'text', text: 'x' }] },
      });
      expect(out).toBeUndefined();
    });

    it('JSON-stringifies an unknown output type via the default branch', () => {
      const out = formatToolResultOutput({
        toolName: 'weird',
        output: { type: 'mystery', value: { k: 'v' } },
      });
      expect(out).toContain('mystery');
      expect(out).toContain('weird');
    });

    it('appends a [Truncated] placeholder when text exceeds maxLength', () => {
      const long = 'x'.repeat(500);
      const out = formatToolResultOutput(
        { toolName: 'big', output: { type: 'text', value: long } },
        50
      );
      expect(out).toContain('[Truncated]');
      expect(out!.length).toBeLessThan(long.length);
    });

    it('does not truncate when maxLength is -1 (default)', () => {
      const long = 'y'.repeat(500);
      const out = formatToolResultOutput({
        toolName: 'big',
        output: { type: 'text', value: long },
      });
      expect(out).not.toContain('[Truncated]');
      expect(out).toContain(long);
    });
  });

  describe('buildRescuePrompt', () => {
    it('uses the tool-mandating branch for "required"', () => {
      const out = buildRescuePrompt('required');
      expect(out).toMatch(/MUST call/);
    });

    it('uses the tool-mandating branch for "tool"', () => {
      const out = buildRescuePrompt('tool');
      expect(out).toMatch(/MUST call/);
    });

    it('uses the flexible branch for other toolChoice values', () => {
      const out = buildRescuePrompt('auto');
      expect(out).not.toMatch(/MUST call/);
      expect(out).toMatch(/text response/);
    });
  });
});
