/**
 * Tests for the pause-game action tool. Thin wrapper: it forwards PlayerID to
 * bridgeManager.pausePlayer() and returns its boolean result. The bridge is
 * stubbed so we assert call shaping and result passthrough without a live bridge.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { bridgeManager } from '../../../src/server.js';
import createPauseGameTool from '../../../src/tools/actions/pause-game.js';

const tool = createPauseGameTool();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pause-game', () => {
  it('forwards the PlayerID to bridgeManager.pausePlayer and returns its result', async () => {
    const spy = vi.spyOn(bridgeManager, 'pausePlayer').mockResolvedValue(true);

    const result = await tool.execute({ PlayerID: 3 } as any);

    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3);
  });

  it('propagates a false result from the bridge', async () => {
    vi.spyOn(bridgeManager, 'pausePlayer').mockResolvedValue(false);

    expect(await tool.execute({ PlayerID: 0 } as any)).toBe(false);
  });
});
