import { describe, expect, it } from 'vitest';
import type { NewspaperEvent, NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { triggerRepeatStateSchema, triggerRuleAuditSchema } from '../../../../../src/newspaper/contracts/triggers.js';
import type { EditorialConstants } from '../../../../../src/newspaper/editorial/config/constants.js';
import { prepareTriggerExpressions } from '../../../../../src/newspaper/editorial/config/expressions.js';
import { getEditorialTriggerExpressions, loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialTriggerRule } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { evaluateTriggerRules, longestRuleWindow } from '../../../../../src/newspaper/editorial/rules/evaluate.js';

const constants: EditorialConstants = {
  distances: { neighboring: 7 },
  spans: { recent: 5, long: 40 }, sizes: {}, shares: {}, types: { settlers: ['Settler', 'Pioneer'] },
  shortcuts: { city: { neighbor: 'city.foreign && city.distance.own <= neighboring' } },
};

const annexationId = 'neighbor-puppet-annexed';
const settlerId = 'settler-departure';

/** Exercise the two example entries as loaded from the shipped catalogue. */
async function runExamples(model: ReturnType<typeof facts>) {
  const config = await loadEditorialConfig();
  const rules = config.triggers.filter(rule => rule.id === annexationId || rule.id === settlerId);
  const compiled = await getEditorialTriggerExpressions(config);
  return evaluateTriggerRules({ rules, compiled, constants: config.constants, facts: model, speedMultiplier: 1 });
}
/** Supply two dated rows per city when needed, with distinct observation IDs. */
function city(subjectID: number, id: number, turn: number, values: NewspaperSnapshot['values']): NewspaperSnapshot {
  return { subjectID, source: { table: 'CityInformations', id, turn, createdAt: 10 * turn + 2 }, values: { Y: 0, ...values } };
}

/** Supply one visible event with the same shape the archive projection returns. */
function event(id: number, turn: number, type: string, values: NewspaperEvent['values']): NewspaperEvent {
  return { type, source: { table: 'GameEvents', id, turn, createdAt: 10 * turn + 8 }, values };
}

/** Build usable public facts at the cutoff, with a longer recorded history than the reporting period. */
function facts({ cities = [], history = cities, events = [], turn = 20, previous = 18 }: {
  cities?: NewspaperSnapshot[]; history?: NewspaperSnapshot[]; events?: NewspaperEvent[];
  turn?: number; previous?: number;
} = {}) {
  const players: NewspaperSnapshot[] = [0, 1, 2].map(id => ({
    subjectID: id, source: { table: 'PlayerSummaries', id: id + 100, turn: 0, createdAt: 0 }, values: {},
  }));
  const evidence: NewspaperEvidence = {
    request: { receiverPlayerID: 0, previousCheckTurn: previous, cutoffTurn: turn, historyFromTurn: -1 },
    cities, players, events: events.filter(({ source }) => source.turn > previous),
    comparisons: { cities: [], players: [] },
    history: { fromTurn: -1, snapshots: { cities: history, players }, baseline: { cities: [], players: [] },
      events, gaps: [] },
  };
  return buildNewspaperFacts(evidence, { mapWidth: 64, mapHeight: 32, mapWrapX: true,
    playerIdentities: { 0: { major: true }, 1: { major: true }, 2: { major: false } } });
}

/** Compile once and share the prepared catalogue between checks. */
async function prepare(rules: EditorialTriggerRule[], speedMultiplier = 1) {
  const compiled = await prepareTriggerExpressions(rules, constants);
  return (model: ReturnType<typeof facts>, repeatState?: Awaited<ReturnType<typeof evaluateTriggerRules>>['repeatState']) =>
    evaluateTriggerRules({ rules, compiled, constants, facts: model, speedMultiplier, repeatState });
}

/** Produce examples with controlled visibility and recorded history. */
function examples(status: 'positive' | 'false' | 'hidden') {
  const homeBefore = city(10, 1, 15, { X: 10, OwnerID: 0, Population: 8 });
  const home = city(10, 2, 20, { X: 10, OwnerID: 0, Population: 6,
    ...(status === 'hidden' ? {} : { FoodPerTurn: status === 'false' ? 0 : 2 }) });
  const portBefore = city(20, 3, 15, { X: 14, Name: 'Port', OwnerID: 1, IsPuppet: true });
  const port = city(20, 4, 20, { X: 14, Name: 'Port', OwnerID: status === 'false' ? 2 : 1, IsPuppet: false, IsOccupied: true });
  const settlerTrained = event(200, 17, 'CityTrained', { PlayerID: 0, CityID: 10, CityX: 10, CityY: 0, Unit: 'Pioneer' });
  return facts({ cities: [port, home], history: [homeBefore, home, ...(status === 'hidden' ? [] : [portBefore]), port],
    events: [settlerTrained] });
}

describe('newspaper trigger rules', () => {
  describe('owner examples', () => {
    it('should fire both rules from visible facts and cite the rows behind each match', async () => {
      const result = await runExamples(examples('positive'));
      expect(result.developments).toMatchObject([
        { definitionId: annexationId, subject: 'city/20', values: { distance: 4 }, importance: 58, urgent: false },
        { definitionId: settlerId, subject: 'city/10', values: { lost: 2 }, importance: 50, urgent: false },
      ]);
      expect(result.developments[0].sources.map(source => source.id)).toEqual(expect.arrayContaining([2, 3, 4]));
      expect(result.developments[1].sources.map(source => source.id)).toEqual(expect.arrayContaining([1, 2, 200]));
      expect(result.audit.map(rule => rule.subjects.map(subject => [subject.subject, subject.outcome])))
        .toEqual([[['city/10', 'false'], ['city/20', 'fired']], [['city/10', 'fired'], ['city/20', 'false']]]);
      expect(triggerRuleAuditSchema.array().parse(JSON.parse(JSON.stringify(result.audit)))).toEqual(result.audit);
    });

    it.each([
      ['false', 3, undefined, undefined], ['hidden', 1, 'city.before', 'city.foodPerTurn'],
    ] as const)('should stop each rule when a predicate is %s', async (status, portIndex, portHidden, homeHidden) => {
      const result = await runExamples(examples(status));
      expect(result.developments).toEqual([]);
      const port = result.audit[0].subjects[1], home = result.audit[1].subjects[0];
      expect(port).toMatchObject({ outcome: status, failedWhen: portIndex });
      expect(home).toMatchObject({ outcome: status, failedWhen: 3 });
      expect(port.expressions).toHaveLength(portIndex + 1);
      expect(home.expressions).toHaveLength(4);
      expect(port.expressions.at(-1)?.hidden).toBe(portHidden);
      expect(home.expressions.at(-1)?.hidden).toBe(homeHidden);
    });
  });

  describe('windows and repeat state', () => {
    it('should use the reporting period for event subjects and the configured horizon for globals', async () => {
      const rule: EditorialTriggerRule = { id: 'events', subject: 'event', event: ['GreatPersonExpended'],
        window: 45, when: 'true', values: { eventTurn: 'event.turn', observed: 'events.length' }, tags: [] };
      const run = await prepare([rule,
        { id: 'pair', subject: 'pair', when: 'true', tags: [] },
        { id: 'incident', subject: 'incident', when: 'true', tags: [] },
      ], 2);
      const input = facts({ events: [
        event(204, 20, 'GreatPersonExpended', {}),
        event(202, 18, 'GreatPersonExpended', {}),
        event(201, 16, 'GreatPersonExpended', {}),
        event(203, 19, 'CityTrained', {}),
      ] });
      const result = await run(input);
      expect(longestRuleWindow([rule, { ...rule, window: 90, enabled: false }], constants, 2)).toBe(90);
      expect(result.audit.map(record => record.subjectCount)).toEqual([1, 0, 0]);
      expect(result.developments).toMatchObject([{ subject: 'event/204', values: { eventTurn: 20, observed: 4 } }]);
      expect(result.repeatState).toEqual({});
    });

    it('should distinguish groups of new events with the same key without keeping per-event repeat memory', async () => {
      const run = await prepare([{ id: 'training', subject: 'event', event: 'CityTrained',
        when: 'true', group: { by: '"training"' }, tags: [] }]);
      const old = [event(301, 19, 'CityTrained', {}), event(302, 20, 'CityTrained', {})];
      const first = await run(facts({ events: old }));
      const second = await run(facts({ turn: 22, previous: 20, events: [
        ...old, event(303, 21, 'CityTrained', {}), event(304, 22, 'CityTrained', {}),
      ] }), first.repeatState);
      expect(first.developments[0].subject).toBe(second.developments[0].subject);
      expect(first.developments[0].fingerprint).not.toBe(second.developments[0].fingerprint);
      expect(second.developments[0].seriesKeys).toEqual(['event/303', 'event/304'].map(subject => JSON.stringify(['training', subject])));
      expect(second.repeatState).toEqual({});
    });
    it('should keep repeated coverage of the same rule in a series separate from other rules on that subject', async () => {
      const run = await prepare([
        { id: 'trade', subject: 'world', when: 'true', repeat: 2, tags: [] },
        { id: 'politics', subject: 'world', when: 'true', repeat: 2, tags: [] },
      ]);
      const first = await run(facts());
      const next = await run(facts({ turn: 22, previous: 20 }), first.repeatState);
      expect(first.developments.map(development => development.subject)).toEqual(['world', 'world']);
      expect(first.developments[0].seriesKeys).not.toEqual(first.developments[1].seriesKeys);
      expect(next.developments.map(development => development.seriesKeys))
        .toEqual(first.developments.map(development => development.seriesKeys));
      expect(next.developments[0].fingerprint).not.toBe(first.developments[0].fingerprint);
    });
    it('should remember once, rearm after false, and measure a cooldown in scaled turns after restore', async () => {
      const run = await prepare([
        { id: 'once', subject: 'world', when: 'turn !== 21', repeat: 'once', tags: [] },
        { id: 'rearm', subject: 'world', when: 'turn !== 21', tags: [] },
        { id: 'span', subject: 'world', when: 'true', repeat: 'recent', tags: [] },
      ], 2);
      const t20 = await run(facts());
      expect(t20.developments.map(d => d.definitionId)).toEqual(['once', 'rearm', 'span']);
      const restored = triggerRepeatStateSchema.parse(JSON.parse(JSON.stringify(t20.repeatState)));
      const t21 = await run(facts({ turn: 21 }), restored);
      expect(t21.developments).toEqual([]);
      const t29 = await run(facts({ turn: 29 }), t21.repeatState);
      expect(t29.developments.map(d => d.definitionId)).toEqual(['rearm']);
      const t30 = await run(facts({ turn: 30 }), t29.repeatState);
      expect(t30.developments.map(d => d.definitionId)).toEqual(['span']);
      expect(restored).toEqual(t20.repeatState);
    });
  });

  describe('derived values and groups', () => {
    it('should bind scalar values in order, clamp importance, and apply group ratings only above the minimum', async () => {
      const rule: EditorialTriggerRule = { id: 'religion', subject: 'city', when: 'city.majorityReligion',
        values: { population: 'city.population', doubled: 'population * 2' },
        group: { by: 'doubled === 2 ? "singleton" : city.majorityReligion' },
        importance: 'matches[0].values.doubled * 100 + count',
        urgent: 'key === "Buddhism" && count === 2 && typeof city === "undefined"', tags: [] };
      const cities = [
        city(3, 3, 20, { MajorityReligion: 'Buddhism', Population: 1 }),
        city(2, 2, 20, { MajorityReligion: 'Buddhism', Population: 7 }),
        city(1, 1, 20, { MajorityReligion: 'Buddhism', Population: 4 }),
      ];
      const run = await prepare([rule]);
      const result = await run(facts({ cities }));
      expect(result.developments).toMatchObject([{
        seriesKeys: ['city/1', 'city/2'].map(subject => JSON.stringify(['religion', subject])), importance: 100, urgent: true,
        values: { count: 2, key: 'Buddhism', matches: [
          { subject: 'city/1', values: { population: 4, doubled: 8 } },
          { subject: 'city/2', values: { population: 7, doubled: 14 } },
        ] },
      }]);
      expect(result.developments[0].sources.map(source => source.id)).toEqual([1, 2]);
      expect(result.audit[0].groups).toMatchObject([{ outcome: 'fired', importance: 100, urgent: true }, { outcome: 'too-small' }]);
      expect(result.audit[0].groups[1].expressions).toEqual([]);
      expect(Object.keys(result.repeatState)).toHaveLength(2);
    });

    it('should share the interruption cap across subject and grouped ratings', async () => {
      const timedOut: EditorialTriggerRule[] = Array.from({ length: 7 }, (_, index) => ({
        id: `timeout-${index}`, subject: 'world', when: '(() => { while (true) {} })()', tags: [],
      }));
      const group: EditorialTriggerRule = {
        id: 'group', subject: 'world', when: 'true', group: { by: '"group"', min: 1 },
        importance: '(() => { while (true) {} })()', urgent: 'true', tags: [],
      };
      const earlier: EditorialTriggerRule = {
        ...group, id: 'valid', importance: '100 * count',
      };
      const later: EditorialTriggerRule = {
        ...group, id: 'skipped', importance: '100 * count',
      };
      const run = await prepare([...timedOut, earlier, group, later]);
      const result = await run(facts());
      expect(result.developments.map(development => development.definitionId)).toEqual(['valid']);
      expect(result.audit.at(-2)?.groups[0].expressions.map(expression => expression.field)).toEqual(['importance']);
      expect(result.audit.at(-1)?.groups[0]).toMatchObject({ outcome: 'error', expressions: [
        { field: 'importance', error: expect.stringContaining('interruption limit') },
      ] });
    });
    it('should stop at execution failures without evaluating later fields or exposing map metadata', async () => {
      const run = await prepare([
        { id: 'invalid', subject: 'world', when: 'true', importance: 'true', urgent: 'game.mapWidth > 0', tags: [] },
        { id: 'secret', subject: 'world', when: ['game.mapWidth', 'game.mapWrapX'], tags: [] },
        { id: 'safe', subject: 'world', when: 'typeof mapWidth === "undefined" && !game.knows("mapWrapX")',
          importance: -5, urgent: '"yes"', tags: [] },
      ]);
      const result = await run(facts());
      expect(result.developments).toMatchObject([{ definitionId: 'safe', importance: 0, urgent: true }]);
      expect(result.audit[0].subjects[0].expressions.map(expression => expression.field)).toEqual(['when', 'importance']);
      expect(result.audit[1].subjects[0]).toMatchObject({ outcome: 'hidden', failedWhen: 0,
        expressions: [{ hidden: 'game.mapWidth' }] });
    });
  });
});
