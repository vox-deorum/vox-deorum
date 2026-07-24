/** Tests for the thin registered Lua function transport tool. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeManager, knowledgeManager } from '../../../src/server.js';
import createCallLuaFunctionTool from '../../../src/tools/general/call-lua-function.js';

const tool = createCallLuaFunctionTool();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('call-lua-function', () => {
  it('returns the BridgeManager success response verbatim', async () => {
    const response = { success: true, result: { accepted: true } };
    const call = vi.spyOn(bridgeManager, 'callLuaFunction').mockResolvedValue(response as any);

    await expect(tool.execute({ Name: 'VoxDeorumDiploBegin', Args: [{ busy: false }] } as any)).resolves.toBe(response);
    expect(call).toHaveBeenCalledWith('VoxDeorumDiploBegin', [{ busy: false }]);
  });

  it('returns DLL_DISCONNECTED unchanged', async () => {
    const response = { success: false, error: { code: 'DLL_DISCONNECTED', message: 'The Civilization V DLL is disconnected.' } };
    vi.spyOn(bridgeManager, 'callLuaFunction').mockResolvedValue(response as any);

    await expect(tool.execute({ Name: 'VoxDeorumDiploStatus', Args: [] } as any)).resolves.toBe(response);
  });

  it('rejects a guarded call before it reaches BridgeManager after a game switch', async () => {
    vi.spyOn(knowledgeManager, 'getGameId').mockReturnValue('active-game');
    const call = vi.spyOn(bridgeManager, 'callLuaFunction');

    await expect(
      tool.execute({ Name: 'VoxDeorumDiploAppend', Args: [], ExpectedGameID: 'previous-game' } as any)
    ).rejects.toThrow(/expected game previous-game, but active game is active-game/);
    expect(call).not.toHaveBeenCalled();
  });
});
