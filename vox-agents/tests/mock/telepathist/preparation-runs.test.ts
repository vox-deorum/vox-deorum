/**
 * Stage-4 run-model tests for telepathist turn/phase preparation.
 *
 * Verifies the concurrent-root behavior introduced when `prepareTurnSummaries` and
 * `preparePhaseSummaries` were migrated to open one `context.withRun({ overrides: { turn } })`
 * per fanned-out task:
 *   - each concurrent task runs in its own root and the summarizer sees that task's own `turn`
 *     override (no two concurrent summaries observe the same turn);
 *   - one task's failure does not cancel its siblings (each task is independently caught);
 *   - a context-length signal on one task is recorded for that turn only, siblings still persist.
 *
 * The heavy collaborators (the DB query tools, the summarizer agent, the instruction/model
 * helpers) are mocked; the focus is the per-task root + turn-override wiring, exercised through
 * the shared FakeVoxContext run-model fake.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Module mocks (declared before importing the code under test) ----------------------------

vi.mock('../../../src/telepathist/tools/get-situation.js', () => ({
  GetSituationTool: vi.fn().mockImplementation(() => ({
    // Must contain '## ' so the "no meaningful data" skip does not trigger.
    execute: vi.fn(async () => ['## Situation section']),
  })),
}));

vi.mock('../../../src/telepathist/tools/get-decision.js', () => ({
  GetDecisionTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn(async () => ['# Turn data']),
  })),
}));

vi.mock('../../../src/telepathist/preparation/instructions.js', () => ({
  turnSummarySchema: {},
  phaseSummarySchema: {},
  buildTurnSummaryInstruction: (turn: number) => [`inst-${turn}`, `rem-${turn}`],
  buildPhaseSummaryInstruction: (from: number, to: number) => [`inst-${from}-${to}`, `rem-${from}-${to}`],
  // Any truthy raw summary parses into a complete summary object.
  parseSummaryMarkdown: (raw: unknown) =>
    raw
      ? {
          situation: 's',
          situationabstract: 'sa',
          decisions: 'd',
          decisionabstract: 'da',
          narrative: 'n',
        }
      : undefined,
}));

vi.mock('../../../src/utils/models/models.js', () => ({
  getModelConfig: () => ({ name: 'test-model' }),
}));

import { prepareTurnSummaries } from '../../../src/telepathist/preparation/turn-preparation.js';
import { preparePhaseSummaries } from '../../../src/telepathist/preparation/phase-preparation.js';
import { createFakeVoxContext } from '../../helpers/fake-vox-context.js';

// --- Minimal kysely-ish stub -----------------------------------------------------------------

/**
 * A chainable query stub: select/selectAll/orderBy/where return the same builder; execute()
 * resolves to the rows preconfigured for the table. insertInto().values().execute() records the
 * inserted row under `inserted[table]`.
 */
