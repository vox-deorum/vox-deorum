/**
 * Tests for KnowledgeManager's pure helpers and its store lifecycle / game-state
 * accessors. A fresh KnowledgeManager instance is used (not the server singleton) so
 * no bridge listeners or auto-save timers are installed; the store is backed by a
 * real on-disk SQLite file in a temp directory.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { bridgeManager, gameDatabase } from '../../../src/server.js';
import { syncGameIdentity } from '../../../src/knowledge/getters/game-identity.js';
import { KnowledgeManager, extractRenderEventForStorage } from '../../../src/knowledge/manager.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { MappingMismatchError } from '../../../src/database/manager.js';
import type { LuaResponse } from '../../../src/bridge/manager.js';

vi.mock('../../../src/knowledge/getters/game-identity.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/knowledge/getters/game-identity.js')>();
  return { ...actual, syncGameIdentity: vi.fn() };
});

const mockSyncGameIdentity = vi.mocked(syncGameIdentity);
const managerConnections = new WeakMap<KnowledgeManager, { handler: (...args: any[]) => unknown; cleanup: () => void; checkGameContext: MockInstance }>();

/** Establish a manager's identity through its public bridge connection lifecycle. */
async function connectManagerToGame(manager: KnowledgeManager, gameId: string, turn: number, activePlayerId: number) {
  let connection = managerConnections.get(manager);
  if (!connection) {
    const connectedListeners = bridgeManager.rawListeners('connected');
    const gameEventListeners = bridgeManager.rawListeners('gameEvent');
    const checkGameContext = vi.spyOn(manager as any, 'checkGameContext');
    // No live game to checksum against; treat the enum mappings as verified
    vi.spyOn(manager as any, 'loadEnumMappings').mockResolvedValue(true);
    await manager.initialize();
    const handler = bridgeManager.rawListeners('connected').find(listener => !connectedListeners.includes(listener));
    if (!handler) throw new Error('KnowledgeManager did not register a connected handler');
    const cleanup = () => {
      for (const listener of bridgeManager.rawListeners('connected')) {
        if (!connectedListeners.includes(listener)) bridgeManager.off('connected', listener);
      }
      for (const listener of bridgeManager.rawListeners('gameEvent')) {
        if (!gameEventListeners.includes(listener)) bridgeManager.off('gameEvent', listener);
      }
    };
    connection = { handler, cleanup, checkGameContext };
    managerConnections.set(manager, connection);
  }
  mockSyncGameIdentity.mockResolvedValue({ gameId, turn, activePlayerId });
  connection.handler();
  // The connected handler does not return its context check, so await the check it started.
  // This settles after a full store load, and also when the game ID is unchanged.
  await connection.checkGameContext.mock.results.at(-1)!.value;
  expect(manager.getGameId()).toBe(gameId);
  expect(manager.getStore().isInitialized()).toBe(true);
  return connection.cleanup;
}

describe('extractRenderEventForStorage', () => {
  it('returns null for non-render event types', () => {
    expect(extractRenderEventForStorage({ type: 'PlayerDoneTurn', payload: {} })).toBeNull();
    expect(extractRenderEventForStorage({ type: undefined as any, payload: {} })).toBeNull();
  });

  it('strips the Render: prefix and lifts time/turn out of the payload', () => {
    const result = extractRenderEventForStorage({
      type: 'Render:PlayerPanelSwitch',
      payload: { time: 999, turn: 7, playerID: 3, extra: 'x' },
    });
    expect(result).toEqual({
      time: 999,
      turn: 7,
      event: 'PlayerPanelSwitch',
      payload: { playerID: 3, extra: 'x' },
    });
  });
});

describe('game-state accessors', () => {
  let manager: KnowledgeManager;
  let removeListeners: (() => void) | undefined;
  let tmpDir: string;

  beforeEach(async () => {
    manager = new KnowledgeManager();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'km-state-test-'));
    (manager as any).config.databasePath = tmpDir;
  });

  afterEach(async () => {
    removeListeners?.();
    await manager.shutdown();
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns sane defaults before any game identity exists', () => {
    expect(manager.getTurn()).toBe(-1);
    expect(manager.getActivePlayerId()).toBe(-1);
    expect(manager.getGameId()).toBe('');
  });

  it('updateTurn advances forward but ignores backwards/equal turns', async () => {
    removeListeners = await connectManagerToGame(manager, 'g', 10, 1);
    manager.updateTurn(5);
    expect(manager.getTurn()).toBe(10);
    manager.updateTurn(10);
    expect(manager.getTurn()).toBe(10);
    manager.updateTurn(15);
    expect(manager.getTurn()).toBe(15);
  });

  it('returns the changed active player through its accessor', async () => {
    expect(() => manager.updateActivePlayer(4)).not.toThrow();
    expect(manager.getActivePlayerId()).toBe(-1);

    removeListeners = await connectManagerToGame(manager, 'g', 10, 1);
    manager.updateActivePlayer(4);
    expect(manager.getActivePlayerId()).toBe(4);
    // Calling with no/identical id leaves it unchanged.
    manager.updateActivePlayer(4);
    expect(manager.getActivePlayerId()).toBe(4);
  });
});

