/** Check that a caller's event filters are applied together through the MCP tool. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { connectToolClient } from '../tool-client.js';
import { gameDatabase, knowledgeManager } from '../../../src/server.js';
import createGetEventsTool from '../../../src/tools/knowledge/get-events.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

describe('get-events filtered original results', () => {
  let store: KnowledgeStore;
  let client: Awaited<ReturnType<typeof connectToolClient>>;
  let turn = 9;

  afterEach(async () => {
    await client?.close();
    vi.restoreAllMocks();
    await store?.close();
  });

  it('combines turn, type, ID range, and player visibility filters', async () => {
    store = await setupStore(9);
    vi.spyOn(knowledgeManager, 'getTurn').mockImplementation(() => turn);
    vi.spyOn(gameDatabase, 'localizeObject').mockImplementation(async value => value);
    const visibility = Array(22).fill(0);
    visibility[0] = 2;
    await store.storeMutableKnowledge('PlayerSummaries', 0, {
      Era: 'ERA_ANCIENT',
      Cities: 1,
      Population: 1,
      Gold: 0,
      GoldPerTurn: 0,
      Technologies: 0,
    } as any, visibility, undefined, 9);

    const candidates = [
      { id: 101, turn: 9, type: 'PlayerDoneTurn', playerZero: 2, marker: 'before-range' },
      { id: 105, turn: 8, type: 'PlayerDoneTurn', playerZero: 2, marker: 'other-turn' },
      { id: 109, turn: 9, type: 'PlayerDoTurn', playerZero: 2, marker: 'other-type' },
      { id: 115, turn: 9, type: 'PlayerDoneTurn', playerZero: 2, marker: 'selected' },
      { id: 117, turn: 9, type: 'PlayerDoneTurn', playerZero: 0, marker: 'hidden' },
      { id: 121, turn: 9, type: 'PlayerDoneTurn', playerZero: 2, marker: 'after-range' },
    ];
    for (const candidate of candidates) {
      turn = candidate.turn;
      const flags = Array(22).fill(0);
      flags[0] = candidate.playerZero;
      await store.storeGameEvent(candidate.id, candidate.type, { Marker: candidate.marker }, flags);
    }
    client = await connectToolClient(createGetEventsTool());

    const report = await client.call({
      Turn: 9,
      Type: 'PlayerDoneTurn',
      After: 103,
      Before: 119,
      PlayerID: 0,
      Original: true,
    });

    expect(report.events).toEqual([
      expect.objectContaining({ ID: 115, Turn: 9, Type: 'PlayerDoneTurn', Marker: 'selected' }),
    ]);
  });
});