function makeDb(tableRows: Record<string, unknown[]>) {
  const inserted: Record<string, unknown[]> = {};
  const builder = (table: string): any => {
    const b: any = {
      select: () => b,
      selectAll: () => b,
      orderBy: () => b,
      where: () => b,
      execute: async () => tableRows[table] ?? [],
    };
    return b;
  };
  const db = {
    selectFrom: (table: string) => builder(table),
    insertInto: (table: string) => ({
      values: (v: unknown) => ({
        execute: async () => {
          (inserted[table] ??= []).push(v);
        },
      }),
    }),
  };
  return { db, inserted };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('prepareTurnSummaries run model', () => {
  it('runs each turn in its own root with its own turn override and persists every turn', async () => {
    const availableTurns = [1, 2, 3, 4, 5];
    const { db, inserted } = makeDb({ turn_summaries: [] });
    const parameters: any = {
      gameID: 'g',
      playerID: 2,
      civilizationName: 'Rome',
      availableTurns,
      telepathistDb: db,
    };

    const ctx = createFakeVoxContext();
    ctx.setBaseParameters(parameters);

    // Record the turn the summarizer observed on each call — taken from the run's composed
    // parameters (callAgent is invoked with run.parameters inside each per-turn root).
    const seenTurns: number[] = [];
    ctx.callAgent.mockImplementation(async () => {
      // callAgent no longer takes a parameters argument; the summarizer's turn comes from the
      // active run's composed parameters (ALS-backed in the fake). Reading it here proves per-run
      // isolation under concurrency rather than a shared-field race.
      const turn = (ctx.currentParameters as { turn: number }).turn;
      seenTurns.push(turn);
      return 'RAW_SUMMARY';
    });

    const exceeded = await prepareTurnSummaries(parameters, ctx.asContext() as any);

    expect(exceeded.size).toBe(0);
    // One root opened per turn, each overriding only `turn`.
    expect(ctx.withRun).toHaveBeenCalledTimes(availableTurns.length);
    for (const call of ctx.withRun.mock.calls) {
      expect(Object.keys((call[0] as any).overrides)).toEqual(['turn']);
    }
    // Every turn was observed exactly once — no two concurrent summaries shared a turn override.
    expect([...seenTurns].sort((a, b) => a - b)).toEqual(availableTurns);
    // Every turn persisted a summary.
    expect(inserted.turn_summaries).toHaveLength(availableTurns.length);
    expect((inserted.turn_summaries as any[]).map((r) => r.turn).sort((a, b) => a - b)).toEqual(
      availableTurns
    );
  });

  it('isolates a failing turn: siblings still persist', async () => {
    const availableTurns = [1, 2, 3];
    const { db, inserted } = makeDb({ turn_summaries: [] });
    const parameters: any = {
      gameID: 'g',
      playerID: 2,
      civilizationName: 'Rome',
      availableTurns,
      telepathistDb: db,
    };

    const ctx = createFakeVoxContext();
    ctx.setBaseParameters(parameters);

    ctx.callAgent.mockImplementation(async () => {
      const turn = (ctx.currentParameters as { turn: number }).turn;
      if (turn === 2) {
        const e = new Error('boom') as Error & { isRetryable: boolean };
        e.isRetryable = false; // fail fast — no backoff retries
        throw e;
      }
      return 'RAW_SUMMARY';
    });

    const exceeded = await prepareTurnSummaries(parameters, ctx.asContext() as any);

    expect(exceeded.size).toBe(0);
    // Turn 2 failed; turns 1 and 3 still persisted independently.
    expect((inserted.turn_summaries ?? []).map((r: any) => r.turn).sort((a, b) => a - b)).toEqual([
      1, 3,
    ]);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('records a context-length turn without cancelling siblings', async () => {
    const availableTurns = [1, 2, 3];
    const { db, inserted } = makeDb({ turn_summaries: [] });
    const parameters: any = {
      gameID: 'g',
      playerID: 2,
      civilizationName: 'Rome',
      availableTurns,
      telepathistDb: db,
    };

    const ctx = createFakeVoxContext();
    ctx.setBaseParameters(parameters);

    ctx.callAgent.mockImplementation(async (...args: unknown[]) => {
      const turn = (ctx.currentParameters as { turn: number }).turn;
      // callAgent(name, input, onContextLengthError) — the callback is now the 3rd positional arg.
      const onContextLengthError = args[2] as (() => void) | undefined;
      if (turn === 3) onContextLengthError?.();
      return 'RAW_SUMMARY';
    });

    const exceeded = await prepareTurnSummaries(parameters, ctx.asContext() as any);

    // Turn 3 flagged as context-exceeded and skipped (no insert); siblings persisted.
    expect([...exceeded]).toEqual([3]);
    expect((inserted.turn_summaries ?? []).map((r: any) => r.turn).sort((a, b) => a - b)).toEqual([
      1, 2,
    ]);
  });
});

describe('preparePhaseSummaries run model', () => {
  it('runs each phase in its own root with the phase end turn as the override', async () => {
    // 25 turn summaries → phases of 10 → toTurns 10, 20, 25.
    const turnRows = Array.from({ length: 25 }, (_, i) => ({
      turn: i + 1,
      situation: 's',
      decisions: 'd',
    }));
    const { db, inserted } = makeDb({ phase_summaries: [], turn_summaries: turnRows });
    const parameters: any = {
      gameID: 'g',
      playerID: 2,
      civilizationName: 'Rome',
      telepathistDb: db,
    };

    const ctx = createFakeVoxContext();
    ctx.setBaseParameters(parameters);

    const seenTurns: number[] = [];
    ctx.callAgent.mockImplementation(async () => {
      const turn = (ctx.currentParameters as { turn: number }).turn;
      seenTurns.push(turn);
      return 'RAW_PHASE_SUMMARY';
    });

    await preparePhaseSummaries(parameters, ctx.asContext() as any);

    // Three phase roots, each overriding `turn` to its phase end turn.
    expect(ctx.withRun).toHaveBeenCalledTimes(3);
    expect([...seenTurns].sort((a, b) => a - b)).toEqual([10, 20, 25]);
    expect((inserted.phase_summaries as any[]).map((r) => r.toTurn).sort((a, b) => a - b)).toEqual([
      10, 20, 25,
    ]);
  });
});
