/**
 * Timeline tests for VoxPlayer (src/strategist/vox-player.ts): reloads, startup notifications,
 * busy reloads, turn recording, and the seat store's lifecycle.
 *
 * The loop runs for real with instant timers. Each time it goes idle it takes the next scripted
 * step (usually a turn notification) and stops when the script runs out. Tool calls and the
 * strategist execution are stubbed. File-enabled seats open real stores in a temporary telemetry
 * folder, and a stand-in recorder commits one `turn` commit per recorded turn.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sleepHook = vi.hoisted(() => ({ onSleep: undefined as (() => void) | undefined }));
vi.mock('node:timers/promises', () => ({
  setTimeout: () => {
    sleepHook.onSleep?.();
    return Promise.resolve();
  }
}));

vi.mock('../../../src/strategist/pacing/triage.js', () => ({
  runStrategistTriage: async () => undefined,
}));

import { VoxPlayer } from '../../../src/strategist/vox-player.js';
import { HumanDecisionBus } from '../../../src/strategist/human-decision-bus.js';
import { VoxSpanExporter } from '../../../src/utils/telemetry/vox-exporter.js';
import { spanProcessor, sqliteExporter } from '../../../src/instrumentation.js';
import { config } from '../../../src/utils/config.js';
import { WorkspaceStore } from '../../../src/utils/workspace/workspace-store.js';
import { turnEventWindow, type StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import type { PlayerConfig } from '../../../src/types/config.js';
import type { VoxRunOptions } from '../../../src/infra/vox-run.js';

/** What the strategist saw when it ran on a turn. */
interface Decision {
  turn: number;
  workingMemory: Record<string, string>;
  lastDecisionTurn?: number;
  fromTurn?: number;
  cachedTurns: number[];
}

let telemetryDir: string;
let savedTelemetryDir: string | undefined;

beforeEach(() => {
  sleepHook.onSleep = undefined;
  savedTelemetryDir = config.telemetryDir;
  telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-timeline-'));
  config.telemetryDir = telemetryDir;
  vi.spyOn(VoxSpanExporter.getInstance(), 'createContext').mockResolvedValue(undefined);
  vi.spyOn(VoxSpanExporter.getInstance(), 'closeContext').mockResolvedValue(undefined);
  vi.spyOn(spanProcessor, 'forceFlush').mockResolvedValue(undefined as never);
  vi.spyOn(sqliteExporter, 'forceFlush').mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  config.telemetryDir = savedTelemetryDir as string;
  try {
    fs.rmSync(telemetryDir, { recursive: true, force: true });
  } catch {
    // A store left open by a failed test can keep the folder locked on Windows.
  }
});

/** Build a seat. `files` turns on the seat store and the stand-in recorder. */
function makeSeat(options: { gameID: string; initialTurn: number; files?: boolean; everyTurns?: number; failRecord?: (turn: number) => boolean }) {
  const playerConfig = {
    strategist: 'simple-strategist',
    llms: {},
    files: options.files ? 'write' : false,
    pacing: { everyTurns: options.everyTurns ?? 1 },
  } as PlayerConfig;
  const player = new VoxPlayer({
    playerID: 1,
    slot: '1',
    playerConfig,
    gameID: options.gameID,
    initialTurn: options.initialTurn,
    humanDecisionBus: new HumanDecisionBus(),
  });

  const callTool = vi.spyOn(player.context, 'callTool').mockResolvedValue({} as never);

  // Per-turn side effects run while the strategist decides on that turn.
  const duringDecision = new Map<number, () => void | Promise<void>>();
  const decisions: Decision[] = [];
  const execute = vi.spyOn(player.context, 'execute').mockImplementation(async () => {
    const parameters = player.context.currentParameters!;
    decisions.push({
      turn: parameters.turn,
      workingMemory: { ...parameters.workingMemory },
      lastDecisionTurn: parameters.lastDecisionTurn,
      fromTurn: parameters._decisionEventWindow?.fromTurn,
      cachedTurns: Object.keys(parameters.gameStates).map(Number),
    });
    await duringDecision.get(parameters.turn)?.();
  });

  // Each turn's run-local overrides, in order.
  const runs: Array<Partial<StrategistParameters>> = [];
  const realWithRun = player.context.withRun.bind(player.context);
  vi.spyOn(player.context, 'withRun').mockImplementation((runOptions: VoxRunOptions<StrategistParameters>, cb) => {
    if (runOptions.overrides?.turn !== undefined) runs.push(runOptions.overrides);
    return realWithRun(runOptions, cb as never);
  });

  // The stand-in recorder commits one turn commit to the real store.
  const recordTurn = vi.fn((parameters: StrategistParameters) => {
    if (options.failRecord?.(parameters.turn)) throw new Error(`record failed for turn ${parameters.turn}`);
    return player.context.store!.commit({
      kind: 'turn',
      turn: parameters.turn,
      author: 'host',
      changes: [{ path: `records/turn-${parameters.turn}/players.md`, type: 'file', content: `turn ${parameters.turn}` }],
    });
  });
  const records = vi.spyOn(player.context, 'records').mockReturnValue({ recordTurn } as never);

  return { player, callTool, execute, decisions, duringDecision, runs, recordTurn, records };
}

