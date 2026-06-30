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
  collectSpokenReply,
  type TranscriptMessage,
} from '../../../src/utils/diplomacy/transcript-utils.js';
import { counterpartOpenProposal, type DealReduction } from '../../../src/utils/diplomacy/deal-reduce.js';
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

  describe('collectSpokenReply', () => {
    /** Wrap assistant content as a thread item with throwaway metadata. */
    function assistant(content: MessageWithMetadata['message']['content']): MessageWithMetadata {
      return { message: { role: 'assistant', content } as MessageWithMetadata['message'], metadata: { datetime: new Date(0), turn: 1 } };
    }

    it('captures a send-message-only turn from the tool-call Message input', () => {
      const messages = [assistant([
        { type: 'tool-call', toolCallId: 't1', toolName: 'send-message', input: { Message: 'Hello there.' } },
      ])];
      expect(collectSpokenReply(messages)).toBe('Hello there.');
    });

    it('archives a narrate-then-send-message turn as BOTH, in display order', () => {
      // The leak this closes: a model that narrates and then speaks shows both live; the reload must
      // reproduce that same sequence (native text first, then the send-message text).
      const messages = [assistant([
        { type: 'text', text: 'I will respond carefully.' },
        { type: 'tool-call', toolCallId: 't2', toolName: 'send-message', input: { Message: 'We accept your terms.' } },
      ])];
      expect(collectSpokenReply(messages)).toBe('I will respond carefully.\nWe accept your terms.');
    });

    it('captures a plain-string assistant message (the Anthropic free-text fallback)', () => {
      expect(collectSpokenReply([assistant('A spoken fallback line.')])).toBe('A spoken fallback line.');
    });

    it('returns "" for a turn that spoke nothing (support tools only, no text)', () => {
      const messages = [assistant([
        { type: 'tool-call', toolCallId: 't3', toolName: 'get-briefing', input: { Categories: ['Military'] } },
      ])];
      expect(collectSpokenReply(messages)).toBe('');
    });

    it('preserves the spoken text verbatim, including leading/trailing whitespace', () => {
      // What streamed live keeps the model's own padding; archival must not silently trim it, or the
      // reloaded reply would differ from what the counterpart saw.
      const messages = [assistant([
        { type: 'tool-call', toolCallId: 't4', toolName: 'send-message', input: { Message: '  Hold the line.\n' } },
      ])];
      expect(collectSpokenReply(messages)).toBe('  Hold the line.\n');
    });

    it('collapses a whitespace-only reply to "" so the retry fallback engages', () => {
      const messages = [assistant([
        { type: 'tool-call', toolCallId: 't5', toolName: 'send-message', input: { Message: '   \n  ' } },
      ])];
      expect(collectSpokenReply(messages)).toBe('');
    });

    it('ignores user messages and returns "" when none are assistant turns', () => {
      const messages: MessageWithMetadata[] = [
        { message: { role: 'user', content: 'ignore me' }, metadata: { datetime: new Date(0), turn: 1 } },
      ];
      expect(collectSpokenReply(messages)).toBe('');
    });
  });
});

describe('counterpartOpenProposal', () => {
  /** A deal reduction with sensible defaults (no proposal on the table). */
  function reduction(partial: Partial<DealReduction> = {}): DealReduction {
    return { active: null, status: 'none', proposals: [], ...partial };
  }

  it('is true only when an OPEN proposal authored by the counterpart is on the table', () => {
    // Agent voices seat 3; the counterpart (seat 1) authored the open proposal.
    const counterpart = reduction({ active: row({ SpeakerID: 1, MessageType: 'deal-proposal' }), status: 'open' });
    expect(counterpartOpenProposal(counterpart, 3)).toBe(true);
  });

  it('is false when OUR own side authored the open proposal (ball is on the other side)', () => {
    const own = reduction({ active: row({ SpeakerID: 3, MessageType: 'deal-proposal' }), status: 'open' });
    expect(counterpartOpenProposal(own, 3)).toBe(false);
  });

  it('is false when there is no active proposal', () => {
    expect(counterpartOpenProposal(reduction(), 3)).toBe(false);
  });

  it('is false when the counterpart proposal is no longer open (e.g. accepted)', () => {
    const accepted = reduction({ active: row({ SpeakerID: 1, MessageType: 'deal-proposal' }), status: 'accepted' });
    expect(counterpartOpenProposal(accepted, 3)).toBe(false);
  });
});
