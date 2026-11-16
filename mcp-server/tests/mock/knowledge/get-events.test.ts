/** Check that a caller's event filters are applied together through the MCP tool. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { connectToolClient } from '../tool-client.js';
import { gameDatabase, knowledgeManager } from '../../../src/server.js';
import createGetEventsTool from '../../../src/tools/knowledge/get-events.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { enumMappings } from '../../../src/knowledge/helpers/enum.js';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

describe('get-events filtered original results', () => {
  let store: KnowledgeStore;
  let client: Awaited<ReturnType<typeof connectToolClient>>;
  let turn = 9;

  afterEach(async () => {
    await client?.close();
    vi.restoreAllMocks();
    await store?.close();
  });

  it('redacts nested unknown resources while keeping readable deal terms and stored payloads unchanged', async () => {
    store = await setupStore(9);
    await store.storeMutableKnowledge('PlayerSummaries', 0, {
      Cities: 1, Population: 1, Gold: 0, GoldPerTurn: 0, Technologies: 0, Resources: { Iron: '1 / 1' }
    } as any);
    const payload = { FromPlayerID: 0, ToPlayerID: 1, FromGives: ['Gold: 5'], ToGives: ['Open Borders'],
      TurnsRemaining: 7, TradedItems: [{ ItemType: 'Gold', Data1: 5 }], Plot: { ResourceType: 'Uranium' },
      Items: [{ Resource: 'Iron' }] };
    await store.getDatabase().insertInto('GameEvents').values({ ID: 1, Turn: 9, Type: 'DealMade', Player0: 1, Payload: payload } as any).execute();
    client = await connectToolClient(createGetEventsTool());
    const result = await client.call({ PlayerID: 0, Original: true });
    expect(result.events[0]).toMatchObject({ FromGives: ['Gold: 5'], ToGives: ['Open Borders'], TurnsRemaining: 7,
      Plot: { ResourceType: 'None' }, Items: [{ Resource: 'Iron' }] });
    expect(result.events[0]).not.toHaveProperty('TradedItems');
    expect((await store.getDatabase().selectFrom('GameEvents').selectAll().executeTakeFirstOrThrow()).Payload).toEqual(payload);
  });

  it('hides only unrevealed strategic and luxury resources, keeping bonus resources readable', async () => {
    store = await setupStore(9);
    const rules = new Database(':memory:');
    rules.exec(`CREATE TABLE Resources (ID INTEGER, ResourceClassType TEXT);
      INSERT INTO Resources VALUES (0, 'RESOURCECLASS_RUSH'), (1, 'RESOURCECLASS_MODERN'), (2, 'RESOURCECLASS_LUXURY'), (3, 'RESOURCECLASS_BONUS');`);
    vi.spyOn(gameDatabase, 'getDatabase').mockReturnValue(new Kysely<any>({ dialect: new SqliteDialect({ database: rules }) }));
    enumMappings['ResourceType'] = { [-1]: 'None', 0: 'Iron', 1: 'Uranium', 2: 'Silk', 3: 'Wheat' };
    try {
      await store.storeMutableKnowledge('PlayerSummaries', 0, {
        Cities: 1, Population: 1, Gold: 0, GoldPerTurn: 0, Technologies: 0, Resources: { Iron: '0 / 2', Silk: 0 }
      } as any);
      const plots = ['Iron', 'Uranium', 'Silk', 'Wheat', 'None', 4];
      for (const [index, resource] of plots.entries()) {
        await store.getDatabase().insertInto('GameEvents')
          .values({ ID: index + 1, Turn: 9, Type: 'TileRevealed', Player0: 1, Payload: { Plot: { ResourceType: resource } } } as any).execute();
      }
      client = await connectToolClient(createGetEventsTool());
      const result = await client.call({ PlayerID: 0, Original: true });
      expect(result.events.map((event: any) => event.Plot.ResourceType)).toEqual(['Iron', 'None', 'Silk', 'Wheat', 'None', 'None']);
    } finally {
      delete enumMappings['ResourceType'];
    }
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
