/**
 * Mock-tier unit tests for the Summarizer agent (src/telepathist/summarizer.ts).
 *
 * Summarizer is a PROMPT BUILDER (getSystem/getInitialMessages) plus a
 * content-hash-cached helper (summarizeWithCache) and an instruction builder
 * (buildToolSummaryInstruction). These tests assert shared template fragments by
 * reference, dynamic input values, branch behavior, and cache hit/miss via the
 * callAgent spy — never whole-prompt snapshots, prose, or hash values.
 */

import { describe, it, expect, beforeEach } from 'vitest';
// Import the registry first so the full agent graph initializes before the
// leaf summarizer module is evaluated, avoiding a circular-import TDZ error.
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { createFakeVoxContext, FakeVoxContext } from '../../helpers/fake-vox-context.js';
import { getPromptSet } from '../../../src/utils/prompts/prompt-files.js';
import {
  buildToolSummaryInstruction,
  summarizeWithCache,
  type SummarizerInput,
} from '../../../src/telepathist/summarizer.js';
import type { TelepathistParameters } from '../../../src/telepathist/telepathist-parameters.js';

const summarizer = agentRegistry.get('summarizer') as any;

/**
 * A minimal in-memory stand-in for the telepathist DB summary_cache table,
 * implementing only the Kysely fluent chains that summarizeWithCache uses:
 * selectFrom(...).select(...).where(...).executeTakeFirst() and
 * insertInto(...).values(...).onConflict(...).execute().
 */
function makeFakeTelepathistDb() {
  const store = new Map<string, { result: string }>();
  const inserts: Array<{ model?: string }> = [];
  return {
    store,
    inserts,
    selectFrom() {
      let key: string | undefined;
      const chain: any = {
        select: () => chain,
        where: (_col: string, _op: string, value: string) => {
          key = value;
          return chain;
        },
        async executeTakeFirst() {
          return key !== undefined ? store.get(key) : undefined;
        },
      };
      return chain;
    },
    insertInto() {
      let values: any;
      const chain: any = {
        values: (v: any) => {
          values = v;
          return chain;
        },
        onConflict: (_cb: any) => chain,
        async execute() {
          inserts.push(values);
          if (values && !store.has(values.cacheKey)) {
            store.set(values.cacheKey, { result: values.result });
          }
        },
      };
      return chain;
    },
  };
}

/** Build a minimal TelepathistParameters matching the real shape for these tests. */
function makeTelepathistParameters(
  overrides: Partial<TelepathistParameters> = {}
): TelepathistParameters {
  return {
    playerID: 1,
    gameID: 'test-game',
    turn: 100,
    databasePath: '/tmp/test.db',
    db: {} as any,
    telepathistDb: makeFakeTelepathistDb() as any,
    civilizationName: 'Rome',
    leaderName: 'Augustus Caesar',
    availableTurns: [10, 20, 30],
    ...overrides,
  } as TelepathistParameters;
}

let ctx: FakeVoxContext;

beforeEach(() => {
  ctx = createFakeVoxContext();
  // Resolve getModelConfig('summarizer', ...) cleanly on the cache-miss insert path.
  ctx.modelOverrides = { summarizer: { name: 'fake-model' } as any };
});

