/**
 * Mock-tier tests for ProductionController — the segment state machine and its
 * `segments.jsonl` log. This migrates the coverage that used to live on ObsManager
 * (the removed recording-file tracking + JSONL event log + addEvent surface), now
 * driven by render events through the controller.
 *
 * Uses a fake ObsManager (no real OBS) and a real temp recording directory. Fake
 * timers drive the grace-period auto-stop; segments are otherwise stopped explicitly
 * via stop()/suspend().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProductionController } from '../../../src/infra/production-controller.js';
import type { ObsManager } from '../../../src/infra/obs-manager.js';

/** SEGMENT_GRACE_MS in the source. */
const GRACE_MS = 10_000;
const CLIP = 'clip-001.mkv';

/** A fake ObsManager exposing only the surface ProductionController touches. */
function makeFakeObs(recordingDir?: string) {
  return {
    isOperational: vi.fn(() => true),
    getRecordingDirectory: vi.fn(() => recordingDir),
    startProduction: vi.fn(async () => {}),
    // stopProduction resolves the full output path; the controller logs its basename.
    stopProduction: vi.fn(async () => (recordingDir ? path.join(recordingDir, CLIP) : undefined)),
    pauseProduction: vi.fn(async () => {}),
    resumeProduction: vi.fn(async () => {}),
  };
}

type FakeObs = ReturnType<typeof makeFakeObs>;

/** Build a render-event payload in the MCP notification shape the controller expects. */
function render(turn: number, playerID: number, data: Record<string, unknown> = {}) {
  return { turn, playerID, data } as Record<string, unknown>;
}

let tmpDir: string;
let obs: FakeObs;

function controllerFor(mode: 'recording' | 'livestream', dir?: string) {
  obs = makeFakeObs(dir);
  return new ProductionController(obs as unknown as ObsManager, mode);
}

/** Parse the segments.jsonl log in `dir` into entries (empty array if absent/blank). */
function readLog(dir: string): any[] {
  const file = path.join(dir, 'segments.jsonl');
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf-8').trim();
  return raw ? raw.split('\n').map((l) => JSON.parse(l)) : [];
}

