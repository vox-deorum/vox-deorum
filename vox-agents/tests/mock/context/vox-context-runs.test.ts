/**
 * Run-model tests for VoxContext (src/infra/vox-context.ts).
 *
 * Exercises the concurrent-root-run machinery directly through withRun()/forkRun() and the run
 * handles — no model layer needed. Covers: per-run isolation of parameters, progress callback,
 * timeout callback, abort signal, and token sink; the composed-parameter proxy (override-local
 * vs base-shared writes); forkRun snapshot/detach semantics; and per-run vs context-wide abort.
 *
 * The model-driven slice (execute() token accounting, abort-mid-step, shutdown teardown) lives
 * in vox-context-execute-runs.test.ts, which mocks the telemetry + concurrency layers.
 */

import { describe, it, expect } from 'vitest';
import { VoxContext } from '../../../src/infra/vox-context.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { makeStrategistParameters } from '../../helpers/fake-vox-context.js';

/** Resolve on the next macrotask so concurrently-started runs can interleave. */
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

/** A two-party rendezvous: both runs await arrive() and proceed together. */
function barrier() {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  let count = 0;
  return {
    async arrive() {
      if (++count >= 2) release();
      await gate;
    }
  };
}

describe('VoxContext run model', () => {
  it('isolates parameters, progress, timeout, signal, and token sink across concurrent runs', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'runs-iso');
    const baseA = makeStrategistParameters({ turn: 10 });
    const baseB = makeStrategistParameters({ turn: 20 });
    const spA = () => {};
    const spB = () => {};
    const sync = barrier();

    const captured: Record<string, { turn: number; sp?: unknown; signal: AbortSignal; tokens: unknown }> = {};

    await Promise.all([
      ctx.withRun({ parameters: baseA, overrides: { turn: 100 }, streamProgress: spA }, async run => {
        ctx.timeoutRefresh = () => {}; const trA = ctx.timeoutRefresh;
        await sync.arrive(); // hold both runs active at once
        captured.A = { turn: ctx.currentParameters!.turn, sp: ctx.streamProgress, signal: run.signal, tokens: run.tokens };
        // After interleaving, this run still observes its own callbacks/params, not the sibling's.
        expect(ctx.streamProgress).toBe(spA);
        expect(ctx.timeoutRefresh).toBe(trA);
        expect(ctx.currentParameters!.turn).toBe(100);
      }),
      ctx.withRun({ parameters: baseB, overrides: { turn: 200 }, streamProgress: spB }, async run => {
        await sync.arrive();
        captured.B = { turn: ctx.currentParameters!.turn, sp: ctx.streamProgress, signal: run.signal, tokens: run.tokens };
        expect(ctx.streamProgress).toBe(spB);
        expect(ctx.currentParameters!.turn).toBe(200);
      }),
    ]);

    expect(captured.A.turn).toBe(100);
    expect(captured.B.turn).toBe(200);
    expect(captured.A.sp).toBe(spA);
    expect(captured.B.sp).toBe(spB);
    expect(captured.A.signal).not.toBe(captured.B.signal);
    expect(captured.A.tokens).not.toBe(captured.B.tokens);
    // Overrides never mutate the shared base objects.
    expect(baseA.turn).toBe(10);
    expect(baseB.turn).toBe(20);
  });

  it('reads currentParameters from the active run and falls back to baseParameters outside a run', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'runs-fallback');
    const base = makeStrategistParameters({ turn: 5 });
    expect(ctx.currentParameters).toBeUndefined();

    ctx.setBaseParameters(base);
    expect(ctx.currentParameters).toBe(base); // outside a run → base
    expect(ctx.currentInput).toBeUndefined();

    await ctx.withRun({ overrides: { turn: 42 } }, async () => {
      // Inside the run, the composed proxy overlays the override on the base source.
      expect(ctx.currentParameters!.turn).toBe(42);
      expect(ctx.currentParameters!.gameID).toBe(base.gameID); // non-override reads base
    });

    expect(ctx.currentParameters).toBe(base); // back to base after the run
    expect(base.turn).toBe(5); // override write never reached the base
  });

  it('throws if withRun has neither parameters nor baseParameters', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'runs-noparams');
    await expect(ctx.withRun({}, async () => 'x')).rejects.toThrow(/requires options\.parameters or baseParameters/);
  });

  it('composed proxy: override keys stay run-local; non-override writes go to the shared base', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'runs-proxy');
    const base = makeStrategistParameters({ turn: 1 });
    const sync = barrier();

    await Promise.all([
      ctx.withRun({ parameters: base, overrides: { turn: 100, before: 0, after: 0 } }, async run => {
        run.parameters.turn = 111;           // override key → run-local
        run.parameters.lastDecisionTurn = 7; // non-override key → writes through to base (seat-wide)
        await sync.arrive();
        expect(run.parameters.turn).toBe(111);
      }),
      ctx.withRun({ parameters: base, overrides: { turn: 200 } }, async run => {
        await sync.arrive();
        await tick();
        expect(run.parameters.turn).toBe(200);              // unaffected by sibling's override write
        expect(run.parameters.lastDecisionTurn).toBe(7);    // sees the sibling's base write
      }),
    ]);

    expect(base.turn).toBe(1);            // override write never touched the base
    expect(base.lastDecisionTurn).toBe(7); // base write is seat-wide
  });

  it('run.abort() cancels only its own run; the sibling keeps running', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'runs-abort-one');
    const base = makeStrategistParameters();
    const sync = barrier();
    let aHandle!: { signal: AbortSignal }, bAbortedDuringSibling = false;
    let releaseB!: () => void;
    const bPending = new Promise<void>(r => (releaseB = r));

    await Promise.all([
      ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async run => {
        aHandle = run;
        await sync.arrive();
        run.abort();
        expect(run.signal.aborted).toBe(true);
      }),
      ctx.withRun({ parameters: base, overrides: { turn: 2 } }, async run => {
        await sync.arrive();
        await tick();
        bAbortedDuringSibling = run.signal.aborted; // must be false: sibling abort did not reach us
        releaseB();
        await bPending;
      }),
    ]);

    expect(aHandle.signal.aborted).toBe(true);
    expect(bAbortedDuringSibling).toBe(false);
  });

  it('context.abort() cancels every active run', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'runs-abort-all');
    const base = makeStrategistParameters();
    const sync = barrier();
    const signals: AbortSignal[] = [];

    await Promise.all([
      ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async run => {
        signals.push(run.signal);
        await sync.arrive();
        ctx.abort();
        expect(run.signal.aborted).toBe(true);
      }),
      ctx.withRun({ parameters: base, overrides: { turn: 2 } }, async run => {
        signals.push(run.signal);
        await sync.arrive();
        await tick();
        expect(run.signal.aborted).toBe(true);
      }),
    ]);

    expect(signals.every(s => s.aborted)).toBe(true);
  });

  it('cascades a parent abort to nested child runs while keeping siblings isolated', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'runs-nested-abort');
    const base = makeStrategistParameters();
    ctx.setBaseParameters(base); // children open withRun({ overrides }) and compose over the base

    // A gate that resolves once both child runs are active, and a hold that keeps them running.
    let bothActive!: () => void;
    const ready = new Promise<void>(r => (bothActive = r));
    let arrived = 0;
    let release!: () => void;
    const hold = new Promise<void>(r => (release = r));

    let childA!: { signal: AbortSignal; abort(): void };
    let childB!: { signal: AbortSignal };
    let parent!: { signal: AbortSignal; abort(): void };

    const parentDone = ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async p => {
      parent = p;
      // Two children opened inside the parent run — each links to the parent's signal.
      await Promise.all([
        ctx.withRun({ overrides: { turn: 2 } }, async run => {
          childA = run;
          if (++arrived >= 2) bothActive();
          await hold;
        }),
        ctx.withRun({ overrides: { turn: 3 } }, async run => {
          childB = run;
          if (++arrived >= 2) bothActive();
          await hold;
        }),
      ]);
    });

    await ready; // both children registered and holding

    // Sibling isolation: aborting child A reaches neither child B nor the parent.
    childA.abort();
    expect(childA.signal.aborted).toBe(true);
    expect(childB.signal.aborted).toBe(false);
    expect(parent.signal.aborted).toBe(false);

    // Parent abort cascades into the still-running child.
    parent.abort();
    expect(parent.signal.aborted).toBe(true);
    expect(childB.signal.aborted).toBe(true);

    release();
    await parentDone;
  });

  it('aborts a nested child immediately when the parent is already aborted', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'runs-nested-abort-pre');
    const base = makeStrategistParameters();
    ctx.setBaseParameters(base); // child opens withRun({ overrides }) and composes over the base

    let childSignal!: AbortSignal;
    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async parent => {
      parent.abort(); // parent cancelled before the child opens
      await ctx.withRun({ overrides: { turn: 2 } }, async child => {
        childSignal = child.signal;
      });
    });

    expect(childSignal.aborted).toBe(true);
  });

  it('forkRun snapshots top-level primitives, shares nested state, and detaches cancellation', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'runs-fork');
    const base = makeStrategistParameters({ turn: 7 });
    let forkHandle!: { id: string; signal: AbortSignal; parameters: StrategistParameters; tokens: unknown };
    let forkAborted = false;
    let parentId = '', parentTokens: unknown, parentSignal!: AbortSignal;
    let releaseFork!: () => void;
    const forkRunning = new Promise<void>(r => (releaseFork = r));

    await ctx.withRun({ parameters: base, overrides: { turn: 7 } }, async parent => {
      parentId = parent.id; parentTokens = parent.tokens; parentSignal = parent.signal;
      ctx.forkRun(async child => {
        forkHandle = child;
        child.signal.addEventListener('abort', () => (forkAborted = true));
        await forkRunning;
      });
      // forkRun starts the child synchronously, so its handle is captured before we return.
      expect(forkHandle.parameters.turn).toBe(7);                       // snapshot of the parent turn
      expect(forkHandle.parameters.gameStates).toBe(base.gameStates);   // nested seat state shared by ref
      expect(forkHandle.id).not.toBe(parentId);
      expect(forkHandle.signal).not.toBe(parentSignal);
      expect(forkHandle.tokens).not.toBe(parentTokens);

      // Detached top-level writes don't cross between parent and child.
      forkHandle.parameters.turn = 99;
      expect(parent.parameters.turn).toBe(7);

      parent.abort();
      expect(forkHandle.signal.aborted).toBe(false); // survives the parent's cancellation
    });

    // The parent run has ended but the detached fork is still active.
    expect((ctx as any).activeRuns.size).toBe(1);
    expect(base.turn).toBe(7); // fork's snapshot write never reached the base

    ctx.abort(); // context-wide abort still reaches the fork
    expect(forkHandle.signal.aborted).toBe(true);
    expect(forkAborted).toBe(true);

    releaseFork();
    await tick();
    expect((ctx as any).activeRuns.size).toBe(0);
  });

  it('forkRun throws when called outside a run', () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'runs-fork-outside');
    expect(() => ctx.forkRun(async () => {})).toThrow(/must be called inside an active run/);
  });
});
