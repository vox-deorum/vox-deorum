import { describe, expect, it } from 'vitest';
import { projectNewspaperPlayer, projectNewspaperCity, projectNewspaperEvent, type NewspaperProjectionContext } from '../../src/newspaper/projection.js';
import { projectCityReportFields, projectPlayerReportFields } from '../../src/knowledge/helpers/report-projection.js';
import { redactEventResources } from '../../src/knowledge/helpers/event-redaction.js';
import { matchesEventSubject } from '../../src/knowledge/helpers/event-subjects.js';
import { pickFields, omitFields } from '../../src/utils/fields.js';

/** Supply historical contact and dated diplomat points for a controlled receiver. */
function context(points = 0): NewspaperProjectionContext {
  return {
    receiverPlayerID: 0,
    summaries: [
      { Key: 0, Player0: 2, DiplomatPoints: { Player1: points, Player2: points }, Resources: { Iron: '1 / 1' } },
      { Key: 1, Player0: 1 }, { Key: 2, Player0: 1 }, { Key: 3, Player0: 0 }
    ] as any,
    players: [0, 1, 2, 3].map(Key => ({ Key, TeamID: Key, IsMajor: 1, Civilization: `Civ${Key}` })) as any
  };
}

/** Build a deal whose private terms have both readable and structured representations. */
function deal(from = 1, to = 2) {
  return {
    ID: 90, Turn: 10, CreatedAt: 3010, Player0: 1, Type: 'DealMade', Payload: {
      FromPlayerID: from, ToPlayerID: to,
      FromPlayer: { Name: `Leader${from}`, Civilization: `Civ${from}` }, ToPlayer: { Name: `Leader${to}`, Civilization: `Civ${to}` },
      StartTurn: 10,
      FromGives: ['40 Gold'], ToGives: ['Open Borders'], TurnsRemaining: 30, PeaceTreatyType: 0,
      TradedItems: [
        { FromPlayerID: from, ItemType: 'Gold', Data1: 40, Data2: 0, Data3: 0, Duration: 0 },
        { FromPlayerID: to, ItemType: 'OpenBorders', Data1: 0, Data2: 0, Data3: 0, Duration: 30 }
      ],
      Memo: 'private unrelated text', Unknown: { Player: { ID: 3, Civilization: 'Civ3' } }
    }
  };
}

