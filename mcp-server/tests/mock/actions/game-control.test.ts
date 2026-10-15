/** Public pacing controls preserve bridge outcomes and select the requested player or mode. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeManager } from '../../../src/server.js';
import createPauseGameTool from '../../../src/tools/actions/pause-game.js';
import createResumeGameTool from '../../../src/tools/actions/resume-game.js';
import createSetProductionModeTool from '../../../src/tools/actions/set-production-mode.js';
import { connectToolClient } from '../tool-client.js';

vi.mock('../../../src/server.js', () => ({
  bridgeManager: { pausePlayer: vi.fn(), resumePlayer: vi.fn(), setProductionMode: vi.fn() }
}));

afterEach(() => { vi.resetAllMocks(); });

const cases = [
  { factory: createPauseGameTool, args: { PlayerID: 0 }, accepted: true, before: [1], after: [0, 1], initialMode: false, finalMode: false },
  { factory: createPauseGameTool, args: { PlayerID: 21 }, accepted: true, before: [1], after: [1, 21], initialMode: false, finalMode: false },
  { factory: createPauseGameTool, args: { PlayerID: 0 }, accepted: false, before: [1], after: [1], initialMode: false, finalMode: false },
  { factory: createPauseGameTool, args: { PlayerID: 21 }, accepted: false, before: [1], after: [1], initialMode: false, finalMode: false },
  { factory: createResumeGameTool, args: { PlayerID: 0 }, accepted: true, before: [0, 1, 21], after: [1, 21], initialMode: false, finalMode: false },
  { factory: createResumeGameTool, args: { PlayerID: 21 }, accepted: true, before: [0, 1, 21], after: [0, 1], initialMode: false, finalMode: false },
  { factory: createResumeGameTool, args: { PlayerID: 0 }, accepted: false, before: [0, 1, 21], after: [0, 1, 21], initialMode: false, finalMode: false },
  { factory: createResumeGameTool, args: { PlayerID: 21 }, accepted: false, before: [0, 1, 21], after: [0, 1, 21], initialMode: false, finalMode: false },
  { factory: createSetProductionModeTool, args: { enabled: true }, accepted: true, before: [1], after: [1], initialMode: false, finalMode: true },
  { factory: createSetProductionModeTool, args: { enabled: false }, accepted: true, before: [1], after: [1], initialMode: true, finalMode: false },
  { factory: createSetProductionModeTool, args: { enabled: true }, accepted: false, before: [1], after: [1], initialMode: false, finalMode: false },
  { factory: createSetProductionModeTool, args: { enabled: false }, accepted: false, before: [1], after: [1], initialMode: true, finalMode: true }
];

describe('game controls through MCP', () => {
  it.each(cases)('preserves outcome and target for $args with bridge acceptance $accepted', async ({ factory, args, accepted, before, after, initialMode, finalMode }) => {
    const pausedPlayers = new Set(before);
    let productionMode = initialMode;
    vi.mocked(bridgeManager.pausePlayer).mockImplementation(async playerID => {
      if (accepted) pausedPlayers.add(playerID);
      return accepted;
    });
    vi.mocked(bridgeManager.resumePlayer).mockImplementation(async playerID => {
      if (accepted) pausedPlayers.delete(playerID);
      return accepted;
    });
    vi.mocked(bridgeManager.setProductionMode).mockImplementation(async enabled => {
      if (accepted) productionMode = enabled;
      return accepted;
    });

    const client = await connectToolClient(factory());
    try {
      expect(await client.call(args)).toBe(accepted);
      expect([...pausedPlayers].sort((left, right) => left - right)).toEqual(after);
      expect(productionMode).toBe(finalMode);
    } finally {
      await client.close();
    }
  });
});
