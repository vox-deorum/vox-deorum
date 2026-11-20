import { beforeAll, describe, expect, it } from 'vitest';
import type {
  NewspaperCulturalInfluenceObservation, NewspaperEvidence, NewspaperSnapshot,
} from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import type { TriggerRuleAudit } from '../../../../../src/newspaper/contracts/triggers.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildCulturalInfluenceChanges } from '../../../../../src/newspaper/editorial/facts/cultural-influence.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import type { FactField, FactObject } from '../../../../../src/newspaper/editorial/facts/model.js';
import { context } from '../../../../helpers/newspaper-diplomacy.js';

type Observation = NewspaperCulturalInfluenceObservation;
type Reading = Observation['readings'][number];

const cutoff = 10;
const previous = 5;
const ruleIds = [
  'cultural-influence-becomes-influential-incoming',
  'cultural-influence-becomes-influential-outgoing',
  'cultural-influence-trend-turns-incoming',
  'cultural-influence-trend-turns-outgoing',
];

const playerIdentities = Object.fromEntries(Object.entries(context.playerNames!).map(([id, name]) => [
  id, { name, major: Number(id) < 10, teamId: Number(id) + 100 },
]));

let config: EditorialConfig;

/** Record a dated player snapshot whose identity can match a diplomacy observation. */
function playerRow(id: number, turn: number): NewspaperSnapshot {
  return { subjectID: id, values: {}, source: { table: 'PlayerSummaries', id: turn * 100 + id, turn, createdAt: turn * 1000 } };
}

/** Record one directional influence reading with only the fields the Lua format supplies. */
function reading(
  otherPlayerID: number,
  direction: Reading['direction'],
  level: Reading['level'],
  percentage: number,
  trend?: Reading['trend'],
  tourismCultureRatio?: number,
  turnsToInfluential?: number
): Reading {
  return {
    otherPlayerID, direction, level, percentage,
    ...(trend === undefined ? {} : { trend }),
    ...(tourismCultureRatio === undefined ? {} : { tourismCultureRatio }),
    ...(turnsToInfluential === undefined ? {} : { turnsToInfluential }),
  };
}

/** Record one public cultural observation from a victory-progress row. */
function observation(turn: number, id: number, readings: Reading[]): Observation {
  return { source: { table: 'VictoryProgress', id, turn, createdAt: turn * 1000 + id }, readings };
}

/** Build evidence with explicit cutoff, prior window, and cultural observations. */
function evidenceWith(
  culturalInfluence?: NewspaperEvidence['culturalInfluence'],
  playerIds: number[] = [0, 1]
): NewspaperEvidence {
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: previous, cutoffTurn: cutoff, historyFromTurn: -1 },
    players: playerIds.map(id => playerRow(id, cutoff)),
    cities: [], comparisons: { players: [], cities: [] }, events: [],
    ...(culturalInfluence ? { culturalInfluence } : {}),
  };
}

/** Read the helper's change list, treating a hidden field as no changes. */
function changes(field: FactField | undefined): readonly FactObject[] {
  return field ? field.value as readonly FactObject[] : [];
}

/** Run the four stock cultural rules and return the trigger audit. */
async function check(evidence: NewspaperEvidence): Promise<TriggerRuleAudit[]> {
  const facts = buildNewspaperFacts(evidence, { playerIdentities },
    { ideologies: config.constants.types.ideologies });
  const result = await runEditorialCheck({
    campaignId: 'fixture', timelineId: 'cultural-influence', receiver: { playerId: 0, label: 'France' },
    evidence, facts, config, speedMultiplier: 1, state: createInitialPublicationState(), context,
  });
  return result.decision.triggerAudit;
}

/** Select one rule's audit record. */
function rule(audit: readonly TriggerRuleAudit[], id: string): TriggerRuleAudit {
  const entry = audit.find(candidate => candidate.rule === id);
  if (!entry) throw new Error(`Missing audit for ${id}.`);
  return entry;
}

/** Read the subjects that fired for one rule. */
function firedSubjects(record: TriggerRuleAudit) {
  return record.subjects.filter(subject => subject.outcome === 'fired');
}

