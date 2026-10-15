/** Civilization relationships over HTTP or stdio with controlled SQLite rules. */
import { describe, it, expect } from 'vitest';
import { mcpClient } from '../../../setup.js';

/** Decode a civilization report delivered by the server. */
async function query(args: Record<string, unknown> = {}) {
  const result = await mcpClient.callTool({ name: 'get-civilization', arguments: args });
  expect(result.isError).not.toBe(true);
  return result.structuredContent as any;
}

describe('get-civilization through MCP', () => {
  it('lists playable civilizations with leader and ability information', async () => {
    const report = await query();
    expect(report.Count).toBe(4);
    expect(report.Items).toEqual(expect.arrayContaining([
      expect.objectContaining({ Name: 'Rome', Leader: 'Augustus', Uniques: expect.arrayContaining([expect.stringContaining('Construct buildings faster')]) }),
      expect.objectContaining({ Name: 'Japan', Leader: 'Oda', Uniques: expect.arrayContaining([expect.stringContaining('Samurai')]) })
    ]));
  });

  it('finds a civilization by its display name', async () => {
    const report = await query({ Search: 'Rome' });
    expect(report.Count).toBe(1);
    expect(report.Items).toMatchObject([{ Type: 'CIVILIZATION_ROME', Name: 'Rome', Leader: 'Augustus' }]);
  });

  it('finds a civilization despite a misspelled name', async () => {
    const report = await query({ Search: 'grece' });
    expect(report.Items).toEqual(expect.arrayContaining([expect.objectContaining({ Type: 'CIVILIZATION_GREECE' })]));
  });

  it('returns the leader ability and preferred victory for an exact identifier', async () => {
    const report = await query({ Search: 'CIVILIZATION_ROME' });
    expect(report.Count).toBe(1);
    expect(report.Items).toMatchObject([{
      Type: 'CIVILIZATION_ROME', Leader: 'Augustus', PreferredVictory: 'Domination',
      Abilities: [{ Type: 'Ability', Name: 'Glory of Rome', Help: 'Construct buildings faster' }]
    }]);
  });

  it('links a unique unit to its replacement and prerequisite technology', async () => {
    const report = await query({ Search: 'CIVILIZATION_JAPAN' });
    expect(report.Items).toMatchObject([{
      Type: 'CIVILIZATION_JAPAN', Abilities: expect.arrayContaining([
        expect.objectContaining({ Type: 'Unit', Name: 'Samurai', Replacing: 'Swordsman', PrereqTech: 'Bronze Working' })
      ])
    }]);
  });
});