describe('store lifecycle', () => {
  let manager: KnowledgeManager;
  let tmpDir: string;
  let removeListeners: (() => void) | undefined;

  beforeEach(async () => {
    manager = new KnowledgeManager();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'km-test-'));
    (manager as any).config.databasePath = tmpDir;
  });

  afterEach(async () => {
    removeListeners?.();
    vi.restoreAllMocks();
    await manager.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads a store onto a temp DB, then saves and shuts it down cleanly', async () => {
    removeListeners = await connectManagerToGame(manager, 'game-xyz', 12, 1);
    const store = manager.getStore();
    await manager.saveKnowledge();
    expect(await store.getMetadata('turn')).toBe('12');

    await manager.shutdown();
    manager = new KnowledgeManager();
    (manager as any).config.databasePath = tmpDir;
    await manager.loadKnowledge('game-xyz');
    expect(await manager.getStore().getMetadata('turn')).toBe('12');
  });

  it('keeps each game database isolated when switching between them', async () => {
    const cleanups: Array<() => void> = [];
    removeListeners = () => cleanups.reverse().forEach(cleanup => cleanup());

    cleanups.push(await connectManagerToGame(manager, 'game-one', 4, 0));
    await manager.getStore().setMetadata('marker', 'one');

    cleanups.push(await connectManagerToGame(manager, 'game-two', 9, 1));
    expect(await manager.getStore().getMetadata('marker')).toBeUndefined();
    await manager.getStore().setMetadata('marker', 'two');

    cleanups.push(await connectManagerToGame(manager, 'game-one', 5, 0));
    expect(await manager.getStore().getMetadata('marker')).toBe('one');

    cleanups.push(await connectManagerToGame(manager, 'game-two', 10, 1));
    expect(await manager.getStore().getMetadata('marker')).toBe('two');
  });
});

describe('enum mapping verification on DLL connection', () => {
  let manager: KnowledgeManager;
  let tmpDir: string;
  let dllStatus: (connected: boolean) => Promise<unknown>;
  let removeListeners: () => void;
  let checksumResponse: LuaResponse;
  let pauseGame: MockInstance;

  beforeEach(async () => {
    manager = new KnowledgeManager();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'km-mapping-test-'));
    (manager as any).config.databasePath = tmpDir;
    mockSyncGameIdentity.mockResolvedValue({ gameId: 'mapping-game', turn: 0, activePlayerId: 0 });
    checksumResponse = { success: true, result: { Units: { Count: 1, Checksum: 1 } } };
    vi.spyOn(LuaFunction.prototype, 'execute').mockImplementation(async function (this: LuaFunction) {
      return this.name === 'getTableChecksums' ? checksumResponse : { success: true, result: true };
    });
    vi.spyOn(bridgeManager, 'executeLuaScript').mockResolvedValue({ success: true, result: true });
    pauseGame = vi.spyOn(bridgeManager, 'pauseGame').mockResolvedValue(true);

    const connectedListeners = bridgeManager.rawListeners('connected');
    const gameEventListeners = bridgeManager.rawListeners('gameEvent');
    await manager.initialize();
    const handler = bridgeManager.rawListeners('gameEvent').find(listener => !gameEventListeners.includes(listener))!;
    dllStatus = connected => handler({ type: 'dll_status', payload: { connected } }) as Promise<unknown>;
    removeListeners = () => {
      for (const listener of bridgeManager.rawListeners('connected')) {
        if (!connectedListeners.includes(listener)) bridgeManager.off('connected', listener);
      }
      for (const listener of bridgeManager.rawListeners('gameEvent')) {
        if (!gameEventListeners.includes(listener)) bridgeManager.off('gameEvent', listener);
      }
    };
  });

  afterEach(async () => {
    removeListeners();
    vi.restoreAllMocks();
    await manager.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('switches to the game once the live checksums match', async () => {
    const reload = vi.spyOn(gameDatabase, 'reloadMappings').mockResolvedValue();
    await dllStatus(true);
    expect(reload).toHaveBeenCalledWith(checksumResponse.result);
    expect(manager.getGameId()).toBe('mapping-game');
    expect(pauseGame).not.toHaveBeenCalled();
  });

  it('pauses the game and never switches to it when the database does not match', async () => {
    vi.spyOn(gameDatabase, 'reloadMappings').mockRejectedValue(new MappingMismatchError('Units differ'));
    await dllStatus(true);
    expect(pauseGame).toHaveBeenCalledOnce();
    expect(mockSyncGameIdentity).not.toHaveBeenCalled();
    expect(manager.getGameId()).toBe('');
  });

  it('stops advertising a verified game once a later connection does not match', async () => {
    const reload = vi.spyOn(gameDatabase, 'reloadMappings').mockResolvedValue();
    await dllStatus(true);
    expect(manager.getGameId()).toBe('mapping-game');
    expect(await manager.isGameVerified()).toBe(true);

    await dllStatus(false);
    reload.mockRejectedValue(new MappingMismatchError('Units differ'));
    await dllStatus(true);
    expect(await manager.isGameVerified()).toBe(false);
    expect(manager.getGameId()).toBe('');
    expect(() => manager.getStore()).toThrow();
  });

  it('retries without pausing when the game cannot answer yet', async () => {
    const reload = vi.spyOn(gameDatabase, 'reloadMappings').mockResolvedValue();
    checksumResponse = { success: false, error: { code: 'DLL_DISCONNECTED', message: 'not connected' } };
    await dllStatus(true);
    expect(reload).not.toHaveBeenCalled();
    expect(pauseGame).not.toHaveBeenCalled();

    checksumResponse = { success: true, result: { Units: { Count: 1, Checksum: 1 } } };
    await dllStatus(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(manager.getGameId()).toBe('mapping-game');
  });

  it('rebuilds the mappings after the DLL reconnects', async () => {
    const reload = vi.spyOn(gameDatabase, 'reloadMappings').mockResolvedValue();
    await dllStatus(true);
    await dllStatus(true);
    expect(reload).toHaveBeenCalledOnce();

    await dllStatus(false);
    await dllStatus(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