/** Read one named value from an audit subject. */
function subjectValue(record: TriggerRuleAudit['subjects'][number], name: string) {
  const expression = record.expressions.find(entry => entry.field === `values.${name}`);
  if (!expression) throw new Error(`Missing value ${name}.`);
  return expression.value;
}

describe('cultural influence facts', () => {
  beforeAll(async () => {
    const stock = await loadEditorialConfig();
    config = {
      ...stock,
      triggers: stock.triggers.filter(candidate => ruleIds.includes(candidate.id)),
      templates: [],
    };
  });

  describe('change list', () => {
    it('should require an earlier baseline observation', () => {
      const later = observation(10, 101, [reading(1, 'outgoing', 'Influential', 100, 'Rising', 8)]);
      expect(buildCulturalInfluenceChanges(evidenceWith({ observations: [later] }), 1)).toBeUndefined();
      expect(buildCulturalInfluenceChanges(evidenceWith({
        baseline: observation(6, 100, [reading(1, 'outgoing', 'Popular', 75, 'Rising', 5)]),
        observations: [later],
      }), 1)).toBeUndefined();
    });

    it('should ignore percentage movement and a continuing trend', () => {
      const percentage = evidenceWith({
        baseline: observation(5, 100, [reading(1, 'outgoing', 'Popular', 75, 'Static', 5)]),
        observations: [observation(10, 101, [reading(1, 'outgoing', 'Popular', 90, 'Static', 9)])],
      });
      expect(buildCulturalInfluenceChanges(percentage, 1)).toBeUndefined();

      const continuing = evidenceWith({
        baseline: observation(5, 100, [reading(1, 'outgoing', 'Popular', 75, 'Rising', 5)]),
        observations: [observation(10, 101, [reading(1, 'outgoing', 'Popular', 90, 'Rising', 9)])],
      });
      expect(buildCulturalInfluenceChanges(continuing, 1)).toBeUndefined();
    });

    it('should emit each direction with the rows and scalars a rule reads', () => {
      const evidence = evidenceWith({
        baseline: observation(5, 100, [
          reading(1, 'outgoing', 'Popular', 75, 'Static', 5),
          reading(1, 'incoming', 'Popular', 60, 'Falling', -2),
        ]),
        observations: [observation(10, 101, [
          reading(1, 'outgoing', 'Influential', 100, 'Rising', 8, 3),
          reading(1, 'incoming', 'Popular', 65, 'Static', 1),
        ])],
      });
      const [outgoing, incoming] = changes(buildCulturalInfluenceChanges(evidence, 1));
      expect(outgoing).toBeDefined();
      expect(incoming).toBeDefined();
      expect(outgoing).toMatchObject({
        rival: { value: { $kind: 'reference', kind: 'player', id: 1 } },
        direction: { value: 'outgoing' },
        level: { value: 'Influential' },
        previousLevel: { value: 'Popular' },
        percentage: { value: 100 },
        previousPercentage: { value: 75 },
        trend: { value: 'Rising' },
        previousTrend: { value: 'Static' },
        tourismCultureRatio: { value: 8 },
        turnsToInfluential: { value: 3 },
        observedTurn: { value: 10 },
        previousTurn: { value: 5 },
        levelChanged: { value: true },
        trendChanged: { value: true },
        reachedInfluential: { value: true },
      });
      expect(outgoing!.percentage.sources?.map(source => source.turn)).toEqual([5, 10]);
      expect(incoming).toMatchObject({
        direction: { value: 'incoming' },
        levelChanged: { value: false },
        trendChanged: { value: true },
        reachedInfluential: { value: false },
      });
    });

    it('should treat a missing direction as a break instead of comparing across it', () => {
      const evidence = evidenceWith({
        baseline: observation(5, 100, [reading(1, 'outgoing', 'Popular', 75, 'Rising', 5)]),
        observations: [
          observation(7, 101, [reading(1, 'incoming', 'Popular', 50, 'Static', 0)]),
          observation(9, 102, [reading(1, 'outgoing', 'Influential', 100, 'Rising', 6)]),
        ],
      });
      expect(buildCulturalInfluenceChanges(evidence, 1)).toBeUndefined();
    });

    it('should not treat a fall from Dominant as reaching Influential', () => {
      const evidence = evidenceWith({
        baseline: observation(5, 100, [reading(1, 'outgoing', 'Dominant', 200, 'Static', 10)]),
        observations: [observation(10, 101, [reading(1, 'outgoing', 'Influential', 150, 'Static', 8)])],
      });
      const [change] = changes(buildCulturalInfluenceChanges(evidence, 1));
      expect(change).toMatchObject({
        levelChanged: { value: true },
        reachedInfluential: { value: false },
      });
    });
  });

  describe('stock culture rules', () => {
    it('should evaluate every new rule without non-hidden errors on an empty window', async () => {
      const audit = await check(evidenceWith(undefined, [0, 1]));
      expect(audit.map(entry => entry.rule)).toEqual(expect.arrayContaining(ruleIds));
      for (const id of ruleIds) {
        const record = rule(audit, id);
        expect(record.subjects.every(subject => subject.outcome !== 'error')).toBe(true);
      }
    });

    it('should report reaching Influential in each direction separately', async () => {
      const base = [
        reading(1, 'outgoing', 'Popular', 75, 'Static', 5),
        reading(1, 'incoming', 'Popular', 70, 'Static', 4),
      ];
      const outgoingAudit = await check(evidenceWith({
        baseline: observation(5, 100, base),
        observations: [observation(10, 101, [
          reading(1, 'outgoing', 'Influential', 100, 'Static', 9),
          reading(1, 'incoming', 'Popular', 72, 'Static', 4),
        ])],
      }, [0, 1, 2]));
      const outgoing = firedSubjects(rule(outgoingAudit, 'cultural-influence-becomes-influential-outgoing'));
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0]).toMatchObject({ subject: 'player/1', importance: 75 });
      expect(subjectValue(outgoing[0], 'rival')).toBe('Brazil');
      expect(subjectValue(outgoing[0], 'direction')).toBe('outgoing');
      expect(subjectValue(outgoing[0], 'level')).toBe('Influential');
      expect(subjectValue(outgoing[0], 'previousLevel')).toBe('Popular');
      expect(subjectValue(outgoing[0], 'percentage')).toBe(100);
      expect(subjectValue(outgoing[0], 'turnsToInfluential')).toBeNull();
      expect(subjectValue(outgoing[0], 'tourismCultureRatio')).toBe(9);
      expect(firedSubjects(rule(outgoingAudit, 'cultural-influence-becomes-influential-incoming'))).toEqual([]);

      const incomingAudit = await check(evidenceWith({
        baseline: observation(5, 100, base),
        observations: [observation(10, 101, [
          reading(1, 'outgoing', 'Popular', 78, 'Static', 5),
          reading(1, 'incoming', 'Influential', 110, 'Static', 6),
        ])],
      }));
      const incoming = firedSubjects(rule(incomingAudit, 'cultural-influence-becomes-influential-incoming'));
      expect(incoming).toHaveLength(1);
      expect(incoming[0]).toMatchObject({ subject: 'player/1', importance: 80 });
      expect(subjectValue(incoming[0], 'direction')).toBe('incoming');
      expect(subjectValue(incoming[0], 'percentage')).toBe(110);
      expect(firedSubjects(rule(incomingAudit, 'cultural-influence-becomes-influential-outgoing'))).toEqual([]);
    });

    it('should report a trend turn with its ratio and turning point in each direction', async () => {
      const incomingAudit = await check(evidenceWith({
        baseline: observation(5, 100, [reading(1, 'incoming', 'Popular', 70, 'Falling', -5)]),
        observations: [observation(10, 101, [reading(1, 'incoming', 'Popular', 80, 'Rising', 6, 5)])],
      }));
      const incoming = firedSubjects(rule(incomingAudit, 'cultural-influence-trend-turns-incoming'));
      expect(incoming).toHaveLength(1);
      expect(incoming[0]).toMatchObject({ subject: 'player/1', importance: 50 });
      expect(subjectValue(incoming[0], 'rival')).toBe('Brazil');
      expect(subjectValue(incoming[0], 'direction')).toBe('incoming');
      expect(subjectValue(incoming[0], 'percentage')).toBe(80);
      expect(subjectValue(incoming[0], 'trend')).toBe('Rising');
      expect(subjectValue(incoming[0], 'previousTrend')).toBe('Falling');
      expect(subjectValue(incoming[0], 'turnsToInfluential')).toBe(5);
      expect(subjectValue(incoming[0], 'tourismCultureRatio')).toBe(6);
      expect(firedSubjects(rule(incomingAudit, 'cultural-influence-becomes-influential-incoming'))).toEqual([]);

      const outgoingAudit = await check(evidenceWith({
        baseline: observation(5, 100, [reading(1, 'outgoing', 'Familiar', 25, 'Static', 0)]),
        observations: [observation(10, 101, [reading(1, 'outgoing', 'Familiar', 30, 'Falling', -3)])],
      }));
      const outgoing = firedSubjects(rule(outgoingAudit, 'cultural-influence-trend-turns-outgoing'));
      expect(outgoing).toHaveLength(1);
      expect(subjectValue(outgoing[0], 'trend')).toBe('Falling');
      expect(subjectValue(outgoing[0], 'previousTrend')).toBe('Static');
      expect(firedSubjects(rule(outgoingAudit, 'cultural-influence-trend-turns-incoming'))).toEqual([]);
    });

    it('should prefer the milestone over a trend turn in the same direction', async () => {
      const audit = await check(evidenceWith({
        baseline: observation(5, 100, [reading(1, 'outgoing', 'Popular', 75, 'Static', 5)]),
        observations: [observation(10, 101, [reading(1, 'outgoing', 'Influential', 100, 'Falling', 2)])],
      }));
      expect(firedSubjects(rule(audit, 'cultural-influence-becomes-influential-outgoing'))).toHaveLength(1);
      expect(firedSubjects(rule(audit, 'cultural-influence-trend-turns-outgoing'))).toEqual([]);
    });

    it('should report both directions when both readings change in the same window', async () => {
      const audit = await check(evidenceWith({
        baseline: observation(5, 100, [
          reading(1, 'outgoing', 'Popular', 75, 'Static', 5),
          reading(1, 'incoming', 'Familiar', 25, 'Static', 0),
        ]),
        observations: [observation(10, 101, [
          reading(1, 'outgoing', 'Influential', 100, 'Static', 8),
          reading(1, 'incoming', 'Influential', 105, 'Static', 7),
        ])],
      }));
      expect(firedSubjects(rule(audit, 'cultural-influence-becomes-influential-outgoing')))
        .toHaveLength(1);
      expect(firedSubjects(rule(audit, 'cultural-influence-becomes-influential-incoming')))
        .toHaveLength(1);
    });

    it('should keep silent when a gap hides the previous reading', async () => {
      const audit = await check(evidenceWith({
        baseline: observation(5, 100, [reading(1, 'outgoing', 'Popular', 75, 'Rising', 5)]),
        observations: [
          observation(7, 101, [reading(1, 'incoming', 'Popular', 50, 'Static', 0)]),
          observation(9, 102, [reading(1, 'outgoing', 'Influential', 100, 'Rising', 6)]),
        ],
      }));
      expect(firedSubjects(rule(audit, 'cultural-influence-becomes-influential-outgoing'))).toEqual([]);
      expect(firedSubjects(rule(audit, 'cultural-influence-trend-turns-outgoing'))).toEqual([]);
    });

    it('should stay silent when only the percentage moves', async () => {
      const audit = await check(evidenceWith({
        baseline: observation(5, 100, [reading(1, 'incoming', 'Popular', 70, 'Static', 4)]),
        observations: [observation(10, 101, [reading(1, 'incoming', 'Popular', 95, 'Static', 8)])],
      }));
      for (const id of ruleIds) expect(firedSubjects(rule(audit, id))).toEqual([]);
    });
  });
});
