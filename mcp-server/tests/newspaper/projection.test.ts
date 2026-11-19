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
    expect(basic.values).toMatchObject({ HitPoints: 50, Population: 0, IsOccupied: false, IsCapital: 1, RazingTurns: 0, Wonders: ['Beacon'] });
    expect(basic.values).not.toHaveProperty('FoodPerTurn');
    const full = projectCityReportFields(row, 2);
    expect(full.FoodPerTurn).toBe(-1);
    expect(full).not.toHaveProperty('IsCapital');
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

  it.each(['OldAllyPlayerID', 'NewAllyPlayerID'])('should retain an own alliance change as %s without exposing the unknown other ally', role => {
    const otherRole = role === 'OldAllyPlayerID' ? 'NewAllyPlayerID' : 'OldAllyPlayerID';
    const payload = {
      MinorPlayerID: 1, [role]: 0, [otherRole]: 3,
      [role.replace(/ID$/, '')]: { Name: 'Leader0', Civilization: 'Civ0' },
      [otherRole.replace(/ID$/, '')]: { Name: 'Leader3', Civilization: 'Civ3' }
    };
    const row = { ID: 91, Turn: 10, CreatedAt: 3010, Player0: 1, Type: 'SetAlly', Payload: payload };
    const values = projectNewspaperEvent(row as any, context())!.values;
    expect(values).toMatchObject({ MinorPlayerID: 1, [role]: 0, [otherRole]: 3 });
    expect(values).toHaveProperty(role.replace(/ID$/, ''), { Name: 'Leader0', Civilization: 'Civ0' });
    expect(values).not.toHaveProperty(otherRole.replace(/ID$/, ''));
    expect(projectNewspaperEvent({ ...row, Player0: 0 } as any, context())).toBeUndefined();
    expect(projectNewspaperEvent({ ...row, Payload: { ...payload, [role]: 2 } } as any, context())).toBeUndefined();
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
    expect(projectNewspaperEvent(row as any, context())?.values).toMatchObject({ City: { City: 'Harbor' }, IsCapital: false });
    const unknown = context();
    unknown.summaries = unknown.summaries.filter(summary => summary.Key !== 2);
    expect(projectNewspaperEvent(row as any, unknown)).toBeUndefined();
    const religion = { ...row, Type: 'ReligionFounded', Payload: {
      PlayerID: 1, HolyCityID: 99, ReligionID: 2, HolyCity: { Name: 'Harbor', Population: 3, Health: '50%' }
    } };
    const founded = projectNewspaperEvent(religion as any, context())!.values;
    expect(founded.HolyCity).toEqual({ Name: 'Harbor' });
    expect(founded).not.toHaveProperty('ReligionID');
    expect(founded).not.toHaveProperty('Religion');
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
    const policy = { ...deal(), Type: 'PlayerAdoptPolicy', Payload: { PlayerID: 1, PolicyID: 'Aristocracy' } };
    expect(projectNewspaperEvent(policy as any, context(199))).toBeUndefined();
    const permitted = projectNewspaperEvent(policy as any, context(200))!;
    expect(permitted.values.Policy).toBe('Aristocracy');
    expect(permitted.values).not.toHaveProperty('PolicyID');
  });

  it('exposes recorded military strength only for self and full national access', () => {
    const row = { ID: 7, Key: 1, Turn: 9, CreatedAt: 1009, Player0: 1, Era: 'Classical Era', MilitaryStrength: 42 } as any;
    expect(projectNewspaperPlayer(row, context(800))?.values).not.toHaveProperty('MilitaryStrength');
    expect(projectNewspaperPlayer({ ...row, Player0: 2 }, context())?.values).toHaveProperty('MilitaryStrength', 42);
    expect(projectNewspaperPlayer({ ...row, Key: 0, MilitaryStrength: 0, Player0: 2 }, context())?.values).toHaveProperty('MilitaryStrength', 0);
    expect(projectNewspaperPlayer({ ...row, Player0: 0 }, context())).toBeUndefined();
  });

  it('includes own full-visibility national facts, preserving zero, null and missing values', () => {
    const row = { ID: 7, Key: 0, Turn: 9, CreatedAt: 1009, Player0: 2,
      Votes: 0, Resources: null, MilitaryUnits: 0, MilitarySupply: 0, DiplomaticDeals: null,
      Relationships: { Civ1: ['At War'] }, MajorAlly: 'Civ1' } as any;
    const values = projectNewspaperPlayer(row, context())!.values;
    expect(values).toEqual({ Votes: 0, Resources: null, MilitaryUnits: 0, MilitarySupply: 0, DiplomaticDeals: null });
    expect(projectNewspaperPlayer({ ...row, Player0: 1 }, context())?.values).toEqual({});
  });

  it('keeps foreign national restrictions at full visibility', () => {
    const row = { ID: 7, Key: 1, Turn: 9, CreatedAt: 1009, Player0: 2, Era: 'Classical Era',
      Votes: 3, Resources: { Iron: 2 }, MilitaryUnits: 4, MilitarySupply: 5, DiplomaticDeals: { Civ2: [] },
      Relationships: { Civ2: ['At War'] }, MajorAlly: 'Civ2' } as any;
    const values = projectNewspaperPlayer(row, context())!.values;
    expect(values).toEqual({ Era: 'Classical Era' });
    expect(values).not.toHaveProperty('Relationships');
    expect(values).not.toHaveProperty('MajorAlly');
  });

  it('keeps a visible known city-state with no selected values and omits unknown or hidden rows', () => {
    const cityState = { ID: 8, Key: 4, Turn: 9, CreatedAt: 1009, Player0: 1,
      Relationships: { Civ0: 'Friendly' }, MajorAlly: null } as any;
    const ctx = context();
    ctx.players = [...ctx.players, { Key: 4, TeamID: 4, IsMajor: 0, Civilization: 'Civ4' } as any];
    const projected = projectNewspaperPlayer(cityState, ctx);
    expect(projected?.values).toEqual({});
    expect(projected?.values).not.toHaveProperty('Relationships');
    expect(projected?.values).not.toHaveProperty('MajorAlly');
    expect(projectNewspaperPlayer({ ...cityState, Key: 5 }, ctx)).toBeUndefined();
    expect(projectNewspaperPlayer({ ...cityState, Player0: 0 }, ctx)).toBeUndefined();
  });

  it.each([
    ['CityConstructed', { OwnerID: 1, CityID: 8, BuildingType: 'Granary', IsGoldPurchase: false }, { Building: 'Granary', IsGoldPurchase: false }],
    ['CityPuppeted', { PlayerID: 1, CityID: 8 }, { PlayerID: 1, CityID: 8 }],
    ['CityRazed', { PlayerID: 1, CityX: 0, CityY: 4 }, { CityX: 0, CityY: 4 }],
    ['SetPopulation', { CityX: 0, CityY: 4, OldPopulation: 3, NewPopulation: 2 }, { OldPopulation: 3, NewPopulation: 2 }],
    ['CapitalChanged', { PlayerID: 1, NewCapitalCityID: 8, OldCapitalCityID: -1 }, { NewCapitalCityID: 8, OldCapitalCityID: -1 }],
    ['CombatResult', { AttackingPlayerID: -1, DefendingPlayerID: 2, InterceptingPlayerID: -1, PlotX: 0, PlotY: 4 }, { DefendingPlayerID: 2, PlotX: 0, PlotY: 4 }],
    ['UnitKilledInCombat', { KillerPlayerID: 1, KilledPlayerID: 2, KilledUnitType: 'Galleass', PlotX: 8 }, { Unit: 'Galleass' }],
    ['PlayerCityFounded', { PlayerID: 1, PlotX: 0, PlotY: 4 }, { PlayerID: 1, PlotX: 0, PlotY: 4 }],
    ['UnitCityFounded', { PlayerID: 1, UnitID: 8, UnitType: 'Settler', PlotX: 0, PlotY: 4 }, { Unit: 'Settler', PlotX: 0, PlotY: 4 }],
    ['GreatPersonExpended', { PlayerID: 1, GreatPersonType: 'Great Scientist', CityX: 0, CityY: 4 }, { Unit: 'Great Scientist', CityX: 0, CityY: 4 }],
    ['MinorFriendsChanged', { MinorPlayerID: 1, MajorPlayerID: 0, IsNowFriend: false, NewFriendship: 0 }, { IsNowFriend: false, NewFriendship: 0 }]
  ])('projects the permitted recorded payload for %s', (Type, Payload, expected) => {
    const row = { ID: 91, Turn: 10, CreatedAt: 3010, Type, Payload: { ...Payload, OtherPrivateData: 999 }, Player0: 1 } as any;
    const projected = projectNewspaperEvent(row, context());
    expect(projected).toMatchObject({ type: Type, values: expected });
    expect(projected?.values).not.toHaveProperty('OtherPrivateData');
    if (Type === 'UnitKilledInCombat') expect(projected?.values).not.toHaveProperty('PlotX');
    expect(projectNewspaperEvent({ ...row, Player0: 0 }, context())).toBeUndefined();
  });

  it.each([
    [{ Starting: false, TurnChange: 10 }, true],
    [{ Starting: false, TurnChange: 0 }, false],
    [{ Starting: false }, undefined],
    [{ Starting: true, TurnChange: 0 }, undefined],
    [{ Starting: true, TurnChange: 8 }, true],
    [{ TurnChange: 0 }, undefined]
  ])('reports only supported Golden Age directions from %j', (payload, expected) => {
    const row = { ID: 91, Turn: 10, CreatedAt: 3010, Type: 'PlayerGoldenAge', Payload: { PlayerID: 1, ...payload }, Player0: 1 } as any;
    const projected = projectNewspaperEvent(row, context())!;
    if (expected === undefined) expect(projected.values).not.toHaveProperty('Starting');
    else expect(projected.values.Starting).toBe(expected);
  });

  it.each([
    ['TeamTechResearched', { TeamID: 1, TechID: 'Pottery', ChangeAmount: 4 }, { Tech: 'Pottery' }],
    ['PlayerAdoptPolicy', { PlayerID: 1, PolicyID: 'Aristocracy' }, { Policy: 'Aristocracy' }],
    ['PlayerAdoptPolicyBranch', { PlayerID: 1, BranchType: 'Tradition' }, { Branch: 'Tradition' }],
    ['IdeologySwitched', { PlayerID: 1, OldBranchType: 'Freedom', NewBranchType: 'Order' },
      { OldBranch: 'Freedom', NewBranch: 'Order' }],
    ['ReligionFounded', { PlayerID: 1, HolyCityID: 99, ReligionID: 'Buddhism' }, { Religion: 'Buddhism' }],
    ['UnitCityFounded', { PlayerID: 1, UnitID: 8, UnitType: 'Settler' }, { Unit: 'Settler' }],
    ['UnitKilledInCombat', { KillerPlayerID: 1, KilledPlayerID: 2, KilledUnitType: 'Galleass' }, { Unit: 'Galleass' }],
    ['GreatPersonExpended', { PlayerID: 1, GreatPersonType: 'Great Scientist' }, { Unit: 'Great Scientist' }],
    ['CityConstructed', { OwnerID: 1, CityID: 8, BuildingType: 'Granary' }, { Building: 'Granary' }]
  ])('publishes %s names under name keys and drops the raw field', (Type, Payload, expected) => {
    const row = { ID: 92, Turn: 10, CreatedAt: 3010, Type, Payload, Player0: 1 } as any;
    const values = projectNewspaperEvent(row, context(200))!.values;
    expect(values).toMatchObject(expected);
    for (const field of ['TechID', 'PolicyID', 'BranchType', 'OldBranchType', 'NewBranchType', 'ReligionID',
      'UnitType', 'KilledUnitType', 'GreatPersonType', 'BuildingType']) expect(values).not.toHaveProperty(field);
  });

  it('keeps only nonblank name strings and drops numeric or blank recordings', () => {
    /** Build a witnessed research row around one recorded technology value. */
    const row = (Payload: Record<string, unknown>) => ({ ID: 93, Turn: 10, CreatedAt: 3010,
      Type: 'TeamTechResearched', Player0: 1, Payload }) as any;
    expect(projectNewspaperEvent(row({ TeamID: 1, TechID: 'Pottery', ChangeAmount: 4 }), context())!.values)
      .toEqual({ TeamID: 1, ChangeAmount: 4, Tech: 'Pottery' });
    for (const TechID of [0, -1, null, '   ']) {
      expect(projectNewspaperEvent(row({ TeamID: 1, TechID, ChangeAmount: 4 }), context())!.values)
        .toEqual({ TeamID: 1, ChangeAmount: 4 });
    }
  });

  it('publishes an unwitnessed researched technology for a met team in reduced form', () => {
    const row = { ID: 94, Turn: 10, CreatedAt: 3010, Type: 'TeamTechResearched', Player0: 0,
      Payload: { TeamID: 1, TechID: 'Printing Press', ChangeAmount: 4, Reader: 'secret' } } as any;
    const values = projectNewspaperEvent(row, context())!.values;
    expect(values).toEqual({ TeamID: 1, Tech: 'Printing Press' });
  });

  it('reduces an unwitnessed named great person birth to owner and name', () => {
    const base = { ID: 98, Turn: 10, CreatedAt: 3010, Type: 'UnitCreated', Player0: 0 };
    /** Project an unwitnessed unit creation around one recorded great person name. */
    const project = (GreatPerson: unknown) => projectNewspaperEvent({ ...base, Payload: {
      PlayerID: 1, UnitID: 8, UnitType: 'Great Scientist', PlotX: 3, PlotY: 4,
      Unit: { UnitType: 'Great Scientist', GreatPerson }, Secret: 'reader' }
    } as any, context());
    expect(project('Hypatia')?.values).toEqual({ PlayerID: 1, Person: 'Hypatia' });
    for (const GreatPerson of [0, -1, null, '   ']) expect(project(GreatPerson)).toBeUndefined();
    expect(projectNewspaperEvent({ ...base, Payload: {
      PlayerID: 1, UnitID: 8, UnitType: 'Warrior', PlotX: 3, PlotY: 4 }
    } as any, context())).toBeUndefined();
    expect(projectNewspaperEvent({ ...base, Player0: 1, Payload: {
      PlayerID: 1, UnitID: 8, UnitType: 'Warrior', PlotX: 3, PlotY: 4 }
    } as any, context())?.values).not.toHaveProperty('Person');
  });

  it.each([
    ['UnitCreated', { PlayerID: 1, UnitID: 8, UnitType: 'Great Scientist', PlotX: 3, PlotY: 4 },
      { Person: 'Hypatia', Unit: 'Great Scientist', PlotX: 3, PlotY: 4 }],
    ['GreatPersonExpended', { PlayerID: 1, UnitID: 8, GreatPersonType: 'Great Scientist', CityX: 0, CityY: 4 },
      { Person: 'Hypatia', Unit: 'Great Scientist', CityX: 0, CityY: 4 }],
    ['UnitPrekill', { OwnerID: 1, UnitID: 8, UnitType: 'Great Scientist', PlotX: 3, PlotY: 4,
      AttackingPlayerID: -1, DelayKill: false },
      { Person: 'Hypatia', Unit: 'Great Scientist', PlotX: 3, PlotY: 4, AttackingPlayerID: -1, DelayKill: false }]
  ])('publishes a recorded great person name for %s without changing unit naming', (Type, Payload, expected) => {
    const row = { ID: 99, Turn: 10, CreatedAt: 3010, Type, Player0: 1,
      Payload: { ...Payload, Unit: { UnitType: 'Great Scientist', GreatPerson: 'Hypatia' } } } as any;
    const values = projectNewspaperEvent(row, context())!.values;
    expect(values).toMatchObject(expected);
    expect(values).not.toHaveProperty('GreatPerson');
    expect(values).not.toHaveProperty('GreatPersonType');
  });

  it('does not publish a nested great person name for other unit events', () => {
    const row = { ID: 100, Turn: 10, CreatedAt: 3010, Type: 'UnitCityFounded', Player0: 1,
      Payload: { PlayerID: 1, UnitID: 8, UnitType: 'Great General', PlotX: 3, PlotY: 4,
        Unit: { UnitType: 'Great General', GreatPerson: 'Hypatia' } } } as any;
    const values = projectNewspaperEvent(row, context())!.values;
    expect(values).toMatchObject({ Unit: 'Great General' });
    expect(values).not.toHaveProperty('Person');
  });

  it('reports only the final removal of a named great person', () => {
    /** Build a witnessed death row around one recorded name and kill flag. */
    const row = (Payload: Record<string, unknown>, Player0 = 1) => ({ ID: 101, Turn: 10, CreatedAt: 3010,
      Type: 'UnitPrekill', Player0, Payload }) as any;
    const death = { OwnerID: 1, UnitID: 8, UnitType: 'Great Scientist', PlotX: 3, PlotY: 4,
      AttackingPlayerID: -1, Unit: { GreatPerson: 'Hypatia' } };
    expect(projectNewspaperEvent(row({ ...death, DelayKill: false }), context())?.values)
      .toMatchObject({ OwnerID: 1, Unit: 'Great Scientist', Person: 'Hypatia', DelayKill: false });
    expect(projectNewspaperEvent(row({ ...death, DelayKill: 0 }), context())?.values).toHaveProperty('DelayKill', 0);
    for (const DelayKill of [true, 1, undefined, 'false']) {
      expect(projectNewspaperEvent(row({ ...death, DelayKill }), context())).toBeUndefined();
    }
    for (const Unit of [undefined, { GreatPerson: 0 }, { GreatPerson: '   ' }]) {
      expect(projectNewspaperEvent(row({ ...death, Unit, DelayKill: false }), context())).toBeUndefined();
    }
    expect(projectNewspaperEvent(row({ ...death, DelayKill: false }, 0), context())).toBeUndefined();
  });

  it('suppresses a death when the same unit was expended in the same turn', () => {
    const row = { ID: 102, Turn: 10, CreatedAt: 3010, Type: 'UnitPrekill', Player0: 1,
      Payload: { OwnerID: 1, UnitID: 8, UnitType: 'Great Scientist', PlotX: 3, PlotY: 4,
        AttackingPlayerID: -1, DelayKill: false, Unit: { GreatPerson: 'Hypatia' } } } as any;
    /** Build an expenditure row and vary the fields that tie it to the death. */
    const expended = (Turn = 10, PlayerID = 1, UnitID = 8, Player0 = 1) => ({ ID: 103, Turn, CreatedAt: 3010,
      Type: 'GreatPersonExpended', Player0, Payload: { PlayerID, UnitID, GreatPersonType: 'Great Scientist' } }) as any;
    for (const event of [expended(9), expended(10, 2), expended(10, 1, 9)]) {
      expect(projectNewspaperEvent(row, { ...context(), unitLifecycle: [event] })).toBeDefined();
    }
    expect(projectNewspaperEvent(row, { ...context(), unitLifecycle: [expended()] })).toBeUndefined();
    // The query owns visibility; a matching expenditure hides the death even when unwitnessed.
    expect(projectNewspaperEvent(row, { ...context(), unitLifecycle: [expended(10, 1, 8, 0)] })).toBeUndefined();
  });

  it('reports a named death without an unmet attacker and hides it without the owner', () => {
    const base = { ID: 104, Turn: 10, CreatedAt: 3010, Type: 'UnitPrekill', Player0: 1,
      Payload: { OwnerID: 1, UnitID: 8, UnitType: 'Great Scientist', PlotX: 3, PlotY: 4,
        AttackingPlayerID: 3, AttackingPlayer: { Name: 'Leader3', Civilization: 'Civ3' },
        DelayKill: false, Unit: { GreatPerson: 'Hypatia' } } } as any;
    const unmet = projectNewspaperEvent(base, context())!;
    expect(unmet.values).toMatchObject({ OwnerID: 1, Person: 'Hypatia' });
    expect(unmet.values).not.toHaveProperty('AttackingPlayerID');
    expect(unmet.values).not.toHaveProperty('AttackingPlayer');
    const met = context();
    met.summaries[3].Player0 = 1;
    expect(projectNewspaperEvent(base, met)!.values).toMatchObject({
      AttackingPlayerID: 3, AttackingPlayer: { Name: 'Leader3', Civilization: 'Civ3' }
    });
    const unmetOwner = context();
    unmetOwner.summaries[1].Player0 = 0;
    expect(projectNewspaperEvent(base, unmetOwner)).toBeUndefined();
  });

  it('keeps unwitnessed great person uses and deaths private', () => {
    const expended = { ID: 105, Turn: 10, CreatedAt: 3010, Type: 'GreatPersonExpended', Player0: 0,
      Payload: { PlayerID: 1, UnitID: 8, GreatPersonType: 'Great Scientist', CityX: 0, CityY: 4,
        Unit: { GreatPerson: 'Hypatia' } } } as any;
    expect(projectNewspaperEvent(expended, context())).toBeUndefined();
    const death = { ...expended, ID: 106, Type: 'UnitPrekill', Payload: {
      OwnerID: 1, UnitID: 8, UnitType: 'Great Scientist', PlotX: 3, PlotY: 4,
      AttackingPlayerID: -1, DelayKill: false, Unit: { GreatPerson: 'Hypatia' } } } as any;
    expect(projectNewspaperEvent(death, context())).toBeUndefined();
  });

  it('withholds unwitnessed world news without a valid owner, name or fully known team', () => {
    const base = { ID: 95, Turn: 10, CreatedAt: 3010, Type: 'TeamTechResearched', Player0: 0 };
    /** Project an unwitnessed research payload for a chosen contact context. */
    const project = (Payload: Record<string, unknown>, ctx = context()) =>
      projectNewspaperEvent({ ...base, Payload: { ChangeAmount: 1, ...Payload } } as any, ctx);
    expect(project({ TechID: 'Pottery' })).toBeUndefined();
    expect(project({ TeamID: 7, TechID: 'Pottery' })).toBeUndefined();
    expect(project({ TeamID: 1, TechID: 0 })).toBeUndefined();
    expect(project({ TeamID: 1, TechID: '  ' })).toBeUndefined();
    const partial = context();
    partial.players = [...partial.players,
      { Key: 4, TeamID: 9, IsMajor: 1, Civilization: 'Civ4' }, { Key: 5, TeamID: 9, IsMajor: 1, Civilization: 'Civ5' }] as any;
    partial.summaries = [...partial.summaries, { Key: 4, Player0: 1 } as any, { Key: 5, Player0: 0 } as any];
    expect(project({ TeamID: 9, TechID: 'Pottery' }, partial)).toBeUndefined();
    partial.summaries[5].Player0 = 1;
    expect(project({ TeamID: 9, TechID: 'Pottery' }, partial)).toBeDefined();

    const barbarians = context();
    barbarians.players = [...barbarians.players, { Key: 63, TeamID: 63 } as any];
    expect(project({ TeamID: 63, TechID: 'Pottery' }, barbarians)).toBeUndefined();
  });

  it('keeps unrelated events private when the receiver did not witness them', () => {
    expect(projectNewspaperEvent({ ID: 96, Turn: 10, CreatedAt: 3010, Type: 'TeamSetHasTech', Player0: 0,
      Payload: { TeamID: 1, TechID: 'Pottery', HasTech: true } } as any, context())).toBeUndefined();
    expect(projectNewspaperEvent({ ID: 97, Turn: 10, CreatedAt: 3010, Type: 'ReligionFounded', Player0: 0,
      Payload: { PlayerID: 1, ReligionID: 'Buddhism' } } as any, context())).toBeUndefined();
  });
});
