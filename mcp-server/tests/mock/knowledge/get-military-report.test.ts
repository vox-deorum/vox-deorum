import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as militaryReport from '../../../src/knowledge/getters/military-report.js';
import createGetMilitaryReportTool from '../../../src/tools/knowledge/get-military-report.js';
import { connectToolClient } from '../tool-client.js';

const tool = createGetMilitaryReportTool();
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  vi.spyOn(militaryReport, 'getMilitaryReport').mockImplementation(async playerID => playerID === 2 ? ({
    units: {
      Attack: { Warrior: { Count: 4, Strength: 8 } },
      Nuclear: { NuclearMissile: { Count: 2 } },
      Support: {
        GreatGeneral: { Count: 1 },
        GreatAdmiral: { Count: 1 },
        SiegeTower: { Count: 2 },
      },
    },
    zones: {
      '1': {
        Territory: 'Friendly',
        Domain: 'Land',
        Value: 12,
        Dominance: 'Friendly',
        FriendlyStrength: 500,
        EnemyStrength: 250,
        NeutralStrength: 0,
        City: 'Rome',
        AreaID: 3,
        Plots: 6,
        CenterX: 4,
        CenterY: 7,
        Units: { Rome: { Warrior: 3 } },
        Neighbors: [],
      },
    },
  } as any) : ({ units: {}, zones: {} } as any));
  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
});

describe('get-military-report', () => {
  it('returns combat, nuke, support-unit, and tactical-zone data', async () => {
    const result = await client.call({ PlayerID: 2 });

    expect(result['Unit Stats'].Attack.Warrior).toMatchObject({ Count: 4, Strength: 8 });
    expect(result['Unit Stats'].Nuclear.NuclearMissile.Count).toBe(2);
    expect(result['Unit Stats'].Support).toMatchObject({
      GreatGeneral: { Count: 1 },
      GreatAdmiral: { Count: 1 },
      SiegeTower: { Count: 2 },
    });
    expect(result['Friendly Land Zone 1']).toMatchObject({
      ZoneValue: 12,
      City: 'Rome',
      Units: { Rome: { Warrior: 3 } },
    });

    const otherPerspective = await client.call({ PlayerID: 1 });
    expect(otherPerspective['Unit Stats']).toEqual({});
    expect(otherPerspective).not.toHaveProperty('Friendly Land Zone 1');
  });
});
