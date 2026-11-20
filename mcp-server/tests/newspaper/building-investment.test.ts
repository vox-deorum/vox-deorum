import { describe, expect, it } from 'vitest';
import { projectNewspaperEvent, type NewspaperProjectionContext } from '../../src/newspaper/projection.js';

/** Supply dated contact and one readable city row for a foreign investment. */
function context(): NewspaperProjectionContext {
  return {
    receiverPlayerID: 0,
    summaries: [{ Key: 0, Player0: 2 }, { Key: 1, Player0: 1 }] as any,
    players: [
      { Key: 0, TeamID: 0, IsMajor: 1, Civilization: 'Civ0' },
      { Key: 1, TeamID: 1, IsMajor: 1, Civilization: 'Civ1' },
    ] as any,
    cityHistory: [{
      Key: 8, ID: 8, Turn: 9, CreatedAt: 1009, Name: 'Harbor', Owner: 'Civ1', X: 2, Y: 3,
      IsCapital: 0, Player0: 1,
    }],
  };
}

/** Build one witnessed investment row with the archived payload shape. */
function row(Payload: Record<string, unknown>, Player0 = 1) {
  return { ID: 50, Turn: 10, CreatedAt: 3010, Type: 'CityInvestedBuilding', Player0, Payload } as any;
}

describe('building investment projection', () => {
  it('should preserve a readable building class, activation and dated city link', () => {
    const projected = projectNewspaperEvent(row({
      PlayerID: 1, CityID: 8, BuildingClass: 'Monument', Invested: true,
    }), context());
    expect(projected).toMatchObject({
      type: 'CityInvestedBuilding',
      values: { PlayerID: 1, CityID: 8, Building: 'Monument', Invested: true, CityX: 2, CityY: 3 },
    });
    expect(projected?.values).not.toHaveProperty('BuildingClass');
  });

  it('should keep a legacy numeric activation and a recorded deactivation', () => {
    const ctx = context();
    expect(projectNewspaperEvent(row({ PlayerID: 1, CityID: 8, BuildingClass: 'Monument', Invested: 1 }), ctx)
      ?.values).toMatchObject({ Invested: 1 });
    expect(projectNewspaperEvent(row({ PlayerID: 1, CityID: 8, BuildingClass: 'Monument', Invested: false }), ctx)
      ?.values).toMatchObject({ Invested: false });
  });

  it('should require a nonempty recorded building class and a permitted owner', () => {
    const ctx = context();
    for (const BuildingClass of [0, 12, '', '   ', null]) {
      const projected = projectNewspaperEvent(row({ PlayerID: 1, CityID: 8, BuildingClass, Invested: true }), ctx);
      expect(projected?.values).not.toHaveProperty('Building');
    }
    expect(projectNewspaperEvent(
      row({ PlayerID: 1, CityID: 8, BuildingClass: 'Monument', Invested: true }, 0), ctx
    )).toBeUndefined();
  });
});
