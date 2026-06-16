import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../../../src/index.js';
import { dllConnector } from '../../../src/services/dll-connector.js';
import { pauseManager } from '../../../src/services/pause-manager.js';

describe('Event Route State Handling', () => {
  beforeAll(() => {
    pauseManager.finalize();
  });

  afterEach(() => {
    pauseManager.finalize();
    vi.restoreAllMocks();
  });

  it('routes PlayerDoTurn events to the pause manager', () => {
    const setActivePlayer = vi.spyOn(pauseManager, 'setActivePlayer');

    dllConnector.emit('game_event', {
      type: 'game_event',
      id: 1000001,
      event: 'PlayerDoTurn',
      payload: { PlayerID: 2 }
    });

    dllConnector.emit('game_event', {
      type: 'game_event',
      id: 1000002,
      event: 'PlayerDoneTurn',
      payload: { NextPlayerID: 3 }
    });

    expect(setActivePlayer).toHaveBeenCalledTimes(1);
    expect(setActivePlayer).toHaveBeenCalledWith(2);
  });

  it('clears paused players on DLL disconnect events', () => {
    vi.spyOn(dllConnector, 'sendNoWait').mockReturnValue({ success: true, result: undefined });

    pauseManager.registerPausedPlayer(6);
    dllConnector.emit('disconnected');

    expect(pauseManager.getPausedPlayers()).toEqual([]);
  });
});
