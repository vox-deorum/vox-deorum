import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pauseManager } from '../../../src/services/pause-manager.js';
import { dllConnector } from '../../../src/services/dll-connector.js';
import { respondSuccess } from '../../../src/types/api.js';

describe('Pause Manager', () => {
  beforeEach(() => {
    pauseManager.finalize();
  });

  afterEach(() => {
    pauseManager.finalize();
    vi.restoreAllMocks();
  });

  it('tracks paused players locally and avoids duplicate entries', () => {
    vi.spyOn(dllConnector, 'sendNoWait').mockReturnValue(respondSuccess());

    expect(pauseManager.registerPausedPlayer(2)).toBe(true);
    expect(pauseManager.registerPausedPlayer(2)).toBe(true);
    expect(pauseManager.getPausedPlayers()).toEqual([2]);

    expect(pauseManager.unregisterPausedPlayer(2)).toBe(true);
    expect(pauseManager.getPausedPlayers()).toEqual([]);
  });

  it('resyncs paused players when the DLL reconnects', () => {
    const sendNoWait = vi.spyOn(dllConnector, 'sendNoWait').mockReturnValue(respondSuccess());

    pauseManager.registerPausedPlayer(1);
    pauseManager.registerPausedPlayer(3);
    sendNoWait.mockClear();

    dllConnector.emit('connected');

    expect(sendNoWait).toHaveBeenCalledTimes(2);
    expect(sendNoWait).toHaveBeenCalledWith({ type: 'pause_player', playerID: 1 });
    expect(sendNoWait).toHaveBeenCalledWith({ type: 'pause_player', playerID: 3 });
  });

  it('clears tracked players and notifies the DLL when requested', () => {
    const sendNoWait = vi.spyOn(dllConnector, 'sendNoWait').mockReturnValue(respondSuccess());

    pauseManager.registerPausedPlayer(4);
    sendNoWait.mockClear();

    pauseManager.clearPausedPlayers();

    expect(pauseManager.getPausedPlayers()).toEqual([]);
    expect(sendNoWait).toHaveBeenCalledOnce();
    expect(sendNoWait).toHaveBeenCalledWith({ type: 'clear_paused_players' });
  });

  it('does not clear tracked players on raw connector disconnect events by itself', () => {
    vi.spyOn(dllConnector, 'sendNoWait').mockReturnValue(respondSuccess());

    pauseManager.registerPausedPlayer(5);
    dllConnector.emit('disconnected');

    expect(pauseManager.getPausedPlayers()).toEqual([5]);
  });

  it('finalize clears tracked state', () => {
    vi.spyOn(dllConnector, 'sendNoWait').mockReturnValue(respondSuccess());

    pauseManager.registerPausedPlayer(7);
    pauseManager.finalize();

    expect(pauseManager.getPausedPlayers()).toEqual([]);
    expect(pauseManager.isGamePaused()).toBe(false);
  });
});
