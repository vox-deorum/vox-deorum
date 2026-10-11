/**
 * Event input path tests for VoxPlayer (src/strategist/vox-player.ts).
 *
 * A strategist that reads events from files runs once per decision, with no event-window retries:
 * an overflow fails the decision and leaves the pending window and last decision in place. A
 * strategist without bash keeps the inline fallback, which retries with fewer events.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Make the player's promise-based sleeps instant (turn polling + the post-shutdown settle wait).
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve() }));

// Triage is off in these tests.
vi.mock('../../../src/strategist/pacing/triage.js', () => ({ runStrategistTriage: async () => undefined }));

import { VoxPlayer } from '../../../src/strategist/vox-player.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { HumanDecisionBus } from '../../../src/strategist/human-decision-bus.js';
import { VoxSpanExporter } from '../../../src/utils/telemetry/vox-exporter.js';
import { spanProcessor, sqliteExporter } from '../../../src/instrumentation.js';
import { bashToolName } from '../../../src/utils/tools/tool-names.js';
import type { PlayerConfig } from '../../../src/types/config.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import type { ResolvedRunTools, VoxRunOptions } from '../../../src/infra/vox-run.js';

const playerConfig: PlayerConfig = { strategist: 'simple-strategist', llms: {} } as PlayerConfig;

/** Events by refresh: turn 1 holds a turning point and a minor event, later turns hold none. */
const eventsByFetch = [{ '1': [{ Type: 'DeclareWar' }, { Type: 'UnitPromoted' }] }];

beforeEach(() => {
  vi.spyOn(VoxSpanExporter.getInstance(), 'createContext').mockResolvedValue(undefined);
  vi.spyOn(VoxSpanExporter.getInstance(), 'closeContext').mockResolvedValue(undefined);
  vi.spyOn(spanProcessor, 'forceFlush').mockResolvedValue(undefined as never);
  vi.spyOn(sqliteExporter, 'forceFlush').mockResolvedValue(undefined as never);
});

/**
 * Run turns 1 and 2 with a strategist execution that always overflows, and return what each
 * attempt saw: its turn and the pending event window it was given.
 *
 * @param withBash - Whether the seat has files on and a bash tool, so the strategist runs in file mode
 */
async function runOverflowingTurns(withBash: boolean) {
  const player = new VoxPlayer({
    playerID: 1,
    slot: '1',
    playerConfig,
    gameID: `game-file-events-${withBash}`,
    initialTurn: 0,
    humanDecisionBus: new HumanDecisionBus(),
  });
  player.context.files = { game: 'write', shared: {}, quota: 8 };
  if (withBash) player.context.tools[bashToolName] = {} as never;

  let eventFetches = 0;
  vi.spyOn(player.context, 'callTool').mockImplementation(async (name: string) => {
    if (name === 'get-events') return (eventsByFetch[eventFetches++] ?? {}) as never;
    return {} as never;
  });
  const attempts: Array<{ turn: number; window: unknown; runTools?: ResolvedRunTools }> = [];
  vi.spyOn(player.context, 'execute').mockImplementation(async (...args) => {
    const parameters = player.context.currentParameters!;
    attempts.push({ turn: parameters.turn, window: structuredClone(parameters.gameStates[parameters.turn]?.mergedEvents), runTools: args[5]?.runTools });
    (args[4] as (() => void) | undefined)?.();
  });

  const realWithRun = player.context.withRun.bind(player.context);
  let turns = 0;
  vi.spyOn(player.context, 'withRun').mockImplementation((options: VoxRunOptions<StrategistParameters>, cb) =>
    realWithRun(options, cb as never).then((result) => {
      if (++turns < 2) player.notifyTurn(turns + 1);
      else player.abort(true);
      return result;
    }));

  player.notifyTurn(1);
  const resolveTools = vi.spyOn(agentRegistry.get<StrategistParameters>(playerConfig.strategist)!, 'getRunTools');
  try {
    await player.execute();
    return { attempts, base: player.context.getBaseParameters()!, resolutions: resolveTools.mock.calls.length };
  } finally {
    resolveTools.mockRestore();
  }
}

describe('VoxPlayer event input', () => {
  it.each([true, false])('should pass one resolved declaration per decision through every attempt (bash: %s)', async (withBash) => {
    const { attempts, resolutions } = await runOverflowingTurns(withBash);

    expect(resolutions).toBe(2);
    for (const turn of [1, 2]) {
      const turnAttempts = attempts.filter((attempt) => attempt.turn === turn);
      const declaration = turnAttempts[0].runTools;
      expect(declaration).toBeDefined();
      expect(declaration!.tools!.includes(bashToolName)).toBe(withBash);
      for (const attempt of turnAttempts) expect(attempt.runTools).toBe(declaration);
    }
  });

  describe('with file input', () => {
    it('should run the strategist once per turn and never retry with filtered events', async () => {
      const { attempts } = await runOverflowingTurns(true);

      expect(attempts.map((attempt) => attempt.turn)).toEqual([1, 2]);
    });

    it('should leave the last decision and pending window unchanged after an overflow', async () => {
      const { attempts, base } = await runOverflowingTurns(true);

      expect(base.lastDecisionTurn).toBeUndefined();
      expect(base._decisionEventWindow).toEqual({ fromTurn: 0 });
      // Inline briefers still get the full pending window, so turn 2 still sees turn 1's events.
      expect(attempts[1].window).toEqual(eventsByFetch[0]);
    });
  });

  describe('with inline input', () => {
    it('should retry an overflowed decision with fewer events when the seat has no bash tool', async () => {
      const { attempts } = await runOverflowingTurns(false);

      const turnOneWindows = attempts.filter((attempt) => attempt.turn === 1).map((attempt) => attempt.window);
      expect(turnOneWindows.length).toBeGreaterThan(1);
      expect(turnOneWindows[0]).toEqual(eventsByFetch[0]);
      expect(turnOneWindows.at(-1)).not.toEqual(eventsByFetch[0]);
    });
  });
});