beforeEach(() => {
  vi.useFakeTimers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prodctrl-'));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ProductionController (recording mode)', () => {
  describe('start', () => {
    it('opens an empty segments.jsonl and starts no OBS recording yet', async () => {
      const c = controllerFor('recording', tmpDir);
      await c.start();

      expect(fs.existsSync(path.join(tmpDir, 'segments.jsonl'))).toBe(true);
      expect(readLog(tmpDir)).toEqual([]);
      expect(obs.startProduction).not.toHaveBeenCalled();
    });
  });

  describe('segment lifecycle', () => {
    it('starts a segment on the first PlayerPanelSwitch and logs a "start" entry', async () => {
      const c = controllerFor('recording', tmpDir);
      await c.start();
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 3));

      expect(obs.startProduction).toHaveBeenCalledTimes(1);
      const log = readLog(tmpDir);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ event: 'start', turn: 5, playerID: 3 });
      expect(typeof log[0].at).toBe('number');

      await c.stop();
    });

    it('logs a "switch" entry for a later PlayerPanelSwitch within the same segment', async () => {
      const c = controllerFor('recording', tmpDir);
      await c.start();
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 3));
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 4));

      // Only one OBS recording was started across the two switches.
      expect(obs.startProduction).toHaveBeenCalledTimes(1);
      const events = readLog(tmpDir);
      expect(events.map((e) => e.event)).toEqual(['start', 'switch']);
      expect(events[1]).toMatchObject({ event: 'switch', turn: 5, playerID: 4 });

      await c.stop();
    });

    it('writes a "stop" entry carrying the OBS output basename on stop()', async () => {
      const c = controllerFor('recording', tmpDir);
      await c.start();
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 3));
      await c.stop();

      expect(obs.stopProduction).toHaveBeenCalledTimes(1);
      const log = readLog(tmpDir);
      const stop = log.find((e) => e.event === 'stop');
      expect(stop).toMatchObject({ event: 'stop', turn: 5, playerID: 3, file: CLIP });
      // basename only — no directory separators leak into the log.
      expect(stop.file).not.toContain(path.sep);
    });

    it('auto-stops the segment after the grace period with no further events', async () => {
      const c = controllerFor('recording', tmpDir);
      await c.start();
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 3));

      expect(readLog(tmpDir).some((e) => e.event === 'stop')).toBe(false);

      await vi.advanceTimersByTimeAsync(GRACE_MS);

      expect(obs.stopProduction).toHaveBeenCalledTimes(1);
      expect(readLog(tmpDir).some((e) => e.event === 'stop')).toBe(true);
    });

    it('extends the grace window on AnimationStarted instead of stopping', async () => {
      const c = controllerFor('recording', tmpDir);
      await c.start();
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 3));

      // Just before the window closes, an AnimationStarted resets it.
      await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
      await c.handleRenderEvent('AnimationStarted', render(5, 3));
      await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
      expect(obs.stopProduction).not.toHaveBeenCalled();

      // After a full grace window with no events, it finally stops.
      await vi.advanceTimersByTimeAsync(1);
      expect(obs.stopProduction).toHaveBeenCalledTimes(1);
    });
  });

  describe('minor civilizations', () => {
    it('does not start a segment for a minor-civ panel switch while idle', async () => {
      const c = controllerFor('recording', tmpDir);
      await c.start();
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 9, { isMinorCiv: true }));

      expect(obs.startProduction).not.toHaveBeenCalled();
      expect(readLog(tmpDir)).toEqual([]);
    });

    it('logs a minor-civ switch inside a segment without changing the segment owner', async () => {
      const c = controllerFor('recording', tmpDir);
      await c.start();
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 3)); // major starts segment
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 99, { isMinorCiv: true }));
      await c.stop();

      const log = readLog(tmpDir);
      expect(log.find((e) => e.event === 'switch')).toMatchObject({ playerID: 99 });
      // The stop entry keeps the major's player/turn — the minor civ didn't take ownership.
      expect(log.find((e) => e.event === 'stop')).toMatchObject({ turn: 5, playerID: 3 });
    });
  });

  describe('guards', () => {
    it('is a no-op (no log written, no throw) when there is no recording directory', async () => {
      const c = controllerFor('recording', undefined);
      await c.start();
      await expect(c.handleRenderEvent('PlayerPanelSwitch', render(5, 3))).resolves.toBeUndefined();

      // Segment machinery still runs; only the log is skipped for lack of a directory.
      expect(obs.startProduction).toHaveBeenCalledTimes(1);
      expect(obs.getRecordingDirectory).toHaveBeenCalled();

      await c.stop();
    });

    it('ignores render events when OBS is not operational', async () => {
      const c = controllerFor('recording', tmpDir);
      obs.isOperational.mockReturnValue(false);
      await c.start();
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 3));

      expect(obs.startProduction).not.toHaveBeenCalled();
      expect(readLog(tmpDir)).toEqual([]);
    });

    it('ignores render events before start() (controller inactive)', async () => {
      const c = controllerFor('recording', tmpDir);
      await c.handleRenderEvent('PlayerPanelSwitch', render(5, 3));
      expect(obs.startProduction).not.toHaveBeenCalled();
    });

    it('rejects malformed render payloads', async () => {
      const c = controllerFor('recording', tmpDir);
      await c.start();

      await expect(c.handleRenderEvent('PlayerPanelSwitch', { turn: 5, playerID: 3 }))
        .rejects.toThrow(/expected data object/);
      await expect(c.handleRenderEvent('PlayerPanelSwitch', { playerID: 3, data: {} }))
        .rejects.toThrow(/expected numeric turn/);
      await expect(c.handleRenderEvent('PlayerPanelSwitch', { turn: 5, data: {} }))
        .rejects.toThrow(/expected numeric playerID/);
    });
  });
});

describe('ProductionController (livestream mode)', () => {
  it('passes start/suspend/resume/stop straight through to ObsManager', async () => {
    const c = controllerFor('livestream', tmpDir);

    await c.start();
    expect(obs.startProduction).toHaveBeenCalledTimes(1);

    await c.suspend();
    expect(obs.pauseProduction).toHaveBeenCalledTimes(1);

    await c.resume();
    expect(obs.resumeProduction).toHaveBeenCalledTimes(1);

    await c.stop();
    expect(obs.stopProduction).toHaveBeenCalledTimes(1);
  });

  it('does not drive recording segments from render events', async () => {
    const c = controllerFor('livestream', tmpDir);
    await c.start();
    obs.startProduction.mockClear();

    await c.handleRenderEvent('PlayerPanelSwitch', render(5, 3));

    // No segment recording started; no segments.jsonl written.
    expect(obs.startProduction).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpDir, 'segments.jsonl'))).toBe(false);
  });
});
