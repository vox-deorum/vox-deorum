/**
 * Mock-tier unit tests for src/oracle/utils/prompt-extractor.ts.
 *
 * Exercises telemetry span traversal against a seeded in-memory Kysely/SQLite
 * telemetry database: latest-valid strategist.turn.N root selection, target-agent
 * selection + fallback, system/message/tool/model extraction, malformed-JSON
 * tolerance, and rationale fuzzy matching. System/message payloads are opaque
 * placeholders; assertions cover structural facts only.
 */

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractPrompt, findTurnByRationale } from '../../../src/oracle/utils/prompt-extractor.js';
import type { NewSpan, TelemetryDatabase } from '../../../src/utils/telemetry/schema.js';

// ---------------------------------------------------------------------------
// In-memory telemetry DB helpers
// ---------------------------------------------------------------------------

let sqlite: Database.Database;
let db: Kysely<TelemetryDatabase>;
let seq = 0;

function openMemoryDb(): void {
  sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE spans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contextId TEXT NOT NULL,
      turn INTEGER,
      traceId TEXT NOT NULL,
      spanId TEXT NOT NULL,
      parentSpanId TEXT,
      name TEXT NOT NULL,
      startTime INTEGER NOT NULL,
      endTime INTEGER NOT NULL,
      durationMs INTEGER NOT NULL,
      attributes TEXT,
      statusCode INTEGER NOT NULL,
      statusMessage TEXT
    );
  `);
  db = new Kysely<TelemetryDatabase>({ dialect: new SqliteDialect({ database: sqlite }) });
  seq = 0;
}

/** Insert one span row; attributes are JSON-stringified to match the real exporter. */
async function insertSpan(span: {
  turn: number | null;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startTime?: number;
  attributes?: Record<string, unknown> | string | null;
}): Promise<void> {
  const startTime = span.startTime ?? ++seq;
  const attrs =
    span.attributes === undefined
      ? null
      : typeof span.attributes === 'string' || span.attributes === null
        ? (span.attributes as string | null)
        : JSON.stringify(span.attributes);

  const row: NewSpan = {
    contextId: 'ctx-1',
    turn: span.turn,
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    startTime,
    endTime: startTime + 1,
    durationMs: 1,
    attributes: attrs as NewSpan['attributes'],
    statusCode: 1,
    statusMessage: null,
  };
  await db.insertInto('spans').values(row).execute();
}

/**
 * Seed a full single-trace turn: one strategist.turn.N root, one agent span,
 * one step span carrying the prompt attributes.
 */
async function seedTurn(opts: {
  turn: number;
  traceId: string;
  rootName?: string;
  agentName?: string;
  agentAttrs?: Record<string, unknown> | string | null;
  stepAttrs?: Record<string, unknown> | string | null;
  startTime?: number;
}): Promise<{ rootId: string; agentId: string; stepId: string }> {
  const base = opts.startTime ?? ++seq * 100;
  const rootId = `${opts.traceId}-root`;
  const agentId = `${opts.traceId}-agent`;
  const stepId = `${opts.traceId}-step`;

  await insertSpan({
    turn: opts.turn,
    traceId: opts.traceId,
    spanId: rootId,
    parentSpanId: null,
    name: opts.rootName ?? `strategist.turn.${opts.turn}`,
    startTime: base,
  });
  await insertSpan({
    turn: opts.turn,
    traceId: opts.traceId,
    spanId: agentId,
    parentSpanId: rootId,
    name: `agent.${opts.agentName ?? 'simple-strategist'}`,
    startTime: base + 1,
    attributes: opts.agentAttrs ?? { model: 'anthropic/claude-sonnet-4-6@high' },
  });
  await insertSpan({
    turn: opts.turn,
    traceId: opts.traceId,
    spanId: stepId,
    parentSpanId: agentId,
    name: 'ai.streamText.doStream',
    startTime: base + 2,
    attributes:
      opts.stepAttrs ?? {
        'step.messages': JSON.stringify([
          { role: 'system', content: 'SYS_A' },
          { role: 'user', content: 'USER_A' },
        ]),
        'step.tools': JSON.stringify(['set-flavors', 'set-strategy']),
      },
  });

  return { rootId, agentId, stepId };
}

beforeEach(() => {
  openMemoryDb();
});

afterEach(async () => {
  await db.destroy();
  sqlite.close();
});

describe('oracle prompt-extractor', () => {
  describe('extractPrompt root span selection', () => {
    it('returns null when no root spans exist for the turn', async () => {
      const result = await extractPrompt(db, 99);
      expect(result).toBeNull();
    });

    it('returns null when root spans exist but none match strategist.turn.N', async () => {
      await insertSpan({ turn: 5, traceId: 't1', spanId: 'r1', parentSpanId: null, name: 'some.other.root' });
      const result = await extractPrompt(db, 5);
      expect(result).toBeNull();
    });

    it('selects the LATEST valid strategist.turn.N root among botched retries', async () => {
      // Two earlier roots are botched retries; the last (latest startTime) wins.
      await seedTurn({
        turn: 7,
        traceId: 'early',
        startTime: 10,
        stepAttrs: {
          'step.messages': JSON.stringify([{ role: 'system', content: 'EARLY_SYS' }, { role: 'user', content: 'u' }]),
          'step.tools': JSON.stringify(['old-tool']),
        },
        agentAttrs: { model: 'old/model@low' },
      });
      await seedTurn({
        turn: 7,
        traceId: 'late',
        startTime: 20,
        stepAttrs: {
          'step.messages': JSON.stringify([{ role: 'system', content: 'LATE_SYS' }, { role: 'user', content: 'u' }]),
          'step.tools': JSON.stringify(['new-tool']),
        },
        agentAttrs: { model: 'new/model@high' },
      });

      const result = await extractPrompt(db, 7);
      expect(result).not.toBeNull();
      // Proves the late trace was chosen (its agent/step attributes flow through).
      expect(result!.system).toEqual(['LATE_SYS']);
      expect(result!.activeTools).toEqual(['new-tool']);
      expect(result!.modelString).toBe('new/model@high');
    });

    it('ignores non-turn root spans that share the turn number', async () => {
      await insertSpan({ turn: 8, traceId: 'noise', spanId: 'n1', parentSpanId: null, name: 'strategist.summary' });
      await seedTurn({ turn: 8, traceId: 'good', startTime: 30 });

      const result = await extractPrompt(db, 8);
      expect(result).not.toBeNull();
      expect(result!.agentName).toBe('simple-strategist');
    });
  });

  describe('extractPrompt agent selection', () => {
    it('auto-detects the strategist agent when no target is given', async () => {
      const traceId = 'multi';
      await insertSpan({ turn: 1, traceId, spanId: 'root', parentSpanId: null, name: 'strategist.turn.1' });
      // A non-strategist agent appears first in startTime order.
      await insertSpan({
        turn: 1,
        traceId,
        spanId: 'a-helper',
        parentSpanId: 'root',
        name: 'agent.helper',
        startTime: 1,
        attributes: { model: 'h/model@low' },
      });
      await insertSpan({
        turn: 1,
        traceId,
        spanId: 'a-strat',
        parentSpanId: 'root',
        name: 'agent.simple-strategist',
        startTime: 2,
        attributes: { model: 's/model@high' },
      });
      await insertSpan({
        turn: 1,
        traceId,
        spanId: 'step-strat',
        parentSpanId: 'a-strat',
        name: 'step',
        startTime: 3,
        attributes: {
          'step.messages': JSON.stringify([{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]),
          'step.tools': JSON.stringify(['set-flavors']),
        },
      });

      const result = await extractPrompt(db, 1);
      expect(result).not.toBeNull();
      expect(result!.agentName).toBe('simple-strategist');
      expect(result!.modelString).toBe('s/model@high');
    });

    it('falls back to the first agent when none contains "strategist"', async () => {
      const traceId = 'nostrat';
      await insertSpan({ turn: 2, traceId, spanId: 'root', parentSpanId: null, name: 'strategist.turn.2' });
      await insertSpan({
        turn: 2,
        traceId,
        spanId: 'a-first',
        parentSpanId: 'root',
        name: 'agent.alpha',
        startTime: 1,
        attributes: { model: 'a/first@low' },
      });
      await insertSpan({
        turn: 2,
        traceId,
        spanId: 'a-second',
        parentSpanId: 'root',
        name: 'agent.beta',
        startTime: 2,
        attributes: { model: 'b/second@low' },
      });
      await insertSpan({
        turn: 2,
        traceId,
        spanId: 'step-first',
        parentSpanId: 'a-first',
        name: 'step',
        startTime: 3,
        attributes: {
          'step.messages': JSON.stringify([{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]),
          'step.tools': JSON.stringify(['t']),
        },
      });

      const result = await extractPrompt(db, 2);
      expect(result).not.toBeNull();
      expect(result!.agentName).toBe('alpha');
      expect(result!.modelString).toBe('a/first@low');
    });

    it('selects the explicitly requested target agent', async () => {
      const traceId = 'targeted';
      await insertSpan({ turn: 3, traceId, spanId: 'root', parentSpanId: null, name: 'strategist.turn.3' });
      await insertSpan({
        turn: 3,
        traceId,
        spanId: 'a-strat',
        parentSpanId: 'root',
        name: 'agent.simple-strategist',
        startTime: 1,
        attributes: { model: 's/model@high' },
      });
      await insertSpan({
        turn: 3,
        traceId,
        spanId: 'a-spokes',
        parentSpanId: 'root',
        name: 'agent.spokesperson',
        startTime: 2,
        attributes: { model: 'spokes/model@low' },
      });
      await insertSpan({
        turn: 3,
        traceId,
        spanId: 'step-spokes',
        parentSpanId: 'a-spokes',
        name: 'step',
        startTime: 3,
        attributes: {
          'step.messages': JSON.stringify([{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]),
          'step.tools': JSON.stringify(['speak']),
        },
      });

      const result = await extractPrompt(db, 3, 'spokesperson');
      expect(result).not.toBeNull();
      expect(result!.agentName).toBe('spokesperson');
      expect(result!.modelString).toBe('spokes/model@low');
      expect(result!.activeTools).toEqual(['speak']);
    });

    it('returns null when the requested target agent is absent', async () => {
      await seedTurn({ turn: 4, traceId: 'noagent' });
      const result = await extractPrompt(db, 4, 'does-not-exist');
      expect(result).toBeNull();
    });

    it('returns null when there are no agent spans at all', async () => {
      await insertSpan({ turn: 6, traceId: 'bare', spanId: 'root', parentSpanId: null, name: 'strategist.turn.6' });
      const result = await extractPrompt(db, 6);
      expect(result).toBeNull();
    });
  });

  describe('extractPrompt field extraction', () => {
    it('splits system parts from conversation messages', async () => {
      await seedTurn({
        turn: 10,
        traceId: 'split',
        stepAttrs: {
          'step.messages': JSON.stringify([
            { role: 'system', content: 'SYS_1' },
            { role: 'system', content: [{ type: 'text', text: 'SYS_2a' }, { type: 'text', text: 'SYS_2b' }] },
            { role: 'user', content: 'USER_MSG' },
            { role: 'assistant', content: 'ASSISTANT_MSG' },
          ]),
          'step.tools': JSON.stringify(['set-flavors']),
        },
      });

      const result = await extractPrompt(db, 10);
      expect(result).not.toBeNull();
      // Array-content system message is joined with newline; strings pass through.
      expect(result!.system).toEqual(['SYS_1', 'SYS_2a\nSYS_2b']);
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    });

    it('parses active tools from step.tools', async () => {
      await seedTurn({
        turn: 11,
        traceId: 'tools',
        stepAttrs: {
          'step.messages': JSON.stringify([{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]),
          'step.tools': JSON.stringify(['set-flavors', 'set-strategy', 'keep-status-quo']),
        },
      });

      const result = await extractPrompt(db, 11);
      expect(result!.activeTools).toEqual(['set-flavors', 'set-strategy', 'keep-status-quo']);
    });

    it('reads the model from the agent span attributes', async () => {
      await seedTurn({
        turn: 12,
        traceId: 'agentmodel',
        agentAttrs: { model: 'openai-compatible/Kimi-K2.5@medium' },
      });
      const result = await extractPrompt(db, 12);
      expect(result!.modelString).toBe('openai-compatible/Kimi-K2.5@medium');
    });

    it('falls back to the step model when the agent span has none', async () => {
      await seedTurn({
        turn: 13,
        traceId: 'stepmodel',
        agentAttrs: {},
        stepAttrs: {
          model: 'fallback/from-step@low',
          'step.messages': JSON.stringify([{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]),
          'step.tools': JSON.stringify(['t']),
        },
      });
      const result = await extractPrompt(db, 13);
      expect(result!.modelString).toBe('fallback/from-step@low');
    });

    it('returns null when the first step has no messages', async () => {
      await seedTurn({
        turn: 14,
        traceId: 'nomsg',
        stepAttrs: { 'step.tools': JSON.stringify(['t']) },
      });
      const result = await extractPrompt(db, 14);
      expect(result).toBeNull();
    });

    it('returns null when no step spans exist under the agent', async () => {
      const traceId = 'nostep';
      await insertSpan({ turn: 15, traceId, spanId: 'root', parentSpanId: null, name: 'strategist.turn.15' });
      await insertSpan({
        turn: 15,
        traceId,
        spanId: 'agent',
        parentSpanId: 'root',
        name: 'agent.simple-strategist',
        startTime: 1,
        attributes: { model: 'm/m@low' },
      });
      const result = await extractPrompt(db, 15);
      expect(result).toBeNull();
    });
  });

  describe('extractPrompt malformed-JSON tolerance', () => {
    it('treats a malformed step.messages attribute as empty (no throw, null result)', async () => {
      await seedTurn({
        turn: 20,
        traceId: 'badjson',
        stepAttrs: {
          'step.messages': '{ this is not valid json',
          'step.tools': JSON.stringify(['t']),
        },
      });
      // parseJson returns the raw string for malformed JSON; not an array -> null.
      await expect(extractPrompt(db, 20)).resolves.toBeNull();
    });

    it('tolerates a malformed top-level attributes column without throwing', async () => {
      const traceId = 'badattrs';
      await insertSpan({ turn: 21, traceId, spanId: 'root', parentSpanId: null, name: 'strategist.turn.21' });
      // Agent attributes column is not valid JSON -> parseAttributes returns {}.
      await insertSpan({
        turn: 21,
        traceId,
        spanId: 'agent',
        parentSpanId: 'root',
        name: 'agent.simple-strategist',
        startTime: 1,
        attributes: 'not-json-at-all',
      });
      await insertSpan({
        turn: 21,
        traceId,
        spanId: 'step',
        parentSpanId: 'agent',
        name: 'step',
        startTime: 2,
        attributes: {
          model: 'recovered/model@low',
          'step.messages': JSON.stringify([{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]),
          'step.tools': JSON.stringify(['t']),
        },
      });

      const result = await extractPrompt(db, 21);
      expect(result).not.toBeNull();
      // Agent model unreadable -> falls back to the step model.
      expect(result!.modelString).toBe('recovered/model@low');
    });
  });

  describe('findTurnByRationale', () => {
    async function seedToolCall(turn: number, traceId: string, rationale: string): Promise<void> {
      await insertSpan({ turn, traceId, spanId: `${traceId}-root`, parentSpanId: null, name: `strategist.turn.${turn}` });
      await insertSpan({
        turn,
        traceId,
        spanId: `${traceId}-agent`,
        parentSpanId: `${traceId}-root`,
        name: 'agent.simple-strategist',
        startTime: 1,
        attributes: { model: 'm/m@low' },
      });
      await insertSpan({
        turn,
        traceId,
        spanId: `${traceId}-step`,
        parentSpanId: `${traceId}-agent`,
        name: 'step',
        startTime: 2,
      });
      await insertSpan({
        turn,
        traceId,
        spanId: `${traceId}-tool`,
        parentSpanId: `${traceId}-step`,
        name: 'tool.set-flavors',
        startTime: 3,
        attributes: { 'tool.input': JSON.stringify({ Rationale: rationale, GrandStrategy: 'Conquest' }) },
      });
    }

    it('returns true when a tool call Rationale fuzzy-matches above the threshold', async () => {
      await seedToolCall(30, 'match', 'Pursue an aggressive conquest strategy against neighbors');
      const found = await findTurnByRationale(
        db,
        30,
        'Pursue an aggressive conquest strategy against neighbors'
      );
      expect(found).toBe(true);
    });

    it('returns false when the Rationale is too dissimilar', async () => {
      await seedToolCall(31, 'nomatch', 'Build wonders and focus on a peaceful cultural victory');
      const found = await findTurnByRationale(db, 31, 'Declare immediate war on every civilization nearby', 0.75);
      expect(found).toBe(false);
    });

    it('returns false when there is no valid root span for the turn', async () => {
      const found = await findTurnByRationale(db, 999, 'anything');
      expect(found).toBe(false);
    });

    it('returns false when tool calls carry no Rationale arg', async () => {
      const traceId = 'norat';
      await insertSpan({ turn: 32, traceId, spanId: 'root', parentSpanId: null, name: 'strategist.turn.32' });
      await insertSpan({
        turn: 32,
        traceId,
        spanId: 'agent',
        parentSpanId: 'root',
        name: 'agent.simple-strategist',
        startTime: 1,
        attributes: { model: 'm/m@low' },
      });
      await insertSpan({ turn: 32, traceId, spanId: 'step', parentSpanId: 'agent', name: 'step', startTime: 2 });
      await insertSpan({
        turn: 32,
        traceId,
        spanId: 'tool',
        parentSpanId: 'step',
        name: 'tool.x',
        startTime: 3,
        attributes: { 'tool.input': JSON.stringify({ SomethingElse: 'value' }) },
      });

      const found = await findTurnByRationale(db, 32, 'some rationale');
      expect(found).toBe(false);
    });
  });
});
