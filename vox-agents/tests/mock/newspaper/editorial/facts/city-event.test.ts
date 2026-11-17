import { describe, expect, it } from 'vitest';
import type {
  NewspaperEvent, NewspaperEvidence, NewspaperHistory, NewspaperSnapshot,
} from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { reference, type FactMetadata, type FactObject, type FactWindow } from '../../../../../src/newspaper/editorial/facts/model.js';
import { compileEditorialExpressions } from '../../../../../src/newspaper/editorial/shared/expressions.js';

/** Record the final visible city observation of one turn, with optional unresolved owner. */
function city(id: number, turn: number, x: number, owner?: number, values: NewspaperSnapshot['values'] = {}, key = id): NewspaperSnapshot {
  return {
    subjectID: key, source: { table: 'CityInformations', id, turn, createdAt: 10 * turn + 5 },
    values: { X: x, Y: 2, ...(owner === undefined ? {} : { OwnerID: owner }), ...values },
  };
}

/** Record an observed player identity and its first date of contact. */
function player(id: number, turn = 0): NewspaperSnapshot {
  return { subjectID: id, source: { table: 'PlayerSummaries', id: id + 1, turn, createdAt: 10 * turn }, values: {} };
}

/** Record a permitted event after the observations at that turn, except when an earlier time is supplied. */
function event(id: number, turn: number, type: string, values: NewspaperEvent['values'], order = 8): NewspaperEvent {
  return { source: { table: 'GameEvents', id, turn, createdAt: 10 * turn + order }, type, values };
}

/** Build facts with cutoff 10, reporting period (5, 10], and history back to turn zero. */
function facts(cities: NewspaperSnapshot[], snapshots: NewspaperSnapshot[], events: NewspaperEvent[] = [],
  gaps: NewspaperHistory['gaps'] = [], players = [player(0), player(1), player(2)],
  playerIdentities?: FactMetadata['playerIdentities']) {
  const evidence: NewspaperEvidence = {
    request: { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10, historyFromTurn: -1 },
    cities, players: players.filter(row => !gaps.some(gap => gap.table === 'PlayerSummaries' && gap.subjectID === row.subjectID &&
      gap.turn >= row.source.turn)), events: events.filter(row => row.source.turn > 5), comparisons: { cities: [], players: [] },
    history: { fromTurn: -1, baseline: { cities: [], players: [] }, snapshots: { cities: snapshots, players }, gaps, events },
  };
  return buildNewspaperFacts(evidence, { recordingStartTurn: 0, playerIdentities });
}

/** Read the entries left for evaluation-time window selection. */
function entries(fact: FactObject[string]) {
  return (fact.value as FactWindow).entries.map(entry => entry.field.value as FactObject);
}

