/**
 * Live check of Claude Code native tools against the real CLI. Requires a logged-in Claude Code
 * CLI and spends a few cents of subscription usage per run.
 *
 * A short strategist-style run gets a `bash` tool whose output names a threat, a research tool,
 * and a completion tool. The check confirms the CLI calls the run's tools natively under their
 * plain names, sees their real results, and keeps one query across the run's steps. A second check
 * runs two fresh sessions that share an anchored opening and confirms the second reads it from the
 * prompt cache, which needs the provider patch in `patches/`.
 *
 * Run with: npm run test:claude-code (the live/claude-code tier). Rerun after upgrading the Agent
 * SDK or the Claude Code provider, since the session relies on how the CLI reports tool calls.
 * Set CLAUDE_CODE_MODEL to check a model other than sonnet.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';
import { dynamicTool, jsonSchema, streamText, type ModelMessage } from 'ai';
import { getModel } from '../../../src/utils/models/models.js';
import { ClaudeCodeSession } from '../../../src/utils/models/providers/claude-code-session.js';
import { cacheBreakpoint } from '../../../src/utils/models/cache-breakpoint.js';
import type { Model } from '../../../src/types/index.js';

// Explicit gate: this tier only runs under `npm run test:claude-code`, which sets TEST_TIER, so a
// stray run never spends CLI usage.
const liveClaudeCodeEnabled = process.env.TEST_TIER === 'live/claude-code';

const modelConfig = {
  provider: 'claude-code',
  name: process.env.CLAUDE_CODE_MODEL ?? 'sonnet',
  options: { reasoningEffort: 'low' },
} as Model;

const system = 'You are a Civilization V strategist. Events since your last decision are not in this '
  + 'prompt; they are in your workspace records, which you read with bash. Read them, then decide: '
  + 'if barbarians threaten, research Bronze Working, otherwise Pottery. Then call keep-status-quo.';

describe.skipIf(!liveClaudeCodeEnabled)('Claude Code native tools (live CLI)', () => {
  const session = new ClaudeCodeSession();
  afterAll(() => session.close());

  it('should run the tools natively, see their results, and keep one query across steps', async () => {
    const executed: string[] = [];
    const tools = {
      bash: dynamicTool({
        description: "Run a shell command in the workspace. /workspace/records/turn-N/events-all.md holds that turn's events.",
        inputSchema: jsonSchema({ type: 'object', properties: { Command: { type: 'string' } }, required: ['Command'] }),
        execute: async () => {
          executed.push('bash');
          return 'Turn 30: Ulundi finished a Settler. Barbarians spotted near Ondini.';
        },
      }),
      'set-research': dynamicTool({
        description: 'Set the next technology to research.',
        inputSchema: jsonSchema({ type: 'object', properties: { Technology: { type: 'string' } }, required: ['Technology'] }),
        execute: async (input: any) => {
          executed.push(`set-research:${input.Technology}`);
          return 'Research set.';
        },
      }),
      'keep-status-quo': dynamicTool({
        description: 'Keep the current strategy. Ends your turn.',
        inputSchema: jsonSchema({ type: 'object', properties: { Rationale: { type: 'string' } }, required: ['Rationale'] }),
        execute: async () => {
          executed.push('keep-status-quo');
          return 'Turn ended.';
        },
      }),
    };

    const starts = vi.spyOn(ClaudeCodeSession.prototype as any, 'start');
    const messages: ModelMessage[] = [{ role: 'user', content: 'Turn 31. Decide.' }];
    const stepCalls: string[][] = [];
    const cacheReads: number[] = [];

    for (let step = 0; step < 6 && !executed.includes('keep-status-quo'); step++) {
      const model = getModel(modelConfig, { claudeCodeSession: session, completionTools: ['keep-status-quo'] });
      const result = streamText({ model, tools, system, messages, stopWhen: () => true });
      for await (const _ of result.fullStream) { /* drain */ }
      const [only] = await result.steps;
      const names = only.toolCalls.map((call) => call.toolName);
      console.log(`step ${step}: ${only.finishReason} [${names.join(', ')}]`, JSON.stringify(only.usage));
      stepCalls.push(names);
      cacheReads.push(only.usage.inputTokenDetails?.cacheReadTokens ?? 0);
      messages.push(...(await result.response).messages);
      if (only.finishReason !== 'tool-calls') break;
    }

    // Calls arrive under the run's own names, never the CLI's MCP prefix.
    expect(stepCalls.flat().every((name) => name in tools)).toBe(true);
    // The model read the records before deciding, and acted on what bash returned.
    expect(executed[0]).toBe('bash');
    expect(executed).toContain('set-research:Bronze Working');
    expect(executed.at(-1)).toBe('keep-status-quo');
    expect(stepCalls.length).toBeGreaterThan(1);
    // Every step continued the same live query, which keeps the context cached.
    expect(starts).toHaveBeenCalledTimes(1);
    expect(cacheReads.slice(1).every((tokens) => tokens > 0)).toBe(true);
  }, 180_000);

  it('should read an anchored opening from the cache in a fresh session', async () => {
    // A long opening, unique to this test run so the first session cannot find it in the cache.
    const nonce = Date.now().toString(36);
    const rules = Array.from({ length: 300 }, (_, i) => `Standing order ${nonce}-${i}: keep unit ${i} posted at its current city.`);
    const opening: ModelMessage = { role: 'system', content: rules.join('\n'), providerOptions: { ...cacheBreakpoint } };
    const tools = {
      'keep-status-quo': dynamicTool({
        description: 'Keep the current strategy. Ends your turn.',
        inputSchema: jsonSchema({ type: 'object', properties: { Rationale: { type: 'string' } }, required: ['Rationale'] }),
        execute: async () => 'Turn ended.',
      }),
    };

    /** Run one step in a fresh session and return its tool calls and cache read tokens. */
    const runOnce = async (turn: number) => {
      const fresh = new ClaudeCodeSession();
      try {
        const model = getModel(modelConfig, { claudeCodeSession: fresh, completionTools: ['keep-status-quo'] });
        const messages: ModelMessage[] = [opening, { role: 'user', content: `Turn ${turn}. Nothing changed. Call keep-status-quo now.` }];
        const result = streamText({ model, tools, messages, allowSystemInMessages: true, stopWhen: () => true });
        for await (const _ of result.fullStream) { /* drain */ }
        const [only] = await result.steps;
        console.log(`turn ${turn}: ${only.finishReason}`, JSON.stringify(only.usage));
        return { calls: only.toolCalls.map((call) => call.toolName), cacheRead: only.usage.inputTokenDetails?.cacheReadTokens ?? 0 };
      } finally {
        fresh.close();
      }
    };

    const first = await runOnce(40);
    const second = await runOnce(41);

    // Native tools still work when the prompt goes out as separate blocks.
    expect(first.calls).toEqual(['keep-status-quo']);
    expect(second.calls).toEqual(['keep-status-quo']);
    // The second session reads the opening (several thousand tokens) on top of the CLI's own prefix.
    expect(second.cacheRead - first.cacheRead).toBeGreaterThan(2000);
  }, 180_000);
});
