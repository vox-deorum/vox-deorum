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
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve() }));

import { VoxPlayer } from '../../../src/strategist/vox-player.js';
import { HumanDecisionBus } from '../../../src/strategist/human-decision-bus.js';
import { VoxSpanExporter } from '../../../src/utils/telemetry/vox-exporter.js';
import { spanProcessor, sqliteExporter } from '../../../src/instrumentation.js';
import type { PlayerConfig } from '../../../src/types/config.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import type { VoxRunOptions } from '../../../src/infra/vox-run.js';

const playerConfig: PlayerConfig = { strategist: 'simple-strategist', llms: {} } as PlayerConfig;

beforeEach(() => {
  // Telemetry exporters: keep construction + shutdown cheap and offline.
  vi.spyOn(VoxSpanExporter.getInstance(), 'createContext').mockResolvedValue(undefined);
  vi.spyOn(VoxSpanExporter.getInstance(), 'closeContext').mockResolvedValue(undefined);
  vi.spyOn(spanProcessor, 'forceFlush').mockResolvedValue(undefined as never);
  vi.spyOn(sqliteExporter, 'forceFlush').mockResolvedValue(undefined as never);
});

describe('VoxPlayer per-turn root runs', () => {
  it('opens one root per turn with run-local turn/before/after, advances the event cursor, and never mutates the base turn', async () => {
    const player = new VoxPlayer(1, playerConfig, 'game-runs', /* initialTurn */ 0, new HumanDecisionBus());

    // All MCP tool calls (pause/resume/set-metadata/keep-status-quo + the six report fetches)
    // resolve to a non-error stand-in so the real ensureGameState/refreshGameState path succeeds.
    vi.spyOn(player.context, 'callTool').mockResolvedValue({} as never);
    // Stub the strategist execution itself — we only care about the surrounding run wiring.
    const execute = vi.spyOn(player.context, 'execute').mockResolvedValue(undefined);

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

    // The context's base parameters were never mutated per turn — turn is purely run-local.
    expect(player.context.getBaseParameters()?.turn).toBe(-1);
  });
});
