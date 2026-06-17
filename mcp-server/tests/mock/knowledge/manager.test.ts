/**
 * Tests for KnowledgeManager's pure helpers and its store lifecycle / game-state
 * accessors. A fresh KnowledgeManager instance is used (not the server singleton) so
 * no bridge listeners or auto-save timers are installed; the store is backed by a
 * real on-disk SQLite file in a temp directory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { KnowledgeManager, extractRenderEventForStorage } from '../../../src/knowledge/manager.js';

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

  beforeEach(() => {
    manager = new KnowledgeManager();
  });

  it('returns sane defaults before any game identity exists', () => {
    expect(manager.getTurn()).toBe(-1);
    expect(manager.getActivePlayerId()).toBe(-1);
    expect(manager.getGameId()).toBe('');
  });

  it('updateTurn advances forward but ignores backwards/equal turns', () => {
    (manager as any).gameIdentity = { gameId: 'g', turn: 10, activePlayerId: 1 };
    manager.updateTurn(5);
    expect(manager.getTurn()).toBe(10);
    manager.updateTurn(10);
    expect(manager.getTurn()).toBe(10);
    manager.updateTurn(15);
    expect(manager.getTurn()).toBe(15);
  });

  it('updateActivePlayer only mutates when a game identity exists', () => {
    // No identity → silent no-op, accessor still returns the default.
    expect(() => manager.updateActivePlayer(4)).not.toThrow();
    expect(manager.getActivePlayerId()).toBe(-1);

    (manager as any).gameIdentity = { gameId: 'g', turn: 10, activePlayerId: 1 };
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

  beforeEach(async () => {
    manager = new KnowledgeManager();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'km-test-'));
    (manager as any).config.databasePath = tmpDir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await manager.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads a store onto a temp DB, then saves and shuts it down cleanly', async () => {
    await manager.loadKnowledge('game-xyz');
    const store = manager.getStore();
    expect(store.isInitialized()).toBe(true);
    expect(store.getGameId()).toBe('game-xyz');

    // saveKnowledge is a no-op without a game identity; give it one so it stamps metadata.
    (manager as any).gameIdentity = { gameId: 'game-xyz', turn: 12, activePlayerId: 1 };
    await manager.saveKnowledge();
    expect(await store.getMetadata('turn')).toBe('12');

    await manager.shutdown();
    // After shutdown the store is released.
    expect(() => manager.getStore()).toThrow(/not initialized/);
  });
});
