import { describe, expect, it } from 'vitest';
import type {
  NewspaperDiplomacySnapshot, NewspaperEvent, NewspaperEvidence, NewspaperSnapshot
} from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { distanceContext } from '../../../../../src/newspaper/editorial/facts/distance.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { reference, type FactBuildContext, type FactWindow } from '../../../../../src/newspaper/editorial/facts/model.js';
import { buildPlayerFacts, buildPlayerSnapshotFacts } from '../../../../../src/newspaper/editorial/facts/player.js';
import { buildTimeline, observedAt, rowsAt } from '../../../../../src/newspaper/editorial/facts/timeline.js';
import { compileEditorialExpressions } from '../../../../../src/newspaper/editorial/shared/expressions.js';

/** Record a readable national or city observation with its own provenance. */
function snapshot(subjectID: number, id: number, turn: number, values: NewspaperSnapshot['values'],
  table: NewspaperSnapshot['source']['table'] = 'PlayerSummaries'): NewspaperSnapshot {
  return { subjectID, source: { table, id, turn, createdAt: turn }, values };
}

/** Record a public diplomatic observation alongside its national row. */
function diplomatic(row: NewspaperSnapshot, isMajor: boolean, relationships: NewspaperDiplomacySnapshot['relationships'],
  majorAllyPlayerID?: number | null): NewspaperDiplomacySnapshot {
  return { source: row.source, subjectID: row.subjectID, teamID: row.subjectID + 4, isMajor, relationships, majorAllyPlayerID };
}

/** Record an already permitted event from the evidence query. */
function event(id: number, turn: number, type: string, values: NewspaperEvent['values']): NewspaperEvent {
  return { source: { table: 'GameEvents', id, turn, createdAt: turn }, type, values };
}

const own = snapshot(0, 10, 2, { Score: 100, SciencePerTurn: 17, FoundedReligion: null, Technologies: 13 });
const rival = snapshot(1, 11, 3, { Technologies: 12 });
const minor = snapshot(22, 12, 5, { Population: 4, Resources: { Silver: 2 }, Technologies: 100 });
const latestRival = snapshot(1, 13, 6, {
  Technologies: 15,
  Relationships: { Egypt: ['War (Our Score: 42%; Our War Weariness: 10%)'] },
});
const ownCity = snapshot(100, 20, 3, { OwnerID: 0, X: 1, Y: 2, IsCapital: 1 }, 'CityInformations');
const rivalCity = snapshot(200, 21, 4, { OwnerID: 1, X: 4, Y: 2, IsCapital: true }, 'CityInformations');
const disputedCity = snapshot(201, 22, 5, { X: 2, Y: 2, IsCapital: true }, 'CityInformations');
const namesRivalTeam = event(100, 6, 'TeamSetEra', { TeamID: 5 });
const namesMinorBeforeContact = event(101, 4, 'SetAlly', { MinorPlayerID: 22, NewAllyPlayerID: 0 });
const namesMinorAfterContact = event(102, 5, 'SetAlly', { MinorPlayerID: 22, NewAllyPlayerID: 0 });

/** Make dated cutoff and historical player contexts from permitted rows only. */
function context(turn: number, changes: Partial<NewspaperEvidence> = {}): FactBuildContext {
  const evidence: NewspaperEvidence = {
    request: { receiverPlayerID: 0, previousCheckTurn: 4, cutoffTurn: 6, historyFromTurn: 1 },
    players: [own, latestRival, minor],
    cities: [ownCity, rivalCity, disputedCity],
    events: [namesMinorAfterContact, namesRivalTeam],
    comparisons: { players: [], cities: [] },
    history: {
      fromTurn: 1,
      baseline: { players: [], cities: [] },
      snapshots: { players: [own, rival, minor, latestRival], cities: [ownCity, rivalCity, disputedCity] },
      gaps: [],
      events: [namesMinorBeforeContact, namesMinorAfterContact, namesRivalTeam],
    },
    diplomacy: {
      fromTurn: 2,
      baseline: [],
      history: [
        diplomatic(own, true, []),
        diplomatic(rival, true, [{ targetPlayerID: 0, targetTeamID: 4, state: 'war', warScore: 42, master: 'voluntary' }]),
        diplomatic(minor, false, [{ targetPlayerID: 0, targetTeamID: 4, state: 'peace', ally: true }], 0),
        diplomatic(latestRival, true, [{ targetPlayerID: 0, targetTeamID: 4, state: 'peace', defensivePact: true }]),
      ],
      gaps: [],
    },
    ...changes,
  };
  const events = evidence.history?.events ?? [];
  const playerTimeline = buildTimeline(evidence, 'players', events);
  const cityTimeline = buildTimeline(evidence, 'cities', events);
  const players = rowsAt(playerTimeline, turn);
  const cities = rowsAt(cityTimeline, turn);
  return {
    evidence, turn, receiverId: 0, players, cities, events: events.filter(record => record.source.turn <= turn),
    ideologies: ['Order', 'Freedom', 'Autocracy'],
    metadata: { playerIdentities: {
      0: { name: 'Egypt', leader: 'Ramesses', major: true, human: true, teamId: 4 },
      1: { name: 'The Netherlands', leader: 'William', major: true, human: false, teamId: 5 },
      22: { name: 'Geneva', leader: 'Geneva', major: false, human: false, teamId: 26 },
      23: { name: 'Unmet City-State', major: false, teamId: 27 },
    } },
    firstCityTurn: () => undefined,
    cityHistory: () => [],
    playerAt: (id, at) => observedAt(playerTimeline, id, at),
    ...distanceContext(cities, 0, { x: 0, y: 0 })
  };
}

