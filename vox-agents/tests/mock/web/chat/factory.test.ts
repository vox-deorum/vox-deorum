import { beforeEach, describe, expect, it, vi } from 'vitest';

const modelMocks = vi.hoisted(() => ({
  ensureModelsResolved: vi.fn(async () => undefined),
  // Stubbed rather than real so the assertion does not depend on whether a local
  // config.json happens to assign the agent a model.
  selectModelReference: vi.fn((name: string, size: string) => `resolved:${name}:${size}`),
}));

vi.mock('../../../../src/agents/models/resolution.js', () => ({
  ensureModelsResolved: modelMocks.ensureModelsResolved,
  selectModelReference: modelMocks.selectModelReference,
  getRuntimeModel: vi.fn(() => undefined),
}));
import type { VoxContext } from '../../../../src/agents/runtime/vox-context.js';
import type { StrategistParameters } from '../../../../src/strategist/strategy-parameters.js';
import type {
  ChatThreadFactoryDependencies,
  EnvoyThread,
  PlayerAssignment,
  TelepathistChatContext,
} from '../../../../src/types/index.js';
import {
  createChatThreadFactory,
  orderParticipants,
} from '../../../../src/web/chat/factory.js';

/** Create a context-shaped value for tests that supply dialog identities directly. */
function fakeContext(): VoxContext<StrategistParameters> {
  return {} as VoxContext<StrategistParameters>;
}

/** Build isolated factory dependencies and expose their in-memory thread cache. */
function createDependencies(
  overrides: Partial<ChatThreadFactoryDependencies<VoxContext<StrategistParameters>>> = {},
): {
  dependencies: ChatThreadFactoryDependencies<VoxContext<StrategistParameters>>;
  threads: Map<string, EnvoyThread>;
} {
  const threads = new Map<string, EnvoyThread>();
  const dependencies: ChatThreadFactoryDependencies<VoxContext<StrategistParameters>> = {
    getContext: () => undefined,
    getAgent: () => ({ diplomacyOnly: false, speaksOnlyViaSendMessage: true, modelSize: 'default' }),
    getAssignments: () => undefined,
    getThread: (threadId) => threads.get(threadId),
    setThread: (thread) => {
      threads.set(thread.id, thread);
    },
    isThreadBusy: () => false,
    compactThread: vi.fn(async () => undefined),
    createOrdinaryThreadId: () => 'ordinary-thread',
    createDiplomacyThreadId: (gameID, player1ID, player2ID) => {
      const [lower, higher] = player1ID <= player2ID
        ? [player1ID, player2ID]
        : [player2ID, player1ID];
      return `dipl:${gameID}:${lower}:${higher}`;
    },
    createTelepathistContext: vi.fn(async () => {
      throw new Error('Unexpected telepathist context creation');
    }),
    ...overrides,
  };
  return { dependencies, threads };
}

beforeEach(() => {
  modelMocks.ensureModelsResolved.mockClear();
  modelMocks.selectModelReference.mockClear();
});

