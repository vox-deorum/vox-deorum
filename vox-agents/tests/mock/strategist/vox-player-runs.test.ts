/**
 * Run-isolation tests for VoxPlayer (src/strategist/vox-player.ts).
 *
 * Drives a couple of real strategist turns through VoxPlayer.execute() with the heavy edges stubbed
 * (timers, telemetry exporters, tool calls, and the strategist agent execution itself). Asserts the
 * Stage-2 contract: each turn opens its own root run via context.withRun() with run-local
 * turn/before/after overrides, the persistent event cursor lives on the player and advances after a
 * successful refresh (so each turn's `after` is the previous turn's `before`), and the context's
 * base strategist parameters are never mutated per turn (turn stays -1).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Make the player's promise-based sleeps instant (turn polling + the post-shutdown settle wait).
// Tests can observe each sleep through `sleepHook.onSleep` to change state between polls.
const sleepHook = vi.hoisted(() => ({ onSleep: undefined as (() => void) | undefined }));
vi.mock('node:timers/promises', () => ({
  setTimeout: () => {
    sleepHook.onSleep?.();
    return Promise.resolve();
  }
}));

import { VoxPlayer } from '../../../src/strategist/vox-player.js';
import { HumanDecisionBus } from '../../../src/strategist/human-decision-bus.js';
import { VoxSpanExporter } from '../../../src/utils/telemetry/vox-exporter.js';
import { spanProcessor, sqliteExporter } from '../../../src/instrumentation.js';
import type { PlayerConfig } from '../../../src/types/config.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import type { VoxRunOptions } from '../../../src/infra/vox-run.js';

const playerConfig: PlayerConfig = { strategist: 'simple-strategist', llms: {} } as PlayerConfig;

beforeEach(() => {
  sleepHook.onSleep = undefined;
  // Telemetry exporters: keep construction + shutdown cheap and offline.
  vi.spyOn(VoxSpanExporter.getInstance(), 'createContext').mockResolvedValue(undefined);
  vi.spyOn(VoxSpanExporter.getInstance(), 'closeContext').mockResolvedValue(undefined);
  vi.spyOn(spanProcessor, 'forceFlush').mockResolvedValue(undefined as never);
  vi.spyOn(sqliteExporter, 'forceFlush').mockResolvedValue(undefined as never);
});

describe('VoxPlayer per-turn root runs', () => {
  it('opens one root per turn with run-local turn/before/after, advances the event cursor, and never mutates the base turn', async () => {
    const player = new VoxPlayer({
      playerID: 1,
      playerConfig,
      gameID: 'game-runs',
      initialTurn: 0,
      humanDecisionBus: new HumanDecisionBus(),
    });

    // All MCP tool calls (pause/resume/set-metadata/keep-status-quo + the six report fetches)
    // resolve to a non-error stand-in so the real ensureGameState/refreshGameState path succeeds.
    vi.spyOn(player.context, 'callTool').mockResolvedValue({} as never);
    // Stub the strategist execution itself — we only care about the surrounding run wiring.
    const decisionMarkers: Array<unknown> = [];
    const execute = vi.spyOn(player.context, 'execute').mockImplementation(async () => {
      decisionMarkers.push(player.context.currentParameters?._decisionEventWindow);
    });

    // Capture each turn's withRun overrides and pump the next turn (then stop) once the turn settles.
    const overridesSeen: Array<Partial<StrategistParameters>> = [];
    const realWithRun = player.context.withRun.bind(player.context);
    vi.spyOn(player.context, 'withRun').mockImplementation((options: VoxRunOptions<StrategistParameters>, cb) => {
      overridesSeen.push(options.overrides ?? {});
      return realWithRun(options, cb as never).then((result) => {
        if (overridesSeen.length === 1) {
          player.notifyTurn(2); // queue a second turn once turn 1 has settled (running=false)
        } else {
          player.abort(true); // stop the loop after the second turn
        }
        return result;
      });
    });

    player.notifyTurn(1);
    await player.execute();

    // Two roots, one per turn, each with run-local overrides.
    expect(overridesSeen).toHaveLength(2);
    expect(overridesSeen[0]).toEqual({ turn: 1, before: 1_999_999, after: 0 });
    // Turn 2's `after` is turn 1's `before`: the event cursor advanced after turn 1's refresh.
    expect(overridesSeen[1]).toEqual({ turn: 2, before: 2_999_999, after: 1_999_999 });

    // The strategist ran once per turn.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.every((c) => c[0] === 'simple-strategist')).toBe(true);
    expect(decisionMarkers).toHaveLength(2);
    expect(decisionMarkers.every((marker) => marker === player.context.getBaseParameters()?._decisionEventWindow)).toBe(true);
    // Successful decisions release the shared pending floor for the next turn.
    expect(player.context.getBaseParameters()?._decisionEventWindow).toEqual({ fromTurn: 3 });
    expect(player.context.getBaseParameters()?.lastDecisionTurn).toBe(2);

    // The context's base parameters were never mutated per turn — turn is purely run-local.
    expect(player.context.getBaseParameters()?.turn).toBe(-1);
  });

  it('should keep the pending event floor when cancellation arrives as execution settles', async () => {
    const player = new VoxPlayer({
      playerID: 1,
      playerConfig,
      gameID: 'game-cancel-floor',
      initialTurn: 0,
      humanDecisionBus: new HumanDecisionBus(),
    });
    vi.spyOn(player.context, 'callTool').mockResolvedValue({} as never);
    vi.spyOn(player.context, 'execute').mockImplementation(async () => {
      player.abort();
    });
    player.notifyTurn(1);

    await player.execute();

    expect(player.context.getBaseParameters()?._decisionEventWindow).toEqual({ fromTurn: 0 });
    expect(player.context.getBaseParameters()?.lastDecisionTurn).toBeUndefined();
  });

  it('should retain a pending turning point across overflowed turns until it leaves the cache window', async () => {
    const player = new VoxPlayer({
      playerID: 1,
      playerConfig,
      gameID: 'game-pending-events',
      initialTurn: 0,
      humanDecisionBus: new HumanDecisionBus(),
    });
    let eventFetches = 0;
    vi.spyOn(player.context, 'callTool').mockImplementation(async (name: string) => {
      if (name === 'get-events') {
        eventFetches++;
        return (eventFetches === 1 ? { '1': [{ Type: 'DeclareWar' }] } : {}) as never;
      }
      return {} as never;
    });
    // The full pending window each turn's first attempt saw, by turn.
    const firstWindows = new Map<number, unknown>();
    vi.spyOn(player.context, 'execute').mockImplementation(async (...args) => {
      const parameters = player.context.currentParameters!;
      if (!firstWindows.has(parameters.turn)) {
        firstWindows.set(parameters.turn, structuredClone(parameters.gameStates[parameters.turn]?.mergedEvents));
      }
      (args[4] as (() => void) | undefined)?.();
    });

    let turnsStarted = 0;
    const realWithRun = player.context.withRun.bind(player.context);
    vi.spyOn(player.context, 'withRun').mockImplementation((options: VoxRunOptions<StrategistParameters>, cb) =>
      realWithRun(options, cb as never).then((result) => {
        turnsStarted++;
        if (turnsStarted < 12) player.notifyTurn(turnsStarted + 1);
        else player.abort(true);
        return result;
      }));

    player.notifyTurn(1);
    await player.execute();

    // With the default cache of 10 turns, turn 1 stays pending through turn 10 and is then released.
    const base = player.context.getBaseParameters()!;
    expect(firstWindows.size).toBe(12);
    for (const [turn, window] of firstWindows) {
      expect(window, `turn ${turn}`).toEqual(turn <= 10 ? { '1': [{ Type: 'DeclareWar' }] } : {});
    }
    expect(base._decisionEventWindow).toEqual({ fromTurn: 3 });
    expect(base.lastDecisionTurn).toBeUndefined();
    expect(base.gameStates[1]).toBeUndefined();
  });

});

describe('VoxPlayer session pause gate', () => {
  /**
   * Drive one queued turn through a paused session. `pauseResults` are the successive
   * pause-game results (later calls succeed). The session is resumed externally after
   * `resumeAfterSleeps` polls, at which point the held state is snapshotted.
   */
  async function runPausedTurn(pauseResults: unknown[], resumeAfterSleeps: number) {
    const session = { paused: true, isPaused() { return this.paused; } };
    const player = new VoxPlayer({
      playerID: 1,
      playerConfig,
      gameID: 'game-paused',
      initialTurn: 0,
      humanDecisionBus: new HumanDecisionBus(),
      session: session as never,
    });

    const results = [...pauseResults];
    const pauseCalls = () => callTool.mock.calls.filter((c) => c[0] === 'pause-game').length;
    const callTool = vi.spyOn(player.context, 'callTool').mockImplementation(async (name: string) =>
      (name === 'pause-game' ? (results.length > 0 ? results.shift() : true) : {}) as never);
    vi.spyOn(player.context, 'execute').mockResolvedValue(undefined);

    const turnsRun: Array<number | undefined> = [];
    const realWithRun = player.context.withRun.bind(player.context);
    vi.spyOn(player.context, 'withRun').mockImplementation((options: VoxRunOptions<StrategistParameters>, cb) => {
      turnsRun.push(options.overrides?.turn);
      return realWithRun(options, cb as never).then((result) => {
        player.abort(true);
        return result;
      });
    });

    // Resume the session from outside after a fixed number of polls, recording what happened while held.
    let sleeps = 0;
    let whilePaused: { pauseCalls: number; turnsRun: number } | undefined;
    sleepHook.onSleep = () => {
      if (++sleeps !== resumeAfterSleeps) return;
      whilePaused = { pauseCalls: pauseCalls(), turnsRun: turnsRun.length };
      session.paused = false;
    };

    player.notifyTurn(1);
    await player.execute();
    return { whilePaused, turnsRun };
  }

  it('should hold the seat once and keep the turn queued until the session resumes', async () => {
    const { whilePaused, turnsRun } = await runPausedTurn([], 10);

    // One hold across all ten polls, and no turn ran while paused.
    expect(whilePaused).toEqual({ pauseCalls: 1, turnsRun: 0 });
    // The held turn ran after resume.
    expect(turnsRun).toEqual([1]);
  });

  it('should retry a failed hold until it succeeds, then stop re-pausing', async () => {
    // A bridge failure (false) and a thrown call (undefined) before the hold succeeds.
    const { whilePaused, turnsRun } = await runPausedTurn([false, undefined], 10);

    expect(whilePaused).toEqual({ pauseCalls: 3, turnsRun: 0 });
    expect(turnsRun).toEqual([1]);
  });
});
