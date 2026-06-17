/**
 * Tests for the resume-game action tool. Thin wrapper: it forwards PlayerID to
 * bridgeManager.resumePlayer() and returns its boolean result. The bridge is
 * stubbed so we assert call shaping and result passthrough without a live bridge.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { bridgeManager } from '../../../src/server.js';
import createResumeGameTool from '../../../src/tools/actions/resume-game.js';

const tool = createResumeGameTool();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resume-game', () => {
  it('forwards the PlayerID to bridgeManager.resumePlayer and returns its result', async () => {
    const spy = vi.spyOn(bridgeManager, 'resumePlayer').mockResolvedValue(true);

    const result = await tool.execute({ PlayerID: 5 } as any);

    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(5);
  });

  it('propagates a false result from the bridge', async () => {
    vi.spyOn(bridgeManager, 'resumePlayer').mockResolvedValue(false);

    expect(await tool.execute({ PlayerID: 0 } as any)).toBe(false);
  });
});
