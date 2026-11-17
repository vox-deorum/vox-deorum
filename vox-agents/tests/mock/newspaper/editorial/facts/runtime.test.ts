import { describe, expect, it } from 'vitest';
import type {
  NewspaperEvent, NewspaperEvidence, NewspaperSnapshot,
} from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { reference } from '../../../../../src/newspaper/editorial/facts/model.js';
import {
  compileEditorialExpressions, type EditorialShortcutDefinitions,
} from '../../../../../src/newspaper/editorial/shared/expressions.js';

/** Make one readable final city observation for its turn. */
function city(id: number, turn: number, sourceID: number, fields: NewspaperSnapshot['values'] = {}): NewspaperSnapshot {
  return {
    subjectID: id,
    source: { table: 'CityInformations', id: sourceID, turn, createdAt: turn * 10 + 2 },
    values: { X: 0, Y: 0, OwnerID: 0, Population: 3, FoodPerTurn: -2, ...fields },
  };
}

/** Make a known major with a readable city-owning identity. */
function player(id: number): NewspaperSnapshot {
  return {
    subjectID: id,
    source: { table: 'PlayerSummaries', id: id + 100, turn: 1, createdAt: 10 },
    values: { Population: 12 },
  };
}

/** Supply a permitted located event that can appear in different reporting windows. */
function event(id: number, turn: number, x = 0, y = 0): NewspaperEvent {
  return {
    source: { table: 'GameEvents', id, turn, createdAt: turn * 10 + 1 },
    type: 'GreatPersonExpended',
    values: { PlayerID: 0, PlotX: x, PlotY: y },
  };
}

const own = player(0);
const foreign = player(1);
const identity = { playerIdentities: { 0: { major: true, name: 'Rome' }, 1: { major: true, name: 'Carthage' } } };

/** Start an evidence window with visible players and no city assumptions. */
function evidence(cities: NewspaperSnapshot[], events: NewspaperEvent[] = []): NewspaperEvidence & {
  history: NonNullable<NewspaperEvidence['history']>;
} {
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: 18, cutoffTurn: 20, historyFromTurn: 10 },
    players: [own, foreign],
    cities,
    comparisons: { players: [], cities: [] },
    events: events.filter(item => item.source.turn > 18),
    history: {
      fromTurn: 10,
      baseline: { players: [own, foreign], cities: [] },
      snapshots: { players: [], cities: [] },
      gaps: [],
      events,
    },
  };
}

/** Compile controlled rules in order, retaining the production QuickJS boundary. */
function compile(sources: string[], shortcuts?: EditorialShortcutDefinitions) {
  return compileEditorialExpressions(sources.map((source, index) => ({
    rule: 'fact-runtime', field: `when[${index}]`, source,
  })), { shortcuts });
}

