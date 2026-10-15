/** Building queries over the selected real MCP transport and controlled SQLite rules. */
import { describe, it, expect } from 'vitest';
import { mcpClient } from '../../../setup.js';

/** Decode a building report delivered by the server. */
async function query(args: Record<string, unknown> = {}) {
  const result = await mcpClient.callTool({ name: 'get-building', arguments: args });
  expect(result.isError).not.toBe(true);
  return result.structuredContent as any;
}

describe('get-building through MCP', () => {
  it('lists the fixture buildings with their costs and localized names', async () => {
    const report = await query();
    expect(report.Count).toBe(4);
    expect(report.Items).toEqual(expect.arrayContaining([
      expect.objectContaining({ Type: 'BUILDING_LIBRARY', Name: 'Library', Cost: 80, PrereqTech: 'Writing' }),
      expect.objectContaining({ Type: 'BUILDING_BARRACKS', Name: 'Barracks', Cost: 75 })
    ]));
  });

  it('finds a building despite a misspelled name', async () => {
    const report = await query({ Search: 'baracks' });
    expect(report.Items).toEqual(expect.arrayContaining([expect.objectContaining({ Type: 'BUILDING_BARRACKS' })]));
  });

  it('returns a complete report for an exact building identifier', async () => {
    const report = await query({ Search: 'BUILDING_LIBRARY' });
    expect(report.Count).toBe(1);
    expect(report.Items).toMatchObject([{
      Type: 'BUILDING_LIBRARY', Name: 'Library', Cost: 80, PrereqTech: 'Writing',
      Replaces: null, PrereqBuildings: [], IsNationalWonder: false, IsWorldWonder: false,
      Happiness: 0, Defense: 0, HP: 0, Maintenance: 1, UniqueOf: null
    }]);
  });

  it('links prerequisite building names', async () => {
    const report = await query({ Search: 'BUILDING_UNIVERSITY' });
    expect(report.Items).toMatchObject([{ Type: 'BUILDING_UNIVERSITY', PrereqBuildings: ['Library'] }]);
  });

  it('identifies a unique building and the standard building it replaces', async () => {
    const report = await query({ Search: 'BUILDING_PAPER_MAKER' });
    expect(report.Items).toMatchObject([{ Type: 'BUILDING_PAPER_MAKER', UniqueOf: 'China', Replaces: 'Library' }]);
  });
});