describe('newspaper city facts', () => {
  describe('stored and inferred facts', () => {
    it('should keep nulls and readable city details, resolve ownership from projection, and cite the nearest own city', () => {
      const home = city(10, 0, 0, 0, { Name: 'Home', IsCapital: 1, FoodStored: 0, ImportantBuildings: ['Granary'] });
      const foreign = city(20, 4, 3, 1, { Name: 'Port', MajorityReligion: null, IsOccupied: 0, Wonders: ['Lighthouse'] });
      const disputed = city(21, 0, 4, undefined, { Name: 'Disputed', Owner: 'The same civilization' });
      const model = facts([home, foreign, disputed], [home, foreign, disputed]);
      expect(model.cities[10].current).toMatchObject({
        isCapital: { value: true }, foodStored: { value: 0 }, importantBuildings: { value: ['Granary'] },
        own: { value: true }, foreign: { value: false }, distance: { value: { own: { value: 0 }, capital: { value: 0 } } },
      });
      expect(model.cities[20].current).toMatchObject({
        owner: { value: { kind: 'player', id: 1 }, sources: [foreign.source] },
        own: { value: false }, foreign: { value: true }, isOccupied: { value: false }, majorityReligion: { value: null },
        wonders: { value: ['Lighthouse'] }, founded: { value: 4, sources: [foreign.source] },
        distance: { value: { own: { value: 3, sources: [foreign.source, home.source] }, capital: { value: 3 } } },
        nearestOwn: { value: { kind: 'city', id: 10 } },
      });
      expect(model.cities[20].current).not.toHaveProperty('foodStored');
      expect(model.cities[10].current).not.toHaveProperty('founded');
      for (const hidden of ['owner', 'own', 'foreign', 'formerOwner', 'captured']) {
        expect(model.cities[21].current).not.toHaveProperty(hidden);
      }
      expect(model.cities[20].history[0].fields).not.toHaveProperty('distance');
    });

    it('should distinguish Lua empty lists, explicit nulls, and missing city lists', () => {
      const before = city(10, 2, 3, 0, { Wonders: {}, ImportantBuildings: {} });
      const now = city(11, 8, 3, 0, { Wonders: ['Petra'], ImportantBuildings: null }, 10);
      const other = city(12, 8, 4, 1);
      const model = facts([now, other], [before, now, other]);
      expect(model.cities[10].history[0].fields).toMatchObject({ wonders: { value: [] }, importantBuildings: { value: [] } });
      expect(model.cities[10].current).toMatchObject({ wonders: { value: ['Petra'] }, importantBuildings: { value: null } });
      expect(entries(model.cities[10].current!.built)).toMatchObject([{ building: { value: 'Petra' } }]);
      expect(model.cities[12].current).not.toHaveProperty('wonders');
      const hiddenBefore = city(10, 2, 3, 0, { Wonders: null });
      expect(entries(facts([now], [hiddenBefore, now]).cities[10].current!.built)).toEqual([]);
    });

    it('should preserve both founding hooks and infer the latest witnessed transfer at that plot', () => {
      const old = city(20, 2, 3, 1, { Name: 'Port' });
      const now = city(21, 8, 3, 2, { Name: 'Port' });
      const founded = event(100, 2, 'PlayerCityFounded', { PlayerID: 1, PlotX: 3, PlotY: 2 }, 2);
      const foundedUnit = event(101, 2, 'UnitCityFounded', { PlayerID: 1, PlotX: 3, PlotY: 2 }, 4);
      const captured = event(102, 7, 'CityCaptureComplete', { OldOwnerID: 1, NewOwnerID: 2, CityX: 3, CityY: 2, IsConquest: 1 });
      const model = facts([now], [old, now], [founded, foundedUnit, captured], [{ table: 'CityInformations', subjectID: 20, turn: 7 }]);
      expect(model.cities[21].current).toMatchObject({
        founded: { value: 2, sources: [now.source, founded.source, foundedUnit.source] },
        captured: { value: {
          turn: { value: 7 }, from: { value: { kind: 'player', id: 1 } }, by: { value: { kind: 'player', id: 2 } }, conquest: { value: true },
        }, sources: [now.source, captured.source] },
        formerOwner: { value: { kind: 'player', id: 1 } },
      });
      expect(model.events.map(row => row.fields.type.value)).toEqual(['PlayerCityFounded', 'UnitCityFounded', 'CityCaptureComplete']);
    });

    it('should infer former ownership when the same city changes owner without a capture row', () => {
      const old = city(10, 2, 3, 1, { Name: 'Port' });
      const previous = city(11, 5, 3, 2, { Name: 'Port' }, 10);
      const now = city(12, 8, 3, 0, { Name: 'Port' }, 10);
      const changed = facts([now], [old, previous, now]).cities[10].current;
      expect(changed?.formerOwner).toMatchObject({ value: { kind: 'player', id: 2 }, sources: [previous.source, now.source] });
      expect(changed).not.toHaveProperty('captured');
      const moved = city(13, 8, 4, 0, { Name: 'Port' }, 10);
      const renamed = city(14, 8, 3, 0, { Name: 'Harbor' }, 10);
      const founded = event(100, 7, 'PlayerCityFounded', { PlayerID: 0, PlotX: 3, PlotY: 2 });
      const visibilityGap = { table: 'CityInformations', subjectID: 10, turn: 7 } as const;
      expect(facts([moved], [old, previous, moved]).cities[10].current).not.toHaveProperty('formerOwner');
      expect(facts([renamed], [old, previous, renamed]).cities[10].current).not.toHaveProperty('formerOwner');
      expect(facts([now], [old, previous, now], [founded]).cities[10].current).not.toHaveProperty('formerOwner');
      expect(facts([now], [old, previous, now], [], [visibilityGap]).cities[10].current).not.toHaveProperty('formerOwner');
    });

    it('should hide prior events, snapshot changes, and inferred founding for a city reacquired after a gap', () => {
      const old = city(10, 1, 3, 1, { Name: 'Port', Wonders: [], MajorityReligion: null });
      const now = city(11, 8, 3, 1, { Name: 'Port', Wonders: ['Lighthouse'], MajorityReligion: 'Taoism' }, 10);
      const founded = event(100, 1, 'PlayerCityFounded', { PlayerID: 1, PlotX: 3, PlotY: 2 }, 3);
      const trained = event(101, 2, 'CityTrained', { PlayerID: 1, CityID: 10, CityX: 3, CityY: 2, Unit: 'Warrior' });
      trained.relatedSources = [old.source];
      const gap = { table: 'CityInformations', subjectID: 10, turn: 4 } as const;
      const model = facts([now], [old, now], [founded, trained], [gap]);
      const current = model.cities[10].current!;
      expect(current).not.toHaveProperty('founded');
      expect(current).not.toHaveProperty('formerOwner');
      for (const name of ['events', 'trained', 'built', 'conversions']) expect(entries(current[name])).toEqual([]);
      expect(model.events.every(item => !item.fields.city)).toBe(true);
    });

    it('should use the pre-revolt city join for a flip without claiming it was a conquest', () => {
      const old = city(20, 2, 3, 1);
      const now = city(21, 8, 3, 2);
      const flip = event(100, 7, 'CityFlipped', { CityID: 20, CityX: 3, CityY: 2, OldOwnerID: 1, NewOwnerID: 2 });
      flip.relatedSources = [old.source];
      const gap = { table: 'CityInformations', subjectID: 20, turn: 7 } as const;
      const observed = facts([now], [old, now], [flip], [gap]);
      expect(observed.events[0].fields.city).toMatchObject({ value: { id: 21 }, sources: [flip.source, old.source, now.source] });
      expect(observed.cities[21].current?.captured).toMatchObject({ value: {
        turn: { value: 7 }, from: { value: { id: 1 } }, by: { value: { id: 2 } }, conquest: { value: false },
      } });
      const reacquired = city(22, 10, 3, 2, {}, 21);
      const unavailable = facts([reacquired], [old, now, reacquired], [flip], [gap, { ...gap, subjectID: 21, turn: 9 }]);
      expect(unavailable.cities[21].current).not.toHaveProperty('captured');
    });
  });

  describe('dated city developments', () => {
    it('should keep training details and visible support without inferring a hidden unit name', () => {
      const current = city(10, 3, 3, 0);
      const known = event(100, 5, 'CityTrained', { PlayerID: 0, CityID: 10, CityX: 3, CityY: 2, Unit: 'Pioneer', WithGold: 0, WithFaith: 1 });
      const created = event(101, 5, 'UnitCreated', { PlayerID: 0, UnitID: 5, UnitType: 'Pioneer' });
      known.relatedSources = [current.source, created.source];
      const noUnit = event(102, 6, 'CityTrained', { PlayerID: 0, CityID: 10, CityX: 3, CityY: 2, UnitID: 5 });
      const noPosition = event(103, 7, 'CityTrained', { PlayerID: 0, CityID: 10, Unit: 'Spearman' });
      const factsAt = facts([current], [current], [known, created, noUnit, noPosition]).cities[10].current!;
      const [first, second, ...others] = entries(factsAt.trained);
      expect(first).toMatchObject({
        turn: { value: 5 }, unit: { value: 'Pioneer', sources: [known.source, current.source, created.source] },
        withGold: { value: false }, withFaith: { value: true },
      });
      expect(second.turn.value).toBe(6);
      expect(second).not.toHaveProperty('unit');
      expect(others).toEqual([]);
    });

    it('should report constructions and wonder additions once and require a dated majority change', () => {
      const old = city(10, 3, 3, 0, { Wonders: ['Pyramids'], MajorityReligion: 'Taoism' });
      const current = city(11, 9, 3, 0, { Wonders: ['Pyramids', 'Petra'], MajorityReligion: 'Buddhism' }, 10);
      const construction = event(100, 7, 'CityConstructed', { CityID: 10, OwnerID: 0, CityX: 3, CityY: 2, Building: 'Petra' });
      const followers = event(101, 6, 'CityConvertsReligion', { OwnerID: 0, CityX: 3, CityY: 2, ReligionID: 'Taoism' });
      const conversion = event(102, 8, 'CityConvertsReligion', { OwnerID: 0, CityX: 3, CityY: 2, ReligionID: 'Buddhism' });
      const row = facts([current], [old, current], [construction, followers, conversion]).cities[10].current!;
      expect(entries(row.built)).toMatchObject([{ turn: { value: 7 }, building: { value: 'Petra',
        sources: [construction.source, old.source, current.source] } }]);
      expect(entries(row.conversions)).toHaveLength(1);
      expect(entries(row.conversions)[0]).toMatchObject({ turn: { value: 8 }, religion: { value: 'Buddhism',
        sources: expect.arrayContaining([old.source, current.source, conversion.source]) } });
      const firstObservation = facts([current], [current]).cities[10].current!;
      expect(entries(firstObservation.built)).toEqual([]);
      expect(entries(firstObservation.conversions)).toEqual([]);
    });

    it('should preserve distinct completions when merging later wonder observations', () => {
      const old = city(10, 3, 3, 0, { Wonders: [] });
      const now = city(11, 9, 3, 0, { Wonders: ['Petra', 'Pyramids'] }, 10);
      const construction = { CityID: 10, OwnerID: 0, CityX: 3, CityY: 2 };
      const petra = event(100, 6, 'CityConstructed', { ...construction, Building: 'Petra' });
      const other = event(101, 6, 'CityConstructed', { ...construction, Building: 'Granary' });
      const which = facts([now], [old, now], [petra, other]).cities[10].current!;
      expect(entries(which.built)).toMatchObject([
        { turn: { value: 6 }, building: { value: 'Petra', sources: [petra.source, old.source, now.source] } },
        { turn: { value: 6 }, building: { value: 'Granary', sources: [other.source] } },
        { turn: { value: 9 }, building: { value: 'Pyramids', sources: [old.source, now.source] } },
      ]);
    });

    it('should confirm numeric religion transitions without guessing localized names or backdating an unproved change', () => {
      const old = city(10, 3, 3, 0, { MajorityReligion: 'Taoism' });
      const now = city(11, 9, 3, 0, { MajorityReligion: 'Buddhism' }, 10);
      const payload = { OwnerID: 0, CityX: 3, CityY: 2 };
      const baseline = event(100, 4, 'CityConvertsReligion', { ...payload, ReligionID: 1 });
      const transition = event(101, 6, 'CityConvertsReligion', { ...payload, ReligionID: 2 });
      const followerChange = event(102, 7, 'CityConvertsReligion', { ...payload, ReligionID: 2 });
      const proved = facts([now], [old, now], [baseline, transition, followerChange]).cities[10].current!;
      expect(entries(proved.conversions)).toMatchObject([
        { turn: { value: 6 }, religion: { value: 2, sources: [baseline.source, transition.source, followerChange.source, old.source, now.source] } },
      ]);
      const uncertain = facts([now], [old, now], [transition]).cities[10].current!;
      expect(entries(uncertain.conversions)).toMatchObject([
        { turn: { value: 9 }, religion: { value: 'Buddhism', sources: [old.source, now.source] } },
      ]);
    });

    it('should preserve a distinct return following a contradictory dated majority', () => {
      const old = city(10, 3, 3, 0, { MajorityReligion: 'Taoism' });
      const now = city(11, 9, 3, 0, { MajorityReligion: 'Buddhism' }, 10);
      const payload = { OwnerID: 0, CityX: 3, CityY: 2 };
      const first = event(100, 5, 'CityConvertsReligion', { ...payload, ReligionID: 'Buddhism' });
      const second = event(101, 7, 'CityConvertsReligion', { ...payload, ReligionID: 'Islam' });
      const observed = facts([now], [old, now], [first, second]).cities[10].current!;
      expect(entries(observed.conversions)).toMatchObject([
        { turn: { value: 5 }, religion: { value: 'Buddhism' } },
        { turn: { value: 7 }, religion: { value: 'Islam' } },
        { turn: { value: 9 }, religion: { value: 'Buddhism', sources: [second.source, old.source, now.source] } },
      ]);
      const unchanged = city(12, 9, 3, 0, { MajorityReligion: 'Taoism' }, 10);
      const returned = facts([unchanged], [old, unchanged], [first]).cities[10].current!;
      expect(entries(returned.conversions)).toMatchObject([
        { turn: { value: 5 }, religion: { value: 'Buddhism' } },
        { turn: { value: 9 }, religion: { value: 'Taoism', sources: [first.source, old.source, unchanged.source] } },
      ]);
    });

    it('should select city and global events with the group window and audit a hidden entry', async () => {
      const current = city(10, 3, 3, 0);
      const known = event(100, 5, 'CityTrained', { PlayerID: 0, CityID: 10, CityX: 3, CityY: 2, Unit: 'Pioneer' });
      const created = event(101, 5, 'UnitCreated', { PlayerID: 0, UnitID: 5 });
      known.relatedSources = [current.source, created.source];
      const unknown = event(102, 6, 'CityTrained', { PlayerID: 0, CityID: 10, CityX: 3, CityY: 2 });
      const expressions = ['city.trained[0].unit', 'city.events.length', 'events.length'];
      const runner = await compileEditorialExpressions(expressions.map((source, i) => ({
        rule: 'trained-unit', field: `when[${i}]`, source,
      })));
      const subjects = [{ city: reference('city', 10) }];
      const [[currentPeriod], [longerWindow]] = await runner.evaluate({
        facts: facts([current], [current], [known, created, unknown]),
        groups: [{ expressions: [0, 1, 2], subjects }, { windowFromTurn: 4, expressions: [0, 1, 2], subjects }],
      });
      expect(currentPeriod[0]).toMatchObject({ error: { hidden: 'city.trained[0].unit' } });
      expect(currentPeriod.slice(1).map(result => 'value' in result && result.value)).toEqual([1, 1]);
      expect(longerWindow[0]).toMatchObject({ value: 'Pioneer', sources: expect.arrayContaining([known.source, created.source, current.source]) });
      expect(longerWindow.slice(1).map(result => 'value' in result && result.value)).toEqual([2, 3]);
    });
  });
});