/** Run the loop, taking one scripted step each time it goes idle, and stop when the steps run out. */
async function drive(player: VoxPlayer, steps: Array<() => void>): Promise<void> {
  sleepHook.onSleep = () => {
    const step = steps.shift();
    if (step) step();
    else player.abort(true);
  };
  await player.execute();
}

/** Open the seat's store again after its loop closed it. */
function reopenStore(gameID: string): WorkspaceStore {
  return WorkspaceStore.open(WorkspaceStore.pathFor(gameID, 1));
}

/** The turns `fetch` was called for, in order. */
function fetchedTurns(callTool: ReturnType<typeof makeSeat>['callTool'], tool: string): number[] {
  return callTool.mock.calls.filter((call) => call[0] === tool).map((call) => (call[2] as StrategistParameters).turn);
}

describe('VoxPlayer timeline', () => {
  describe('reloads', () => {
    it('should reset live state and decide on turn 50 when it follows turn 60 with the same player', async () => {
      const seat = makeSeat({ gameID: 'reload-live', initialTurn: 59, everyTurns: 5 });
      seat.duringDecision.set(59, () => {
        seat.player.context.getBaseParameters()!.workingMemory.plan = 'expand';
      });

      await drive(seat.player, [() => seat.player.notifyTurn(59), () => seat.player.notifyTurn(60), () => seat.player.notifyTurn(50)]);

      // Turn 60 is a paced skip; turn 50 decides as a new session would.
      expect(seat.decisions.map((decision) => decision.turn)).toEqual([59, 50]);
      const reloaded = seat.decisions[1];
      expect(reloaded.workingMemory).toEqual({});
      expect(reloaded.lastDecisionTurn).toBeUndefined();
      expect(reloaded.fromTurn).toBe(50);
      // Turn 50 was fetched fresh, and the old timeline's states are gone.
      expect(fetchedTurns(seat.callTool, 'get-players')).toEqual([59, 60, 50]);
      expect(reloaded.cachedTurns).toEqual([50]);
      // The event cursor restarted at turn 50.
      expect(seat.runs.map((run) => run.after)).toEqual([
        turnEventWindow(59).after,
        turnEventWindow(59).before,
        turnEventWindow(50).after,
      ]);
    });

    it('should cancel a running chat so its note commits nothing, and rewind records and notes together', async () => {
      const gameID = 'reload-store';
      const seat = makeSeat({ gameID, initialTurn: 48, files: true });
      const store = seat.player.context.store!;
      let releaseChat!: () => void;
      let chat: Promise<unknown> | undefined;
      seat.duringDecision.set(49, () => {
        store.commit({ kind: 'notes', turn: 49, author: 'simple-strategist', changes: [{ path: 'game/turn-49.md', type: 'file', content: 'keep' }] });
      });
      seat.duringDecision.set(55, () => {
        store.commit({ kind: 'notes', turn: 55, author: 'simple-strategist', changes: [{ path: 'game/babylon.md', type: 'file', content: 'betrayed' }] });
      });
      seat.duringDecision.set(56, () => {
        // A long chat commits a note tagged with an older turn after later turns were recorded,
        // then starts another note that is still in flight when the reload arrives.
        store.commit({ kind: 'notes', turn: 49, author: 'diplomat', changes: [{ path: 'game/late.md', type: 'file', content: 'late' }] });
        const gate = new Promise<void>((resolve) => { releaseChat = resolve; });
        chat = seat.player.context.withRun({}, async (run) => {
          await gate;
          return store.commit({ kind: 'notes', turn: 56, author: 'diplomat', changes: [{ path: 'game/chat.md', type: 'file', content: 'chat' }], signal: run.signal });
        });
        // The reloaded turn 50 lets the cancelled chat try to commit.
        seat.duringDecision.set(50, () => releaseChat());
      });

      const steps = [49, 50, 51, 52, 53, 54, 55, 56, 50].map((turn) => () => { seat.player.notifyTurn(turn); });
      await drive(seat.player, steps);

      await expect(chat).rejects.toThrow();
      expect(seat.decisions.map((decision) => decision.turn)).toEqual([49, 50, 51, 52, 53, 54, 55, 56, 50]);
      const reopened = reopenStore(gameID);
      try {
        const files = [...reopened.manifest().keys()];
        expect(files).toContain('records/turn-49/players.md');
        expect(files).toContain('records/turn-50/players.md');
        expect(files).toContain('game/turn-49.md');
        expect(files).not.toContain('records/turn-55/players.md');
        expect(files).not.toContain('game/babylon.md');
        expect(files).not.toContain('game/late.md');
        expect(files).not.toContain('game/chat.md');
        // Discarded commits stay in history next to the reload.
        const history = reopened.history();
        expect(history.some((commit) => commit.kind === 'reload' && commit.turn === 50)).toBe(true);
        expect(history.filter((commit) => commit.kind === 'turn' && commit.turn === 55)).toHaveLength(1);
        expect(history.some((commit) => commit.author === 'diplomat' && commit.turn === 56)).toBe(false);
      } finally {
        reopened.close();
      }
    });

    it('should rewind a store that recorded later turns when a new session starts at turn 50', () => {
      const gameID = 'reload-new-session';
      const earlier = reopenStore(gameID);
      for (let turn = 48; turn <= 60; turn++) {
        earlier.commit({ kind: 'turn', turn, author: 'host', changes: [{ path: `records/turn-${turn}/players.md`, type: 'file', content: String(turn) }] });
      }
      earlier.close();

      const seat = makeSeat({ gameID, initialTurn: 50, files: true });
      const store = seat.player.context.store!;
      expect(store.lastRecordedTurn()).toBe(49);
      expect(store.history().some((commit) => commit.kind === 'reload' && commit.turn === 50)).toBe(true);
      seat.player.closeStore();
    });

    it('should not rewind for a briefing or note committed for turn N before turn N is processed', () => {
      const gameID = 'reload-early-briefing';
      const earlier = reopenStore(gameID);
      earlier.commit({ kind: 'turn', turn: 49, author: 'host', changes: [{ path: 'records/turn-49/players.md', type: 'file', content: '49' }] });
      earlier.commit({ kind: 'briefing', turn: 50, author: 'simple-briefer', changes: [{ path: 'records/turn-50/briefings/combined.md', type: 'file', content: 'early' }] });
      earlier.commit({ kind: 'notes', turn: 50, author: 'diplomat', changes: [{ path: 'game/early.md', type: 'file', content: 'early' }] });
      const head = earlier.head();
      earlier.close();

      const seat = makeSeat({ gameID, initialTurn: 50, files: true });
      expect(seat.player.context.store!.head()).toBe(head);
      seat.player.closeStore();
    });

    it('should fail the turn on a failed rewind and retry the original cut on the next turn', async () => {
      const seat = makeSeat({ gameID: 'reload-rewind-fails', initialTurn: 59, files: true });
      const rewind = vi.spyOn(seat.player.context.store!, 'rewind');

      await drive(seat.player, [
        () => seat.player.notifyTurn(59),
        () => seat.player.notifyTurn(60),
        () => {
          rewind.mockImplementationOnce(() => { throw new Error('disk I/O error'); });
          seat.player.notifyTurn(50);
        },
        () => seat.player.notifyTurn(51),
      ]);

      expect(rewind.mock.calls.map((call) => call[0])).toEqual([50, 50]);
      // Turn 50 was neither recorded nor decided, but the game was resumed.
      expect(seat.recordTurn.mock.calls.map((call) => call[0].turn)).toEqual([59, 60, 51]);
      expect(seat.decisions.map((decision) => decision.turn)).toEqual([59, 60, 51]);
      const resumedTurns = seat.callTool.mock.calls.filter((call) => call[0] === 'resume-game').length;
      expect(resumedTurns).toBeGreaterThanOrEqual(5);
      // Turn 51 fetched events from the start of turn 50.
      expect(seat.runs.at(-1)).toMatchObject({ turn: 51, after: turnEventWindow(50).after });
    });

    it('should retry a failed constructor rewind on the first processed turn', async () => {
      const rewind = vi.spyOn(WorkspaceStore.prototype, 'rewind').mockImplementationOnce(() => { throw new Error('locked'); });
      const seat = makeSeat({ gameID: 'reload-constructor-fails', initialTurn: 50, files: true });

      await drive(seat.player, [() => seat.player.notifyTurn(50)]);

      expect(rewind.mock.calls.map((call) => call[0])).toEqual([50, 50]);
      expect(seat.decisions.map((decision) => decision.turn)).toEqual([50]);
    });

    it('should reset a files-disabled seat without any store calls', async () => {
      const open = vi.spyOn(WorkspaceStore, 'open');
      const rewind = vi.spyOn(WorkspaceStore.prototype, 'rewind');
      const seat = makeSeat({ gameID: 'reload-no-files', initialTurn: 59 });

      await drive(seat.player, [() => seat.player.notifyTurn(59), () => seat.player.notifyTurn(60), () => seat.player.notifyTurn(50)]);

      expect(seat.decisions.map((decision) => decision.turn)).toEqual([59, 60, 50]);
      expect(seat.decisions[2].cachedTurns).toEqual([50]);
      expect(open).not.toHaveBeenCalled();
      expect(rewind).not.toHaveBeenCalled();
      expect(seat.records).not.toHaveBeenCalled();
      expect(seat.player.context.store).toBeUndefined();
    });
  });

  describe('startup notifications', () => {
    it.each(['queued', 'running', 'finished'] as const)(
      'should decide once and keep turn-0 notes when the real turn 0 arrives while %s',
      async (when) => {
        const gameID = `startup-${when}`;
        const seat = makeSeat({ gameID, initialTurn: 0, files: true });
        const rewind = vi.spyOn(seat.player.context.store!, 'rewind');
        seat.duringDecision.set(0, () => {
          seat.player.context.store!.commit({ kind: 'notes', turn: 0, author: 'human-strategist', changes: [{ path: 'game/opening.md', type: 'file', content: 'plan' }] });
          if (when === 'running') seat.player.notifyTurn(0);
        });

        seat.player.notifyTurn(0, 'startup');
        if (when === 'queued') seat.player.notifyTurn(0);
        const steps = when === 'finished' ? [() => { seat.player.notifyTurn(0); }, () => { seat.player.notifyTurn(1); }] : [() => { seat.player.notifyTurn(1); }];
        await drive(seat.player, steps);

        expect(seat.decisions.map((decision) => decision.turn)).toEqual([0, 1]);
        expect(rewind).not.toHaveBeenCalled();
        const reopened = reopenStore(gameID);
        try {
          expect(reopened.manifest().has('game/opening.md')).toBe(true);
        } finally {
          reopened.close();
        }
      },
    );

    it('should treat a repeated real turn 0 after the acknowledgement as a reload', async () => {
      const seat = makeSeat({ gameID: 'startup-repeat', initialTurn: 0, files: true });
      const rewind = vi.spyOn(seat.player.context.store!, 'rewind');

      seat.player.notifyTurn(0, 'startup');
      await drive(seat.player, [() => seat.player.notifyTurn(0), () => seat.player.notifyTurn(0)]);

      expect(seat.decisions.map((decision) => decision.turn)).toEqual([0, 0]);
      expect(rewind.mock.calls.map((call) => call[0])).toEqual([0]);
    });

    it('should treat a recovered turn 0 as a reload after the acknowledgement is cleared on reconnection', async () => {
      const seat = makeSeat({ gameID: 'startup-reconnect', initialTurn: 0 });

      seat.player.notifyTurn(0, 'startup');
      await drive(seat.player, [
        () => seat.player.clearStartupAcknowledgement(),
        () => seat.player.notifyTurn(0),
      ]);

      expect(seat.decisions.map((decision) => decision.turn)).toEqual([0, 0]);
    });
  });

  describe('busy reloads', () => {
    it('should cut at the lowest turn dropped while busy when the next turn is accepted', async () => {
      const gameID = 'busy-reload';
      const seat = makeSeat({ gameID, initialTurn: 58, files: true });
      const rewind = vi.spyOn(seat.player.context.store!, 'rewind');
      seat.duringDecision.set(60, () => {
        seat.player.context.getBaseParameters()!.workingMemory.plan = 'war';
        // A loaded save replays turns 55, 52, and 57 while turn 60 is still running.
        for (const turn of [55, 52, 57]) seat.player.notifyTurn(turn);
      });

      await drive(seat.player, [59, 60, 61].map((turn) => () => { seat.player.notifyTurn(turn); }));

      // The dropped notifications queued nothing; turn 61 started a new timeline at 52.
      expect(seat.decisions.map((decision) => decision.turn)).toEqual([59, 60, 61]);
      expect(rewind.mock.calls.map((call) => call[0])).toEqual([52]);
      expect(seat.runs.at(-1)).toMatchObject({ turn: 61, after: turnEventWindow(52).after });
      const reloaded = seat.decisions[2];
      expect(reloaded.workingMemory).toEqual({});
      expect(reloaded.lastDecisionTurn).toBeUndefined();
      expect(reloaded.fromTurn).toBe(52);
      expect(reloaded.cachedTurns).toEqual([61]);
    });

    it('should not rewind for an ordinary forward notification dropped while busy', async () => {
      const seat = makeSeat({ gameID: 'busy-forward', initialTurn: 59, files: true });
      const rewind = vi.spyOn(seat.player.context.store!, 'rewind');
      seat.duringDecision.set(60, () => { seat.player.notifyTurn(61); });

      await drive(seat.player, [60, 62].map((turn) => () => { seat.player.notifyTurn(turn); }));

      expect(seat.decisions.map((decision) => decision.turn)).toEqual([60, 62]);
      expect(rewind).not.toHaveBeenCalled();
      // Turn 62's refresh covers the dropped turn 61.
      expect(seat.runs.at(-1)).toMatchObject({ turn: 62, after: turnEventWindow(60).before });
    });
  });

  describe('turn records', () => {
    it('should record paced skips as well as decisions', async () => {
      const seat = makeSeat({ gameID: 'records-paced', initialTurn: 1, files: true, everyTurns: 3 });

      await drive(seat.player, [1, 2, 3, 4].map((turn) => () => { seat.player.notifyTurn(turn); }));

      expect(seat.decisions.map((decision) => decision.turn)).toEqual([1, 4]);
      expect(seat.recordTurn.mock.calls.map((call) => call[0].turn)).toEqual([1, 2, 3, 4]);
    });

    it('should fail the turn before its decision and keep the event cursor when recording fails', async () => {
      const seat = makeSeat({ gameID: 'records-fail', initialTurn: 1, files: true, failRecord: (turn) => turn === 2 });

      await drive(seat.player, [1, 2, 3].map((turn) => () => { seat.player.notifyTurn(turn); }));

      expect(seat.decisions.map((decision) => decision.turn)).toEqual([1, 3]);
      const statusQuoTurns = seat.callTool.mock.calls.filter((call) => call[0] === 'keep-status-quo');
      expect(statusQuoTurns).toHaveLength(0);
      // Turn 3 re-fetches the events turn 2 failed to record.
      expect(seat.runs.map((run) => run.after)).toEqual([
        turnEventWindow(1).after,
        turnEventWindow(1).before,
        turnEventWindow(1).before,
      ]);
    });

    it('should close the seat store only after the loop stops', async () => {
      const seat = makeSeat({ gameID: 'records-close', initialTurn: 1, files: true });
      const store = seat.player.context.store!;
      const close = vi.spyOn(store, 'close');
      const shutdown = vi.spyOn(seat.player.context, 'shutdown');
      seat.duringDecision.set(1, () => { expect(close).not.toHaveBeenCalled(); });

      await drive(seat.player, [() => seat.player.notifyTurn(1)]);

      expect(close).toHaveBeenCalledOnce();
      expect(shutdown.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
      expect(seat.player.context.store).toBeUndefined();
    });
  });
});