describe('newspaper player facts', () => {
  describe('identity and readable fields', () => {
    it('should include a known city-state from its first observation without treating it as a major', () => {
      const at = context(5);
      expect(at.playerAt(22, 4)).toBeUndefined();
      expect(at.playerAt(23, 5)).toBeUndefined();
      const facts = buildPlayerFacts(minor, at);
      expect(facts).toMatchObject({
        name: { value: 'Geneva' },
        teamId: { value: 26 },
        cityState: { value: true },
        major: { value: false },
        population: { value: 4, sources: [minor.source] },
      });
      expect(facts.cities.value).toEqual([]);
      expect(facts.capital).toBeUndefined();
      expect(facts.distance).toBeUndefined();
      expect(facts.score).toBeUndefined();
    });

    it('should keep readable nulls, measured values, and foreign missing fields distinct', () => {
      const at = context(6);
      expect(buildPlayerFacts(own, at)).toMatchObject({
        leader: { value: 'Ramesses' },
        human: { value: true },
        self: { value: true },
        distance: { value: 0 },
        sciencePerTurn: { value: 17 },
        foundedReligion: { value: null }
      });
      const facts = buildPlayerFacts(latestRival, at);
      expect(facts.technologies.value).toBe(15);
      expect(facts.sciencePerTurn).toBeUndefined();
    });
  });

  describe('ideology', () => {
    /** Record a player row with the same readable values and a chosen policy-branch map. */
    function policyRow(branches: unknown, id: number, turn = 6): NewspaperSnapshot {
      return snapshot(0, id, turn, branches === undefined ? own.values : { ...own.values, PolicyBranches: branches });
    }

    it('should derive the readable ideology branch from policy-branch keys', () => {
      const row = policyRow({ Freedom: ['Constitution'] }, 14);
      expect(buildPlayerFacts(row, context(6)).ideology).toEqual({ value: 'Freedom', sources: [row.source] });
    });

    it('should record null when the player has no recorded ideology', () => {
      for (const [index, branches] of [{ Tradition: [] }, {}, [], null].entries()) {
        const row = policyRow(branches, 20 + index);
        expect(buildPlayerFacts(row, context(6)).ideology).toEqual({ value: null, sources: [row.source] });
      }
    });

    it('should omit ideology when policy data is withheld or unreadable', () => {
      for (const [index, branches] of [undefined, 'withheld'].entries()) {
        const row = policyRow(branches, 30 + index);
        expect(buildPlayerFacts(row, context(6))).not.toHaveProperty('ideology');
      }
    });

    it('should derive ideology on a dated snapshot as well as the cutoff', () => {
      const row = policyRow({ Order: ['Autocracy'] }, 40, 3);
      expect(buildPlayerSnapshotFacts(row, context(3)).ideology).toEqual({ value: 'Order', sources: [row.source] });
    });
  });

  describe('cities and events', () => {
    it('should find a dated capital and closest cities using only the asserted owner', () => {
      const facts = buildPlayerFacts(latestRival, context(6));
      expect(facts.cities.value).toEqual([expect.objectContaining({ kind: 'city', id: rivalCity.subjectID })]);
      expect(facts.capital).toEqual({
        value: expect.objectContaining({ kind: 'city', id: rivalCity.subjectID }),
        sources: [rivalCity.source],
      });
      expect(facts.distance).toEqual({ value: 3, sources: [rivalCity.source, ownCity.source] });
      expect(buildPlayerSnapshotFacts(rival, context(3)).capital).toBeUndefined();
    });

    it('should match permitted team and player events without linking pre-contact parties', () => {
      const at = context(6);
      const rivalEvents = (buildPlayerFacts(latestRival, at).events.value as FactWindow).entries;
      const minorEvents = (buildPlayerFacts(minor, at).events.value as FactWindow).entries;
      expect(rivalEvents).toEqual([{ turn: 6, field: {
        value: expect.objectContaining({ kind: 'event', id: namesRivalTeam.source.id }), sources: [namesRivalTeam.source],
      } }]);
      expect(minorEvents.map(item => item.field.sources)).toEqual([[namesMinorAfterContact.source]]);
    });
  });

  describe('public diplomacy', () => {
    it('should report known wars, pacts, and vassalage from permitted observations on either side', () => {
      const earlier = context(3);
      const facts = buildPlayerFacts(own, earlier);
      expect(facts.atWar.value).toBe(true);
      expect(facts.wars.value).toEqual([expect.objectContaining({ kind: 'player', id: rival.subjectID })]);
      expect(buildPlayerFacts(rival, earlier).vassal.value).toBe(true);

      const current = buildPlayerFacts(latestRival, context(6));
      expect(current.friend.value).toBe(false);
      expect(current.enemy.value).toBe(false);
      expect(current.atWar.value).toBe(false);
      expect(current.wars.value).toEqual([]);
      expect(current.ally.value).toBe(true);
    });

    it('should distinguish explicit city-state allies from an unavailable relationship table', () => {
      const at = context(5);
      const facts = buildPlayerFacts(minor, at);
      expect(facts.majorAlly.value).toMatchObject({ kind: 'player', id: own.subjectID });
      expect(facts.ally.value).toBe(true);

      const missing = context(6, { diplomacy: { fromTurn: 2, history: [], baseline: [], gaps: [] } });
      const unknown = buildPlayerFacts(latestRival, missing);
      expect(unknown.relationships).toBeUndefined();
      expect(unknown.atWar).toBeUndefined();
      expect(unknown.enemy).toBeUndefined();
    });

    it('should not carry a relationship across a new national row without a permitted diplomatic observation', () => {
      const evidence = context(6).evidence;
      const at = context(6, { diplomacy: {
        ...evidence.diplomacy!,
        history: evidence.diplomacy!.history.filter(row => row.source.id !== latestRival.source.id),
      } });
      const facts = buildPlayerSnapshotFacts(latestRival, at);

      expect(facts.relationships).toBeUndefined();
    });

    it.each([
      ['unknownRelationship', [{ targetPlayerID: 0, targetTeamID: 4, state: 'unknown' }]],
      ['unresolvedIdentity', []],
      ['ambiguousIdentity', []],
    ] as const)('should hide negative war facts for an incomplete %s row', (kind, entries) => {
      const evidence = context(6).evidence;
      const at = context(6, { diplomacy: {
        ...evidence.diplomacy!,
        history: [...evidence.diplomacy!.history.filter(row => row.source.id !== latestRival.source.id),
          diplomatic(latestRival, true, [...entries])],
        gaps: [{ kind, source: latestRival.source, subjectID: latestRival.subjectID }],
      } });
      const facts = buildPlayerFacts(latestRival, at);

      expect(facts.atWar).toBeUndefined();
      expect(facts.wars).toBeUndefined();
      expect(facts.enemy).toBeUndefined();
    });

    it('should still report a proved war when another party could not be resolved', () => {
      const evidence = context(6).evidence;
      const at = context(6, { diplomacy: {
        ...evidence.diplomacy!,
        history: [...evidence.diplomacy!.history.filter(row => row.source.id !== latestRival.source.id),
          diplomatic(latestRival, true, [{ targetPlayerID: 0, targetTeamID: 4, state: 'war', warScore: 25 }])],
        gaps: [{ kind: 'unresolvedIdentity', source: latestRival.source, subjectID: latestRival.subjectID }],
      } });
      const facts = buildPlayerFacts(latestRival, at);

      expect(facts.atWar.value).toBe(true);
      expect(facts.enemy.value).toBe(true);
      expect(facts.wars.value).toEqual([expect.objectContaining({ kind: 'player', id: own.subjectID })]);
    });
  });

  describe('player expressions', () => {
    it('should rank visible majors and reconcile reciprocal relations at the date of a carried snapshot', async () => {
      const at = context(6);
      const sources = [
        'player.before.relation(rival).warScore',
        'player.relation(rival).war',
        "player.before.rank('technologies')",
        "player.rank('technologies')",
        "rival.rank('sciencePerTurn')",
        "minor.knows('before')",
        '!player.before.relation(minor).war',
      ];
      const runner = await compileEditorialExpressions(sources.map((source, index) => ({
        rule: 'player-observation', field: `values.${index}`, source
      })));
      const [[[beforeWarScore, currentWar, beforeRank, currentRank, hiddenRank, minorBefore, unmetRelation]]] =
        await runner.evaluate({
          facts: buildNewspaperFacts(at.evidence, at.metadata),
          groups: [{
            expressions: sources.map((_, index) => index),
            subjects: [{ player: reference('player', 0), rival: reference('player', 1), minor: reference('player', 22) }]
          }]
        });
      expect(beforeWarScore).toEqual({ value: -42, sources: [own.source, rival.source] });
      expect(currentWar).toEqual({ value: false, sources: [latestRival.source] });
      expect(beforeRank).toEqual({ value: 1, sources: [own.source, rival.source] });
      expect(currentRank).toEqual({ value: 2, sources: [own.source, latestRival.source] });
      expect(hiddenRank).toMatchObject({ error: { hidden: 'player.rank' } });
      expect(minorBefore).toEqual({ value: false });
      expect(unmetRelation).toMatchObject({ error: { hidden: 'player.relation' }, sources: [own.source] });
    });

    it('should keep an unrecorded pair distinct from a conflicting war observation', async () => {
      const evidence = context(6).evidence;
      const latestOwn = snapshot(0, 14, 6, own.values);
      const at = context(6, {
        players: [latestOwn, latestRival, minor],
        history: {
          ...evidence.history!,
          snapshots: { players: [...evidence.history!.snapshots.players, latestOwn], cities: evidence.history!.snapshots.cities }
        },
        diplomacy: {
          ...evidence.diplomacy!,
          history: [...evidence.diplomacy!.history,
            diplomatic(latestOwn, true, [{ targetPlayerID: 1, targetTeamID: 5, state: 'war', warScore: 25 }])],
        }
      });
      const expressions = [
        'rival.enemy', 'rival.atWar', 'rival.wars.length',
        'rival.relation(self).war', 'rival.relation(self).warScore', 'rival.relation(minor).war'
      ];
      const runner = await compileEditorialExpressions(expressions.map(source => ({ rule: 'conflict', field: 'values.war', source })));
      const [[results]] = await runner.evaluate({
        facts: buildNewspaperFacts(at.evidence, at.metadata),
        groups: [{ subjects: [{ rival: reference('player', 1), minor: reference('player', 22) }],
          expressions: [0, 1, 2, 3, 4, 5] }],
      });

      expect(results.slice(0, 5)).toEqual(['player.enemy', 'player.atWar', 'player.wars', 'player.relation.war', 'player.relation.warScore']
        .map(hidden => expect.objectContaining({ error: expect.objectContaining({ hidden }) })));
      expect(results[5]).toEqual({ value: false });
    });

    it('should hide a pair that could have been omitted by an unresolved row', async () => {
      const evidence = context(6).evidence;
      const at = context(6, { diplomacy: {
        ...evidence.diplomacy!,
        gaps: [{ kind: 'unresolvedIdentity', source: latestRival.source, subjectID: latestRival.subjectID }],
      } });
      const runner = await compileEditorialExpressions([
        { rule: 'unresolved', field: 'values.war', source: 'rival.relation(minor).war' },
        { rule: 'unresolved', field: 'values.peace', source: 'rival.relation(self).war' },
      ]);
      const [[results]] = await runner.evaluate({
        facts: buildNewspaperFacts(at.evidence, at.metadata),
        groups: [{ subjects: [{ rival: reference('player', 1), minor: reference('player', 22) }], expressions: [0, 1] }],
      });

      expect(results[0]).toMatchObject({ error: { hidden: 'player.relation.war' } });
      expect(results[1]).toEqual({ value: false, sources: [latestRival.source] });
    });
  });
});
