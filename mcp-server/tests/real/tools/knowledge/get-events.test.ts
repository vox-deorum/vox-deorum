/** Real get-events behavior through MCP using events seeded by relay-message. */

import { describe, it, expect } from 'vitest';
import { mcpClient } from '../../../setup.js';

/** Create a uniquely identifiable event through the public report tool. */
async function seedRelayedEvent() {
  const marker = `seed-${crypto.randomUUID()}`;
  const result = await mcpClient.callTool({
    name: 'relay-message',
    arguments: {
      PlayerID: 0,
      FromPlayerID: 1,
      AboutPlayerIDs: [2],
      Message: 'Rumor',
      Content: marker,
      Confidence: 4,
      Importance: 3,
      Categories: ['Military'],
      Memo: 'Check this report',
    },
  });
  expect(result.isError).not.toBe(true);
  return { marker, eventID: result.structuredContent!.EventID as number };
}

/** Read one seeded event with an ID interval away from either cursor boundary. */
async function readSeededEvent(eventID: number) {
  const result = await mcpClient.callTool({
    name: 'get-events',
    arguments: {
      PlayerID: 0,
      Original: true,
      Type: 'RelayedMessage',
      After: eventID - 1,
      Before: eventID,
    },
  });
  expect(result.isError).not.toBe(true);
  return result.structuredContent as { events: Array<Record<string, unknown>> };
}

describe('get-events through MCP', () => {
  it('returns a newly relayed event with its caller-provided data', async () => {
    const { marker, eventID } = await seedRelayedEvent();
    const report = await mcpClient.callTool({
      name: 'get-events',
      arguments: { PlayerID: 0, Original: true },
    });
    const events = (report.structuredContent as { events: Array<Record<string, unknown>> }).events;
    expect(events).toContainEqual(expect.objectContaining({
      ID: eventID,
      Type: 'RelayedMessage',
      Content: marker,
      FromPlayerID: 1,
      AboutPlayerIDs: [2],
    }));
  });

  it('filters an event by its turn within a narrow event ID interval', async () => {
    const { eventID } = await seedRelayedEvent();
    const event = (await readSeededEvent(eventID)).events[0];
    /** Read the seeded event's ID interval restricted to one turn. */
    const readAtTurn = async (turn: number) => {
      const result = await mcpClient.callTool({
        name: 'get-events',
        arguments: { PlayerID: 0, Original: true, Type: 'RelayedMessage', Turn: turn, After: eventID - 1, Before: eventID },
      });
      return (result.structuredContent as { events: Array<Record<string, unknown>> }).events;
    };

    expect(await readAtTurn(event.Turn as number)).toContainEqual(expect.objectContaining({ ID: eventID, Turn: event.Turn }));
    expect(await readAtTurn((event.Turn as number) + 1)).toEqual([]);
  });

  it('rejects a player ID outside the supported range', async () => {
    const rejected = await mcpClient.callTool({
      name: 'get-events',
      arguments: { PlayerID: 25 },
    }).then(result => result.isError === true, () => true);
    expect(rejected).toBe(true);
  });

  it('returns no events for a type that has not been recorded', async () => {
    const result = await mcpClient.callTool({
      name: 'get-events',
      arguments: { Type: `NoEvent-${crypto.randomUUID()}`, Original: true },
    });
    expect(result.structuredContent).toEqual({ events: [] });
  });
});
