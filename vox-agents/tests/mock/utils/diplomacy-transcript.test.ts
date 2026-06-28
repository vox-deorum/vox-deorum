/**
 * Unit tests for the pure diplomacy-transcript reconciliation helpers.
 * No I/O — these reconcile stored transcript rows with in-memory chat threads.
 */

import { describe, it, expect } from 'vitest';
import {
  diplomacyThreadId,
  orderPair,
  roleOf,
  agentName,
  audienceID,
  speakerRole,
  hydrateMessages,
  deriveCloseTurn,
  isClosedThisTurn,
  joinAssistantText,
  type TranscriptMessage,
} from '../../../src/utils/diplomacy/transcript-utils.js';
import type { EnvoyThread, MessageWithMetadata } from '../../../src/types/index.js';

/** Minimal thread for the ordered-pair derivation helpers. */
function thread(partial: Partial<EnvoyThread>): EnvoyThread {
  return {
    id: 't', agent: 3, gameID: 'g',
    player1ID: 1, player2ID: 3,
    player1Role: 'the leader', player2Role: 'diplomat',
    contextType: 'live', contextId: 'g-player-3', messages: [],
    ...partial,
  };
}

/** Build a transcript row with sensible defaults. */
function row(partial: Partial<TranscriptMessage>): TranscriptMessage {
  return {
    ID: 1,
    Player1ID: 1,
    Player2ID: 3,
    Player1Role: 'the leader',
    Player2Role: 'diplomat',
    SpeakerID: 1,
    MessageType: 'text',
    Content: 'hello',
    Payload: {},
    Turn: 10,
    CreatedAt: 0,
    ...partial,
  };
}

describe('diplomacy transcript helpers', () => {
  describe('diplomacyThreadId', () => {
    it('should be stable regardless of endpoint order', () => {
      expect(diplomacyThreadId('game-x', 3, 1)).toBe('dipl:game-x:1:3');
      expect(diplomacyThreadId('game-x', 1, 3)).toBe('dipl:game-x:1:3');
    });
  });

  describe('orderPair', () => {
    it('should order Player1 = min, Player2 = max regardless of argument order', () => {
      expect(orderPair(3, 1)).toEqual({ player1ID: 1, player2ID: 3 });
      expect(orderPair(1, 3)).toEqual({ player1ID: 1, player2ID: 3 });
      expect(orderPair(5, -1)).toEqual({ player1ID: -1, player2ID: 5 });
    });
  });

  describe('roleOf / agentName / audienceID', () => {
    it('should resolve role by playerID, the agent name from the agent seat, and the audience', () => {
      const t = thread({ agent: 3, player1ID: 1, player2ID: 3, player1Role: 'the leader', player2Role: 'diplomat' });
      expect(roleOf(t, 1)).toBe('the leader');
      expect(roleOf(t, 3)).toBe('diplomat');
      expect(agentName(t)).toBe('diplomat'); // the agent seat's role IS the agent name
      expect(audienceID(t)).toBe(1);          // the other endpoint
    });

    it('should work when the agent seat sorts to player1', () => {
      const t = thread({ agent: 1, player1ID: 1, player2ID: 3, player1Role: 'spokesperson', player2Role: 'the leader' });
      expect(agentName(t)).toBe('spokesperson');
      expect(audienceID(t)).toBe(3);
    });
  });

  describe('speakerRole', () => {
    it('should map the voiced seat to assistant and the caller to user', () => {
      expect(speakerRole(3, 3)).toBe('assistant');
      expect(speakerRole(1, 3)).toBe('user');
    });
  });

  describe('hydrateMessages', () => {
    it('should keep text/close AND deal rows in append order, mapping roles by the voiced seat', () => {
      const transcript = [
        row({ ID: 1, SpeakerID: 1, Content: 'A speaks', MessageType: 'text', Turn: 5, CreatedAt: 2 }),
        row({ ID: 2, SpeakerID: 3, Content: 'B replies', MessageType: 'text', Turn: 5 }),
        row({ ID: 3, SpeakerID: 3, Content: 'farewell', MessageType: 'close', Turn: 6 }),
        row({ ID: 4, SpeakerID: 3, Content: 'deal', MessageType: 'deal-proposal', Turn: 6, Payload: { Deal: { version: 1, items: [], promises: [] } } }),
        row({ ID: 5, SpeakerID: 1, Content: '', MessageType: 'deal-reject', Turn: 6, Payload: { ProposalMessageID: 4 } }),
      ];
      const result = hydrateMessages(transcript, /* voicedID */ 3);
      // All conversation + deal rows are kept, in store append order.
      expect(result.map(m => m.message.role)).toEqual(['user', 'assistant', 'assistant', 'assistant', 'user']);
      expect(result.map(m => m.message.content)).toEqual(['A speaks', 'B replies', 'farewell', 'deal', '']);
      expect(result[0].metadata.turn).toBe(5);
      expect(result[0].metadata.datetime.getTime()).toBe(2000);
      // Deal rows carry their payload (for inline cards + reduction); text/close do not.
      expect(result.slice(0, 3).every(m => m.deal === undefined)).toBe(true);
      expect(result[3].deal?.MessageType).toBe('deal-proposal');
      expect(result[4].deal?.MessageType).toBe('deal-reject');
    });
  });

  describe('deriveCloseTurn', () => {
    it('should return undefined when never closed', () => {
      expect(deriveCloseTurn([row({ MessageType: 'text' })])).toBeUndefined();
    });
    it('should return the latest close turn', () => {
      const transcript = [
        row({ ID: 1, MessageType: 'close', Turn: 4 }),
        row({ ID: 2, MessageType: 'text', Turn: 7 }),
        row({ ID: 3, MessageType: 'close', Turn: 9 }),
      ];
      expect(deriveCloseTurn(transcript)).toBe(9);
    });
  });

  describe('isClosedThisTurn', () => {
    it('should lock on the close turn and unlock on a later turn', () => {
      expect(isClosedThisTurn(9, 9)).toBe(true);
      expect(isClosedThisTurn(9, 8)).toBe(true);   // close recorded in the future relative to read
      expect(isClosedThisTurn(9, 10)).toBe(false); // later turn → reopenable
      expect(isClosedThisTurn(undefined, 10)).toBe(false);
    });
  });

  describe('joinAssistantText', () => {
    it('should concatenate only assistant text, string and array content', () => {
      const messages: MessageWithMetadata[] = [
        { message: { role: 'user', content: 'ignore me' }, metadata: { datetime: new Date(0), turn: 1 } },
        { message: { role: 'assistant', content: 'plain reply' }, metadata: { datetime: new Date(0), turn: 1 } },
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'part one' },
              { type: 'tool-call', toolCallId: 't', toolName: 'x', input: {} },
              { type: 'text', text: 'part two' },
            ],
          },
          metadata: { datetime: new Date(0), turn: 1 },
        },
      ];
      expect(joinAssistantText(messages)).toBe('plain reply\npart one\npart two');
    });
  });
});
