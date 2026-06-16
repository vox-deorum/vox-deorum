/**
 * Mock-tier unit tests for the EpisodeRetriever programmatic agent
 * (src/telepathist/episode-retriever.ts).
 *
 * EpisodeRetriever is a non-LLM agent: handleMessage resolves a target turn
 * (greeting/initialize -> thread or first available turn; numeric -> parsed
 * turn; unavailable -> snap to closest; none -> usage hint), then fetches and
 * formats episodes. The episode utils (requestEpisodesFromTelemetry,
 * formatEpisodeResults) are mocked. Assertions target the dynamic FACTS passed
 * to those utils and the resulting thread state changes — never streamed prose.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/utils/prompts/episode-utils.js', () => ({
  requestEpisodesFromTelemetry: vi.fn(),
  formatEpisodeResults: vi.fn(),
}));

import {
  requestEpisodesFromTelemetry,
  formatEpisodeResults,
} from '../../../src/utils/prompts/episode-utils.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import type { TelepathistParameters } from '../../../src/telepathist/telepathist-parameters.js';
import type { EnvoyThread } from '../../../src/types/index.js';

const retriever = agentRegistry.get('episode-retriever') as any;

/** Build a minimal TelepathistParameters for the retriever. */
function makeParams(overrides: Partial<TelepathistParameters> = {}): TelepathistParameters {
  return {
    playerID: 2,
    gameID: 'test-game',
    turn: 30,
    databasePath: '/tmp/test.db',
    db: { TAG: 'telemetry-db' } as any,
    telepathistDb: { TAG: 'telepathist-db' } as any,
    civilizationName: 'Rome',
    leaderName: 'Augustus Caesar',
    availableTurns: [10, 20, 30],
    ...overrides,
  } as TelepathistParameters;
}

/** Build a minimal EnvoyThread the retriever consumes. */
function makeThread(overrides: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'thread-1',
    agent: 2,
    gameID: 'test-game',
    player1ID: -1,
    player2ID: 2,
    contextType: 'database',
    contextId: 'test-game-player-2',
    messages: [],
    metadata: {},
    ...overrides,
  } as EnvoyThread;
}

let streamed: string[];
let streamProgress: (text: string) => void;

beforeEach(() => {
  vi.mocked(requestEpisodesFromTelemetry).mockReset();
  vi.mocked(formatEpisodeResults).mockReset();
  vi.mocked(requestEpisodesFromTelemetry).mockResolvedValue([] as any);
  vi.mocked(formatEpisodeResults).mockReturnValue('FORMATTED_EPISODES');
  streamed = [];
  streamProgress = (t: string) => streamed.push(t);
});

describe('EpisodeRetriever.handleMessage', () => {
  describe('greeting / initialize', () => {
    it('uses the thread metadata turn when available', async () => {
      const params = makeParams();
      const thread = makeThread({ metadata: { turn: 20 } });

      await retriever.handleMessage(params, thread, '{{{Greeting}}}', streamProgress);

      expect(requestEpisodesFromTelemetry).toHaveBeenCalledWith(
        params.db,
        params.telepathistDb,
        20,
        params.playerID
      );
      expect(thread.metadata!.turn).toBe(20);
    });

    it('falls back to the first available turn when no thread turn is set', async () => {
      const params = makeParams();
      const thread = makeThread({ metadata: {} });

      await retriever.handleMessage(params, thread, '{{{Initialize}}}', streamProgress);

      expect(requestEpisodesFromTelemetry).toHaveBeenCalledWith(
        params.db,
        params.telepathistDb,
        10,
        params.playerID
      );
    });

    it('records the formatted result as an assistant message', async () => {
      const params = makeParams();
      const thread = makeThread({ metadata: { turn: 20 } });

      await retriever.handleMessage(params, thread, '{{{Greeting}}}', streamProgress);

      expect(thread.messages).toHaveLength(1);
      const msg = thread.messages[0];
      expect(msg.message.role).toBe('assistant');
      expect(msg.message.content).toBe('FORMATTED_EPISODES');
      expect(msg.metadata.turn).toBe(20);
    });
  });

  describe('numeric messages', () => {
    it('parses a bare turn number', async () => {
      const params = makeParams();
      const thread = makeThread({ metadata: {} });

      await retriever.handleMessage(params, thread, '30', streamProgress);

      expect(requestEpisodesFromTelemetry).toHaveBeenCalledWith(
        params.db,
        params.telepathistDb,
        30,
        params.playerID
      );
    });

    it('parses a turn number embedded in text', async () => {
      const params = makeParams();
      const thread = makeThread({ metadata: {} });

      await retriever.handleMessage(params, thread, 'turn 20 please', streamProgress);

      expect(requestEpisodesFromTelemetry).toHaveBeenCalledWith(
        params.db,
        params.telepathistDb,
        20,
        params.playerID
      );
    });
  });

  describe('unavailable turns', () => {
    it('snaps a requested turn to the closest available turn', async () => {
      const params = makeParams();
      const thread = makeThread({ metadata: {} });

      // 22 is closest to 20 (diff 2) vs 30 (diff 8).
      await retriever.handleMessage(params, thread, '22', streamProgress);

      expect(requestEpisodesFromTelemetry).toHaveBeenCalledWith(
        params.db,
        params.telepathistDb,
        20,
        params.playerID
      );
      expect(thread.metadata!.turn).toBe(20);
    });
  });

  describe('missing turn', () => {
    it('streams a usage hint and records an assistant message without fetching', async () => {
      const params = makeParams();
      const thread = makeThread({ metadata: {} });

      await retriever.handleMessage(params, thread, 'hello there', streamProgress);

      expect(requestEpisodesFromTelemetry).not.toHaveBeenCalled();
      expect(thread.messages).toHaveLength(1);
      expect(thread.messages[0].message.role).toBe('assistant');
    });
  });

  describe('retrieval errors', () => {
    it('streams an error and does not record an assistant message', async () => {
      const params = makeParams();
      const thread = makeThread({ metadata: { turn: 20 } });
      vi.mocked(requestEpisodesFromTelemetry).mockRejectedValue(new Error('BOOM_DB'));

      await retriever.handleMessage(params, thread, '{{{Greeting}}}', streamProgress);

      const streamedAll = streamed.join('\n');
      expect(streamedAll).toContain('BOOM_DB');
      expect(thread.messages).toHaveLength(0);
    });
  });
});
