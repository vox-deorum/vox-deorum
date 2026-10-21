/**
 * Tests for KnowledgeStore's real persistence paths against an in-memory SQLite database.
 * Public/Mutable/Timed CRUD run fully real; only handleGameEvent's collaborators
 * (gameDatabase localization, MCP notifications) are mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { knowledgeManager, gameDatabase } from '../../../src/server.js';
import { bridgeManager } from '../../../src/server.js';
import * as gameIdentity from '../../../src/knowledge/getters/game-identity.js';
import { MaxMajorCivs } from '../../../src/knowledge/schema/base.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectNotificationClient } from '../tool-client.js';

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

  it('does not create a version when the same snapshot is stored twice', async () => {
    const snapshot = { GrandStrategy: 'Conquest', EconomicStrategies: ['Growth'], MilitaryStrategies: ['Defense'] } as any;
    await store.storeMutableKnowledge('StrategyChanges', 4, snapshot);
    await store.storeMutableKnowledge('StrategyChanges', 4, snapshot);

    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 4);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ Version: 1, GrandStrategy: 'Conquest', EconomicStrategies: ['Growth'] });
  });

  it('stamps an explicit source turn, defaulting to the manager turn otherwise', async () => {
    await store.storeMutableKnowledge('StrategyChanges', 1, { GrandStrategy: 'Conquest', Rationale: 'a' } as any, undefined, undefined, 7);
    expect((await store.getMutableKnowledge('StrategyChanges', 1))!.Turn).toBe(7);

    await store.storeMutableKnowledge('StrategyChanges', 2, { GrandStrategy: 'Culture', Rationale: 'a' } as any);
    expect((await store.getMutableKnowledge('StrategyChanges', 2))!.Turn).toBe(10);
  });

  it('honors per-player visibility filtering', async () => {
    const visibility = (level: number) => {
      const flags = new Array(MaxMajorCivs).fill(0);
      flags[5] = level;
      return flags;
    };
    await store.storeMutableKnowledge('StrategyChanges', 1, { GrandStrategy: 'Conquest', Rationale: 'a' } as any, visibility(1));
    await store.storeMutableKnowledge('StrategyChanges', 2, { GrandStrategy: 'Culture', Rationale: 'b' } as any, visibility(2));
    await store.storeMutableKnowledge('StrategyChanges', 3, { GrandStrategy: 'Diplomacy', Rationale: 'c' } as any, visibility(0));

    expect(await store.getMutableKnowledge('StrategyChanges', 1, 5)).toMatchObject({ GrandStrategy: 'Conquest' });
    expect(await store.getMutableKnowledge('StrategyChanges', 2, 5)).toMatchObject({ GrandStrategy: 'Culture' });
    expect(await store.getMutableKnowledge('StrategyChanges', 3, 5)).toBeUndefined();
    expect(await store.getMutableKnowledge('StrategyChanges', 1, 3)).toBeUndefined();
    expect(await store.getMutableKnowledge('StrategyChanges', 1)).toMatchObject({ GrandStrategy: 'Conquest' });
  });
});

describe('timed knowledge & render events', () => {
  it('persists a single TimedKnowledge row and returns its new ID', async () => {
    const id = await store.storeTimedKnowledge('GameEvents', { data: { Type: 'TestEvent' } as any });

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
  let notificationClient: Awaited<ReturnType<typeof connectNotificationClient>>;
  let priorConnectedListeners: Function[];
  let priorGameEventListeners: Function[];

  beforeEach(async () => {
    // localizeObject needs the (uninitialized) localization DB; stub it to identity.
    vi.spyOn(gameDatabase, 'localizeObject').mockImplementation(async (o: any) => o);
    priorConnectedListeners = bridgeManager.rawListeners('connected');
    priorGameEventListeners = bridgeManager.rawListeners('gameEvent');
    // A fresh game ID per test forces a context switch, so no identity leaks between tests.
    vi.spyOn(gameIdentity, 'syncGameIdentity').mockResolvedValue({ gameId: `event-test-${crypto.randomUUID()}`, turn: 10, activePlayerId: 1 });
    vi.spyOn(knowledgeManager, 'loadKnowledge').mockResolvedValue();
    // No live game to checksum against; treat the enum mappings as verified
    vi.spyOn(knowledgeManager as any, 'loadEnumMappings').mockResolvedValue(true);
    await knowledgeManager.initialize();
    const connectedHandler = bridgeManager.rawListeners('connected').find(listener => !priorConnectedListeners.includes(listener));
    if (!connectedHandler) throw new Error('KnowledgeManager did not register a connected handler');
    notificationClient = await connectNotificationClient();
    connectedHandler();
    // GameSwitched is the last step of the context switch; clear it so each test sees only its own notifications.
    await vi.waitFor(() => expect(notificationClient.notifications.map(n => n.event)).toContain('GameSwitched'));
    expect(knowledgeManager.getActivePlayerId()).toBe(1);
    notificationClient.notifications.length = 0;
  });

  afterEach(async () => {
    await notificationClient.close();
    for (const listener of bridgeManager.rawListeners('connected')) {
      if (!priorConnectedListeners.includes(listener)) bridgeManager.off('connected', listener);
    }
    for (const listener of bridgeManager.rawListeners('gameEvent')) {
      if (!priorGameEventListeners.includes(listener)) bridgeManager.off('gameEvent', listener);
    }
    await knowledgeManager.shutdown();
  });

  const validPayload = { PlotX: 5, PlotY: 6, PlayerID: 1 };

  it('ignores unknown event types without writing or notifying', async () => {
    await store.handleGameEvent(10_000_001, 'NotARealEvent', validPayload);
    const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('validates a known schema, stores the event, and stamps lastID without notifying an unlisted event', async () => {
    await store.handleGameEvent(10_000_001, 'BarbariansCampCleared', validPayload);

    const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Type: 'BarbariansCampCleared', Turn: 10 });
    expect(await store.getMetadata('lastID')).toBe('10000001');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(notificationClient.notifications).toHaveLength(0);
  });

  it('rejects a schema-invalid payload (no write, no notify)', async () => {
    await store.handleGameEvent(10_000_002, 'BarbariansCampCleared', { PlotX: 'nope' } as any);
    const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('drops events with sentinel coordinates before storage', async () => {
    await store.handleGameEvent(10_000_003, 'BarbariansCampCleared', { PlotX: -2147483647, PlotY: 6, PlayerID: 1 });
    const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('stores IdeologyAdopted as PlayerAdoptPolicyBranch', async () => {
    await store.handleGameEvent(10_000_004, 'IdeologyAdopted', { PlayerID: 1, BranchType: 9 });
    const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Type: 'PlayerAdoptPolicyBranch' });
    expect(rows[0].Payload).toMatchObject({ PlayerID: 1, BranchType: 9 });
  });

  it('drops IdeologyAdopted for a branch being locked', async () => {
    await store.handleGameEvent(10_000_005, 'IdeologyAdopted', { PlayerID: 1, BranchType: 9 }, undefined, { BranchLocked: true });
    expect(await store.getDatabase().selectFrom('GameEvents').selectAll().execute()).toHaveLength(0);
  });

  it.each([
    ['DiplomacyPanelOpened', { CounterpartID: 3, Turn: 10 }],
    ['DiplomacyChatMessage', { CounterpartID: 3, Turn: 10, Text: 'Hello.' }],
    ['DiplomacyDealAction', { CounterpartID: 3, Turn: 10, Action: 'propose', Deal: { Items: [] } }],
    ['DiplomacyTranscriptRequest', { CounterpartID: 3, Turn: 10, BeforeID: 99 }],
  ])('admits %s with a real observer seat, true AsObserver, and extra payload fields', async (type, fields) => {
    const payload = { PlayerID: 27, AsObserver: true, ExtraTransportField: { preserved: true }, ...fields };

    await store.handleGameEvent(10_000_010, type, payload);

    const [row] = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
    expect(row).toMatchObject({ Type: type });
    expect(row.Payload).toMatchObject(payload);
    await vi.waitFor(() => expect(notificationClient.notifications).toHaveLength(1));
    expect(notificationClient.notifications[0]).toMatchObject({
      event: type,
      playerID: 27,
      turn: 10,
      latestID: 10_000_010,
      data: expect.objectContaining(payload),
    });
  });

  it.each([
    ['DiplomacyPanelOpened', { CounterpartID: 3, Turn: 10 }],
    ['DiplomacyChatMessage', { CounterpartID: 3, Turn: 10, Text: 'Hello.' }],
    ['DiplomacyDealAction', { CounterpartID: 3, Turn: 10, Action: 'propose', Deal: { Items: [] } }],
    ['DiplomacyTranscriptRequest', { CounterpartID: 3, Turn: 10, BeforeID: 99 }],
  ])('rejects %s when AsObserver is false', async (type, fields) => {
    await store.handleGameEvent(10_000_011, type, { PlayerID: 27, AsObserver: false, ...fields });

    expect(await store.getDatabase().selectFrom('GameEvents').selectAll().execute()).toHaveLength(0);
  });

  it.each([
    ['propose missing Deal', { Action: 'propose' }],
    ['counter missing Deal', { Action: 'counter', ProposalMessageID: 7 }],
    ['counter missing ProposalMessageID', { Action: 'counter', Deal: { Items: [] } }],
    ['accept missing ProposalMessageID', { Action: 'accept' }],
    ['reject missing ProposalMessageID', { Action: 'reject' }],
  ])('rejects a DiplomacyDealAction %s (no write, no notify)', async (_label, fields) => {
    await store.handleGameEvent(10_000_012, 'DiplomacyDealAction', {
      PlayerID: 2, CounterpartID: 3, Turn: 10, ...fields,
    });

    expect(await store.getDatabase().selectFrom('GameEvents').selectAll().execute()).toHaveLength(0);
  });

  it('still advances the active player and notifies when a turn-end read fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockRejectedValue(new Error('bridge down'));
    await store.handleGameEvent(10_000_020, 'PlayerDoneTurn', { PlayerID: 1, NextPlayerID: 2 });

    expect(knowledgeManager.getActivePlayerId()).toBe(2);
    await vi.waitFor(() => expect(notificationClient.notifications).toHaveLength(1));
    expect(notificationClient.notifications[0]).toMatchObject({
      event: 'PlayerDoneTurn',
      playerID: 1,
      turn: 10,
      latestID: 10_000_020,
    });
  });
});