describe('newspaper fact runtime', () => {
  describe('shortcuts', () => {
    it('should bind each shortcut to its city, owner or list entry and cite the facts read', async () => {
      const home = city(1, 20, 11, { IsCapital: true });
      const away = city(2, 20, 12, { OwnerID: 1, X: 8 });
      const runner = await compile([
        'city.is.neighbor && city.owner.is.rival',
        'cities.some(c => c.is.neighbor) && self.capital.is.frontier',
        'city.is.neighbor = false',
      ], {
        city: {
          inRange: 'city.distance.own <= neighboring',
          neighbor: 'city.foreign && city.is.inRange',
          frontier: 'city.own && cities.some(c => c.is.neighbor && distance(city, c) <= neighboring)',
        },
        player: { rival: '!player.self' },
      });
      const facts = buildNewspaperFacts(evidence([home, away]), identity);
      const groups = [{ expressions: [0, 1, 2], subjects: [{ city: reference('city', 2), neighboring: 1 }] }];
      const [[[neighbor, frontier, mutation]]] = await runner.evaluate({ facts, constants: { neighboring: 8 }, groups });
      expect(neighbor).toEqual({ value: true, sources: [away.source, home.source, foreign.source] });
      expect(frontier).toEqual({ value: true, sources: [home.source, away.source] });
      expect(mutation).toHaveProperty('error.source');
      const [[[outside, noFrontier]]] = await runner.evaluate({ facts, constants: { neighboring: 7 }, groups });
      expect(outside).toEqual({ value: false, sources: [away.source, home.source] });
      expect(noFrontier).toHaveProperty('value', false);
    });

    it('should read the correct historical view and keep a shortcut hidden when its input is hidden', async () => {
      const previous = city(1, 18, 11, { FoodStored: 8 });
      const current = city(1, 20, 12, { FoodStored: 11 });
      const input = evidence([current]);
      input.history.snapshots.cities.push(previous, current);
      const runner = await compile([
        '!city.is.starving && city.previous.is.starving && city.history.some(c => c.is.starving)',
        '(() => { try { return city.is.unreadable; } catch { return true; } })()',
        '!city.is.knows("unreadable") && !city.is.knows("undefinedShortcut")',
        'city.previous.is.knows("starving")',
        'city.is.undefinedShortcut',
      ], {
        city: {
          starving: 'city.foodPerTurn < 0 && city.foodStored < -city.foodPerTurn * recent',
          unreadable: 'city.id > 0 && city.currentProduction',
        },
      });
      const [[[history, hidden, guarded, known, undeclared]]] = await runner.evaluate({
        facts: buildNewspaperFacts(input),
        constants: { recent: 5 },
        groups: [{ windowFromTurn: 17, expressions: [0, 1, 2, 3, 4], subjects: [{ city: reference('city', 1) }] }],
      });
      expect(history).toEqual({ value: true, sources: [current.source, previous.source] });
      expect(hidden).toMatchObject({ error: { hidden: 'city.currentProduction' }, sources: [current.source] });
      expect(guarded).toEqual({ value: true });
      expect(known).toEqual({ value: true, sources: [previous.source] });
      expect(undeclared).toHaveProperty('error.hidden', 'city.is.undefinedShortcut');
    });

    it('should respect the group window when a shortcut reads dated event lists', async () => {
      const current = city(1, 20, 11);
      const trained: NewspaperEvent = {
        ...event(22, 17),
        type: 'CityTrained',
        values: { PlayerID: 0, CityID: 1, CityX: 0, CityY: 0, Unit: 'Pioneer' },
      };
      const input = evidence([current], [trained]);
      input.history.baseline.cities.push(city(1, 10, 10));
      const runner = await compile([
        'city.is.sentSettler && events.some(e => e.is.settlerTrained)',
        'city.events.some(e => e.is.settlerTrained)',
      ], {
        city: { sentSettler: 'city.trained.some(t => settlers.includes(t.unit))' },
        event: { settlerTrained: 'event.type === "CityTrained" && settlers.includes(event.unit)' },
      });
      const group = { expressions: [0, 1], subjects: [{ city: reference('city', 1) }] };
      const [[wide], [narrow]] = await runner.evaluate({
        facts: buildNewspaperFacts(input),
        constants: { settlers: ['Pioneer'] },
        groups: [{ ...group, windowFromTurn: 15 }, group],
      });
      expect(wide).toEqual(Array.from({ length: 2 }, () => ({
        value: true, sources: [current.source, trained.source],
      })));
      expect(narrow).toEqual(Array.from({ length: 2 }, () => ({ value: false, sources: [current.source] })));
    });

    it('should reject recursive shortcuts without stopping other expressions', async () => {
      const current = city(1, 20, 11);
      const runner = await compile(['city.is.first', 'city.is.healthy'], {
        city: { first: 'city.is.second', second: 'city.is.first', healthy: 'city.population > 1' },
      });
      const [[[recursion, healthy]]] = await runner.evaluate({
        facts: buildNewspaperFacts(evidence([current])),
        groups: [{ expressions: [0, 1], subjects: [{ city: reference('city', 1) }] }],
      });
      expect(recursion).toHaveProperty('error.message', expect.stringContaining('city.is.first'));
      expect(healthy).toEqual({ value: true, sources: [current.source] });
    });
  });

  describe('dated observations', () => {
    it('should distinguish trigger windows from the previous check and cite the values and memberships read', async () => {
      const baseline = city(1, 8, 18, { Population: 4, MajorityReligion: 'Buddhism', Wonders: ['Petra'] });
      const middle = city(1, 14, 19, { Population: 7, MajorityReligion: 'Buddhism', Wonders: ['Petra'] });
      const current = city(1, 20, 20, { Population: 10, MajorityReligion: null, Wonders: ['Petra'] });
      const early = event(21, 14);
      const later = event(22, 20);
      const input = evidence([current], [early, later]);
      input.history.baseline.cities.push(baseline);
      input.history.snapshots.cities.push(middle, current);
      const facts = buildNewspaperFacts(input, identity, { longTurns: 8 });
      expect(facts.subjects.event).toEqual([later.source.id]);
      const runner = await compile([
        'city.population - city.before.population',
        'city.previous.population',
        'city.at(5).population',
        'city.history.map(s => s.population).join(",")',
        'events.length',
        'city.events.length',
        'held(city, s => s.foodPerTurn === -2, 4)',
        'crossed(city.population, city.before.population, 10)',
        'dropped(city.previous.population, city.population, 9)',
        'pct(city.population, city.before.population)',
        'changed(city, "majorityReligion") && !changed(city, "wonders")',
        'city.at(9).id',
      ]);
      const subjects = [{ city: reference('city', 1) }];
      const [[[growth, previous, at, history, events, cityEvents, held, crossed, dropped, pct, changed, capped]],
        [[defaultGrowth, defaultHistory, defaultEvents]]] = await runner.evaluate({
        facts,
        groups: [
          { windowFromTurn: 13, expressions: Array.from({ length: 12 }, (_, i) => i), subjects },
          { expressions: [0, 3, 4], subjects },
        ],
      });
      expect(growth).toEqual({ value: 6, sources: [current.source, baseline.source] });
      expect(previous).toEqual({ value: 7, sources: [middle.source] });
      expect(at).toEqual(previous);
      expect(history).toEqual({ value: '7,10', sources: [middle.source, current.source] });
      expect(events).toEqual({ value: 2, sources: [early.source, later.source] });
      expect(cityEvents).toEqual({ value: 2, sources: [current.source, early.source, later.source] });
      expect(held).toEqual({ value: true, sources: [middle.source, current.source] });
      expect(crossed).toHaveProperty('value', true);
      expect(dropped).toHaveProperty('value', true);
      expect(pct).toHaveProperty('value', 1.5);
      expect(changed).toHaveProperty('value', true);
      expect(capped).toHaveProperty('error.hidden', 'city.at');
      expect(defaultGrowth).toEqual({ value: 3, sources: [current.source, middle.source] });
      expect(defaultHistory).toEqual({ value: '10', sources: [current.source] });
      expect(defaultEvents).toEqual({ value: 1, sources: [later.source] });
    });

    it('should stop carrying a city through gaps and keep reused IDs separate', async () => {
      const baseline = city(1, 10, 11);
      const reacquired = city(1, 17, 12, { Population: 11 });
      const firstPlot = city(2, 10, 21);
      const reused = city(2, 16, 22, { X: 7, Population: 1 });
      const newCity = city(3, 16, 31, { X: 2 });
      const input = evidence([reacquired, reused, newCity]);
      input.history.baseline.cities.push(baseline, firstPlot);
      input.history.snapshots.cities.push(reused, newCity, reacquired);
      input.history.gaps.push({ table: 'CityInformations', subjectID: 1, turn: 15 });
      const runner = await compile([
        '!city.knows("before") && !city.knows("founded")',
        'held(city, s => { throw new Error("should not call the test across a gap"); }, 7)',
        'held(city, s => s.foodPerTurn < 0, 4)',
        'city.at(5).population',
        'city.history.length',
        'city.founded',
      ]);
      const [[reappeared, recycled], [newObservation]] = await runner.evaluate({
        facts: buildNewspaperFacts(input, { ...identity, recordingStartTurn: 10 }),
        groups: [
          { windowFromTurn: 12, expressions: [0, 1, 2, 3, 4],
            subjects: [1, 2].map(id => ({ city: reference('city', id) })) },
          { windowFromTurn: 12, expressions: [5, 3], subjects: [{ city: reference('city', 3) }] },
        ],
      });
      for (const match of [reappeared, recycled]) {
        expect(match[0]).toEqual({ value: true });
        expect(match[1]).toEqual({ value: false });
        expect(match[2]).toHaveProperty('value', true);
        expect(match[3]).toHaveProperty('error.hidden', 'city.at');
        expect(match[4]).toHaveProperty('value', 1);
      }
      expect(newObservation[0]).toEqual({ value: 16, sources: [newCity.source] });
      expect(newObservation[1]).toHaveProperty('error.hidden', 'city.at');
    });

    it('should reject a group window the loaded event evidence does not cover', async () => {
      const runner = await compile(['events.length']);
      const input = evidence([]);
      const groups = [{ windowFromTurn: 9, expressions: [0], subjects: [{}] }];
      await expect(runner.evaluate({ facts: buildNewspaperFacts(input), groups })).rejects.toThrow(RangeError);
      const facts = buildNewspaperFacts({ ...input, history: undefined });
      await expect(runner.evaluate({
        facts, groups: [{ ...groups[0], windowFromTurn: 17 }],
      })).rejects.toThrow(RangeError);
      await expect(runner.evaluate({ facts, groups: [{ expressions: [0], subjects: [{}] }] })).resolves.toEqual([[[{ value: 0 }]]]);
    });

    it('should hide a held span that starts before the first covered snapshot', async () => {
      const runner = await compile([
        '!held(self, () => true, 12)',
        'held(self, () => true, 11)',
        '!held(self, () => true, 2)',
        'held(self, () => true, 1)',
      ]);
      const input = evidence([]);
      const [[loaded]] = await runner.evaluate({
        facts: buildNewspaperFacts(input),
        groups: [{ expressions: [0, 1], subjects: [{}] }],
      });
      const [[noHistory]] = await runner.evaluate({
        facts: buildNewspaperFacts({ ...input, history: undefined }),
        groups: [{ expressions: [2, 3], subjects: [{}] }],
      });
      for (const [uncovered, covered] of [loaded, noHistory]) {
        expect(uncovered).toHaveProperty('error.hidden', 'held');
        expect(covered).toEqual({ value: true, sources: [own.source] });
      }
    });

    it('should keep dated ownership when a continuously visible city changes hands', async () => {
      const original = city(1, 10, 11, { Name: 'Border Town' });
      const transferred = city(1, 16, 12, { OwnerID: 1, Name: 'Border Town' });
      const oldOther = city(2, 10, 21, { X: 2, Name: 'Old Settlement' });
      const reused = city(2, 16, 22, { X: 2, OwnerID: 1, Name: 'New Settlement' });
      const input = evidence([transferred, reused]);
      input.history.baseline.cities.push(original, oldOther);
      input.history.snapshots.cities.push(transferred, reused);
      const runner = await compile(['city.owner.id - city.before.owner.id']);
      const [[[owners], [uncertain]]] = await runner.evaluate({
        facts: buildNewspaperFacts(input, identity),
        groups: [{ windowFromTurn: 12, expressions: [0], subjects: [1, 2].map(id => ({ city: reference('city', id) })) }],
      });
      expect(owners).toEqual({ value: 1, sources: [transferred.source, foreign.source, original.source, own.source] });
      expect(uncertain).toHaveProperty('error.hidden', 'city.before');
    });
  });

  describe('public views', () => {
    it('should distinguish an unresolved relationship from an absent entry', async () => {
      const laterSelf: NewspaperSnapshot = { ...own, source: { ...own.source, id: 104, turn: 20, createdAt: 201 } };
      const third = player(3);
      const input = evidence([]);
      input.players = [laterSelf, foreign, third];
      input.history.baseline.players.push(third);
      input.history.snapshots.players.push(laterSelf);
      input.diplomacy = {
        fromTurn: 10,
        baseline: [
          { source: own.source, subjectID: 0, teamID: 0, isMajor: true,
            relationships: [{ targetPlayerID: 1, targetTeamID: 1, state: 'war', warScore: 30 }] },
          { source: foreign.source, subjectID: 1, teamID: 1, isMajor: true,
            relationships: [{ targetPlayerID: 0, targetTeamID: 0, state: 'peace' }] },
          { source: third.source, subjectID: 3, teamID: 3, isMajor: true, relationships: [] },
        ],
        history: [
          { source: laterSelf.source, subjectID: 0, teamID: 0, isMajor: true,
            relationships: [{ targetPlayerID: 1, targetTeamID: 1, state: 'unknown' }] },
        ],
        gaps: [],
      };
      const runner = await compile([
        'self.relation(1).war',
        'self.before.relation(1).war',
        'self.relation(1).knows("warScore")',
        'self.relation(3).war',
      ]);
      const [[[unknown, conflict, score, absent]]] = await runner.evaluate({
        facts: buildNewspaperFacts(input, identity),
        groups: [{ expressions: [0, 1, 2, 3], subjects: [{}] }],
      });
      expect(unknown).toMatchObject({ error: { hidden: 'player.relation.war' }, sources: [laterSelf.source] });
      expect(conflict).toMatchObject({ error: { hidden: 'player.relation.war' }, sources: [own.source, foreign.source] });
      expect(score).toEqual({ value: false });
      expect(absent).toEqual({ value: false });
    });

    it('should make null readable, stop on hidden reads, and allow sorting a local copy', async () => {
      const home = city(1, 20, 11, { Population: 9, MajorityReligion: null });
      const foreignCity = city(2, 20, 22, { OwnerID: 1, Population: 2, FoodPerTurn: undefined });
      const runner = await compile([
        '!city.knows("foodPerTurn") && city.foreign',
        '(() => { try { return city.foodPerTurn } catch { return 2 } })()',
        'self.capital.knows("population")',
        'cities[0].knows("majorityReligion") && cities[0].majorityReligion === null',
        '[...cities].sort((a, b) => a.population - b.population)[0].id',
        'cities[0].id',
        'cities.length + players.length',
        'Object.isFrozen(Object.getOwnPropertyDescriptor(cities, "0").get) && held.prototype === undefined',
      ]);
      const [[[known, hidden, unseenCapital, nil, sorted, original, count, immutable]]] = await runner.evaluate({
        facts: buildNewspaperFacts(evidence([home, foreignCity]), identity),
        groups: [{ expressions: [0, 1, 2, 3, 4, 5, 6, 7], subjects: [{ city: reference('city', 2) }] }],
      });
      expect(known).toEqual({ value: true, sources: [foreignCity.source] });
      expect(hidden).toHaveProperty('error.hidden', 'city.foodPerTurn');
      expect(unseenCapital).toHaveProperty('error.hidden', 'player.capital');
      expect(nil).toEqual({ value: true, sources: [home.source] });
      expect(sorted).toHaveProperty('value', 2);
      expect(original).toHaveProperty('value', 1);
      expect(count).toEqual({ value: 4, sources: [home.source, foreignCity.source, own.source, foreign.source] });
      expect(immutable).toEqual({ value: true });
    });

    it('should use private wrap geometry consistently for cities, players, plots and events', async () => {
      const home = city(1, 20, 11, { IsCapital: true });
      const foreignCity = city(2, 20, 22, { OwnerID: 1, X: 9 });
      const located = event(36, 20, 0, 7);
      const input = evidence([home, foreignCity], [located]);
      const metadata = { ...identity, gameSpeed: 'Epic', mapSize: 'Standard', mapWidth: '10',
        mapHeight: '8', mapWrapX: 'true', mapWrapY: true };
      const facts = buildNewspaperFacts(input, metadata);
      const runner = await compile([
        'city.distance.own + city.distance.capital',
        'city.nearestOwn === self.capital && city.owner.distance === city.distance.own',
        'event.distance.own + distance(event, self.capital)',
        'distance({ x: 0, y: 0 }, { x: 1, y: 1 })',
        'Object.keys(game).sort().join(",")',
        'game.mapWidth',
      ]);
      const batch = {
        groups: [{ expressions: [0, 1, 2, 3, 4, 5], subjects: [{ city: reference('city', 2), event: reference('event', 36) }] }],
      };
      const [[[distances, nearest, byEvent, diagonal, settings, privateField]]] = await runner.evaluate({ ...batch, facts });
      expect(distances).toEqual({ value: 2, sources: [foreignCity.source, home.source] });
      expect(nearest).toHaveProperty('value', true);
      expect(byEvent).toEqual({ value: 2, sources: [located.source, home.source] });
      expect(diagonal).toEqual({ value: 2 });
      expect(settings).toEqual({ value: 'mapSize,speed,speedMultiplier' });
      expect(privateField).toHaveProperty('error.hidden', 'game.mapWidth');
      expect(JSON.stringify(facts)).not.toContain('mapWidth');
      expect(JSON.stringify(facts)).not.toContain('mapWrapY');

      const invalid = buildNewspaperFacts(input, { ...metadata, mapWidth: 'ten' });
      const [[[unwrappedCities, , unwrappedEvent]]] = await runner.evaluate({ ...batch, facts: invalid });
      expect(unwrappedCities).toHaveProperty('value', 18);
      expect(unwrappedEvent).toHaveProperty('value', 14);
    });
  });
});
