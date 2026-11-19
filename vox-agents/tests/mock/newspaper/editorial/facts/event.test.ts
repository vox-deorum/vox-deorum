import { describe, expect, it } from 'vitest';
import type {
  NewspaperEvent, NewspaperEvidence, NewspaperSnapshot,
} from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { reference, type FactMetadata } from '../../../../../src/newspaper/editorial/facts/model.js';

/** Record a visible player observation at a contact date. */
function player(id: number, turn = 0): NewspaperSnapshot {
  return { subjectID: id, source: { table: 'PlayerSummaries', id: id + 1, turn, createdAt: 10 * turn }, values: {} };
}

/** Record a permitted event after the reporting period, in its own insertion order. */
function event(id: number, turn: number, type: string, values: NewspaperEvent['values']): NewspaperEvent {
  return { source: { table: 'GameEvents', id, turn, createdAt: 10 * turn + 8 }, type, values };
}

/** Build one cutoff fact model with reporting period (5, 10] and history from turn zero. */
function facts(
  events: NewspaperEvent[],
  players: NewspaperSnapshot[],
  identities: FactMetadata['playerIdentities'],
): ReturnType<typeof buildNewspaperFacts> {
  const evidence: NewspaperEvidence = {
    request: { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10, historyFromTurn: 0 },
    players,
    cities: [],
    events: events.filter(row => row.source.turn > 5),
    comparisons: { players: [], cities: [] },
    history: {
      fromTurn: 0,
      baseline: { players: [], cities: [] },
      snapshots: { players, cities: [] },
      gaps: [],
      events,
    },
  };
  return buildNewspaperFacts(evidence, { playerIdentities: identities });
}

