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

  it('clears paused players on DLL disconnect events', () => {
    vi.spyOn(dllConnector, 'sendNoWait').mockReturnValue({ success: true, result: undefined });

    pauseManager.registerPausedPlayer(6);
    dllConnector.emit('disconnected');

    expect(pauseManager.getPausedPlayers()).toEqual([]);
  });
});
