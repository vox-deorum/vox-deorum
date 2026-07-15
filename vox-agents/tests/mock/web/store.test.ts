/**
 * @module tests/mock/web/store
 *
 * Focused cache, durable-read, and owned-context cleanup coverage for ChatThreadStore.
 */

import { describe, expect, it, vi } from 'vitest';
import type { EnvoyThread } from '../../../src/types/index.js';
import { ChatThreadStore } from '../../../src/web/chat/store.js';

/** Build a minimal thread for store behavior tests. */
function makeThread(overrides: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'thread-1',
    agent: 2,
    gameID: 'game-1',
    player1ID: 1,
    player2ID: 2,
    contextType: 'live',
    contextId: 'game-1-player-2',
    messages: [],
    ...overrides,
  };
}

/** Create a store and expose its injected dependency spies. */
function makeStore() {
  const syncDiplomacyThread = vi.fn(async () => {});
  const shutdownContext = vi.fn(async () => {});
  const store = new ChatThreadStore({ syncDiplomacyThread, shutdownContext });
  return { store, syncDiplomacyThread, shutdownContext };
}

describe('ChatThreadStore', () => {
  it('lists, gets, and replaces threads without durable reads', () => {
    const { store, syncDiplomacyThread } = makeStore();
    const original = makeThread({ diplomacy: true });
    const replacement = makeThread({ title: 'Replacement' });

    store.set(original);
    expect(store.get(original.id)).toBe(original);
    expect(store.list()).toEqual([original]);
    expect(syncDiplomacyThread).not.toHaveBeenCalled();

    store.set(replacement);
    expect(store.list()).toEqual([replacement]);
  });

  it('refreshes diplomacy threads on read but leaves ordinary threads in memory', async () => {
    const { store, syncDiplomacyThread } = makeStore();
    const diplomacy = makeThread({ id: 'diplomacy', diplomacy: true });
    const ordinary = makeThread({ id: 'ordinary', diplomacy: false });
    store.set(diplomacy);
    store.set(ordinary);

    await expect(store.read(diplomacy.id)).resolves.toBe(diplomacy);
    await expect(store.read(ordinary.id)).resolves.toBe(ordinary);
    await expect(store.read('missing')).resolves.toBeUndefined();
    expect(syncDiplomacyThread).toHaveBeenCalledOnce();
    expect(syncDiplomacyThread).toHaveBeenCalledWith(diplomacy);
  });

  it('shuts down a database context before removing its thread', async () => {
    const { store, shutdownContext } = makeStore();
    const thread = makeThread({ contextType: 'database', contextId: 'telepath-1' });
    store.set(thread);

    await expect(store.delete(thread.id)).resolves.toBe(true);
    expect(shutdownContext).toHaveBeenCalledWith('telepath-1');
    expect(store.get(thread.id)).toBeUndefined();
  });

  it('preserves a database thread when context shutdown fails', async () => {
    const { store, shutdownContext } = makeStore();
    const thread = makeThread({ contextType: 'database', contextId: 'telepath-1' });
    const failure = new Error('shutdown failed');
    shutdownContext.mockRejectedValueOnce(failure);
    store.set(thread);

    await expect(store.delete(thread.id)).rejects.toBe(failure);
    expect(store.get(thread.id)).toBe(thread);
  });

  it('deletes live threads without attempting context shutdown', async () => {
    const { store, shutdownContext } = makeStore();
    const thread = makeThread();
    store.set(thread);

    await expect(store.delete(thread.id)).resolves.toBe(true);
    await expect(store.delete(thread.id)).resolves.toBe(false);
    expect(shutdownContext).not.toHaveBeenCalled();
  });
});
