/** Relay report round trips through the configured HTTP or stdio MCP transport. */
import { describe, it, expect } from 'vitest';
import { mcpClient } from '../../../setup.js';

const report = {
  PlayerID: 0,
  FromPlayerID: 1,
  AboutPlayerIDs: [2],
  Message: 'Rumor',
  Content: 'x'.repeat(4000),
  Confidence: 4,
  Importance: 6,
  Categories: ['Military', 'Economy'],
  Memo: 'Monitor the reported buildup.'
};

describe('relay-message via MCP', () => {
  it('persists a 4000-character report with subject IDs and multiple categories', async () => {
    const relayed = await mcpClient.callTool({ name: 'relay-message', arguments: report });
    expect(relayed.isError).not.toBe(true);
    expect(relayed.structuredContent).toMatchObject({ Success: true, EventID: expect.any(Number) });
    const eventID = relayed.structuredContent!.EventID as number;

    const retrieved = await mcpClient.callTool({
      name: 'get-events',
      arguments: {
        PlayerID: 0, Original: true, Type: 'RelayedMessage',
        After: eventID - 1, Before: eventID
      }
    });
    expect(retrieved.isError).not.toBe(true);
    expect(retrieved.structuredContent).toMatchObject({
      events: [expect.objectContaining({
        ID: eventID, Type: 'RelayedMessage', ToPlayerID: 0, FromPlayerID: 1,
        AboutPlayerIDs: [2], Message: 'Rumor', Categories: ['Military', 'Economy'],
        Content: report.Content
      })]
    });
  });

  it('rejects content longer than 4000 characters', async () => {
    const result = await mcpClient.callTool({
      name: 'relay-message', arguments: { ...report, Content: 'x'.repeat(4001) }
    });
    expect(result.isError).toBe(true);
  });
});