describe('newspaper field projection', () => {
  it('should preserve missing, null, false, zero and sentinel values through generic selection', () => {
    const row = { zero: 0, off: false, empty: null, sentinel: -1 };
    expect(pickFields(row, ['zero', 'off', 'empty', 'sentinel', 'absent'] as any)).toEqual(row);
    expect(omitFields(row, ['sentinel'])).toEqual({ zero: 0, off: false, empty: null });
    const player = projectNewspaperPlayer({ ID: 7, Key: 0, Turn: 9, CreatedAt: 1009, Player0: 2,
      Gold: 0, FoundedReligion: null, GoldenAge: false } as any, context());
    expect(player?.values).toEqual({ Gold: 0, FoundedReligion: null, GoldenAge: false });
    expect(player?.values).not.toHaveProperty('Era');
  });

  it('should use recorded levels and diplomat thresholds without mutating national snapshots', () => {
    const row = { PolicyBranches: { Tradition: ['A', 'B'] }, MilitaryUnits: 3, DiplomaticDeals: { Civ2: [{ WeGive: ['Gold'], TheyGive: [] }] },
      CurrentResearch: 'Writing', SciencePerTurn: 3, Spies: { Secret: {} }, Gold: 5, CulturePerTurn: 4 };
    const original = structuredClone(row);
    expect(projectPlayerReportFields(row, undefined)).toEqual({});
    expect(projectPlayerReportFields(row, 0)).toEqual({});
    expect(projectPlayerReportFields(row, 1, 199)).toEqual({ PolicyBranches: { Tradition: 2 }, Gold: 5, CulturePerTurn: 4 });
    expect(projectPlayerReportFields(row, 1, 200)).toHaveProperty('PolicyBranches.Tradition', ['A', 'B']);
    expect(projectPlayerReportFields(row, 1, 499)).not.toHaveProperty('MilitaryUnits');
    expect(projectPlayerReportFields(row, 1, 500)).toHaveProperty('MilitaryUnits', 3);
    expect(projectPlayerReportFields(row, 1, 799)).not.toHaveProperty('DiplomaticDeals');
    const allowed = projectPlayerReportFields(row, 1, 800);
    expect(allowed).toHaveProperty('DiplomaticDeals');
    allowed.PolicyBranches.Tradition.push('Changed');
    expect(row).toEqual(original);
  });

  it('should require recorded city access and return raw basic or full values without mutation', () => {
    const row = { ID: 12, Key: 8, Turn: 10, CreatedAt: 3010, Player0: 1, Name: 'Harbor',
      HitPoints: 50, MaxHitPoints: 100, Population: 0, IsOccupied: false, IsCapital: 1, RazingTurns: 0,
      Wonders: ['Beacon'], ImportantBuildings: ['Library'], FoodPerTurn: -1 };
    const original = structuredClone(row);
    const basic = projectNewspaperCity(row as any, context())!;
    expect(basic.values).toMatchObject({ HitPoints: 50, Population: 0, IsOccupied: false, RazingTurns: 0, Wonders: ['Beacon'] });
    expect(basic.values).not.toHaveProperty('FoodPerTurn');
    expect(basic.values).not.toHaveProperty('IsCapital');
    const full = projectCityReportFields(row, 2);
    expect(full.FoodPerTurn).toBe(-1);
    full.Wonders!.push('Changed');
    expect(row).toEqual(original);
    expect(projectNewspaperCity({ ...row, Player0: undefined } as any, context())).toBeUndefined();
  });

  it('should omit all private deal terms below the gate and retain their raw values when permitted', () => {
    const row = deal();
    const denied = projectNewspaperEvent(row as any, context(799))!;
    for (const key of ['FromGives', 'ToGives', 'TradedItems', 'TurnsRemaining', 'PeaceTreatyType']) expect(denied.values).not.toHaveProperty(key);
    const allowed = projectNewspaperEvent(row as any, context(800))!;
    expect(allowed.values).toMatchObject({ FromGives: ['40 Gold'], ToGives: ['Open Borders'], TurnsRemaining: 30, PeaceTreatyType: 0,
      TradedItems: [{ ItemType: 'Gold', Data1: 40, Data2: 0, Data3: 0 }, { ItemType: 'OpenBorders', Duration: 30 }],
      FromPlayer: { Name: 'Leader1', Civilization: 'Civ1' }, ToPlayer: { Name: 'Leader2', Civilization: 'Civ2' } });
    expect(allowed.values).not.toHaveProperty('Memo');
    expect(allowed.values).not.toHaveProperty('Unknown');
    expect(projectNewspaperEvent(deal(0, 1) as any, context(0))?.values).toHaveProperty('TradedItems');
  });

  it('should require strength for both foreign parties from a fully accessible receiver row', () => {
    const ctx = context(800);
    ctx.summaries[0].DiplomatPoints = { Player1: 800, Player2: 799 };
    expect(projectNewspaperEvent(deal() as any, ctx)?.values).not.toHaveProperty('FromGives');
    ctx.summaries[0].DiplomatPoints.Player2 = 800;
    ctx.summaries[0].Player0 = 1;
    expect(projectNewspaperEvent(deal() as any, ctx)?.values).not.toHaveProperty('FromGives');
  });

  it.each(['ThirdPartyWar', 'ThirdPartyPeace'])('should withhold all terms for an unknown %s team, even for a participant', itemType => {
    const row = deal(0, 1);
    row.Payload.TradedItems.push({ FromPlayerID: 0, ItemType: itemType, Data1: 7, Data2: 0, Data3: 0, Duration: 30 });
    row.Payload.FromGives.push(itemType === 'ThirdPartyWar' ? 'Declare War on Civ3' : 'Make Peace with Civ3');
    const ctx = context();
    ctx.players[2].TeamID = 7;
    ctx.players[3].TeamID = 7;
    const projected = projectNewspaperEvent(row as any, ctx)!;
    expect(projected.values.ToPlayer).toEqual({ Name: 'Leader1', Civilization: 'Civ1' });
    for (const key of ['FromGives', 'ToGives', 'TradedItems', 'TurnsRemaining']) expect(projected.values).not.toHaveProperty(key);
    ctx.summaries[3].Player0 = 1;
    const permitted = projectNewspaperEvent(row as any, ctx)!;
    expect(permitted.values).toMatchObject({ FromGives: row.Payload.FromGives, ToGives: row.Payload.ToGives,
      TradedItems: row.Payload.TradedItems, TurnsRemaining: 30 });
    row.Payload.TradedItems[2].Data1 = 8;
    expect(projectNewspaperEvent(row as any, ctx)?.values).not.toHaveProperty('FromGives');
  });

  it('should omit deals with a party missing from historical contact', () => {
    const absent = context(800);
    absent.summaries = absent.summaries.filter(summary => summary.Key !== 2);
    expect(projectNewspaperEvent(deal() as any, absent)).toBeUndefined();
  });

  it('should copy nested deal inputs before exposing permitted terms', () => {
    const row = deal(0, 1);
    const original = structuredClone(row);
    const projected = projectNewspaperEvent(row as any, context())!;
    (projected.values.FromPlayer as any).Civilization = 'Changed';
    (projected.values.TradedItems as any[])[0].Data1 = 99;
    (projected.values.FromGives as string[]).push('Changed');
    expect(row).toEqual(original);
  });

  it('should resolve recorded city labels from flat owners and omit labels without a known owner', () => {
    // CityCaptureComplete has coordinates, without a CityID. Lua enriches its plot as City.
    const row = { ID: 3, Turn: 10, CreatedAt: 1010, Player0: 1, Type: 'CityCaptureComplete', Payload: {
      OldOwnerID: 1, NewOwnerID: 2, CityX: 0, CityY: 4, Population: 0, IsConquest: false,
      IsCapital: false, TotalGreatWorks: 0, CapturedGreatWorks: 0,
      OldOwner: { Name: 'Leader1', Civilization: 'Civ1' }, NewOwner: { Name: 'Leader2', Civilization: 'Civ2' },
      City: { Owner: 'Civ2', City: 'Harbor', CityID: 99, Population: 0, ResourceType: 'Uranium' }
    } };
    expect(projectNewspaperEvent(row as any, context())?.values.City).toEqual({ City: 'Harbor' });
    const unknown = context();
    unknown.summaries = unknown.summaries.filter(summary => summary.Key !== 2);
    expect(projectNewspaperEvent(row as any, unknown)).toBeUndefined();
    const religion = { ...row, Type: 'ReligionFounded', Payload: {
      PlayerID: 1, HolyCityID: 99, ReligionID: 2, HolyCity: { Name: 'Harbor', Population: 3, Health: '50%' }
    } };
    expect(projectNewspaperEvent(religion as any, context())?.values.HolyCity).toEqual({ Name: 'Harbor' });
    const pantheon = { ...row, Type: 'PantheonFounded', Payload: {
      PlayerID: 1, CityID: 99, ReligionType: 0, BeliefType: 7, City: { Name: 'Harbor', Population: 3 }
    } };
    expect(projectNewspaperEvent(pantheon as any, context())?.values.City).toEqual({ Name: 'Harbor' });
    const flipped = { ...row, Type: 'CityFlipped', Payload: {
      OldOwnerID: 1, NewOwnerID: 2, CityID: 99, City: { Name: 'Harbor', Population: 3 }
    } };
    expect(projectNewspaperEvent(flipped as any, context())?.values).toMatchObject({ CityID: 99, City: { Name: 'Harbor' } });
    const unowned = { ...row, Type: 'PlayerLiberated', Payload: {
      LiberatingPlayerID: 0, LiberatedPlayerID: 1, CityID: 99, City: { Name: 'Harbor', Population: 3 }
    } };
    const liberated = projectNewspaperEvent(unowned as any, context())!.values;
    expect(liberated).toMatchObject({ LiberatingPlayerID: 0, LiberatedPlayerID: 1, CityID: 99 });
    expect(liberated).not.toHaveProperty('City');
  });

  it('should retain witnessed barbarian plundering without a barbarian summary and still enforce contact and visibility', () => {
    const row = { ID: 4, Turn: 10, CreatedAt: 1010, Player0: 1, Type: 'PlayerPlunderedTradeRoute', Payload: {
      PlunderingPlayerID: 63, PlunderingUnitID: 100, PlunderGoldValue: 50,
      OriginOwnerID: 0, OriginCityID: 42, DestinationOwnerID: 1, DestinationCityID: 99,
      OriginCity: { City: 'Home', Population: 3 }, DestinationCity: { Name: 'Port', Population: 2 },
      ConnectionType: 'Food', Domain: 0,
      PlunderingPlayer: { Name: 'Barbarian', Civilization: 'Barbarians' }
    } };
    expect(projectNewspaperEvent(row as any, context())?.values).toMatchObject({
      PlunderingPlayerID: 63, PlunderGoldValue: 50, OriginCity: { City: 'Home' }, DestinationCity: { Name: 'Port' }
    });
    expect(projectNewspaperEvent({ ...row, Player0: 0 } as any, context())).toBeUndefined();
    row.Payload.DestinationOwnerID = 3;
    expect(projectNewspaperEvent(row as any, context())).toBeUndefined();
  });

  it.each([63, 1])('should retain a witnessed capture with barbarian owner %s', oldOwner => {
    const newOwner = oldOwner === 63 ? 1 : 63;
    const row = { ID: 5, Turn: 10, CreatedAt: 1010, Player0: 1, Type: 'CityCaptureComplete', Payload: {
      OldOwnerID: oldOwner, NewOwnerID: newOwner, CityX: 0, CityY: 4, IsCapital: false,
      Population: 1, IsConquest: true, TotalGreatWorks: 0, CapturedGreatWorks: 0,
      City: { Owner: newOwner === 63 ? 'Barbarians' : 'Civ1', City: 'Harbor', CityID: 99, Population: 1 }
    } };
    expect(projectNewspaperEvent(row as any, context())?.values).toMatchObject({
      OldOwnerID: oldOwner, NewOwnerID: newOwner, City: { City: 'Harbor' }
    });
    expect(projectNewspaperEvent({ ...row, Player0: 0 } as any, context())).toBeUndefined();
  });

  it('should recursively copy resource payloads, preserving the live no-inventory behavior', () => {
    const row = { Plot: { ResourceType: 'Uranium' }, Items: [{ Resource: 'Iron', Count: 0, Enabled: false }], Empty: null };
    const original = structuredClone(row);
    expect(redactEventResources(row, { Resources: { Iron: '1 / 1' } })).toEqual({
      Plot: { ResourceType: 'None' }, Items: [{ Resource: 'Iron', Count: 0, Enabled: false }], Empty: null
    });
    const copy = redactEventResources(row, null);
    expect(copy).toEqual(row);
    copy.Plot.ResourceType = 'Changed';
    expect(row).toEqual(original);
    expect(redactEventResources(row, { Resources: null })).toEqual(row);
  });

  it('should retain flat relevance matching for players, teams and subject lists', () => {
    const payload = deal().Payload;
    expect(matchesEventSubject('DealMade', payload, 2)).toBe(true);
    expect(matchesEventSubject('DeclareWar', { TargetTeamID: 8 }, 2, 8)).toBe(true);
    expect(matchesEventSubject('RelayedMessage', { AboutPlayerIDs: [2] }, 2)).toBe(true);
    expect(matchesEventSubject('DealMade', { ToPlayer: { ID: 2 } }, 2)).toBe(false);
  });

  it('should leave events and national facts unknown without historical access', () => {
    expect(projectNewspaperPlayer({ Key: 1, CulturePerTurn: 5 } as any, context())).toBeUndefined();
    expect(projectNewspaperEvent({ ...deal(), Player0: undefined } as any, context(800))).toBeUndefined();
    expect(projectNewspaperEvent({ ...deal(), Type: 'RelayedMessage' } as any, context(800))).toBeUndefined();
    const policy = { ...deal(), Type: 'PlayerAdoptPolicy', Payload: { PlayerID: 1, PolicyID: 7 } };
    expect(projectNewspaperEvent(policy as any, context(199))).toBeUndefined();
    expect(projectNewspaperEvent(policy as any, context(200))?.values.PolicyID).toBe(7);
  });
});