describe('newspaper event facts', () => {
  it('should preserve known and nobody IDs while hiding a late contact on an involved event', async () => {
    const ally = event(100, 6, 'SetAlly', { MinorPlayerID: 22, OldAllyPlayerID: 0, NewAllyPlayerID: 1 });
    const unallied = event(101, 6, 'SetAlly', { MinorPlayerID: 22, OldAllyPlayerID: 0, NewAllyPlayerID: -1 });
    const lost = event(102, 6, 'SetAlly', { MinorPlayerID: 22, OldAllyPlayerID: 2, NewAllyPlayerID: 0 });
    const age = event(103, 9, 'PlayerGoldenAge', { PlayerID: 0, Starting: 0, TurnChange: 0 });
    const oldAlly = player(2, 5);
    const model = facts([], [], [ally, unallied, lost, age], [{ table: 'PlayerSummaries', subjectID: 2, turn: 8 }],
      [player(0), player(1, 7), oldAlly, player(22, 5)], { 1: { name: 'Later Contact' } });
    const rows = model.events;
    expect(rows[0].fields).toMatchObject({
      turn: { value: 6 }, type: { value: 'SetAlly' }, minorPlayer: { value: { kind: 'player', id: 22 } },
      oldAllyPlayerId: { value: 0 }, oldAllyPlayer: { value: { kind: 'player', id: 0 } },
    });
    expect(rows[0].fields).not.toHaveProperty('newAllyPlayerId');
    expect(rows[0].fields).not.toHaveProperty('newAllyPlayer');
    expect(rows[1].fields.newAllyPlayerId.value).toBe(-1);
    expect(rows[1].fields).not.toHaveProperty('newAllyPlayer');
    expect(rows[2].fields.oldAllyPlayerId).toEqual({ value: 2, sources: [lost.source, oldAlly.source] });
    expect(rows[2].fields).not.toHaveProperty('oldAllyPlayer');
    expect(rows[3].fields).toMatchObject({ starting: { value: false }, turnChange: { value: 0 }, player: { value: { id: 0 } } });

    const runner = await compileEditorialExpressions([{
      rule: 'ally-contact', field: 'values.ally', source: 'players.find(p => p.id === event.newAllyPlayerId)?.name',
    }]);
    const result = await runner.evaluate({ facts: model, groups: [{ expressions: [0], subjects: [{ event: reference('event', 100) }] }] });
    expect(result[0][0][0]).toMatchObject({ error: { hidden: 'event.newAllyPlayerId' } });
    expect(entries(model.players[1].current!.events)).toEqual([]);
  });

  it('should hide involved diplomacy team IDs until known without losing the receiver’s team or ordinary events', () => {
    const unknownTarget = event(100, 6, 'DeclareWar', { OriginatingPlayerID: 0, TargetTeamID: 9, IsAggressor: true });
    const toReceiver = event(101, 6, 'DeclareWar', { OriginatingPlayerID: 1, TargetTeamID: 4, IsAggressor: true });
    const partialTeam = event(102, 6, 'MakePeace', { OriginatingPlayerID: 0, TargetTeamID: 8 });
    const knownTeam = event(103, 8, 'MakePeace', { OriginatingPlayerID: 0, TargetTeamID: 8 });
    const ordinary = event(104, 8, 'CombatResult', { AttackingPlayerID: 63, DefendingPlayerID: 0, InterceptingPlayerID: -1 });
    const teammate = event(105, 9, 'DeclareWar', { OriginatingPlayerID: 4, TargetTeamID: 8 });
    const players = [player(0), player(1, 7), player(2), player(3, 7), player(4, 5)];
    const model = facts([], [], [unknownTarget, toReceiver, partialTeam, knownTeam, ordinary, teammate], [], players, {
      0: { teamId: 4 }, 1: { teamId: 9 }, 2: { teamId: 8 }, 3: { teamId: 8 }, 4: { teamId: 4 },
    });
    const rows = model.events;
    expect(rows[0].fields).toMatchObject({ isAggressor: { value: true }, originatingPlayerId: { value: 0 } });
    expect(rows[0].fields).not.toHaveProperty('targetTeamId');
    expect(rows[1].fields.targetTeamId.value).toBe(4);
    expect(rows[1].fields).not.toHaveProperty('originatingPlayerId');
    expect(rows[1].fields).not.toHaveProperty('originatingPlayer');
    expect(rows[2].fields.targetTeamId).toEqual({ value: 8, sources: [partialTeam.source, players[2].source] });
    expect(rows[3].fields.targetTeamId).toEqual({ value: 8, sources: [knownTeam.source, players[2].source] });
    expect(rows[4].fields).toMatchObject({ attackingPlayerId: { value: 63 }, interceptingPlayerId: { value: -1 } });
    expect(rows[5].fields).toMatchObject({ targetTeamId: { value: 8 }, originatingPlayer: { value: { id: 4 } } });
    const included = (id: number) => (model.players[id].current!.events.value as FactWindow).entries.map(row => row.field.value);
    expect(included(1)).toEqual([]);
    expect(included(2)).toEqual([reference('event', 102), reference('event', 103), reference('event', 105)]);
    expect(included(3)).toEqual([reference('event', 103), reference('event', 105)]);
    expect(included(4)).toEqual([reference('event', 101), reference('event', 105)]);
  });

  it('should expose event positions and cutoff distances separately from city or unit joins', () => {
    const home = city(10, 3, 0, 0, { IsCapital: 1 });
    const foreign = city(20, 8, 3, 1);
    const founded = event(100, 8, 'PlayerCityFounded', { PlayerID: 1, PlotX: 3, PlotY: 2 }, 3);
    const great = event(101, 9, 'GreatPersonExpended', { PlayerID: 1, GreatPersonType: 'Great Scientist',
      Unit: 'Great Scientist', CityX: 2, CityY: 2 });
    const missing = event(102, 9, 'CityTrained', { PlayerID: 1, CityID: 20, UnitID: 2 });
    const rows = facts([home, foreign], [home, foreign], [founded, great, missing]).events;
    expect(rows[0].fields).toMatchObject({
      player: { value: { kind: 'player', id: 1 } }, city: { value: { kind: 'city', id: 20 } },
      plot: { value: { x: { value: 3 }, y: { value: 2 } } }, distance: { value: { own: { value: 3, sources: [founded.source, home.source] } } },
    });
    expect(rows[1].fields).toMatchObject({ greatPersonType: { value: 'Great Scientist' }, unit: { value: 'Great Scientist' },
      distance: { value: { own: { value: 2 } } } });
    expect(rows[1].fields).not.toHaveProperty('city');
    for (const unavailable of ['city', 'unit', 'plot', 'distance']) expect(rows[2].fields).not.toHaveProperty(unavailable);
  });

  it('should link trade endpoints independently and suppress a stale or ambiguous city at the same coordinates', () => {
    const home = city(10, 3, 0, 0);
    const port = city(20, 3, 3, 1);
    const later = city(21, 9, 3, 1);
    const route = event(100, 7, 'PlayerTradeRouteCompleted', { OriginPlayerID: 0, DestinationPlayerID: 1,
      OriginCityID: 10, DestinationCityID: 20, OriginCityX: 0, OriginCityY: 2, DestinationCityX: 3, DestinationCityY: 2 });
    route.relatedSources = [home.source, port.source];
    const razing = event(101, 8, 'CityRazed', { PlayerID: 1, CityX: 3, CityY: 2 });
    const replacement = event(102, 9, 'UnitCityFounded', { PlayerID: 1, PlotX: 3, PlotY: 2 }, 3);
    const available = facts([home, port], [home, port], [route]).events[0].fields;
    expect(available).toMatchObject({ originCity: { value: { id: 10 } }, destinationCity: { value: { id: 20 } } });
    expect(available).not.toHaveProperty('city');
    expect(facts([home, port, later], [home, port, later], [route]).events[0].fields).not.toHaveProperty('destinationCity');
    expect(facts([home, later], [home, port, later], [route, razing, replacement]).events[0].fields).not.toHaveProperty('destinationCity');
  });

  it('should reject a joined event when the same city ID was reused at another plot in between', () => {
    const old = city(20, 2, 3, 1);
    const moved = city(21, 6, 5, 1, {}, 20);
    const again = city(22, 8, 3, 1, {}, 20);
    const joined = event(100, 4, 'CityTrained', { PlayerID: 1, CityID: 20, CityX: 3, CityY: 2, Unit: 'Warrior' });
    joined.relatedSources = [old.source];
    const model = facts([again], [old, moved, again], [joined]);
    expect(model.events[0].fields).not.toHaveProperty('city');
    expect(entries(model.cities[20].current!.trained)).toEqual([]);
    expect(model.cities[20].current).not.toHaveProperty('founded');
  });
});
