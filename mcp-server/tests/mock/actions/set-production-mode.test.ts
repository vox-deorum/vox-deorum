/**
 * Tests for the set-production-mode action tool. Thin wrapper: it forwards the
 * `enabled` boolean to bridgeManager.setProductionMode() and returns its result.
 * The bridge is stubbed so we assert call shaping and result passthrough.
 *
 * (No game-enum resolution is involved — the input is a plain boolean — so the
 * enumMappings injection used by other action tools does not apply here.)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { bridgeManager } from '../../../src/server.js';
import createSetProductionModeTool from '../../../src/tools/actions/set-production-mode.js';

const tool = createSetProductionModeTool();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('set-production-mode', () => {
  it('forwards enabled=true to bridgeManager.setProductionMode and returns its result', async () => {
    const spy = vi.spyOn(bridgeManager, 'setProductionMode').mockResolvedValue(true);

    const result = await tool.execute({ enabled: true } as any);

    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(true);
  });

  it('forwards enabled=false and propagates a false result', async () => {
    const spy = vi.spyOn(bridgeManager, 'setProductionMode').mockResolvedValue(false);

    const result = await tool.execute({ enabled: false } as any);

    expect(result).toBe(false);
    expect(spy).toHaveBeenCalledWith(false);
  });
});
