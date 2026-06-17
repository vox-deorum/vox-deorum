/**
 * Tests for KnowledgeStore's real persistence paths against an in-memory SQLite database.
 * Public/Mutable/Timed CRUD run fully real; only handleGameEvent's collaborators
 * (gameDatabase localization, MCP notifications) are mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { knowledgeManager, gameDatabase, MCPServer } from '../../../src/server.js';
import { composeVisibility } from '../../../src/utils/knowledge/visibility.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

describe('public knowledge', () => {
  it('round-trips storePublicKnowledge / getPublicKnowledge and upserts on conflict', async () => {
    await store.storePublicKnowledge('PlayerInformations', 4, {
      Civilization: 'Rome', Leader: 'Caesar', TeamID: 4, IsHuman: 0, IsMajor: 1,
    } as any);

    const first = await store.getPublicKnowledge('PlayerInformations', 4);
    expect(first).toMatchObject({ Key: 4, Civilization: 'Rome', Leader: 'Caesar' });

    // Same key → update in place (no second row).
    await store.storePublicKnowledge('PlayerInformations', 4, {
      Civilization: 'Rome', Leader: 'Augustus', TeamID: 4, IsHuman: 0, IsMajor: 1,
    } as any);
    const updated = await store.getPublicKnowledge('PlayerInformations', 4);
    expect(updated).toMatchObject({ Leader: 'Augustus' });
    const all = await store.getAllPublicKnowledge('PlayerInformations');
    expect(all).toHaveLength(1);
  });

  it('returns null for a missing public key', async () => {
    expect(await store.getPublicKnowledge('PlayerInformations', 999)).toBeNull();
  });
});

describe('mutable knowledge versioning', () => {
  it('creates version 1 with IsLatest=1 and all fields recorded as initial changes', async () => {
    await store.storeMutableKnowledge('StrategyChanges', 1, {
      GrandStrategy: 'Conquest', Rationale: 'first',
    } as any);

    const latest = await store.getMutableKnowledge('StrategyChanges', 1);
    expect(latest).toMatchObject({ Key: 1, Version: 1, IsLatest: 1, GrandStrategy: 'Conquest' });
    // First version reports every non-metadata field it set as a change.
    expect(latest!.Changes).toContain('GrandStrategy');
  });

  it('bumps Version and flips IsLatest on a real change, keeping history queryable', async () => {
    await store.storeMutableKnowledge('StrategyChanges', 1, { GrandStrategy: 'Conquest', Rationale: 'a' } as any);
    await store.storeMutableKnowledge('StrategyChanges', 1, { GrandStrategy: 'Culture', Rationale: 'b' } as any);

    const latest = await store.getMutableKnowledge('StrategyChanges', 1);
    expect(latest).toMatchObject({ Version: 2, IsLatest: 1, GrandStrategy: 'Culture' });
    expect(latest!.Changes).toContain('GrandStrategy');

    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 1);
    expect(history.map((h) => h.Version)).toEqual([2, 1]);
    // Exactly one latest row.
    expect(history.filter((h) => h.IsLatest === 1)).toHaveLength(1);
  });

  it('skips the update entirely when only ignored fields differ (no new version)', async () => {
    await store.storeMutableKnowledge('StrategyChanges', 1, { GrandStrategy: 'Conquest', Rationale: 'a' } as any, undefined, ['Rationale']);
    // Only the ignored Rationale changes → no-op.
    await store.storeMutableKnowledge('StrategyChanges', 1, { GrandStrategy: 'Conquest', Rationale: 'totally different' } as any, undefined, ['Rationale']);

    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 1);
    expect(history).toHaveLength(1);
    expect(history[0].Version).toBe(1);
    // The original (un-updated) Rationale is preserved.
    expect(history[0].Rationale).toBe('a');
  });

  it('stamps an explicit source turn, defaulting to the manager turn otherwise', async () => {
    await store.storeMutableKnowledge('StrategyChanges', 1, { GrandStrategy: 'Conquest', Rationale: 'a' } as any, undefined, undefined, 7);
    expect((await store.getMutableKnowledge('StrategyChanges', 1))!.Turn).toBe(7);

    await store.storeMutableKnowledge('StrategyChanges', 2, { GrandStrategy: 'Culture', Rationale: 'a' } as any);
    expect((await store.getMutableKnowledge('StrategyChanges', 2))!.Turn).toBe(10);
  });

  it('honors per-player visibility filtering', async () => {
    await store.storeMutableKnowledge('StrategyChanges', 1, { GrandStrategy: 'Conquest', Rationale: 'a' } as any, composeVisibility([5]));

    // Visible to player 5, invisible to player 3.
    expect(await store.getMutableKnowledge('StrategyChanges', 1, 5)).not.toBeNull();
    // executeTakeFirst() yields undefined for a filtered-out row.
    expect(await store.getMutableKnowledge('StrategyChanges', 1, 3)).toBeUndefined();
    // No filter → always returned.
    expect(await store.getMutableKnowledge('StrategyChanges', 1)).not.toBeNull();
  });
});

describe('timed knowledge & render events', () => {
  it('persists a single TimedKnowledge row and returns its new ID', async () => {
    const id = await store.storeTimedKnowledge('GameEvents', { data: { Type: 'TestEvent' } as any });
    expect(typeof id).toBe('number');

    const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ID: id, Type: 'TestEvent', Turn: 10 });
  });

  it('persists a render event with extracted metadata columns', async () => {
    await store.insertRenderEvent(123456, 4, 'PlayerPanelSwitch', { playerID: 2 });
    const rows = await store.getDatabase().selectFrom('RenderEvents').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Time: 123456, Turn: 4, Event: 'PlayerPanelSwitch' });
  });
});

describe('handleGameEvent', () => {
  let notifySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // localizeObject needs the (uninitialized) localization DB; stub it to identity.
    vi.spyOn(gameDatabase, 'localizeObject').mockImplementation(async (o: any) => o);
    notifySpy = vi.spyOn(MCPServer.getInstance(), 'sendNotification').mockImplementation(() => {});
  });

  const validPayload = { PlotX: 5, PlotY: 6, PlayerID: 1 };

  it('ignores unknown event types without writing or notifying', async () => {
    await store.handleGameEvent(10_000_001, 'NotARealEvent', validPayload);
    const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(rows).toHaveLength(0);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('validates a known schema, stores the event, stamps lastID, and notifies', async () => {
    await store.handleGameEvent(10_000_001, 'BarbariansCampCleared', validPayload);

    const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Type: 'BarbariansCampCleared', Turn: 10 });
    expect(await store.getMetadata('lastID')).toBe('10000001');
    expect(notifySpy).toHaveBeenCalledWith('BarbariansCampCleared', 1, 10, 10_000_001, expect.any(Object));
  });

  it('rejects a schema-invalid payload (no write, no notify)', async () => {
    await store.handleGameEvent(10_000_002, 'BarbariansCampCleared', { PlotX: 'nope' } as any);
    const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(rows).toHaveLength(0);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('drops events with sentinel coordinates before storage', async () => {
    await store.handleGameEvent(10_000_003, 'BarbariansCampCleared', { PlotX: -2147483647, PlotY: 6, PlayerID: 1 });
    const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(rows).toHaveLength(0);
    expect(notifySpy).not.toHaveBeenCalled();
  });
});