describe('chat thread factory', () => {
  describe('orderParticipants', () => {
    it('should keep each role and identity attached while ordering observer and player endpoints', () => {
      const observerIdentity = { name: 'Observer', leader: '' };
      const playerIdentity = { name: 'Germany', leader: 'Bismarck' };

      expect(orderParticipants(
        { id: 3, role: 'talkative-telepathist', identity: playerIdentity },
        { id: -1, role: 'Observer', identity: observerIdentity },
      )).toEqual({
        player1ID: -1,
        player2ID: 3,
        player1Role: 'Observer',
        player2Role: 'talkative-telepathist',
        player1Identity: observerIdentity,
        player2Identity: playerIdentity,
      });
    });
  });

  describe('openOrdinaryChat', () => {
    it('should construct a database thread through the injected telepathist context factory', async () => {
      const telepathist: TelepathistChatContext = {
        contextId: 'archive-game-telepath-4',
        gameID: 'archive-game',
        playerID: 4,
        identity: { name: 'Arabia', leader: 'Harun al-Rashid' },
      };
      const createTelepathistContext = vi.fn(async () => telepathist);
      const { dependencies, threads } = createDependencies({
        createTelepathistContext,
        getAgent: () => ({ diplomacyOnly: false, speaksOnlyViaSendMessage: true, modelSize: 'small' }),
      });
      const factory = createChatThreadFactory(dependencies);

      const thread = await factory.openOrdinaryChat({
        agentName: 'talkative-telepathist',
        databasePath: 'fixtures/archive-game-player-4.db',
        turn: 125,
      });

      expect(createTelepathistContext).toHaveBeenCalledWith(
        'fixtures/archive-game-player-4.db',
        'ordinary-thread',
      );
      expect(modelMocks.selectModelReference).toHaveBeenCalledWith('talkative-telepathist', 'small');
      expect(modelMocks.ensureModelsResolved).toHaveBeenCalledWith(['resolved:talkative-telepathist:small']);
      expect(thread).toMatchObject({
        id: 'ordinary-thread',
        agent: 4,
        gameID: 'archive-game',
        player1ID: -1,
        player2ID: 4,
        player1Role: 'Observer',
        player2Role: 'talkative-telepathist',
        player2Identity: telepathist.identity,
        diplomacy: false,
        contextType: 'database',
        contextId: 'archive-game-telepath-4',
        databasePath: 'fixtures/archive-game-player-4.db',
        metadata: { turn: 125 },
      });
      expect(threads.get('ordinary-thread')).toBe(thread);
    });

    it('should reject ordinary chats without exactly one context source', async () => {
      const createTelepathistContext = vi.fn(async () => {
        throw new Error('Unexpected telepathist context creation');
      });
      const { dependencies } = createDependencies({
        getContext: () => fakeContext(),
        createTelepathistContext,
      });
      const factory = createChatThreadFactory(dependencies);

      await expect(factory.openOrdinaryChat({
        agentName: 'talkative-telepathist',
      })).rejects.toThrow('Exactly one of contextId or databasePath is required');
      await expect(factory.openOrdinaryChat({
        agentName: 'talkative-telepathist',
        contextId: 'game-1-player-2',
        databasePath: 'fixtures/game-1-player-2.db',
      })).rejects.toThrow('Exactly one of contextId or databasePath is required');
      expect(createTelepathistContext).not.toHaveBeenCalled();
    });

    it('should reject an observer chat whose caller is the voiced seat itself', async () => {
      const { dependencies, threads } = createDependencies({ getContext: () => fakeContext() });
      const factory = createChatThreadFactory(dependencies);

      await expect(factory.openOrdinaryChat({
        agentName: 'spokesperson',
        contextId: 'game-1-player-2',
        callerPlayerID: 2,
        callerRole: 'ghost writer',
        callerIdentity: { name: 'India', leader: 'Gandhi' },
      })).rejects.toMatchObject({ status: 400 });
      expect(threads.size).toBe(0);
    });

    it('should give each database thread its own context instance', async () => {
      const threadIds = ['ordinary-a', 'ordinary-b'];
      const createTelepathistContext = vi.fn(async (_databasePath: string, threadId: string) => ({
        contextId: `archive-game-telepath_${threadId}-4`,
        gameID: 'archive-game',
        playerID: 4,
        identity: { name: 'Arabia', leader: 'Harun al-Rashid' },
      }));
      const { dependencies } = createDependencies({
        createOrdinaryThreadId: () => threadIds.shift()!,
        createTelepathistContext,
      });
      const factory = createChatThreadFactory(dependencies);

      const first = await factory.openOrdinaryChat({
        agentName: 'talkative-telepathist',
        databasePath: 'fixtures/archive-game-player-4.db',
      });
      const second = await factory.openOrdinaryChat({
        agentName: 'talkative-telepathist',
        databasePath: 'fixtures/archive-game-player-4.db',
      });

      expect(first.contextId).toBe('archive-game-telepath_ordinary-a-4');
      expect(second.contextId).toBe('archive-game-telepath_ordinary-b-4');
      expect(first.contextId).not.toBe(second.contextId);
      expect(createTelepathistContext).toHaveBeenNthCalledWith(
        1,
        'fixtures/archive-game-player-4.db',
        'ordinary-a',
      );
      expect(createTelepathistContext).toHaveBeenNthCalledWith(
        2,
        'fixtures/archive-game-player-4.db',
        'ordinary-b',
      );
    });
  });

  describe('openDiplomacyChat', () => {
    it('should reject a voice that can answer without send-message', async () => {
      const { dependencies } = createDependencies({
        getContext: () => fakeContext(),
        getAgent: () => ({ diplomacyOnly: false, speaksOnlyViaSendMessage: false, modelSize: 'default' }),
      });
      const factory = createChatThreadFactory(dependencies);

      await expect(factory.openDiplomacyChat({
        mode: 'diplomacy',
        contextId: 'game-7-player-2',
        callerPlayerID: 1,
        targetPlayerID: 2,
        agentName: 'ordinary-agent',
      })).rejects.toMatchObject({
        status: 400,
        message: 'Agent ordinary-agent cannot voice diplomacy because it does not require the send-message tool.',
      });
    });

    it('should mutate direction, context, roles, and voice when reopening a reversed pair', async () => {
      const assignments: Record<number, PlayerAssignment> = {
        1: { strategist: 'human-strategist', diplomat: 'diplomat', configSlot: 0 },
        2: { strategist: 'simple-strategist', diplomat: 'spokesperson', configSlot: 1 },
      };
      const compactThread = vi.fn(async () => undefined);
      const { dependencies } = createDependencies({
        getContext: () => fakeContext(),
        getAssignments: () => assignments,
        compactThread,
      });
      const factory = createChatThreadFactory(dependencies);
      const india = { name: 'India', leader: 'Gandhi' };
      const germany = { name: 'Germany', leader: 'Bismarck' };

      const first = await factory.openDiplomacyChat({
        mode: 'diplomacy',
        contextId: 'game-7-player-1',
        callerPlayerID: 1,
        callerIdentity: india,
        targetPlayerID: 2,
        targetIdentity: germany,
      });
      const reopened = await factory.openDiplomacyChat({
        mode: 'diplomacy',
        contextId: 'game-7-player-2',
        callerPlayerID: 2,
        callerIdentity: germany,
        callerRole: 'the emperor',
        targetPlayerID: 1,
        targetIdentity: india,
        agentName: 'spokesperson',
      });

      expect(reopened).toBe(first);
      expect(reopened).toMatchObject({
        id: 'dipl:game-7:1:2',
        agent: 1,
        contextId: 'game-7-player-1',
        title: 'Bismarck of Germany ↔ Gandhi of India',
        player1ID: 1,
        player2ID: 2,
        player1Role: 'spokesperson',
        player2Role: 'the emperor',
        player1Identity: india,
        player2Identity: germany,
      });
      expect(compactThread).toHaveBeenCalledTimes(2);
      expect(compactThread).toHaveBeenLastCalledWith(reopened);
    });

    it('should keep stored identities and title when a reopen cannot resolve them live', async () => {
      // Live resolution fails whenever the seat context has no cached game state yet (fresh launch,
      // load, crash recovery). A reopen without dialog-sent identities must fall back to what the
      // thread already holds instead of erasing it with `undefined`.
      const emptyContext = {
        getBaseParameters: () => undefined,
      } as unknown as VoxContext<StrategistParameters>;
      const { dependencies } = createDependencies({ getContext: () => emptyContext });
      const factory = createChatThreadFactory(dependencies);
      const india = { name: 'India', leader: 'Gandhi' };
      const germany = { name: 'Germany', leader: 'Bismarck' };

      const first = await factory.openDiplomacyChat({
        mode: 'diplomacy',
        contextId: 'game-7-player-2',
        callerPlayerID: 1,
        callerIdentity: india,
        targetPlayerID: 2,
        targetIdentity: germany,
      });
      expect(first.title).toBe('Gandhi of India ↔ Bismarck of Germany');

      const reopened = await factory.openDiplomacyChat({
        mode: 'diplomacy',
        contextId: 'game-7-player-2',
        callerPlayerID: 1,
        targetPlayerID: 2,
      });

      expect(reopened).toBe(first);
      expect(reopened).toMatchObject({
        title: 'Gandhi of India ↔ Bismarck of Germany',
        player1Identity: india,
        player2Identity: germany,
      });
    });

    it('should return a busy thread untouched, with no dependency mutation or compaction', async () => {
      // A live turn owns the thread's cache: it committed the caller row and captured the index its
      // reply begins at. A reopen that reassigned the voice and re-synced `thread.messages` would
      // invalidate that index and drop rows the turn is about to normalize — so a reopen during a
      // live turn is a pure lookup.
      const compactThread = vi.fn(async () => undefined);
      const { dependencies, threads } = createDependencies({
        getContext: () => fakeContext(),
        compactThread,
      });
      const factory = createChatThreadFactory(dependencies);
      const india = { name: 'India', leader: 'Gandhi' };
      const germany = { name: 'Germany', leader: 'Bismarck' };

      const first = await factory.openDiplomacyChat({
        mode: 'diplomacy',
        contextId: 'game-7-player-1',
        callerPlayerID: 1,
        callerIdentity: india,
        callerRole: 'the raja',
        targetPlayerID: 2,
        targetIdentity: germany,
      });
      // Stand in for the in-flight turn's state: a committed caller row and a fresh timestamp.
      const liveMessages = first.messages;
      liveMessages.push({
        message: { role: 'user', content: 'Will you trade?' },
        metadata: { datetime: new Date(0), turn: 7, id: 41 },
      });
      const snapshot = { ...first };
      compactThread.mockClear();

      // The same pair reopens from the other side while that turn is still running.
      const busy = createChatThreadFactory({
        ...dependencies,
        getThread: (threadId) => threads.get(threadId),
        isThreadBusy: (threadId) => threadId === first.id,
        compactThread,
      });
      const reopened = await busy.openDiplomacyChat({
        mode: 'diplomacy',
        contextId: 'game-7-player-2',
        callerPlayerID: 2,
        callerIdentity: germany,
        callerRole: 'the emperor',
        targetPlayerID: 1,
        targetIdentity: india,
        agentName: 'spokesperson',
      });

      expect(reopened).toBe(first);
      expect(compactThread).not.toHaveBeenCalled();
      // Nothing the reopen would normally rewrite moved: voice, context, roles, identities, title.
      expect(reopened).toMatchObject({
        agent: snapshot.agent,
        contextId: snapshot.contextId,
        title: snapshot.title,
        player1Role: snapshot.player1Role,
        player2Role: snapshot.player2Role,
        player1Identity: snapshot.player1Identity,
        player2Identity: snapshot.player2Identity,
      });
      // The in-flight turn's cache array is the very same object, with its row intact.
      expect(reopened.messages).toBe(liveMessages);
      expect(reopened.messages.map((m) => m.metadata.id)).toEqual([41]);
      expect(reopened.metadata!.updatedAt).toBe(snapshot.metadata!.updatedAt);
    });
  });
});
