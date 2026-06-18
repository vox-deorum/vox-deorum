import { describe, it, expect } from 'vitest';
import { mergeThreadItems, reviveMessageDates } from '@/components/deal/deal-thread';
import type { MessageWithMetadata, DealTranscriptMessage } from '@/utils/types';

function chat(content: string, ms: number, role: 'user' | 'assistant' = 'user'): MessageWithMetadata {
  return { message: { role, content }, metadata: { datetime: new Date(ms), turn: 1 } };
}

let id = 1;
function deal(messageType: string, seconds: number, speakerID: number): DealTranscriptMessage {
  return {
    ID: id++,
    Player1ID: 0,
    Player2ID: 1,
    Player1Role: 'the leader',
    Player2Role: 'diplomat',
    SpeakerID: speakerID,
    MessageType: messageType,
    Content: '',
    Payload: { Deal: { version: 1, items: [], promises: [] } },
    Turn: 1,
    CreatedAt: seconds,
  };
}

describe('mergeThreadItems', () => {
  it('interleaves deal cards with chat messages by timestamp', () => {
    const messages = [chat('hello', 1000), chat('reply', 3000, 'assistant')];
    const deals = [deal('deal-proposal', 2, 0)];
    const merged = mergeThreadItems(messages, deals, 1);

    expect(merged.map((m) => (m.deal ? `deal:${m.deal.MessageType}` : m.message.content))).toEqual([
      'hello',
      'deal:deal-proposal',
      'reply',
    ]);
    expect(merged[1]!.metadata.datetime.getTime()).toBe(2000);
  });

  it('aligns the voiced seat as assistant and others as user', () => {
    const merged = mergeThreadItems([], [deal('deal-proposal', 1, 3), deal('deal-counter', 2, 7)], 3);
    expect(merged[0]!.message.role).toBe('assistant'); // speaker 3 == voiced
    expect(merged[1]!.message.role).toBe('user'); // speaker 7 != voiced
  });

  it('keeps proposal/counter/accept/enacted but not text or deal-reject (reject shows as status)', () => {
    const deals = [
      deal('deal-proposal', 1, 0),
      { ...deal('text', 2, 0), MessageType: 'text' } as DealTranscriptMessage,
      deal('deal-reject', 3, 0),
      deal('deal-counter', 4, 0),
    ];
    const merged = mergeThreadItems([], deals, 1);
    expect(merged.filter((m) => m.deal).map((m) => m.deal!.MessageType)).toEqual([
      'deal-proposal',
      'deal-counter',
    ]);
  });

  it('does not mutate the input chat messages', () => {
    const messages = [chat('hi', 1)];
    const merged = mergeThreadItems(messages, [], 1);
    expect(merged[0]).not.toBe(messages[0]);
    expect(merged[0]!.message.content).toBe('hi');
  });
});

describe('reviveMessageDates', () => {
  it('converts ISO-string datetimes (as deserialized from the server) into Date objects', () => {
    const iso = '2026-06-18T10:00:00.000Z';
    // Server-hydrated history arrives with metadata.datetime as a string despite the Date type.
    const messages = [{ message: { role: 'user' as const, content: 'hi' }, metadata: { datetime: iso as unknown as Date, turn: 1 } }];
    const revived = reviveMessageDates(messages);
    expect(revived[0]!.metadata.datetime).toBeInstanceOf(Date);
    expect(revived[0]!.metadata.datetime.getTime()).toBe(new Date(iso).getTime());
  });

  it('leaves existing Date objects (live-streamed messages) untouched by reference', () => {
    const live = chat('streamed', 1234);
    const revived = reviveMessageDates([live]);
    expect(revived[0]).toBe(live);
  });

  it('makes mergeThreadItems sort cleanly when history carries string datetimes', () => {
    const iso = (ms: number) => new Date(ms).toISOString() as unknown as Date;
    const messages = [
      { message: { role: 'user' as const, content: 'first' }, metadata: { datetime: iso(1000), turn: 1 } },
      { message: { role: 'user' as const, content: 'third' }, metadata: { datetime: iso(3000), turn: 1 } },
    ];
    const merged = mergeThreadItems(reviveMessageDates(messages), [deal('deal-proposal', 2, 0)], 1);
    expect(merged.map((m) => (m.deal ? 'deal' : m.message.content))).toEqual(['first', 'deal', 'third']);
  });
});