describe('Summarizer', () => {
  describe('getSystem', () => {
    it('includes the shared historian guidelines fragment', async () => {
      const params = makeTelepathistParameters();
      const input: SummarizerInput = { text: 'data', instruction: 'do it' };

      const system = await summarizer.getSystem(params, input, ctx.asContext());

      expect(system).toContain(getPromptSet().render('shared/historian-guidelines'));
    });

    it('includes the dynamic leader and civilization names', async () => {
      const params = makeTelepathistParameters({
        leaderName: 'Pacal',
        civilizationName: 'Maya',
      });
      const input: SummarizerInput = { text: 'data', instruction: 'do it' };

      const system = await summarizer.getSystem(params, input, ctx.asContext());

      expect(system).toContain('Pacal');
      expect(system).toContain('Maya');
    });
  });

  describe('getInitialMessages', () => {
    it('includes the exact instruction and text', async () => {
      const params = makeTelepathistParameters();
      const input: SummarizerInput = {
        text: 'RAW_TEXT_VALUE',
        instruction: 'INSTRUCTION_VALUE',
      };

      const messages = await summarizer.getInitialMessages(params, input, ctx.asContext());

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toContain('INSTRUCTION_VALUE');
      expect(messages[0].content).toContain('RAW_TEXT_VALUE');
    });

    it('includes the optional reminder when provided', async () => {
      const params = makeTelepathistParameters();
      const input: SummarizerInput = {
        text: 'RAW_TEXT_VALUE',
        instruction: 'INSTRUCTION_VALUE',
        reminder: 'REMINDER_VALUE',
      };

      const messages = await summarizer.getInitialMessages(params, input, ctx.asContext());

      expect(messages[0].content).toContain('REMINDER_VALUE');
    });

    it('omits a reminder section when no reminder is provided', async () => {
      const params = makeTelepathistParameters();
      const input: SummarizerInput = { text: 'data', instruction: 'do it' };

      const messages = await summarizer.getInitialMessages(params, input, ctx.asContext());

      expect(messages[0].content).not.toContain('# Reminder');
    });

    it('wraps non-heading data in a # Data section', async () => {
      const params = makeTelepathistParameters();
      const input: SummarizerInput = { text: 'plain text', instruction: 'do it' };

      const messages = await summarizer.getInitialMessages(params, input, ctx.asContext());

      expect(messages[0].content).toContain('# Data\nplain text');
    });

    it('preserves data that already begins with a heading', async () => {
      const params = makeTelepathistParameters();
      const input: SummarizerInput = {
        text: '# Situation\nalready headed',
        instruction: 'do it',
      };

      const messages = await summarizer.getInitialMessages(params, input, ctx.asContext());

      expect(messages[0].content).toContain('# Situation\nalready headed');
      expect(messages[0].content).not.toContain('# Data\n# Situation');
    });
  });

  describe('buildToolSummaryInstruction', () => {
    it.each([
      ['no inquiry', undefined, ['get-cities']],
      ['an inquiry', 'WHAT_IS_THE_INQUIRY', ['get-cities', 'WHAT_IS_THE_INQUIRY']],
    ] as Array<[string, string | undefined, string[]]>)('includes the tool name and %s', (_label, inquiry, expectedParts) => {
      const instruction = buildToolSummaryInstruction('get-cities', inquiry);
      for (const part of expectedParts) {
        expect(instruction).toContain(part);
      }
    });
  });

  describe('summarizeWithCache', () => {
    it.each([
      ['an explicit summarizer assignment', { summarizer: { provider: 'openai', name: 'explicit-summarizer' } }, 'explicit-summarizer'],
      ['the routine alias when summarizer is unassigned', { small: { provider: 'openai', name: 'routine-model' } }, 'routine-model'],
      ['the main alias when neither summarizer nor routine is assigned', { default: { provider: 'openai', name: 'main-model' } }, 'main-model'],
    ])('records %s on a cache miss', async (_description, overrides, expectedModel) => {
      const params = makeTelepathistParameters();
      const input: SummarizerInput = { text: 'data', instruction: 'do it' };
      ctx.modelOverrides = overrides as any;
      ctx.callAgent.mockResolvedValue('summary text');

      await summarizeWithCache(input, params, ctx.asContext() as any);

      expect((params.telepathistDb as any).inserts[0].model).toBe(expectedModel);
    });

    it('stores a cache miss by invoking callAgent', async () => {
      const params = makeTelepathistParameters();
      const input: SummarizerInput = { text: 'data', instruction: 'do it' };
      ctx.callAgent.mockResolvedValue('summary text');

      const result = await summarizeWithCache(input, params, ctx.asContext() as any);

      expect(result).toBe('summary text');
      expect(ctx.callAgent).toHaveBeenCalledTimes(1);
      expect((params.telepathistDb as any).store.size).toBe(1);
    });

    it('returns a cache hit WITHOUT calling callAgent', async () => {
      const params = makeTelepathistParameters();
      const input: SummarizerInput = { text: 'data', instruction: 'do it' };
      ctx.callAgent.mockResolvedValue('summary text');

      // First call populates the cache.
      await summarizeWithCache(input, params, ctx.asContext() as any);
      ctx.callAgent.mockClear();

      // Second identical call should hit the cache.
      const result = await summarizeWithCache(input, params, ctx.asContext() as any);

      expect(result).toBe('summary text');
      expect(ctx.callAgent).not.toHaveBeenCalled();
    });

    it.each([
      ['text', { text: 'text A', instruction: 'do it' }, { text: 'text B', instruction: 'do it' }],
      ['instruction', { text: 'data', instruction: 'instruction A' }, { text: 'data', instruction: 'instruction B' }],
      ['reminder', { text: 'data', instruction: 'do it', reminder: 'remind A' }, { text: 'data', instruction: 'do it', reminder: 'remind B' }],
    ] as Array<[string, SummarizerInput, SummarizerInput]>)('treats changed %s as a distinct cache entry', async (_label, first, second) => {
      const params = makeTelepathistParameters();
      ctx.callAgent.mockResolvedValue('summary text');

      await summarizeWithCache(first, params, ctx.asContext() as any);
      await summarizeWithCache(second, params, ctx.asContext() as any);

      expect(ctx.callAgent).toHaveBeenCalledTimes(2);
      expect((params.telepathistDb as any).store.size).toBe(2);
    });
  });
});
