import { describe, expect, it } from 'vitest';
import type { NewspaperEvidence } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import type { RuleDevelopment } from '../../../../../src/newspaper/contracts/triggers.js';
import { scaleEditorialConstants } from '../../../../../src/newspaper/editorial/config/constants.js';
import { getEditorialExpressions, loadEditorialConfig, parseEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { evaluateTriggerRules } from '../../../../../src/newspaper/editorial/rules/evaluate.js';
import { matchTemplates } from '../../../../../src/newspaper/editorial/selection/templates.js';

const standard = {
  id: 'report', tags: [], weight: { base: 1 },
  variants: [{ id: 'account', headline: 'News from {{city}}', body: ['Published on turn {{period.to}}.'], weight: { base: 1 } }],
};

/** Exercise authored eligibility against the same visible facts and compiled catalogue as a check. */
async function candidates(totalCities: number, triggers: unknown[], template: unknown,
  { adjust, receiverName = 'France' }: {
    adjust?: (developments: RuleDevelopment[]) => RuleDevelopment[];
    receiverName?: string;
  } = {}) {
  const base = await loadEditorialConfig();
  const config = await parseEditorialConfig({ ...base, triggers, templates: [template] });
  const cities: NewspaperEvidence['cities'] = Array.from({ length: totalCities }, (_, id) => ({
    subjectID: id,
    source: { table: 'CityInformations', id, turn: 10, createdAt: 10 },
    values: { Name: `City ${id}`, OwnerID: 0, Population: id + 1, MajorityReligion: 'Buddhism' },
  }));
  const owner = {
    subjectID: 0, source: { table: 'PlayerSummaries' as const, id: 2, turn: 10, createdAt: 10 }, values: {},
  };
  const facts = buildNewspaperFacts({
    request: { receiverPlayerID: 0, cutoffTurn: 10, previousCheckTurn: 8, historyFromTurn: 5 },
    players: [owner], cities, events: [], comparisons: { players: [], cities: [] },
    history: { fromTurn: 5, baseline: { players: [], cities: [] },
      snapshots: { players: [owner], cities }, events: [], gaps: [] },
  }, { playerIdentities: { 0: { name: receiverName, major: true } } });
  const compiled = await getEditorialExpressions(config);
  const rules = await evaluateTriggerRules({
    rules: config.triggers, compiled, facts, constants: config.constants, speedMultiplier: 1,
  });
  const batch = { facts, constants: scaleEditorialConstants(config.constants, 1) };
  return matchTemplates(adjust?.(rules.developments) ?? rules.developments, config, compiled, batch);
}

describe('newspaper template matching', () => {
  it.each([
    ['The Aztecs', ['generic', 'mesoamerican']],
    ['The Maya', ['generic', 'mesoamerican']],
    ['Indonesia', ['generic', 'southeastAsianAndPacific']],
    ['Polynesia', ['generic', 'southeastAsianAndPacific']],
    ['France', ['generic']],
  ] as const)('should offer the eligible regional variants to %s', async (receiverName, expected) => {
    const variant = { ...standard.variants[0], headline: 'News' };
    const selected = await candidates(0, [{ id: 'report', subject: 'world', when: 'true' }], {
      ...standard, triggers: ['report'],
      variants: [
        { ...variant, id: 'generic' },
        { ...variant, id: 'mesoamerican', when: 'self.is.mesoamerican' },
        { ...variant, id: 'southeastAsianAndPacific', when: 'self.is.southeastAsianAndPacific' },
      ],
    }, { receiverName });
    expect(selected).toHaveLength(1);
    expect(selected[0].variants.map(({ id }) => id)).toEqual(expected);
  });

  it('should find a shared subject even after more than one hundred other rule matches', async () => {
    const selected = await candidates(130, [
      { id: 'all', subject: 'city', when: 'true', values: { population: 'city.population' } },
      { id: 'last', subject: 'city', when: 'city.id === 129' },
    ], {
      ...standard, triggers: ['all', 'last'],
      when: 'period.from === 8 && values.population === city.population && subject.id === 129',
      weight: { base: 0, adjustments: [{ when: 'triggerValues.all.population === 130', add: 2 }] },
      variants: [{ ...standard.variants[0], headline: 'News from {{city}} in {{owner}}' }],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      subject: 'city/129', weight: 2,
      values: { city: 'City 129', cityId: 129, owner: 'France', ownerId: 0, 'period.to': 10 },
    });
    expect(selected[0].triggerIds).toHaveLength(2);
    expect(selected[0].variantSources.account).toEqual([
      expect.objectContaining({ table: 'CityInformations', id: 129 }),
      expect.objectContaining({ table: 'PlayerSummaries', id: 2 }),
    ]);
  });

  it('should expose group totals and each member’s values without treating a member as the group', async () => {
    const selected = await candidates(3, [
      { id: 'conversions', subject: 'city', when: 'true', values: { population: 'city.population' },
        group: { by: 'city.majorityReligion', min: 3 } },
    ], {
      ...standard, triggers: ['conversions'],
      when: 'group.count === 3 && group.matches[1].city.name === "City 1" && typeof city === "undefined"',
      variants: [
        { id: 'valid', headline: '{{group.key}} spreads to {{count}} cities', body: ['Turn {{period.to}}.'],
          when: 'group.matches[2].values.population === 3 && !Object.hasOwn(values, "population")',
          weight: { base: 0, adjustments: [{ when: 'group.matches.every(m => m.city.id >= 0)', add: 1 }] } },
        { id: 'false', headline: '{{key}} spreads', body: ['Observed this turn.'],
          when: 'group.matches[0].values.population > 10', weight: { base: 100 } },
        { id: 'missing', headline: 'Missing {{city}}', body: ['Observed this turn.'], weight: { base: 100 } },
      ],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0].variants.map((variant) => variant.id)).toEqual(['valid']);
    expect(selected[0].values).toMatchObject({ key: 'Buddhism', count: 3 });
    expect(selected[0].values).not.toHaveProperty('population');
  });

  it('should skip variants with invalid link destinations or direct reads of an unavailable subject name', async () => {
    const selected = await candidates(0, [
      { id: 'generic', subject: 'world', when: 'true', values: { empty: '""' } },
    ], {
      ...standard, triggers: ['generic'],
      variants: [
        { id: 'valid', headline: 'News', body: ['Turn {{period.to}}.'],
          when: '!subject.knows("name") && subject.kind === "world"', weight: { base: 1 } },
        { id: 'missing-name', headline: 'News', body: ['No city named.'],
          when: '!subject.name', weight: { base: 100 } },
        { id: 'missing-id', headline: 'News from city {{cityId}}', body: ['No city named.'],
          weight: { base: 100 } },
        { id: 'invalid-link', headline: 'News', body: ['See {{location}}.'], weight: { base: 100 },
          links: [{ placeholder: 'location', label: 'our city', target: { type: 'city', cityId: '{{empty}}' } }] },
      ],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0].variants.map((variant) => variant.id)).toEqual(['valid']);
  });

  it('should give each grouped rule its own membership and suppress ambiguous group placeholders', async () => {
    const selected = await candidates(3, [
      { id: 'conversions', subject: 'city', when: 'true', group: { by: 'city.majorityReligion', min: 2 } },
      { id: 'growth', subject: 'city', when: 'city.population > 1', group: { by: 'city.majorityReligion', min: 2 } },
    ], {
      ...standard, triggers: ['conversions', 'growth'],
      when: 'typeof group === "undefined" && typeof count === "undefined" && triggerValues.growth.matches[0].city.id === 1',
      variants: [
        { ...standard.variants[0], id: 'ambiguous', headline: '{{count}} cities' },
        { ...standard.variants[0], id: 'ambiguous-key', headline: '{{group.key}} spreads' },
        { ...standard.variants[0], id: 'qualified',
          headline: '{{triggerValues.conversions.key}} reaches {{triggerValues.conversions.count}} cities',
          body: ['Of these, {{triggerValues.growth.count}} are growing.'],
          when: 'triggerValues.conversions.matches.length === 3 && triggerValues.growth.count === 2' },
      ],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ subject: 'group/city/"Buddhism"',
      values: { 'triggerValues.conversions.count': 3, 'triggerValues.growth.count': 2 } });
    expect(selected[0].variants.map((variant) => variant.id)).toEqual(['qualified']);
  });

  it('should use qualified scalar names and match only intersecting rule windows', async () => {
    const rules = [
      { id: 'ledger', subject: 'city', window: 5, when: 'true', values: { amount: '2' } },
      { id: 'growth', subject: 'city', when: 'true', values: { amount: '3' } },
    ];
    const template = {
      ...standard, triggers: ['ledger', 'growth'],
      when: 'typeof amount === "undefined" && !Object.hasOwn(values, "amount") && triggerValues.ledger.amount === 2',
      variants: [
        { ...standard.variants[0], id: 'ambiguous', headline: '{{amount}}' },
        { ...standard.variants[0], id: 'qualified', headline: '{{triggerValues.ledger.amount}} and {{triggerValues.growth.amount}}' },
      ],
    };
    const overlapping = await candidates(1, rules, template);
    expect(overlapping).toHaveLength(1);
    expect(overlapping[0]).toMatchObject({ period: { from: 8, to: 10 },
      values: { 'triggerValues.ledger.amount': 2, 'triggerValues.growth.amount': 3 } });
    expect(overlapping[0].variants.map((variant) => variant.id)).toEqual(['qualified']);

    const adjacent = await candidates(1, rules, template, {
      adjust: (developments) => developments.map((development) =>
        development.definitionId === 'ledger' ? { ...development, period: { from: 5, to: 8 } } : development
      ),
    });
    expect(adjacent).toEqual([]);
  });
});