describe('newspaper event facts', () => {
  describe('projected names', () => {
    it('should expose technology, policy, branch, and religion names under camel-case keys', () => {
      const tech = event(100, 8, 'TeamTechResearched', { TeamID: 4, Tech: 'Writing', ChangeAmount: 1 });
      const policy = event(101, 8, 'PlayerAdoptPolicy', { PlayerID: 0, Policy: 'Liberty' });
      const branch = event(102, 8, 'PlayerAdoptPolicyBranch', { PlayerID: 0, Branch: 'Liberty' });
      const switched = event(103, 8, 'IdeologySwitched', { PlayerID: 0, OldBranch: 'Freedom', NewBranch: 'Order' });
      const religion = event(104, 8, 'CityConvertsReligion', { OwnerID: 0, CityX: 1, CityY: 2, Religion: 'Taoism' });
      const model = facts([tech, policy, branch, switched, religion], [player(0)], { 0: { teamId: 4 } });
      const rows = model.events.map(row => row.fields);

      expect(rows[0]).toMatchObject({ teamId: { value: 4 }, tech: { value: 'Writing' }, changeAmount: { value: 1 } });
      expect(rows[1]).toMatchObject({ policy: { value: 'Liberty' }, player: { value: { kind: 'player', id: 0 } } });
      expect(rows[2]).toMatchObject({ branch: { value: 'Liberty' } });
      expect(rows[3]).toMatchObject({ oldBranch: { value: 'Freedom' }, newBranch: { value: 'Order' } });
      expect(rows[4]).toMatchObject({ religion: { value: 'Taoism' } });
      for (const row of rows) {
        for (const raw of ['techId', 'policyId', 'branchType', 'oldBranchType', 'newBranchType', 'religionId']) {
          expect(row).not.toHaveProperty(raw);
        }
      }
    });
  });

  describe('team ownership', () => {
    it('should link the single member known at the event date and leave a later contact out', () => {
      const team = event(100, 8, 'TeamSetEra', { TeamID: 4, NewEra: 2 });
      const model = facts([team], [player(0), player(1), player(5, 9)], {
        0: { teamId: 4 }, 1: { teamId: 5 }, 5: { teamId: 4 },
      });
      const fields = model.events[0].fields;

      expect(fields.players).toEqual({
        value: [reference('player', 0)], sources: [team.source, player(0).source],
      });
      expect(fields.player).toEqual({ value: reference('player', 0), sources: [team.source, player(0).source] });
    });

    it('should list every known member of a team without choosing an acting player', () => {
      const team = event(100, 8, 'TeamSetEra', { TeamID: 5, NewEra: 2 });
      const model = facts([team], [player(0), player(1), player(4)], {
        0: { teamId: 4 }, 1: { teamId: 5 }, 4: { teamId: 5 },
      });
      const fields = model.events[0].fields;

      expect(fields.players).toEqual({
        value: [reference('player', 1), reference('player', 4)],
        sources: [team.source, player(1).source, player(4).source],
      });
      expect(fields).not.toHaveProperty('player');
    });

    it('should leave an unknown team without linked players', () => {
      const team = event(100, 8, 'TeamSetEra', { TeamID: 9, NewEra: 2 });
      const model = facts([team], [player(0), player(1)], { 0: { teamId: 4 }, 1: { teamId: 5 } });
      const fields = model.events[0].fields;

      expect(fields).toMatchObject({ teamId: { value: 9 } });
      expect(fields).not.toHaveProperty('players');
      expect(fields).not.toHaveProperty('player');
    });

    it('should keep the acting player for diplomatic events with separately named team roles', () => {
      const war = event(100, 8, 'DeclareWar', { OriginatingPlayerID: 0, TargetTeamID: 5, IsAggressor: true });
      const model = facts([war], [player(0), player(1)], { 0: { teamId: 4 }, 1: { teamId: 5 } });
      const fields = model.events[0].fields;

      expect(fields.player).toMatchObject({ value: { kind: 'player', id: 0 } });
      expect(fields).not.toHaveProperty('players');
    });
  });

  describe('great people', () => {
    it('should keep a recorded great person name and mark a birth', () => {
      const birth = event(100, 8, 'UnitCreated', { PlayerID: 1, Person: 'Ptolemy' });
      const fields = facts([birth], [player(0), player(1)], {
        0: { teamId: 4 }, 1: { teamId: 5 },
      }).events[0].fields;

      expect(fields.person).toEqual({ value: 'Ptolemy', sources: [birth.source] });
      expect(fields.kind).toEqual({ value: 'born', sources: [birth.source] });
      expect(fields.player).toMatchObject({ value: reference('player', 1) });
    });

    it('should leave an ordinary unit creation without a person or kind', () => {
      const creation = event(100, 8, 'UnitCreated', { PlayerID: 1, Unit: 'Warrior' });
      const fields = facts([creation], [player(0), player(1)], {
        0: { teamId: 4 }, 1: { teamId: 5 },
      }).events[0].fields;

      expect(fields).not.toHaveProperty('person');
      expect(fields).not.toHaveProperty('kind');
    });

    it('should drop a blank recorded name instead of reporting a named event', () => {
      const creation = event(100, 8, 'UnitCreated', { PlayerID: 1, Person: '   ' });
      const fields = facts([creation], [player(0), player(1)], {
        0: { teamId: 4 }, 1: { teamId: 5 },
      }).events[0].fields;

      expect(fields).not.toHaveProperty('person');
      expect(fields).not.toHaveProperty('kind');
    });

    it('should mark a named expenditure', () => {
      const spent = event(100, 8, 'GreatPersonExpended', { PlayerID: 1, Person: 'Ptolemy' });
      const fields = facts([spent], [player(0), player(1)], {
        0: { teamId: 4 }, 1: { teamId: 5 },
      }).events[0].fields;

      expect(fields.person).toEqual({ value: 'Ptolemy', sources: [spent.source] });
      expect(fields.kind).toEqual({ value: 'expended', sources: [spent.source] });
    });

    it('should mark a named death and use the dying unit owner as the acting subject', () => {
      const death = event(100, 8, 'UnitPrekill', { OwnerID: 1, AttackingPlayerID: 2, Person: 'Ptolemy' });
      const fields = facts([death], [player(0), player(1), player(2)], {
        0: { teamId: 4 }, 1: { teamId: 5 }, 2: { teamId: 6 },
      }).events[0].fields;

      expect(fields.person).toEqual({ value: 'Ptolemy', sources: [death.source] });
      expect(fields.kind).toEqual({ value: 'died', sources: [death.source] });
      expect(fields.player).toEqual({
        value: reference('player', 1), sources: [death.source, player(1).source],
      });
      expect(fields.attackingPlayer).toMatchObject({ value: reference('player', 2) });
    });

    it('should leave the no-attacker sentinel without a linked attacker', () => {
      const death = event(100, 8, 'UnitPrekill', { OwnerID: 1, AttackingPlayerID: -1, Person: 'Ptolemy' });
      const fields = facts([death], [player(0), player(1)], {
        0: { teamId: 4 }, 1: { teamId: 5 },
      }).events[0].fields;

      expect(fields.player).toEqual({
        value: reference('player', 1), sources: [death.source, player(1).source],
      });
      expect(fields).not.toHaveProperty('attackingPlayer');
    });
  });
});
